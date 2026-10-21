// Three.js scene: the SUV on an endless 3-lane highway with traffic and Florida palms.
// Reads game numbers each frame; owns no game rules.
import {
  AmbientLight, Color, ConeGeometry, DirectionalLight, Fog, InstancedMesh, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer, BoxGeometry,
} from 'three';
import {
  LANES, LANE_WIDTH, PLAYER_LANE, VIEW_AHEAD, VIEW_BEHIND, initTraffic, laneX, recycledZ, rng,
  stepTraffic, visualSpeed, type TrafficCar,
} from '../world';
import { bushGeometry, flat, makeSuv, palmGeometries, trafficGeometries } from './models';

const LOOP = VIEW_AHEAD + VIEW_BEHIND;
const DASH_SPACING = 12;
const TREE_COUNT = 70;
const BUSH_COUNT = 60;
const TRAFFIC_COUNT = 9;
const CAR_COLORS = [0xd9d9d9, 0x9aa5b1, 0x3d5a80, 0xe76f51, 0xf4f1de, 0x6d597a, 0x283618, 0xbc4749];

export interface RoadScene {
  /** Advance and draw one frame. `idleSpeed` is the game speed in miles/sec. */
  frame(dt: number, idleSpeed: number, progress: number): void;
  /** True if WebGL started. */
  ok: boolean;
}

