// The cartoon crash, simulated with cannon-es: the SUV flips and bounces in low gravity while the
// family and luggage flail around inside on springs. Pure (no DOM, no Three.js) and deterministic
// for a seed, so a crash can be replayed and tested. The normal drive never uses physics.
//
// Coordinates are local to where the crash starts: x right, y up, -z forward (the SUV model's frame).
import { Body, Box, Plane, Quaternion, Spring, Vec3, World } from 'cannon-es';
import { rng } from './world';

export interface Pose {
  p: [number, number, number];
  q: [number, number, number, number];
}

export interface CrashFrame {
  car: Pose;
  riders: Pose[];
}

export interface Rider {
  id: string;
  /** Half extents of its box, in meters. */
  half: [number, number, number];
  /** Where it sits in the car (car-local, relative to the car's ground origin). */
  seat: [number, number, number];
}

export const RIDERS: readonly Rider[] = [
  { id: 'dad', half: [0.24, 0.42, 0.2], seat: [-0.45, 1.25, -0.35] },
  { id: 'mom', half: [0.22, 0.4, 0.18], seat: [0.45, 1.25, -0.35] },
  { id: 'kid1', half: [0.16, 0.28, 0.14], seat: [-0.45, 1.12, 0.75] },
  { id: 'kid2', half: [0.16, 0.26, 0.14], seat: [0.45, 1.1, 0.75] },
  { id: 'dog', half: [0.14, 0.18, 0.32], seat: [0, 1.0, 1.75] },
  { id: 'suitcase1', half: [0.3, 0.2, 0.12], seat: [-0.45, 1.0, 1.85] },
  { id: 'suitcase2', half: [0.26, 0.18, 0.12], seat: [0.5, 1.0, 1.85] },
  { id: 'snack1', half: [0.08, 0.12, 0.08], seat: [-0.1, 1.3, 0.2] },
  { id: 'snack2', half: [0.07, 0.07, 0.1], seat: [0.15, 1.3, 0.3] },
  { id: 'snack3', half: [0.09, 0.06, 0.09], seat: [0.0, 1.4, 1.2] },
];

export const CRASH_HZ = 60;
/** Seconds of tumbling, then the car hops back onto its wheels. */
const TUMBLE_SECONDS = 4.5;
const SETTLE_SECONDS = 0.8;
/** Center of the car's body above its ground origin. */
const CAR_CENTER_Y = 1.05;
const CAR_HALF = new Vec3(0.95, 0.85, 2.35);

/** How each crash starts: launch velocity and spin (car-local). */
function launch(kind: string, r: () => number): { v: Vec3; w: Vec3 } {
  const side = r() < 0.5 ? -1 : 1;
  const j = () => (r() - 0.5) * 2;
  switch (kind) {
    case 'rearend': return { v: new Vec3(j(), 7, -6), w: new Vec3(-7 + j(), j(), side * 2) };
    case 'spin': return { v: new Vec3(side * 3, 4, -14), w: new Vec3(j(), side * 8, side * 9) };
    case 'deer': return { v: new Vec3(side * 5, 7, -12), w: new Vec3(j(), side * 3, side * -6) };
    case 'cones': return { v: new Vec3(j() * 2, 8, -15), w: new Vec3(-5, side * 2, side * 4) };
    case 'barrier': return { v: new Vec3(side * 2, 8, -10), w: new Vec3(-5, side * 3, side * 6) };
    default: return { v: new Vec3(side * 4, 6, -14), w: new Vec3(j(), side, side * 7) }; // nodoff: barrel roll
  }
}

const poseOf = (b: Body): Pose => ({
  p: [b.position.x, b.position.y, b.position.z],
  q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
});

