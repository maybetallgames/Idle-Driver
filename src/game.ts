// Pure game logic: no DOM, no timers. Everything here is unit-tested.

export type UpgradeKind = 'sensor' | 'feature' | 'comfort';

export interface Upgrade {
  id: string;
  kind: UpgradeKind;
  name: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  /** Miles per second added per level. */
  speedPerLevel: number;
  /** Multiplier added per level (applied to total speed). */
  mulPerLevel: number;
  /** Highest level that can be bought (features are one-time: max 1). */
  max?: number;
  /** Upgrade levels needed before this can be bought. */
  requires?: Readonly<Record<string, number>>;
}

export const UPGRADES: readonly Upgrade[] = [
  // Sensors: repeatable, each level sees farther.
  { id: 'camera', kind: 'sensor', name: 'Front Camera', description: 'Sees lane lines and cars ahead. +0.5 mi/s, sees farther each level', baseCost: 10, costGrowth: 1.15, speedPerLevel: 0.5, mulPerLevel: 0 },
  { id: 'radar', kind: 'sensor', name: 'Front Radar', description: 'Spots cars far ahead in a narrow beam. +3 mi/s', baseCost: 120, costGrowth: 1.17, speedPerLevel: 3, mulPerLevel: 0 },
  { id: 'sidecams', kind: 'sensor', name: 'Side & Rear Cameras', description: 'Sees all around the car. +20 mi/s', baseCost: 2500, costGrowth: 1.2, speedPerLevel: 20, mulPerLevel: 0 },
  { id: 'lidar', kind: 'sensor', name: 'Lidar', description: 'Spinning laser on the roof: a 3D map of everything around. +60 mi/s', baseCost: 12000, costGrowth: 1.22, speedPerLevel: 60, mulPerLevel: 0 },
  // Driving features: one-time software unlocks that raise the autonomy level.
  { id: 'acc', kind: 'feature', name: 'Adaptive Cruise', description: 'Keeps a steady speed behind traffic. +25% speed', baseCost: 150, costGrowth: 1, speedPerLevel: 0, mulPerLevel: 0.25, max: 1, requires: { radar: 1 } },
  { id: 'lanekeep', kind: 'feature', name: 'Lane Keeping', description: 'Holds the lane so Dad can relax. +25% speed', baseCost: 100, costGrowth: 1, speedPerLevel: 0, mulPerLevel: 0.25, max: 1, requires: { camera: 2 } },
  { id: 'autosteer', kind: 'feature', name: 'Autosteer', description: 'Cruise and lane keeping together. Lane lines turn blue. +50% speed', baseCost: 1200, costGrowth: 1, speedPerLevel: 0, mulPerLevel: 0.5, max: 1, requires: { acc: 1, lanekeep: 1, camera: 5 } },
  { id: 'lanechange', kind: 'feature', name: 'Auto Lane Change', description: 'Passes slow traffic on its own. +30% speed', baseCost: 4000, costGrowth: 1, speedPerLevel: 0, mulPerLevel: 0.3, max: 1, requires: { autosteer: 1, sidecams: 1 } },
  { id: 'navhwy', kind: 'feature', name: 'Navigate on Highway', description: 'Takes exits and merges itself. +50% speed', baseCost: 9000, costGrowth: 1, speedPerLevel: 0, mulPerLevel: 0.5, max: 1, requires: { lanechange: 1, radar: 5 } },
  { id: 'citystreets', kind: 'feature', name: 'City Streets', description: 'Drives through cities and at night. +50% speed', baseCost: 25000, costGrowth: 1, speedPerLevel: 0, mulPerLevel: 0.5, max: 1, requires: { navhwy: 1, lidar: 1 } },
  { id: 'fsd', kind: 'feature', name: 'Full Self Driving', description: 'No driver needed. Dad naps in the back. +100% speed', baseCost: 50000, costGrowth: 1, speedPerLevel: 0, mulPerLevel: 1, max: 1, requires: { citystreets: 1, lidar: 4, camera: 15 } },
  // Comfort.
  { id: 'snacks', kind: 'comfort', name: 'Snack Cooler', description: 'Happy kids, fewer stops: +10% speed', baseCost: 500, costGrowth: 1.6, speedPerLevel: 0, mulPerLevel: 0.1 },
];

