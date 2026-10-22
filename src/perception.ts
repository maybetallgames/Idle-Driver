// What the car can perceive, from the sensors it owns. Pure logic: no DOM, no Three.js.
//
// Positions are relative to the SUV in meters: `forward` along the direction of travel,
// `right` to the right of it.

/** A sensor's field of view: a wedge around the car. */
export interface Cone {
  id: string;
  /** Direction the wedge points, in radians from straight ahead (positive = to the right). */
  dir: number;
  /** Half of the wedge's opening angle, in radians (Math.PI = all the way around). */
  half: number;
  /** How far it sees, in meters. */
  range: number;
}

const deg = Math.PI / 180;

export interface SensorSpec {
  /** Upgrade id that owns this sensor. */
  id: string;
  dir: number;
  half: number;
  /** Range at level 1, and how much each further level adds. */
  baseRange: number;
  rangePerLevel: number;
  maxRange: number;
}

export const SENSORS: readonly SensorSpec[] = [
  { id: 'camera', dir: 0, half: 28 * deg, baseRange: 45, rangePerLevel: 6, maxRange: 160 },
  { id: 'radar', dir: 0, half: 9 * deg, baseRange: 90, rangePerLevel: 10, maxRange: 260 },
  { id: 'sidecams', dir: 0, half: 180 * deg, baseRange: 22, rangePerLevel: 3, maxRange: 70 },
];

/** With no sensors at all, Dad only has the headlights. */
export const HEADLIGHTS: Cone = { id: 'headlights', dir: 0, half: 32 * deg, range: 24 };

/** The wedges the car currently sees, given upgrade levels. */
export function sensorCones(levels: Readonly<Record<string, number>>): Cone[] {
  const cones: Cone[] = [HEADLIGHTS];
  for (const s of SENSORS) {
    const lv = levels[s.id] ?? 0;
    if (lv <= 0) continue;
    cones.push({ id: s.id, dir: s.dir, half: s.half, range: Math.min(s.maxRange, s.baseRange + s.rangePerLevel * (lv - 1)) });
  }
  return cones;
}

/** Wrap an angle to [-PI, PI]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** True if a point (forward, right) of the car is inside the wedge. */
export function inCone(c: Cone, forward: number, right: number): boolean {
  const d = Math.hypot(forward, right);
  if (d > c.range) return false;
  if (d < 1e-6 || c.half >= Math.PI) return true;
  return Math.abs(wrapAngle(Math.atan2(right, forward) - c.dir)) <= c.half;
}

/** True if any sensor sees the point. */
export function perceives(cones: readonly Cone[], forward: number, right: number): boolean {
  return cones.some((c) => inCone(c, forward, right));
}

/** The farthest any sensor sees straight ahead (for the HUD). */
export function forwardRange(cones: readonly Cone[]): number {
  return Math.max(0, ...cones.filter((c) => inCone(c, 1, 0)).map((c) => c.range));
}