export function createRoadScene(container: HTMLElement, seed: number): RoadScene {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  } catch {
    container.classList.add('no-webgl');
    container.textContent = 'This browser can\'t show the 3D view (WebGL is off).';
    return { ok: false, frame: () => {} };
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const sky = new Color(0x9fd3f0);
  scene.background = sky;
  scene.fog = new Fog(sky, 140, VIEW_AHEAD);

  const camera = new PerspectiveCamera(50, 1, 0.5, 900);
  camera.position.set(0, 13, 15);
  camera.lookAt(0, 0, -16);

  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xfff2d6, 2.2);
  sun.position.set(-30, 50, 20);
  scene.add(sun);

  // Ground and road surface are static; only the markings and roadside objects scroll.
  const roadWidth = LANES * LANE_WIDTH;
  const ground = new Mesh(new PlaneGeometry(400, LOOP + 400), new MeshLambertMaterial({ color: 0x8cb369 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -VIEW_AHEAD / 2;
  scene.add(ground);
  const shoulder = new Mesh(new PlaneGeometry(roadWidth + 3, LOOP + 400), new MeshLambertMaterial({ color: 0xc9b98f }));
  shoulder.rotation.x = -Math.PI / 2;
  shoulder.position.set(0, 0.01, -VIEW_AHEAD / 2);
  scene.add(shoulder);
  const road = new Mesh(new PlaneGeometry(roadWidth, LOOP + 400), new MeshLambertMaterial({ color: 0x3a3f45 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -VIEW_AHEAD / 2);
  scene.add(road);

  const lineMat = new MeshBasicMaterial({ color: 0xf5f5f0 });
  for (const side of [-1, 1]) {
    const edge = new Mesh(new PlaneGeometry(0.18, LOOP + 400), side < 0 ? new MeshBasicMaterial({ color: 0xf4d35e }) : lineMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(side * (roadWidth / 2 - 0.25), 0.03, -VIEW_AHEAD / 2);
    scene.add(edge);
  }

  // Dashed lane dividers, recycled as the road scrolls.
  const dashPerLine = Math.ceil(LOOP / DASH_SPACING);
  const dashLoop = dashPerLine * DASH_SPACING;
  const dashGeo = new BoxGeometry(0.2, 0.02, 3);
  dashGeo.translate(0, 0.04, 0); // sit just above the asphalt
  const dashes = new InstancedMesh(dashGeo, lineMat, dashPerLine * (LANES - 1));
  scene.add(dashes);

  // Roadside palms and bushes at seeded spots.
  const r = rng(seed);
  const palm = palmGeometries();
  const trunks = new InstancedMesh(palm.trunk, flat(0x8d6e4f), TREE_COUNT);
  const fronds = new InstancedMesh(palm.fronds, flat(0x3f8f4a), TREE_COUNT);
  const bushes = new InstancedMesh(bushGeometry(), flat(0x5c8f3c), BUSH_COUNT);
  scene.add(trunks, fronds, bushes);
  const roadside = (n: number) => Array.from({ length: n }, () => ({
    x: (r() < 0.5 ? -1 : 1) * (roadWidth / 2 + 4 + r() * 40),
    z: r() * LOOP,
    s: 0.7 + r() * 0.6,
    rot: r() * Math.PI,
  }));
  const trees = roadside(TREE_COUNT);
  const bushSpots = roadside(BUSH_COUNT);

  // Distant mountains: they rise as the trip goes on (a preview of the destination).
  const mountainMat = new MeshLambertMaterial({ color: 0x7d8fa8, flatShading: true, fog: false });
  const mountains = Array.from({ length: 7 }, (_, i) => {
    const m = new Mesh(new ConeGeometry(70 + r() * 40, 1, 5), mountainMat);
    m.position.set(-300 + i * 100 + r() * 40, 0, -700);
    scene.add(m);
    return { m, h: 0.6 + r() * 0.4 };
  });

  // The SUV and traffic.
  const suv = makeSuv();
  suv.position.x = laneX(PLAYER_LANE);
  scene.add(suv);
  const tg = trafficGeometries();
  const bodyMat = flat(0xffffff);
  const bodies = new InstancedMesh(tg.body, bodyMat, TRAFFIC_COUNT);
  const cabins = new InstancedMesh(tg.cabin, flat(0x1b2a38), TRAFFIC_COUNT);
  scene.add(bodies, cabins);

  let distance = 0;
  let time = 0;
  let traffic: TrafficCar[] | undefined;
  const dummy = new Object3D();
  const tint = new Color();

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the road comfortably wide on narrow portrait screens.
    camera.fov = camera.aspect < 0.8 ? 62 : 50;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function place(mesh: InstancedMesh, i: number, x: number, z: number, s = 1, rot = 0) {
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  function frame(dt: number, idleSpeed: number, progress: number) {
    const v = visualSpeed(idleSpeed);
    distance += v * dt;
    time += dt;
    traffic ??= initTraffic(TRAFFIC_COUNT, v, r);
    stepTraffic(traffic, dt, v, r);

    for (let line = 0; line < LANES - 1; line++) {
      const x = (line + 1 - LANES / 2) * LANE_WIDTH;
      for (let i = 0; i < dashPerLine; i++) {
        place(dashes, line * dashPerLine + i, x, recycledZ(i * DASH_SPACING, distance, dashLoop));
      }
    }
    dashes.instanceMatrix.needsUpdate = true;

    trees.forEach((t, i) => {
      const z = recycledZ(t.z, distance, LOOP);
      place(trunks, i, t.x, z, t.s, t.rot);
      place(fronds, i, t.x, z, t.s, t.rot);
    });
    bushSpots.forEach((b, i) => place(bushes, i, b.x, recycledZ(b.z, distance, LOOP), b.s, b.rot));
    trunks.instanceMatrix.needsUpdate = fronds.instanceMatrix.needsUpdate = bushes.instanceMatrix.needsUpdate = true;

    traffic.forEach((c, i) => {
      // Lean the nose a little toward the lane the car is moving into.
      const steer = (laneX(c.lane) - c.x) * 0.08;
      place(bodies, i, c.x, c.z, 1, steer);
      place(cabins, i, c.x, c.z, 1, steer);
      bodies.setColorAt(i, tint.setHex(CAR_COLORS[c.color % CAR_COLORS.length]));
    });
    bodies.instanceMatrix.needsUpdate = cabins.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;

    for (const { m, h } of mountains) {
      m.scale.y = (40 + progress * 220) * h;
      m.position.y = m.scale.y / 2 - 10;
    }

    // A little road bounce for the SUV.
    suv.position.y = Math.sin(time * 9) * 0.03;
    suv.rotation.z = Math.sin(time * 1.3) * 0.01;

    renderer.render(scene, camera);
  }

  return { ok: true, frame };
}