/** SAE-style autonomy levels, unlocked by owning driving features. */
export const AUTONOMY = [
  { level: 0, name: 'Dad drives', feature: undefined },
  { level: 1, name: 'Driver assist', feature: ['acc', 'lanekeep'] },
  { level: 2, name: 'Partial autopilot', feature: ['autosteer'] },
  { level: 3, name: 'Highway pilot', feature: ['navhwy'] },
  { level: 4, name: 'City & night pilot', feature: ['citystreets'] },
  { level: 5, name: 'Full self driving', feature: ['fsd'] },
] as const;

/** Average seconds of driving between takeovers at each autonomy level (L5 never asks). */
export const TAKEOVER_INTERVAL = [40, 75, 150, 360, 1200, Infinity];
/** Online, Dad sorts a takeover out himself after this many seconds if you don't tap. */
export const DAD_RESOLVE_SECONDS = 20;
/** Tapping a takeover is worth this many seconds of driving. */
export const TAKEOVER_BONUS_SECONDS = 15;

/** Tiredness Dad gains per second of driving, by autonomy level (1 = falls asleep). */
export const TIRE_RATE = [1 / 400, 1 / 600, 1 / 1000, 1 / 2000, 1 / 5000, 0];
/** Tiredness Dad loses per second while the car is stopped. */
export const REST_RATE = 1 / 300;
/** Helping with a takeover takes this much off Dad's tiredness. */
export const TAP_REST = 0.08;
/** Coffee takes this much off, and costs this many seconds of driving. */
export const COFFEE_REST = 0.5;
export const COFFEE_COST_SECONDS = 20;
/** After a crash: seconds until the tow truck has you back on the road, and repairs in seconds of driving. */
export const TOW_SECONDS = 30;
export const REPAIR_COST_SECONDS = 30;
/** Each tap on "hurry the tow truck" takes this many seconds off. */
export const TOW_TAP_SECONDS = 3;

/** Chance that Dad crashes when he handles a takeover alone. */
export function crashChance(tiredness: number): number {
  return 0.05 + 0.6 * tiredness * tiredness;
}

export interface CrashKind { id: string; emoji: string; name: string }
export const CRASH_KINDS: readonly CrashKind[] = [
  { id: 'nodoff', emoji: '😴', name: 'Dad nodded off and rolled into the ditch' },
  { id: 'rearend', emoji: '🚛', name: 'Bumped a truck and bounced off' },
  { id: 'spin', emoji: '🌀', name: 'Spun out on the wet road' },
  { id: 'cones', emoji: '🚧', name: 'Plowed through the construction cones' },
  { id: 'deer', emoji: '🦌', name: 'Swerved for a deer (the deer is fine)' },
  { id: 'barrier', emoji: '🎫', name: 'Clipped the toll barrier' },
];
/** Which crash each takeover can turn into. */
const CRASH_FOR_TAKEOVER: Record<string, string> = {
  construction: 'cones', interchange: 'spin', toll: 'barrier', merge: 'rearend', storm: 'spin', deer: 'deer',
};

export interface TakeoverKind { id: string; emoji: string; name: string }
export const TAKEOVER_KINDS: readonly TakeoverKind[] = [
  { id: 'construction', emoji: '🚧', name: 'Construction zone' },
  { id: 'interchange', emoji: '🔀', name: 'Confusing interchange' },
  { id: 'toll', emoji: '🎫', name: 'Toll plaza' },
  { id: 'merge', emoji: '↪️', name: 'Tight merge' },
  { id: 'storm', emoji: '⛈️', name: 'Sudden storm' },
  { id: 'deer', emoji: '🦌', name: 'Deer by the road' },
];

/** Upgrades renamed in save version 2 (sensors replaced the first upgrade list). */
const RENAMED_UPGRADES: Record<string, string> = { cruise: 'camera', tires: 'radar', lane: 'sidecams' };

export interface Landmark {
  at: number;
  name: string;
}

export const LANDMARKS: readonly Landmark[] = [
  { at: 0, name: 'Driveway' },
  { at: 50, name: 'Gas station (bathroom break #1)' },
  { at: 300, name: 'Giant roadside dinosaur' },
  { at: 1500, name: 'Endless cornfields' },
  { at: 6000, name: 'Foothills' },
  { at: 20000, name: 'Switchback roads' },
  { at: 75000, name: 'Mountain cabin' },
];

