// The 3D view on the real map: loads baked chunks around the car, drives the SUV along the real
// route with traffic, and follows it with the camera. Reads game numbers; owns no game rules.
import {
  BoxGeometry, Color, DirectionalLight, Fog, HemisphereLight, InstancedMesh, Mesh, MeshBasicMaterial, Object3D,
  PerspectiveCamera, Scene, SphereGeometry, Vector3, WebGLRenderer,
} from 'three';
import { chunkIndex, expandLanes, laneOffset, poseAt, type MapChunk, type RouteIndex, type RoutePose } from '../map/chunk';
import { initTraffic, rng, stepTraffic, type TrafficCar } from '../world';
import { perceives, type Cone } from '../perception';
import { sensorUniforms, setCones, withSensorView } from './sensorShader';
import { flat, makeSuv, trafficGeometries } from './models';
import { buildChunk, setBlueLaneLines, type ChunkMeshes } from './mapMeshes';
import { createCrashView } from './crashScene';
import { makeRider } from './models';
import { RIDERS } from '../crashSim';

const TRAFFIC_COUNT = 10;
const CAR_COLORS = [0xd9d9d9, 0x9aa5b1, 0x3d5a80, 0xe76f51, 0xf4f1de, 0x6d597a, 0x283618, 0xbc4749, 0x1d1d1d];
/** Beyond this gap between where the game says we are and where the car is drawn, jump instead of driving. */
const SNAP_GAP = 3000;

export interface MapView {
  /**
   * Advance and draw one frame. `routeMeters` is how far along the route the car is,
   * `cones` what the car's sensors cover, `autonomy` the autonomy level (0..5), `crash` the crash in
   * progress (a new `id` plays the crash animation), `daylight` 0 (night) to 1 (day), `ending` true
   * once the family has arrived (full color, sunset, the camera rises over the mountains).
   */
  frame(dt: number, routeMeters: number, cones: readonly Cone[], autonomy: number, crash?: { id: number; kind: string }, daylight?: number, ending?: boolean): void;
  /** Where we are, for the HUD (undefined until the map index has loaded). */
  place(): { s: number; total: number; prev: string; next?: { name: string; s: number } } | undefined;
}

interface Loaded { data: MapChunk; meshes: ChunkMeshes; lanes: [number, number][] }

