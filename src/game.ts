// Pure game logic: no DOM, no timers. Everything here is unit-tested.
//
// Distances are real route miles (Orlando to Rocky Mountain National Park) and speeds are real
// miles per hour: the trip takes as long as the drive would. Money ($) comes from the family's
// live stream: viewers watch, viewers pay. Gas costs money; an empty tank stops the car.

export type UpgradeKind = 'sensor' | 'feature' | 'comfort' | 'stream';

/** What one level of an upgrade does. Multipliers add up across levels and upgrades. */
export interface Effects {
  /** Miles per hour added. */
  mph?: number;
  /** Speed multiplier added (0.1 = +10%). */
  speed?: number;
  /** Viewer multiplier added. */
  viewers?: number;
  /** $ per viewer multiplier added. */
  payout?: number;
  /** Fuel economy multiplier added. */
  mpg?: number;
  /** Slows Dad's tiredness: rate is divided by (1 + sum). */
  rest?: number;
}

export interface Upgrade {
  id: string;
  kind: UpgradeKind;
  name: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  /** Effects of each level. */
  per: Effects;
  /** Highest level that can be bought (features are one-time: max 1). */
  max?: number;
  /** Upgrade levels needed before this can be bought. */
  requires?: Readonly<Record<string, number>>;
}

