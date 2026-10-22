// Plays a precomputed cartoon crash: a see-through SUV tumbling with the family flailing inside,
// in slow motion, then everyone sits up dazed with stars over their heads.
import { Group, Vector3, type Scene } from 'three';
import { CRASH_HZ, RIDERS, simulateCrash, type CrashFrame } from '../crashSim';
import { makeRider, makeStars, makeSuv } from './models';

/** Slow motion for the first part of the crash (in simulated seconds). */
const SLOWMO_UNTIL = 2.6;
const SLOWMO_RATE = 0.35;

export interface CrashView {
  /** Start a crash where the SUV is now. `heading` is the SUV's yaw. */
  start(seed: number, kind: string, at: Vector3, heading: number): void;
  /** Advance the animation; returns false when no crash is showing. */
  update(dt: number): boolean;
  /** World-space point the camera should circle. */
  focus(out: Vector3): Vector3;
  stop(): void;
  readonly active: boolean;
}

export function createCrashView(scene: Scene): CrashView {
  const root = new Group();
  root.visible = false;
  scene.add(root);
  const suv = makeSuv(true);
  root.add(suv);
  const riders = RIDERS.map((r) => {
    const m = makeRider(r.id, r.half);
    let stars: Group | undefined;
    if (m.head >= 0) {
      stars = makeStars();
      stars.position.y = m.head;
      m.group.add(stars);
    }
    root.add(m.group);
    return { group: m.group, stars };
  });

  let frames: CrashFrame[] | undefined;
  let t = 0;
  let clock = 0;

  function apply(f: CrashFrame) {
    suv.position.set(...f.car.p);
    suv.quaternion.set(...f.car.q);
    f.riders.forEach((p, i) => {
      riders[i].group.position.set(...p.p);
      riders[i].group.quaternion.set(...p.q);
    });
  }

  return {
    start(seed, kind, at, heading) {
      frames = simulateCrash(seed, kind);
      t = 0;
      clock = 0;
      root.position.copy(at);
      root.rotation.set(0, heading, 0);
      root.visible = true;
      apply(frames[0]);
    },
    update(dt) {
      if (!frames) return false;
      clock += dt;
      t += dt * (t < SLOWMO_UNTIL ? SLOWMO_RATE : 1);
      const i = Math.min(frames.length - 1, Math.floor(t * CRASH_HZ));
      apply(frames[i]);
      const dazed = i === frames.length - 1;
      for (const r of riders) {
        if (!r.stars) continue;
        r.stars.visible = dazed;
        r.stars.rotation.y = clock * 4;
      }
      // Dazed wobble once it's over.
      if (dazed) riders.forEach((r, k) => { r.group.rotation.z += Math.sin(clock * 3 + k) * 0.08; });
      return true;
    },
    focus(out) {
      root.updateMatrixWorld();
      return out.copy(suv.position).setY(suv.position.y + 1).applyMatrix4(root.matrixWorld);
    },
    stop() {
      frames = undefined;
      root.visible = false;
    },
    get active() { return frames !== undefined; },
  };
}