export function createMapView(container: HTMLElement, opts: { seed: number; mile?: number }): MapView {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    container.classList.add('no-webgl');
    container.textContent = 'This browser can\'t show the 3D view (WebGL is off).';
    return { frame: () => {}, place: () => undefined };
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);
  const status = document.createElement('div');
  status.className = 'view-status';
  status.textContent = 'Loading the map…';
  container.appendChild(status);

  const scene = new Scene();
  // Beyond its sensors the car's screen fades to a dark night-blue.
  const sky = new Color(0x16202c);
  const DAY_SKY = new Color(0x1f3a55), NIGHT_SKY = new Color(0x04070d);
  scene.background = sky;
  const fog = new Fog(sky, 300, 1300);
  scene.fog = fog;
  const camera = new PerspectiveCamera(55, 1, 1, 2500);
  const hemi = new HemisphereLight(0xffffff, 0x8a7f6a, 2.0);
  scene.add(hemi);
  const sun = new DirectionalLight(0xfff2d6, 2.0);
  sun.position.set(-0.5, 1, 0.35);
  scene.add(sun);

  const suv = makeSuv();
  suv.rotation.order = 'YXZ';
  scene.add(suv);
  const tg = trafficGeometries();
  const bodies = new InstancedMesh(tg.body, withSensorView(flat(0xffffff)), TRAFFIC_COUNT);
  const cabins = new InstancedMesh(tg.cabin, withSensorView(flat(0x1b2a38)), TRAFFIC_COUNT);
  // Cars the sensors have detected get a glowing box, like a self-driving car's screen.
  const boxGeo = new BoxGeometry(2.3, 2.0, 5.0);
  boxGeo.translate(0, 1.0, 0);
  const boxes = new InstancedMesh(boxGeo, new MeshBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.28, depthWrite: false }), TRAFFIC_COUNT);
  bodies.frustumCulled = cabins.frustumCulled = boxes.frustumCulled = false;
  scene.add(bodies, cabins, boxes);
  const crashView = createCrashView(scene);
  let playedCrash = -1;
  // The family at the overlook, for the ending.
  const family = new Object3D();
  RIDERS.filter((r) => !r.id.startsWith('s')).forEach((r, i) => {
    const m = makeRider(r.id, r.half).group;
    m.position.set(i * 0.8, r.half[1] + (r.id === 'dog' ? 0 : 0.35), 0);
    family.add(m);
  });
  family.visible = false;
  scene.add(family);
  const sunDisk = new Mesh(new SphereGeometry(120, 24, 12), new MeshBasicMaterial({ color: 0xffd27a, fog: false }));
  sunDisk.visible = false;
  scene.add(sunDisk);
  let endT = 0;
  const SUNSET = new Color(0xf29e6b), warm = new Color(0xffb27a), white = new Color(0xfff2d6);
  const fwdDir = new Vector3();
  let crashTime = 0;

  const base = new URL('map/', document.baseURI).href;
  let index: RouteIndex | undefined;
  const chunks = new Map<number, Loaded | 'loading'>();
  let anchor: [number, number] | undefined;
  let k = 1; // real meters per mercator meter at the anchor
  let shownS: number | undefined;
  let lateral = 0;
  let speedEst = 10;
  let traffic: TrafficCar[] | undefined;
  const r = rng(opts.seed);
  const camPos = new Vector3(), camLook = new Vector3();
  let camReady = false;

  fetch(base + 'route.json')
    .then((res) => res.json())
    .then((j: RouteIndex) => { index = j; })
    .catch(() => { status.textContent = 'Could not load the map.'; });

  function want(i: number) {
    if (!index || i < 0 || i >= index.chunks || chunks.has(i)) return;
    chunks.set(i, 'loading');
    fetch(`${base}c/${String(i).padStart(4, '0')}.json`)
      .then((res) => res.json())
      .then((data: MapChunk) => {
        const meshes = buildChunk(data);
        const entry: Loaded = { data, meshes, lanes: expandLanes(data.ln) };
        chunks.set(i, entry);
        scene.add(meshes.group);
        placeGroup(entry);
      })
      .catch(() => chunks.delete(i));
  }

  function placeGroup(c: Loaded) {
    if (!anchor) return;
    c.meshes.group.position.set((c.data.o[0] - anchor[0]) * k, 0, -(c.data.o[1] - anchor[1]) * k);
    c.meshes.group.scale.set(k, 1, k);
  }

  /** Move the scene origin to this chunk (keeps coordinates small for the GPU). */
  function rebase(c: MapChunk) {
    const old = anchor;
    anchor = [c.o[0], c.o[1]];
    k = Math.cos((c.lat * Math.PI) / 180);
    for (const e of chunks.values()) if (e !== 'loading') placeGroup(e);
    if (old) {
      // Shift the camera with the world so it doesn't jump.
      const dx = (old[0] - anchor[0]) * k, dz = -(old[1] - anchor[1]) * k;
      camPos.x += dx; camPos.z += dz;
      camLook.x += dx; camLook.z += dz;
    }
  }

  function pose(s: number): RoutePose | undefined {
    if (!index) return undefined;
    const e = chunks.get(chunkIndex(index, s));
    if (!e || e === 'loading') return undefined;
    return poseAt(e.data, s, e.lanes);
  }

  /** Scene-space position of a point `off` meters right of the route at pose p. */
  function toScene(p: RoutePose, off: number, out: Vector3, lift = 0) {
    // Right of travel in mercator is (dy, -dx); scene z = -north.
    out.set((p.x - anchor![0]) * k + p.dy * off, p.h + lift, -(p.y - anchor![1]) * k + p.dx * off);
    return out;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 62 : 52;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const dummy = new Object3D();
  dummy.rotation.order = 'YXZ';
  const tint = new Color();
  const v = new Vector3(), ahead = new Vector3();

  function frame(dt: number, routeMeters: number, cones: readonly Cone[], autonomy: number, crash?: { id: number; kind: string }, daylight = 1, ending = false) {
    setCones(cones);
    // The ending fades from the sensor view to the full-color world at sunset.
    endT = ending ? Math.min(1, endT + dt / 6) : 0;
    const e = endT * endT * (3 - 2 * endT);
    sensorUniforms.uSensorMix.value = 1 - e;
    // Day and night: dimmer light and a darker sky after dark.
    const light = daylight + (1 - daylight) * e;
    hemi.intensity = 0.5 + 1.5 * light;
    sun.intensity = 0.1 + 1.9 * light;
    sun.color.lerpColors(white, warm, e);
    sky.lerpColors(NIGHT_SKY, DAY_SKY, daylight).lerp(SUNSET, e);
    fog.color.copy(sky);
    fog.near = 300 + 900 * e;
    fog.far = 1300 + 4500 * e;
    if (ending && camera.far < 6000) { camera.far = 7000; camera.updateProjectionMatrix(); }
    setBlueLaneLines(autonomy >= 2);
    if (!index) { renderer.render(scene, camera); return; }
    const target = Math.min(index.total, opts.mile !== undefined ? opts.mile * 1609.344 : routeMeters);
    const ci = chunkIndex(index, shownS ?? target);
    for (let i = ci - 1; i <= ci + 2; i++) want(i);
    for (const [i, e] of chunks) {
      if (i < ci - 2 || i > ci + 3) {
        if (e !== 'loading') { scene.remove(e.meshes.group); e.meshes.dispose(); }
        chunks.delete(i);
      }
    }

    // Ease the drawn car toward the game's position; jump if it's far (offline catch-up, first load).
    if (shownS === undefined || Math.abs(target - shownS) > SNAP_GAP) {
      if (!pose(target)) { renderer.render(scene, camera); return; }
      shownS = target;
      traffic = undefined;
      camReady = false;
    } else {
      const next = shownS + (target - shownS) * Math.min(1, dt * 2.5);
      if (pose(next)) {
        speedEst += ((next - shownS) / Math.max(dt, 1e-3) - speedEst) * Math.min(1, dt * 2);
        shownS = next;
      }
    }
    const p = pose(shownS)!;
    const cur = chunks.get(chunkIndex(index, shownS)) as Loaded;
    if (!anchor || anchor[0] !== cur.data.o[0] || anchor[1] !== cur.data.o[1]) rebase(cur.data);
    if (status.isConnected) { status.remove(); container.dataset.ready = '1'; }

    // The SUV keeps to the rightmost lane of our side of the road.
    const laneTarget = laneOffset(p.fwd, p.back, p.fwd - 1);
    lateral += (laneTarget - lateral) * Math.min(1, dt * 1.5);
    toScene(p, lateral, suv.position);
    suv.rotation.set(Math.atan(p.grade), Math.atan2(-p.dx, p.dy), 0);
    suv.position.y += Math.sin(performance.now() / 110) * 0.02;
    sensorUniforms.uSensorCar.value.copy(suv.position);
    sensorUniforms.uSensorFwd.value.set(p.dx, -p.dy).normalize();

    // Crashes: the same crash id always plays the same tumble (a crash from while you were away replays).
    if (crash && crash.id !== playedCrash) {
      playedCrash = crash.id;
      crashTime = 0;
      crashView.start(crash.id * 7919 + 13, crash.kind, suv.position, suv.rotation.y);
    } else if (!crash && crashView.active) {
      crashView.stop();
    }
    suv.visible = !crashView.active;
    if (crashView.active) { crashView.update(dt); crashTime += dt; }

    // Traffic, in lanes of our direction.
    const road = { lanes: p.fwd, playerLane: p.fwd - 1 };
    const vs = Math.max(5, speedEst);
    traffic ??= initTraffic(TRAFFIC_COUNT, vs, r, road);
    stepTraffic(traffic, Math.min(dt, 0.1), vs, r, road);
    traffic.forEach((c, i) => {
      const cp = pose(shownS! - c.z);
      let seen = false;
      if (!cp) { dummy.scale.setScalar(0); }
      else {
        const off = laneOffset(cp.fwd, cp.back, Math.min(c.x, cp.fwd - 1));
        seen = perceives(cones, -c.z, off - lateral);
        toScene(cp, off, dummy.position);
        dummy.rotation.set(Math.atan(cp.grade), Math.atan2(-cp.dx, cp.dy) + (c.lane - c.x) * 0.15, 0);
        dummy.scale.setScalar(1);
      }
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      cabins.setMatrixAt(i, dummy.matrix);
      if (!seen) { dummy.scale.setScalar(0); dummy.updateMatrix(); }
      boxes.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, tint.setHex(CAR_COLORS[c.color % CAR_COLORS.length]));
    });
    bodies.instanceMatrix.needsUpdate = cabins.instanceMatrix.needsUpdate = boxes.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;

    // Chase camera: behind and above, looking a little ahead along the road.
    const back = pose(shownS - 25) ?? p;
    const fwd = pose(shownS + 30) ?? p;
    toScene(back, lateral * 0.5, v, 0);
    v.y = Math.max(v.y, p.h) + 17;
    toScene(fwd, lateral * 0.5, ahead, 0);
    if (crashView.active) {
      // Circle the wreck, close in.
      crashView.focus(ahead);
      const a = suv.rotation.y + 2.2 + crashTime * 0.35;
      v.set(ahead.x + Math.sin(a) * 8, ahead.y + 3.5, ahead.z + Math.cos(a) * 8);
      ahead.y -= 1.8; // look a bit below the wreck so it sits above the crash banner
    }
    family.visible = e > 0;
    if (e > 0) {
      // Park at the overlook: the family stands beside the SUV, and the camera swings round
      // behind them to look over the car toward the setting sun.
      fwdDir.set(p.dx, 0, -p.dy).normalize();
      toScene(p, lateral + 2.6, family.position);
      family.rotation.y = suv.rotation.y;
      const side = new Vector3(-fwdDir.z, 0, fwdDir.x);
      const near = new Vector3().copy(suv.position).addScaledVector(fwdDir, -12).addScaledVector(side, 7);
      near.y = Math.max(near.y, p.h) + 4;
      v.lerp(near, e);
      ahead.lerp(new Vector3().copy(suv.position).addScaledVector(fwdDir, 80).setY(suv.position.y + 12), e);
      sunDisk.position.copy(suv.position).addScaledVector(fwdDir, 3000).addScaledVector(side, 400);
      sunDisk.position.y = suv.position.y + 260;
    }
    sunDisk.visible = e > 0.3;
    if (!camReady) { camPos.copy(v); camLook.copy(ahead); camReady = true; }
    const ease = Math.min(1, dt * 3);
    camPos.lerp(v, ease);
    camLook.lerp(ahead, ease);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    sun.target.position.copy(suv.position);
    sun.position.copy(suv.position).add(v.set(-200, 400, 140));
    sun.target.updateMatrixWorld();

    renderer.render(scene, camera);
  }

  function place() {
    if (!index) return undefined;
    const s = shownS ?? 0;
    const passed = index.waypoints.filter((w) => w.s <= s + 1);
    return { s, total: index.total, prev: passed[passed.length - 1]?.name ?? index.waypoints[0].name, next: index.waypoints.find((w) => w.s > s + 1) };
  }

  return { frame, place };
}