/** Run the whole crash and return a pose for every frame at CRASH_HZ. */
export function simulateCrash(seed: number, kind: string): CrashFrame[] {
  const r = rng(seed);
  const world = new World({ gravity: new Vec3(0, -9.8 * 0.5, 0) });
  const GROUND = 1, CAR = 2, STUFF = 4;

  const ground = new Body({ mass: 0, shape: new Plane(), collisionFilterGroup: GROUND, collisionFilterMask: CAR | STUFF });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  const car = new Body({ mass: 20, collisionFilterGroup: CAR, collisionFilterMask: GROUND, linearDamping: 0.05, angularDamping: 0.05 });
  // The body spins about its center; poses are reported at the car's ground origin.
  car.addShape(new Box(CAR_HALF));
  car.position.set(0, CAR_CENTER_Y, 0);
  const { v, w } = launch(kind, r);
  car.velocity.copy(v);
  car.angularVelocity.copy(w);
  world.addBody(car);
  world.defaultContactMaterial.restitution = 0.45;
  world.defaultContactMaterial.friction = 0.35;

  // Riders don't touch the car's box (they live inside it); springs pull them back to their seats.
  const riders = RIDERS.map((rd) => {
    const b = new Body({ mass: 1, shape: new Box(new Vec3(...rd.half)), collisionFilterGroup: STUFF, collisionFilterMask: GROUND | STUFF, angularDamping: 0.3, linearDamping: 0.2 });
    b.position.set(rd.seat[0], rd.seat[1], rd.seat[2]);
    b.velocity.copy(v);
    b.angularVelocity.set((r() - 0.5) * 14, (r() - 0.5) * 14, (r() - 0.5) * 14);
    world.addBody(b);
    const spring = new Spring(b, car, { localAnchorB: new Vec3(rd.seat[0], rd.seat[1] - CAR_CENTER_Y, rd.seat[2]), restLength: 0, stiffness: 90, damping: 2 });
    return { b, spring };
  });
  world.addEventListener('postStep', () => riders.forEach((x) => x.spring.applyForce()));

  const frames: CrashFrame[] = [];
  const dt = 1 / CRASH_HZ;
  const carPose = (): Pose => {
    const down = car.quaternion.vmult(new Vec3(0, -CAR_CENTER_Y, 0));
    return { p: [car.position.x + down.x, car.position.y + down.y, car.position.z + down.z], q: poseOf(car).q };
  };
  const record = () => frames.push({ car: carPose(), riders: riders.map((x) => poseOf(x.b)) });
  record();
  for (let i = 0; i < TUMBLE_SECONDS * CRASH_HZ; i++) {
    world.step(dt);
    record();
  }

  // Cartoon ending: the car hops back onto its wheels (keeping its heading) and everyone pops back
  // into their seats.
  const end = frames[frames.length - 1];
  const q0 = new Quaternion(...end.car.q);
  const fwd = q0.vmult(new Vec3(0, 0, -1));
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  const upright = new Quaternion().setFromEuler(0, yaw, 0);
  const p0 = end.car.p;
  const n = Math.round(SETTLE_SECONDS * CRASH_HZ);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const e = t * t * (3 - 2 * t);
    const q = q0.slerp(upright, e);
    const hop = Math.sin(Math.PI * t) * 1.2;
    const p: [number, number, number] = [p0[0], p0[1] * (1 - e) + hop, p0[2]];
    const riderPoses = RIDERS.map((rd, k) => {
      const seat = q.vmult(new Vec3(...rd.seat));
      const from = end.riders[k];
      const rq = new Quaternion(...from.q).slerp(q, e);
      return {
        p: [
          from.p[0] + (p[0] + seat.x - from.p[0]) * e,
          from.p[1] + (p[1] + seat.y - from.p[1]) * e,
          from.p[2] + (p[2] + seat.z - from.p[2]) * e,
        ] as [number, number, number],
        q: [rq.x, rq.y, rq.z, rq.w] as [number, number, number, number],
      };
    });
    frames.push({ car: { p, q: [q.x, q.y, q.z, q.w] }, riders: riderPoses });
  }
  return frames;
}
