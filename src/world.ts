// Pure helpers for the 3D road scene: scrolling, recycling, and traffic.
// No Three.js, no DOM, so everything here is unit-tested.
//
// World units are meters. The player's SUV sits at z = 0 and "drives" toward -z;
// in practice the world scrolls toward +z past it.

export const LANE_WIDTH = 3.6;
export const LANES = 3;
/** The SUV drives in the middle lane. */
export const PLAYER_LANE = 1;
/** How far ahead of the car the scene is drawn (meters). */
export const VIEW_AHEAD = 260;
/** How far behind the car the scene is kept (meters). */
export const VIEW_BEHIND = 40;
/** Minimum bumper-to-bumper gap between cars in one lane (meters, center to center). */
export const MIN_GAP = 14;

/** Positive modulo: result is always in [0, m). */
export function wrap(v: number, m: number): number {
  return ((v % m) + m) % m;
}

/**
 * Z position of a recycled object. Objects are laid out along a loop of length `loop`
 * starting at `baseZ`; as `distance` grows they slide toward +z and, once they pass
 * `behind`, reappear `loop` meters further ahead. Result is in [behind - loop, behind).
 */
export function recycledZ(baseZ: number, distance: number, loop: number, behind = VIEW_BEHIND): number {
  return wrap(baseZ + distance - behind, loop) - loop + behind;
}

/** Center x of a lane (0 = leftmost). */
export function laneX(lane: number): number {
  return (lane - (LANES - 1) / 2) * LANE_WIDTH;
}

/**
 * On-screen driving speed in m/s for an idle speed in miles/sec. The idle number grows by
 * orders of magnitude, so the scroll is log-scaled to stay readable and capped.
 */
export function visualSpeed(milesPerSec: number): number {
  return Math.min(48, 20 + 9 * Math.log10(1 + Math.max(0, milesPerSec)));
}

/** Small seeded RNG (mulberry32) so scenes are reproducible for screenshots and tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrafficCar {
  lane: number;
  /** Current x (moves smoothly toward the lane center during lane changes). */
  x: number;
  z: number;
  /** Ground speed the car would like to drive (m/s). */
  cruise: number;
  /** Ground speed this step (m/s), after following/yielding. */
  speed: number;
  /** Paint color index, picked by the renderer. */
  color: number;
}

/** True if a car in `lane` at `z` would sit within MIN_GAP of anything (other cars or the SUV). */
export function laneBlocked(cars: readonly TrafficCar[], lane: number, z: number, ignore?: TrafficCar): boolean {
  if (lane === PLAYER_LANE && Math.abs(z) < MIN_GAP) return true;
  return cars.some((c) => c !== ignore && c.lane === lane && Math.abs(c.z - z) < MIN_GAP);
}

/** Spawn a car somewhere in the view with free space around it, or undefined if it doesn't fit. */
export function spawnCar(cars: readonly TrafficCar[], playerSpeed: number, rand: () => number, z: number): TrafficCar | undefined {
  const start = Math.floor(rand() * LANES);
  for (let i = 0; i < LANES; i++) {
    const lane = (start + i) % LANES;
    if (laneBlocked(cars, lane, z)) continue;
    const cruise = playerSpeed * (0.75 + rand() * 0.45);
    return { lane, x: laneX(lane), z, cruise, speed: cruise, color: Math.floor(rand() * 1000) };
  }
  return undefined;
}

/** Initial traffic spread through the view. */
export function initTraffic(count: number, playerSpeed: number, rand: () => number): TrafficCar[] {
  const cars: TrafficCar[] = [];
  for (let tries = 0; cars.length < count && tries < count * 10; tries++) {
    const z = -VIEW_AHEAD + rand() * (VIEW_AHEAD + VIEW_BEHIND);
    const c = spawnCar(cars, playerSpeed, rand, z);
    if (c) cars.push(c);
  }
  return cars;
}

/** The nearest thing ahead (smaller z) in a lane: a car, or the SUV. */
function leaderAhead(cars: readonly TrafficCar[], me: TrafficCar, playerSpeed: number): { gap: number; speed: number } | undefined {
  let best: { gap: number; speed: number } | undefined;
  const consider = (z: number, speed: number) => {
    const gap = me.z - z;
    if (gap > 0 && (!best || gap < best.gap)) best = { gap, speed };
  };
  if (me.lane === PLAYER_LANE) consider(0, playerSpeed);
  for (const c of cars) if (c !== me && c.lane === me.lane) consider(c.z, c.speed);
  return best;
}

/**
 * Advance traffic by `dt` seconds while the SUV drives at `playerSpeed`.
 * Simple lane logic: a car catching up to something slower tries to change lanes,
 * otherwise it follows at the leader's speed. A slow car just ahead of the SUV in its lane
 * moves over or speeds up so the SUV never drives through it. Cars that leave the view
 * respawn at the far end. Mutates and returns `cars`.
 */
export function stepTraffic(cars: TrafficCar[], dt: number, playerSpeed: number, rand: () => number): TrafficCar[] {
  for (const c of cars) {
    c.speed = c.cruise;
    const lead = leaderAhead(cars, c, playerSpeed);
    if (lead && lead.gap < MIN_GAP * 2 && lead.speed < c.speed) {
      const options = [c.lane - 1, c.lane + 1].filter((l) => l >= 0 && l < LANES && !laneBlocked(cars, l, c.z, c));
      if (options.length) c.lane = options[Math.floor(rand() * options.length)];
      else c.speed = lead.speed;
    }
    // Something slow sitting just ahead of the SUV in its lane: get out of the way.
    if (c.lane === PLAYER_LANE && c.z < 0 && c.z > -MIN_GAP * 2 && c.speed < playerSpeed) {
      const options = [PLAYER_LANE - 1, PLAYER_LANE + 1].filter((l) => !laneBlocked(cars, l, c.z, c));
      if (options.length) c.lane = options[Math.floor(rand() * options.length)];
      else c.speed = playerSpeed;
    }
  }
  for (const c of cars) {
    c.z += (playerSpeed - c.speed) * dt;
    const tx = laneX(c.lane);
    const step = 3.5 * dt;
    c.x = Math.abs(tx - c.x) <= step ? tx : c.x + Math.sign(tx - c.x) * step;
  }
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (c.z > VIEW_BEHIND + 10 || c.z < -VIEW_AHEAD - 10) {
      // Slower cars fell behind: bring a new one in from the horizon (and vice versa).
      const others = cars.filter((o) => o !== c);
      const z = c.z > 0 ? -VIEW_AHEAD : VIEW_BEHIND;
      // A car entering from behind must be faster than us, one from the horizon slower.
      const cruise = z < 0 ? playerSpeed * (0.75 + rand() * 0.2) : playerSpeed * (1.05 + rand() * 0.15);
      const fresh = spawnCar(others, playerSpeed, rand, z);
      if (fresh) {
        fresh.cruise = fresh.speed = cruise;
        cars[i] = fresh;
      } else {
        // No room right now: wait just outside the view and drift back in later.
        c.z = z < 0 ? -VIEW_AHEAD - 5 : VIEW_BEHIND + 5;
        c.cruise = c.speed = cruise;
      }
    }
  }
  return cars;
}