export const TRIP_LENGTH = LANDMARKS[LANDMARKS.length - 1].at;
export const SAVE_VERSION = 2;
/** Offline progress is capped so a long absence doesn't skip the whole game. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

export interface GameState {
  version: number;
  /** Total miles driven this trip. */
  odometer: number;
  /** Spendable currency, earned 1:1 with miles. */
  miles: number;
  levels: Record<string, number>;
  /** Epoch ms of the last tick, for offline progress. */
  lastTick: number;
  /** Seconds of driving until the car next needs help. */
  untilTakeover: number;
  /** How many takeovers so far (seeds which one comes next). */
  takeovers: number;
  /** The situation the car is stuck on, if any. While set, the car waits. */
  takeover?: { kind: string; waited: number };
  /** Dad's tiredness, 0 (fresh) to 1 (asleep at the wheel). */
  tiredness: number;
  /** How many crashes so far (seeds the crash animation). */
  crashes: number;
  /** A crash in progress: the car waits for the tow truck. Offline, it waits until you return. */
  crash?: { kind: string; left: number; cost: number };
}

export function newGame(now: number): GameState {
  return { version: SAVE_VERSION, odometer: 0, miles: 0, levels: {}, lastTick: now, untilTakeover: takeoverGap(0, 0), takeovers: 0, tiredness: 0, crashes: 0 };
}

/** The highest autonomy level whose features are owned. */
export function autonomyLevel(levels: Readonly<Record<string, number>>): number {
  let best = 0;
  for (const a of AUTONOMY) {
    if (a.feature && a.feature.some((id) => (levels[id] ?? 0) > 0)) best = a.level;
  }
  return best;
}