export const UPGRADES: readonly Upgrade[] = [
  // Sensors: repeatable, each level sees farther.
  { id: 'camera', kind: 'sensor', name: 'Front Camera', description: 'Sees lane lines and cars ahead, farther each level. +1.5 mph', baseCost: 3, costGrowth: 1.15, per: { mph: 1.5 } },
  { id: 'radar', kind: 'sensor', name: 'Front Radar', description: 'Spots cars far ahead in a narrow beam. +3 mph', baseCost: 30, costGrowth: 1.17, per: { mph: 3 } },
  { id: 'sidecams', kind: 'sensor', name: 'Side & Rear Cameras', description: 'Sees all around the car. +4 mph', baseCost: 500, costGrowth: 1.2, per: { mph: 4 } },
  { id: 'lidar', kind: 'sensor', name: 'Lidar', description: 'Spinning laser on the roof: a 3D map of everything around. +5 mph', baseCost: 4000, costGrowth: 1.22, per: { mph: 5 } },
  // Driving features: one-time software unlocks that raise the autonomy level.
  { id: 'acc', kind: 'feature', name: 'Adaptive Cruise', description: 'Steady speed behind traffic. +10% speed, +10% mpg', baseCost: 50, costGrowth: 1, per: { speed: 0.1, mpg: 0.1 }, max: 1, requires: { radar: 1 } },
  { id: 'lanekeep', kind: 'feature', name: 'Lane Keeping', description: 'Holds the lane so Dad can relax. +10% speed, Dad tires slower', baseCost: 40, costGrowth: 1, per: { speed: 0.1, rest: 0.2 }, max: 1, requires: { camera: 2 } },
  { id: 'autosteer', kind: 'feature', name: 'Autosteer', description: 'Cruise and lane keeping together. Lane lines turn blue. +15% speed', baseCost: 1500, costGrowth: 1, per: { speed: 0.15, rest: 0.3 }, max: 1, requires: { acc: 1, lanekeep: 1, camera: 5 } },
  { id: 'lanechange', kind: 'feature', name: 'Auto Lane Change', description: 'Passes slow traffic on its own. +10% speed', baseCost: 8000, costGrowth: 1, per: { speed: 0.1 }, max: 1, requires: { autosteer: 1, sidecams: 1 } },
  { id: 'navhwy', kind: 'feature', name: 'Navigate on Highway', description: 'Takes exits and merges itself. +15% speed', baseCost: 30000, costGrowth: 1, per: { speed: 0.15 }, max: 1, requires: { lanechange: 1, radar: 5 } },
  { id: 'citystreets', kind: 'feature', name: 'City Streets', description: 'Drives through cities and at night. +15% speed', baseCost: 100000, costGrowth: 1, per: { speed: 0.15 }, max: 1, requires: { navhwy: 1, lidar: 1 } },
  { id: 'fsd', kind: 'feature', name: 'Full Self Driving', description: 'No driver needed. Dad naps in the back. +20% speed', baseCost: 400000, costGrowth: 1, per: { speed: 0.2 }, max: 1, requires: { citystreets: 1, lidar: 4, camera: 15 } },
  { id: 'selfrefuel', kind: 'feature', name: 'Self-Park & Refuel', description: 'Gas stops take seconds instead of a minute', baseCost: 3000, costGrowth: 1, per: {}, max: 1, requires: { sidecams: 1 } },
  // Comfort.
  { id: 'snacks', kind: 'comfort', name: 'Snack Cooler', description: 'Happy kids, calmer Dad: he tires 15% slower', baseCost: 60, costGrowth: 1.6, per: { rest: 0.15 } },
  { id: 'ecotires', kind: 'comfort', name: 'Eco Tires', description: 'Rolls easier: +8% mpg', baseCost: 80, costGrowth: 1.5, per: { mpg: 0.08 } },
  // Stream gear: earn more instead of driving better.
  { id: 'mount', kind: 'stream', name: 'Phone Mount', description: 'No more shaky footage. +15% viewers', baseCost: 4, costGrowth: 1.6, per: { viewers: 0.15 } },
  { id: 'phonecam', kind: 'stream', name: 'Better Phone Camera', description: 'Crisp video of the road. +25% viewers', baseCost: 50, costGrowth: 1.7, per: { viewers: 0.25 } },
  { id: 'overlays', kind: 'stream', name: 'Overlays & Alerts', description: 'Map, speed and tip alerts on screen. +20% $ per viewer', baseCost: 150, costGrowth: 1.75, per: { payout: 0.2 } },
  { id: 'hotspot', kind: 'stream', name: 'Mobile Hotspot', description: 'Fewer dropped streams in the sticks. +20% viewers', baseCost: 200, costGrowth: 1.75, per: { viewers: 0.2 } },
  { id: 'roofcam', kind: 'stream', name: 'Roof Cam', description: 'The big overhead shot. +30% viewers', baseCost: 800, costGrowth: 1.8, per: { viewers: 0.3 } },
  { id: 'merch', kind: 'stream', name: 'Merch Store', description: '"I survived Dad\'s driving" shirts. +40% $ per viewer', baseCost: 1500, costGrowth: 1.9, per: { payout: 0.4 } },
  { id: 'sponsor', kind: 'stream', name: 'Sponsor Deal', description: 'An energy drink sponsors the trip. +60% $ per viewer', baseCost: 6000, costGrowth: 2.0, per: { payout: 0.6 } },
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

// ---- Driving ----
/** Dad's own pace, and the fastest the family will ever go. */
export const BASE_MPH = 25;
export const MAX_MPH = 85;

// ---- Takeovers ----
/** Average seconds of driving between takeovers at each autonomy level (L5 never asks). */
export const TAKEOVER_INTERVAL = [40, 75, 150, 360, 1200, Infinity];
/** Online, Dad sorts a takeover out himself after this many seconds if you don't tap. */
export const DAD_RESOLVE_SECONDS = 20;
/** Tapping a takeover is worth this many seconds of stream income. */
export const TAKEOVER_BONUS_SECONDS = 15;

// ---- Dad ----
/** Tiredness Dad gains per second of driving, by autonomy level (1 = falls asleep). */
export const TIRE_RATE = [1 / 400, 1 / 600, 1 / 1000, 1 / 2000, 1 / 5000, 0];
/** Tiredness Dad loses per second while the car is stopped. */
export const REST_RATE = 1 / 300;
/** Helping with a takeover takes this much off Dad's tiredness. */
export const TAP_REST = 0.08;
/** Coffee takes this much off, and costs this many seconds of income (at least $2). */
export const COFFEE_REST = 0.5;
export const COFFEE_COST_SECONDS = 30;

// ---- Crashes ----
/** Seconds until the tow truck has you back on the road. */
export const TOW_SECONDS = 30;
/** Repairs cost a flat amount plus this many seconds of income. */
export const REPAIR_BASE = 10;
export const REPAIR_COST_SECONDS = 120;
/** Each tap on "hurry the tow truck" takes this many seconds off. */
export const TOW_TAP_SECONDS = 3;

// ---- Stream ----
/** Viewers with no followers. Followers bring more, with diminishing returns (square root). */
export const BASE_VIEWERS = 4;
export const FOLLOWER_PULL = 1.5;
/** $ per viewer per second. */
export const PAYOUT = 0.004;
/** Followers gained per viewer-second watched. */
export const FOLLOW_RATE = 0.0008;
/** Viewers drift toward their target over this many seconds; hype fades over this many. */
const VIEWER_TAU = 30;
const HYPE_TAU = 90;
/** Parked (stuck, crashed, refueling) streams are less interesting. */
const PARKED_VIEWERS = 0.6;

// ---- Gas ----
export const TANK_GALLONS = 14;
export const BASE_MPG = 21;
/** Seconds a gas stop takes (and with self-refuel). */
export const GAS_STOP_SECONDS = 60;
export const QUICK_GAS_STOP_SECONDS = 10;
/** The smallest fill-up Dad bothers with. */
const MIN_FILL = 0.5;

/** States along the route: where each starts (route miles) and its gas price ($/gal). */
export const STATES: readonly { at: number; code: string; gas: number }[] = [
  { at: 0, code: 'FL', gas: 3.35 },
  { at: 204, code: 'GA', gas: 3.15 },
  { at: 550, code: 'TN', gas: 3.05 },
  { at: 732, code: 'KY', gas: 3.2 },
  { at: 820, code: 'IL', gas: 3.55 },
  { at: 994, code: 'MO', gas: 2.95 },
  { at: 1253, code: 'KS', gas: 3.0 },
  { at: 1669, code: 'CO', gas: 3.45 },
];

export interface Chance { id: string; emoji: string; name: string }

export const CRASH_KINDS: readonly Chance[] = [
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

export const TAKEOVER_KINDS: readonly Chance[] = [
  { id: 'construction', emoji: '🚧', name: 'Construction zone' },
  { id: 'interchange', emoji: '🔀', name: 'Confusing interchange' },
  { id: 'toll', emoji: '🎫', name: 'Toll plaza' },
  { id: 'merge', emoji: '↪️', name: 'Tight merge' },
  { id: 'storm', emoji: '⛈️', name: 'Sudden storm' },
  { id: 'deer', emoji: '🦌', name: 'Deer by the road' },
];

export interface Landmark {
  /** Route miles from the start. */
  at: number;
  name: string;
  emoji: string;
  /** Cities are the route's waypoints; sights and state lines spike the stream when you pass them. */
  kind: 'city' | 'sight' | 'border';
}

/**
 * Cities and sights along the real route, at their route mile. Cities come from the baked map
 * (checked by a test); sights and state lines were placed from the route's overview line.
 */
export const LANDMARKS: readonly Landmark[] = [
  { at: 0, name: 'Orlando, FL', emoji: '🏰', kind: 'city' },
  { at: 79, name: 'Ocala horse country', emoji: '🐎', kind: 'sight' },
  { at: 204, name: 'Welcome to Georgia', emoji: '🍑', kind: 'border' },
  { at: 361, name: 'Macon, GA', emoji: '🌸', kind: 'sight' },
  { at: 438.2, name: 'Atlanta, GA', emoji: '🏙️', kind: 'city' },
  { at: 550, name: 'Welcome to Tennessee', emoji: '🎸', kind: 'border' },
  { at: 552, name: 'Lookout Mountain', emoji: '⛰️', kind: 'sight' },
  { at: 554.5, name: 'Chattanooga, TN', emoji: '🚂', kind: 'city' },
  { at: 685.8, name: 'Nashville, TN', emoji: '🎤', kind: 'city' },
  { at: 732, name: 'Welcome to Kentucky', emoji: '🐴', kind: 'border' },
  { at: 820, name: 'Ohio River at Paducah', emoji: '🌉', kind: 'sight' },
  { at: 918, name: 'Illinois cornfields', emoji: '🌽', kind: 'sight' },
  { at: 990, name: 'Gateway Arch', emoji: '🌈', kind: 'sight' },
  { at: 991.6, name: 'St. Louis, MO', emoji: '⚾', kind: 'city' },
  { at: 1124, name: 'Columbia, MO', emoji: '🐯', kind: 'sight' },
  { at: 1239.8, name: 'Kansas City, MO', emoji: '🍖', kind: 'city' },
  { at: 1253, name: 'Welcome to Kansas', emoji: '🌾', kind: 'border' },
  { at: 1303, name: 'Topeka, KS', emoji: '🏛️', kind: 'sight' },
  { at: 1413, name: 'Salina, KS', emoji: '🌾', kind: 'sight' },
  { at: 1504, name: 'Hays, KS (still Kansas)', emoji: '😴', kind: 'sight' },
  { at: 1633, name: 'Giant Van Gogh easel, Goodland', emoji: '🌻', kind: 'sight' },
  { at: 1669, name: 'Welcome to Colorful Colorado', emoji: '🏔️', kind: 'border' },
  { at: 1756, name: 'Limon: first view of the Rockies', emoji: '🏔️', kind: 'sight' },
  { at: 1837.2, name: 'Denver, CO', emoji: '🏙️', kind: 'city' },
  { at: 1862.4, name: 'Boulder, CO', emoji: '🚲', kind: 'city' },
  { at: 1864, name: 'The Flatirons', emoji: '⛰️', kind: 'sight' },
  { at: 1879.4, name: 'Lyons, CO', emoji: '🌲', kind: 'city' },
  { at: 1899.9, name: 'Estes Park, CO', emoji: '🦌', kind: 'city' },
  { at: 1912.0, name: 'Rocky Mountain National Park', emoji: '🏞️', kind: 'city' },
];

export interface Region {
  /** Route mile where it starts. */
  at: number;
  name: string;
  /** Viewer multiplier: scenery matters. */
  viewers: number;
  /** Takeover gap multiplier: cities ask for help more often. */
  takeovers: number;
}

/** Stretches of scenery. Kansas is the grind; the Rockies are payday. */
export const REGIONS: readonly Region[] = [
  { at: 0, name: 'Florida flatlands', viewers: 1, takeovers: 1 },
  { at: 204, name: 'Georgia pines', viewers: 1, takeovers: 1 },
  { at: 420, name: 'Atlanta traffic', viewers: 1.3, takeovers: 0.5 },
  { at: 460, name: 'North Georgia', viewers: 1, takeovers: 1 },
  { at: 540, name: 'Tennessee hills', viewers: 1.25, takeovers: 0.9 },
  { at: 675, name: 'Nashville', viewers: 1.3, takeovers: 0.6 },
  { at: 700, name: 'Kentucky and Illinois farmland', viewers: 0.9, takeovers: 1 },
  { at: 980, name: 'St. Louis', viewers: 1.4, takeovers: 0.6 },
  { at: 1000, name: 'Missouri', viewers: 0.9, takeovers: 1 },
  { at: 1230, name: 'Kansas City', viewers: 1.1, takeovers: 0.7 },
  { at: 1253, name: 'Kansas (the grind)', viewers: 0.6, takeovers: 1.2 },
  { at: 1669, name: 'Colorado high plains', viewers: 1.1, takeovers: 1 },
  { at: 1820, name: 'Denver and Boulder', viewers: 1.3, takeovers: 0.6 },
  { at: 1865, name: 'The Rockies', viewers: 1.7, takeovers: 0.7 },
];

export function regionAt(miles: number): Region {
  let cur = REGIONS[0];
  for (const r of REGIONS) if (miles >= r.at) cur = r;
  return cur;
}

// ---- Day and night ----
/** Game time runs this much faster than real time: a day on the road is two real hours. */
export const TIME_SCALE = 12;
export const DAY = 24 * 3600;
/** The trip starts at 8 in the morning. */
export const START_CLOCK = 8 * 3600;
/** Night: Dad tires faster (until the car can drive at night) and fewer people watch. */
export const NIGHT_TIRE = 1.6;
export const NIGHT_VIEWERS = 0.85;

/** Hour of the game day, 0..24. */
export function hourOf(state: GameState): number {
  return (((state.clock % DAY) + DAY) % DAY) / 3600;
}

export function isNight(state: GameState): boolean {
  const h = hourOf(state);
  return h < 6 || h >= 20;
}

/** 0 at night, 1 in full day, ramping over dawn (6-8) and dusk (18-20). */
export function daylight(state: GameState): number {
  const h = hourOf(state);
  if (h < 6 || h >= 20) return 0;
  if (h < 8) return (h - 6) / 2;
  if (h >= 18) return (20 - h) / 2;
  return 1;
}

export const TRIP_LENGTH = LANDMARKS[LANDMARKS.length - 1].at;
export const SAVE_VERSION = 3;
/** Offline progress is capped so a long absence doesn't skip the whole game. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

export interface Stats {
  /** Total $ the stream has earned. */
  earned: number;
  /** Total $ spent on gas, and gallons burned. */
  fuelSpent: number;
  gallons: number;
  peakViewers: number;
}

export interface GameState {
  version: number;
  /** Route miles driven. */
  odometer: number;
  /** Dollars to spend. */
  cash: number;
  levels: Record<string, number>;
  /** Epoch ms of the last tick, for offline progress. */
  lastTick: number;
  /** Gallons in the tank. */
  gas: number;
  /** A gas stop in progress: seconds left. */
  refuel?: { left: number };
  /** Steady viewers (drift toward a target), plus a hype bonus that fades. */
  viewers: number;
  hype: number;
  /** Followers never leave; they raise the base audience. */
  followers: number;
  /** Game clock in seconds since midnight of the first day (runs TIME_SCALE times real time). */
  clock: number;
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
  stats: Stats;
}

export function newGame(now: number): GameState {
  return {
    version: SAVE_VERSION, odometer: 0, cash: 5, levels: {}, lastTick: now,
    gas: TANK_GALLONS, viewers: BASE_VIEWERS, hype: 0, followers: 0, clock: START_CLOCK,
    untilTakeover: takeoverGap(0, 0), takeovers: 0, tiredness: 0, crashes: 0,
    stats: { earned: 0, fuelSpent: 0, gallons: 0, peakViewers: BASE_VIEWERS },
  };
}

export function level(state: GameState, id: string): number {
  return state.levels[id] ?? 0;
}

/** Sum of one effect over every owned upgrade level. */
export function effect(levels: Readonly<Record<string, number>>, key: keyof Effects): number {
  let sum = 0;
  for (const u of UPGRADES) sum += (u.per[key] ?? 0) * (levels[u.id] ?? 0);
  return sum;
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

export function crashKind(state: GameState): Chance | undefined {
  return state.crash && (CRASH_KINDS.find((k) => k.id === state.crash!.kind) ?? CRASH_KINDS[0]);
}

export function takeoverKind(state: GameState): Chance | undefined {
  return state.takeover && (TAKEOVER_KINDS.find((k) => k.id === state.takeover!.kind) ?? TAKEOVER_KINDS[0]);
}

/** Cruising speed in mph with the upgrades owned. */
export function speed(state: GameState): number {
  return Math.min(MAX_MPH, (BASE_MPH + effect(state.levels, 'mph')) * (1 + effect(state.levels, 'speed')));
}

export function arrived(state: GameState): boolean {
  return state.odometer >= TRIP_LENGTH - 1e-9;
}

/** Why the car isn't moving, if it isn't. */
export function stopReason(state: GameState): 'arrived' | 'crash' | 'takeover' | 'refuel' | 'gas' | undefined {
  if (arrived(state)) return 'arrived';
  if (state.crash) return 'crash';
  if (state.takeover) return 'takeover';
  if (state.refuel) return 'refuel';
  if (state.gas <= 1e-9) return 'gas';
  return undefined;
}

/** How fast the car is going right now. */
export function currentSpeed(state: GameState): number {
  return stopReason(state) ? 0 : speed(state);
}

export function mpg(state: GameState): number {
  return BASE_MPG * (1 + effect(state.levels, 'mpg'));
}

export function stateAt(miles: number) {
  let cur = STATES[0];
  for (const s of STATES) if (miles >= s.at) cur = s;
  return cur;
}

export function gasPrice(state: GameState): number {
  return stateAt(state.odometer).gas;
}

/** Viewers watching right now (steady + hype). */
export function viewers(state: GameState): number {
  return state.viewers + state.hype;
}

function viewerMul(state: GameState): number {
  return 1 + effect(state.levels, 'viewers');
}

export function payoutRate(state: GameState): number {
  return PAYOUT * (1 + effect(state.levels, 'payout'));
}

/** Where the steady audience is heading. */
export function targetViewers(state: GameState, moving = !stopReason(state)): number {
  return (BASE_VIEWERS + FOLLOWER_PULL * Math.sqrt(state.followers)) * viewerMul(state)
    * regionAt(state.odometer).viewers * (isNight(state) ? NIGHT_VIEWERS : 1) * (moving ? 1 : PARKED_VIEWERS);
}

/** $ per second right now. */
export function income(state: GameState): number {
  return viewers(state) * payoutRate(state);
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
  return !isMaxed(state, id) && missingRequirements(state, id).length === 0 && state.cash >= upgradeCost(state, id);
}

export function buy(state: GameState, id: string): GameState {
  if (!canBuy(state, id)) return state;
  const before = autonomyLevel(state.levels);
  const levels = { ...state.levels, [id]: level(state, id) + 1 };
  const after = autonomyLevel(levels);
  const bought = { ...state, cash: state.cash - upgradeCost(state, id), levels };
  if (after <= before) return bought;
  // A new autonomy level is a big stream moment, and spaces takeovers out right away.
  return {
    ...bought,
    hype: bought.hype + 3 * bought.viewers + 30,
    untilTakeover: Math.max(state.untilTakeover, takeoverGap(after, state.takeovers)),
  };
}

export interface AdvanceOptions {
  /** True while the player is watching: Dad then handles a takeover or tow himself after a while. */
  dadHelps?: boolean;
}

/** Longest stretch simulated in one step, so viewers and followers stay accurate. */
const STEP = 60;

/**
 * Advance the simulation by `seconds`. The stream earns the whole time (less while parked).
 * Offline (no `dadHelps`), the car stops at a takeover or a crash and waits for you; Dad rests
 * while it waits. Dad fills up the tank himself whenever it runs dry and there's money for gas.
 */
export function advance(state: GameState, seconds: number, opts: AdvanceOptions = {}): GameState {
  let s = state;
  let left = seconds;
  for (let guard = 0; left > 1e-9 && guard < 100_000; guard++) {
    let dt = Math.min(left, STEP);
    if (s.crash) {
      if (opts.dadHelps) dt = Math.min(dt, s.crash.left);
      s = rest(stream(s, dt, false), dt);
      if (opts.dadHelps) s = s.crash!.left - dt <= 1e-9 ? { ...s, crash: undefined } : { ...s, crash: { ...s.crash!, left: s.crash!.left - dt } };
    } else if (s.takeover) {
      const t = s.takeover;
      if (opts.dadHelps) dt = Math.min(dt, DAD_RESOLVE_SECONDS - t.waited);
      s = rest(stream(s, dt, false), dt);
      if (opts.dadHelps) {
        const waited = t.waited + dt;
        if (waited < DAD_RESOLVE_SECONDS - 1e-9) s = { ...s, takeover: { ...t, waited } };
        else {
          // Dad handles it alone: the more tired he is, the likelier it ends in a crash.
          const crashed = hash01(s.takeovers * 2 + 31337) < crashChance(s.tiredness);
          s = clearTakeover(s);
          if (crashed) s = startCrash(s, CRASH_FOR_TAKEOVER[t.kind] ?? 'spin');
        }
      }
    } else if (s.refuel) {
      dt = Math.min(dt, s.refuel.left);
      s = rest(stream(s, dt, false), dt);
      s = s.refuel!.left - dt <= 1e-9 ? { ...s, refuel: undefined } : { ...s, refuel: { left: s.refuel!.left - dt } };
    } else if (arrived(s)) {
      s = rest(stream(s, dt, false), dt);
    } else if (s.gas <= 1e-9) {
      const filled = fillUp(s);
      if (filled !== s) { s = filled; continue; }
      // Not enough money for gas: parked, the stream earns until Dad can fill up.
      dt = Math.min(dt, 5);
      s = rest(stream(s, dt, false), dt);
    } else {
      const mph = speed(s);
      const auto = autonomyLevel(s.levels);
      const rate = (TIRE_RATE[auto] / (1 + effect(s.levels, 'rest'))) * (isNight(s) && auto < 4 ? NIGHT_TIRE : 1);
      const untilAsleep = rate > 0 ? (1 - s.tiredness) / rate : Infinity;
      const gpm = 1 / mpg(s);
      const untilEmpty = (s.gas / gpm / mph) * 3600;
      const untilThere = ((TRIP_LENGTH - s.odometer) / mph) * 3600;
      dt = Math.min(dt, s.untilTakeover, untilAsleep, untilEmpty, untilThere);
      const miles = (mph * dt) / 3600;
      s = stream(s, dt, true);
      // Passing a sight or a state line is a stream moment.
      for (const l of LANDMARKS) {
        if (l.at > s.odometer && l.at <= s.odometer + miles && l.kind !== 'city') s = { ...s, hype: s.hype + 0.5 * s.viewers + 10 };
      }
      s = {
        ...s,
        odometer: Math.min(TRIP_LENGTH, s.odometer + miles),
        gas: dt >= untilEmpty - 1e-9 ? 0 : Math.max(0, s.gas - miles * gpm),
        untilTakeover: s.untilTakeover - dt,
        tiredness: Math.min(1, s.tiredness + rate * dt),
        stats: { ...s.stats, gallons: s.stats.gallons + miles * gpm },
      };
      if (rate > 0 && s.tiredness >= 1 - 1e-9) s = startCrash({ ...s, tiredness: 1 }, 'nodoff');
      else if (s.untilTakeover <= 1e-9 && !arrived(s)) {
        const kind = TAKEOVER_KINDS[Math.floor(hash01(s.takeovers * 2) * TAKEOVER_KINDS.length)].id;
        s = { ...s, takeover: { kind, waited: 0 } };
      }
    }
    left -= dt;
    s = { ...s, clock: s.clock + dt * TIME_SCALE };
  }
  return s;
}

/** Viewers drift toward their target, hype fades, money and followers come in. */
function stream(s: GameState, dt: number, moving: boolean): GameState {
  const target = targetViewers(s, moving);
  const ev = Math.exp(-dt / VIEWER_TAU), eh = Math.exp(-dt / HYPE_TAU);
  const v = target + (s.viewers - target) * ev;
  const h = s.hype * eh;
  // Viewer-seconds watched over the step (exact integral of the exponential drift).
  const watched = target * dt + (s.viewers - target) * VIEWER_TAU * (1 - ev) + s.hype * HYPE_TAU * (1 - eh);
  const earned = watched * payoutRate(s);
  return {
    ...s,
    viewers: v,
    hype: h < 0.01 ? 0 : h,
    cash: s.cash + earned,
    followers: s.followers + watched * FOLLOW_RATE,
    stats: { ...s.stats, earned: s.stats.earned + earned, peakViewers: Math.max(s.stats.peakViewers, s.viewers + s.hype, v + h) },
  };
}

function rest(s: GameState, seconds: number): GameState {
  return s.tiredness > 0 ? { ...s, tiredness: Math.max(0, s.tiredness - REST_RATE * seconds) } : s;
}

/** Dad fills the tank with what the family can afford, and the gas stop takes a minute. */
function fillUp(s: GameState): GameState {
  const price = gasPrice(s);
  const gallons = Math.min(TANK_GALLONS - s.gas, s.cash / price);
  if (gallons < MIN_FILL) return s;
  const cost = gallons * price;
  return {
    ...s,
    cash: s.cash - cost,
    gas: s.gas + gallons,
    refuel: { left: level(s, 'selfrefuel') > 0 ? QUICK_GAS_STOP_SECONDS : GAS_STOP_SECONDS },
    stats: { ...s.stats, fuelSpent: s.stats.fuelSpent + cost },
  };
}

/** Chance that Dad crashes when he handles a takeover alone. */
export function crashChance(tiredness: number): number {
  return 0.05 + 0.6 * tiredness * tiredness;
}

/** Crash: repairs cost money, the clip goes viral, the adrenaline wakes Dad up, the tow truck comes. */
function startCrash(s: GameState, kind: string): GameState {
  const cost = Math.min(s.cash, REPAIR_BASE + income(s) * REPAIR_COST_SECONDS);
  return {
    ...s,
    cash: s.cash - cost,
    hype: s.hype + 2 * s.viewers + 15,
    followers: s.followers + 0.05 * s.viewers + 3,
    tiredness: Math.min(s.tiredness, 0.3),
    crashes: s.crashes + 1,
    crash: { kind, left: TOW_SECONDS, cost },
    takeover: undefined,
  };
}

function clearTakeover(s: GameState): GameState {
  const takeovers = s.takeovers + 1;
  const gap = takeoverGap(autonomyLevel(s.levels), takeovers) * regionAt(s.odometer).takeovers;
  return { ...s, takeover: undefined, takeovers, untilTakeover: gap };
}

/** The player taps the takeover prompt: chat goes wild, tips come in, and Dad relaxes a bit. */
export function resolveTakeover(state: GameState): GameState {
  if (!state.takeover) return state;
  const tips = income(state) * TAKEOVER_BONUS_SECONDS;
  return clearTakeover({
    ...state,
    cash: state.cash + tips,
    hype: state.hype + 0.25 * state.viewers + 3,
    tiredness: Math.max(0, state.tiredness - TAP_REST),
    stats: { ...state.stats, earned: state.stats.earned + tips },
  });
}

/** Tap to hurry the tow truck along. */
export function hurryTow(state: GameState): GameState {
  if (!state.crash) return state;
  const left = state.crash.left - TOW_TAP_SECONDS;
  return left <= 0 ? { ...state, crash: undefined } : { ...state, crash: { ...state.crash, left } };
}

export function coffeeCost(state: GameState): number {
  return Math.max(2, Math.ceil(income(state) * COFFEE_COST_SECONDS));
}

export function canBuyCoffee(state: GameState): boolean {
  return state.tiredness > 0.02 && state.cash >= coffeeCost(state);
}

/** Buy Dad a coffee. */
export function coffee(state: GameState): GameState {
  if (!canBuyCoffee(state)) return state;
  return { ...state, cash: state.cash - coffeeCost(state), tiredness: Math.max(0, state.tiredness - COFFEE_REST) };
}

/** Honking makes chat happy: a little hype, up to a point. */
export function honk(state: GameState): GameState {
  if (state.hype >= 0.5 * state.viewers + 5) return state;
  return { ...state, hype: state.hype + 1 };
}

/** Advance to wall-clock `now`, capping offline time. Returns new state and seconds simulated. */
export function catchUp(state: GameState, now: number): { state: GameState; seconds: number } {
  const seconds = Math.min(Math.max(0, (now - state.lastTick) / 1000), MAX_OFFLINE_SECONDS);
  return { state: { ...advance(state, seconds), lastTick: now }, seconds };
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

/** Upgrades renamed in save version 2 (sensors replaced the first upgrade list). */
const RENAMED_UPGRADES: Record<string, string> = { cruise: 'camera', tires: 'radar', lane: 'sidecams' };
/** Version 1 and 2 saves measured a made-up 75,000-mile trip in miles that were also the money. */
const OLD_TRIP_LENGTH = 75_000;
const OLD_MILES_TO_CASH = 0.05;

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Parse a save, falling back to a new game if it's missing or corrupt. Older versions are migrated. */
export function deserialize(raw: string | null, now: number): GameState {
  if (!raw) return newGame(now);
  try {
    const s = JSON.parse(raw) as Record<string, unknown> & Partial<GameState>;
    if (typeof s.odometer !== 'number') return newGame(now);
    const fresh = newGame(now);
    const old = typeof s.version !== 'number' || s.version < 3;
    if (old && typeof s.miles !== 'number') return fresh;
    const levels = migrateLevels(s.levels);
    const takeovers = Math.floor(num(s.takeovers, 0, 0));
    const out: GameState = {
      ...fresh,
      odometer: old ? Math.min(TRIP_LENGTH, (s.odometer / OLD_TRIP_LENGTH) * TRIP_LENGTH) : num(s.odometer, 0, 0, TRIP_LENGTH),
      cash: old ? fresh.cash + (s.miles as number) * OLD_MILES_TO_CASH : num(s.cash, fresh.cash, 0),
      levels,
      lastTick: num(s.lastTick, now),
      gas: num(s.gas, TANK_GALLONS, 0, TANK_GALLONS),
      viewers: num(s.viewers, BASE_VIEWERS, 0),
      hype: num(s.hype, 0, 0),
      followers: num(s.followers, 0, 0),
      clock: num(s.clock, START_CLOCK, 0),
      untilTakeover: typeof s.untilTakeover === 'number' && s.untilTakeover >= 0 ? s.untilTakeover : takeoverGap(autonomyLevel(levels), takeovers),
      takeovers,
      tiredness: num(s.tiredness, 0, 0, 1),
      crashes: Math.floor(num(s.crashes, 0, 0)),
    };
    // JSON turns Infinity (L5 never asks for help) into null.
    if (s.untilTakeover === null) out.untilTakeover = takeoverGap(autonomyLevel(levels), takeovers);
    const t = s.takeover;
    if (t && typeof t.kind === 'string') out.takeover = { kind: t.kind, waited: num(t.waited, 0, 0) };
    const c = s.crash;
    if (c && typeof c.kind === 'string') out.crash = { kind: c.kind, left: num(c.left, TOW_SECONDS, 0), cost: num(c.cost, 0, 0) };
    const r = s.refuel;
    if (r && typeof r.left === 'number') out.refuel = { left: num(r.left, 0, 0) };
    const st = (s.stats ?? {}) as Partial<Stats>;
    out.stats = {
      earned: num(st.earned, 0, 0), fuelSpent: num(st.fuelSpent, 0, 0), gallons: num(st.gallons, 0, 0),
      peakViewers: num(st.peakViewers, BASE_VIEWERS, 0),
    };
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
    const u = UPGRADES.find((x) => x.id === to);
    if (!u) continue;
    out[to] = Math.min(u.max ?? Infinity, (out[to] ?? 0) + Math.floor(lv));
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

/** Money: cents under $100, whole dollars above. */
export function formatCash(n: number): string {
  return n < 100 ? `$${n.toFixed(2)}` : `$${formatNumber(n)}`;
}

export function findUpgrade(id: string): Upgrade {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown upgrade: ${id}`);
  return u;
}