/** A repeatable 0..1 number from an integer. */
function hash01(n: number): number {
  let t = (n + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Seconds of driving before the next takeover: the level's average, give or take 40%. */
export function takeoverGap(autonomy: number, count: number): number {
  return TAKEOVER_INTERVAL[autonomy] * (0.6 + 0.8 * hash01(count * 2 + 1));
}

export function crashKind(state: GameState): CrashKind | undefined {
  return state.crash && (CRASH_KINDS.find((k) => k.id === state.crash!.kind) ?? CRASH_KINDS[0]);
}

export function takeoverKind(state: GameState): TakeoverKind | undefined {
  return state.takeover && (TAKEOVER_KINDS.find((k) => k.id === state.takeover!.kind) ?? TAKEOVER_KINDS[0]);
}

export function level(state: GameState, id: string): number {
  return state.levels[id] ?? 0;
}

/** Miles per second. A tiny base speed means the car always moves. */
export function speed(state: GameState): number {
  let flat = 0.2;
  let mul = 1;
  for (const u of UPGRADES) {
    const l = level(state, u.id);
    flat += u.speedPerLevel * l;
    mul += u.mulPerLevel * l;
  }
  return flat * mul;
}

/** How fast the car is going right now: zero while it waits for help. */
export function currentSpeed(state: GameState): number {
  return state.takeover || state.crash ? 0 : speed(state);
}

export function upgradeCost(state: GameState, id: string): number {
  const u = findUpgrade(id);
  return Math.ceil(u.baseCost * Math.pow(u.costGrowth, level(state, id)));
}

/** Requirements not yet met, as [upgrade, level needed] pairs. */
export function missingRequirements(state: GameState, id: string): [Upgrade, number][] {
  const u = findUpgrade(id);
  return Object.entries(u.requires ?? {})
    .filter(([req, lv]) => level(state, req) < lv)
    .map(([req, lv]) => [findUpgrade(req), lv]);
}

export function isMaxed(state: GameState, id: string): boolean {
  const u = findUpgrade(id);
  return u.max !== undefined && level(state, id) >= u.max;
}

export function canBuy(state: GameState, id: string): boolean {
  return !isMaxed(state, id) && missingRequirements(state, id).length === 0 && state.miles >= upgradeCost(state, id);
}

export function buy(state: GameState, id: string): GameState {
  if (!canBuy(state, id)) return state;
  const before = autonomyLevel(state.levels);
  const levels = { ...state.levels, [id]: level(state, id) + 1 };
  const after = autonomyLevel(levels);
  return {
    ...state,
    miles: state.miles - upgradeCost(state, id),
    levels,
    // A new autonomy level spaces takeovers out right away.
    untilTakeover: after > before ? Math.max(state.untilTakeover, takeoverGap(after, state.takeovers)) : state.untilTakeover,
  };
}

export interface AdvanceOptions {
  /** True while the player is watching: Dad then handles a takeover himself after a while. */
  dadHelps?: boolean;
}

/**
 * Advance the simulation by `seconds`. Offline (no `dadHelps`), the car stops at a takeover or a crash
 * and waits for you; Dad rests while it waits.
 */
export function advance(state: GameState, seconds: number, opts: AdvanceOptions = {}): GameState {
  let s = state;
  let left = seconds;
  for (let guard = 0; left > 1e-9 && guard < 10_000; guard++) {
    if (s.crash || s.takeover) {
      if (!opts.dadHelps) {
        s = rest(s, left);
        break;
      }
      if (s.crash) {
        const wait = Math.min(left, s.crash.left);
        left -= wait;
        s = rest(s, wait);
        s = s.crash!.left - wait <= 1e-9 ? { ...s, crash: undefined } : { ...s, crash: { ...s.crash!, left: s.crash!.left - wait } };
        continue;
      }
      const t = s.takeover!;
      const wait = Math.min(left, DAD_RESOLVE_SECONDS - t.waited);
      left -= wait;
      s = rest(s, wait);
      const waited = t.waited + wait;
      if (waited < DAD_RESOLVE_SECONDS - 1e-9) {
        s = { ...s, takeover: { ...t, waited } };
        continue;
      }
      // Dad handles it alone: the more tired he is, the likelier it ends in a crash.
      const crashed = hash01(s.takeovers * 2 + 31337) < crashChance(s.tiredness);
      s = clearTakeover(s);
      if (crashed) s = startCrash(s, CRASH_FOR_TAKEOVER[t.kind] ?? 'spin');
      continue;
    }
    const rate = TIRE_RATE[autonomyLevel(s.levels)];
    const untilAsleep = rate > 0 ? (1 - s.tiredness) / rate : Infinity;
    const drive = Math.min(left, s.untilTakeover, untilAsleep);
    const gained = speed(s) * drive;
    left -= drive;
    s = {
      ...s, odometer: s.odometer + gained, miles: s.miles + gained, untilTakeover: s.untilTakeover - drive,
      tiredness: Math.min(1, s.tiredness + rate * drive),
    };
    if (rate > 0 && s.tiredness >= 1 - 1e-9) s = startCrash({ ...s, tiredness: 1 }, 'nodoff');
    else if (s.untilTakeover <= 1e-9) {
      const kind = TAKEOVER_KINDS[Math.floor(hash01(s.takeovers * 2) * TAKEOVER_KINDS.length)].id;
      s = { ...s, takeover: { kind, waited: 0 } };
    }
  }
  return s;
}

function rest(s: GameState, seconds: number): GameState {
  return { ...s, tiredness: Math.max(0, s.tiredness - REST_RATE * seconds) };
}

/** Crash: repairs cost miles, the adrenaline wakes Dad up, and the car waits for the tow truck. */
function startCrash(s: GameState, kind: string): GameState {
  const cost = Math.min(s.miles, speed(s) * REPAIR_COST_SECONDS);
  return {
    ...s,
    miles: s.miles - cost,
    tiredness: Math.min(s.tiredness, 0.3),
    crashes: s.crashes + 1,
    crash: { kind, left: TOW_SECONDS, cost },
    takeover: undefined,
  };
}

function clearTakeover(s: GameState): GameState {
  const takeovers = s.takeovers + 1;
  return { ...s, takeover: undefined, takeovers, untilTakeover: takeoverGap(autonomyLevel(s.levels), takeovers) };
}

/** The player taps the takeover prompt: the car gets going again, with a bonus, and Dad relaxes a bit. */
export function resolveTakeover(state: GameState): GameState {
  if (!state.takeover) return state;
  const gained = speed(state) * TAKEOVER_BONUS_SECONDS;
  return clearTakeover({
    ...state, odometer: state.odometer + gained, miles: state.miles + gained,
    tiredness: Math.max(0, state.tiredness - TAP_REST),
  });
}

/** Tap to hurry the tow truck along. */
export function hurryTow(state: GameState): GameState {
  if (!state.crash) return state;
  const left = state.crash.left - TOW_TAP_SECONDS;
  return left <= 0 ? { ...state, crash: undefined } : { ...state, crash: { ...state.crash, left } };
}

export function coffeeCost(state: GameState): number {
  return Math.max(5, Math.ceil(speed(state) * COFFEE_COST_SECONDS));
}

export function canBuyCoffee(state: GameState): boolean {
  return state.tiredness > 0.02 && state.miles >= coffeeCost(state);
}

/** Buy Dad a coffee. */
export function coffee(state: GameState): GameState {
  if (!canBuyCoffee(state)) return state;
  return { ...state, miles: state.miles - coffeeCost(state), tiredness: Math.max(0, state.tiredness - COFFEE_REST) };
}

/** Advance to wall-clock `now`, capping offline time. Returns new state and seconds simulated. */
export function catchUp(state: GameState, now: number): { state: GameState; seconds: number } {
  const seconds = Math.min(Math.max(0, (now - state.lastTick) / 1000), MAX_OFFLINE_SECONDS);
  return { state: { ...advance(state, seconds), lastTick: now }, seconds };
}

/** Tapping the horn gives a small boost: one second of driving, minimum 1 mile. */
export function honk(state: GameState): GameState {
  const gained = Math.max(1, currentSpeed(state));
  return { ...state, odometer: state.odometer + gained, miles: state.miles + gained };
}

export function currentLandmark(state: GameState): Landmark {
  let current = LANDMARKS[0];
  for (const l of LANDMARKS) if (state.odometer >= l.at) current = l;
  return current;
}

export function nextLandmark(state: GameState): Landmark | undefined {
  return LANDMARKS.find((l) => l.at > state.odometer);
}

export function tripProgress(state: GameState): number {
  return Math.min(1, state.odometer / TRIP_LENGTH);
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Parse a save, falling back to a new game if it's missing or corrupt. */
export function deserialize(raw: string | null, now: number): GameState {
  if (!raw) return newGame(now);
  try {
    const s = JSON.parse(raw) as Partial<GameState>;
    if (typeof s.odometer !== 'number' || typeof s.miles !== 'number') return newGame(now);
    const levels = migrateLevels(s.levels);
    const takeovers = typeof s.takeovers === 'number' && s.takeovers >= 0 ? Math.floor(s.takeovers) : 0;
    const t = s.takeover;
    const out: GameState = {
      version: SAVE_VERSION,
      odometer: s.odometer,
      miles: s.miles,
      levels,
      lastTick: typeof s.lastTick === 'number' ? s.lastTick : now,
      untilTakeover: typeof s.untilTakeover === 'number' && s.untilTakeover >= 0 ? s.untilTakeover : takeoverGap(autonomyLevel(levels), takeovers),
      takeovers,
      tiredness: typeof s.tiredness === 'number' ? Math.min(1, Math.max(0, s.tiredness)) : 0,
      crashes: typeof s.crashes === 'number' && s.crashes >= 0 ? Math.floor(s.crashes) : 0,
    };
    if (t && typeof t.kind === 'string') out.takeover = { kind: t.kind, waited: typeof t.waited === 'number' ? t.waited : 0 };
    const c = s.crash;
    if (c && typeof c.kind === 'string') out.crash = { kind: c.kind, left: typeof c.left === 'number' ? c.left : TOW_SECONDS, cost: typeof c.cost === 'number' ? c.cost : 0 };
    return out;
  } catch {
    return newGame(now);
  }
}

/** Keep only numeric levels, carrying old upgrade ids over to their replacements. */
function migrateLevels(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, lv] of Object.entries(raw)) {
    if (typeof lv !== 'number' || !(lv > 0)) continue;
    const to = RENAMED_UPGRADES[id] ?? id;
    const max = UPGRADES.find((u) => u.id === to)?.max ?? Infinity;
    out[to] = Math.min(max, (out[to] ?? 0) + Math.floor(lv));
  }
  return out;
}

export function formatNumber(n: number): string {
  if (n < 1000) return n < 10 ? n.toFixed(1) : Math.floor(n).toString();
  const units = ['K', 'M', 'B', 'T'];
  let i = -1;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)}${units[i]}`;
}

export function findUpgrade(id: string): Upgrade {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown upgrade: ${id}`);
  return u;
}
