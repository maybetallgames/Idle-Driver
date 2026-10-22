// Pure game logic: no DOM, no timers. Everything here is unit-tested.

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  /** Miles per second added per level. */
  speedPerLevel: number;
  /** Multiplier added per level (applied to total speed). */
  mulPerLevel: number;
}

export const UPGRADES: readonly Upgrade[] = [
  { id: 'camera', name: 'Front Camera', description: 'Sees lane lines and cars ahead. +0.5 mi/s, sees farther each level', baseCost: 10, costGrowth: 1.15, speedPerLevel: 0.5, mulPerLevel: 0 },
  { id: 'radar', name: 'Front Radar', description: 'Spots cars far ahead in a narrow beam. +3 mi/s', baseCost: 120, costGrowth: 1.17, speedPerLevel: 3, mulPerLevel: 0 },
  { id: 'snacks', name: 'Snack Cooler', description: 'Happy kids, fewer stops: +10% speed', baseCost: 500, costGrowth: 1.6, speedPerLevel: 0, mulPerLevel: 0.1 },
  { id: 'sidecams', name: 'Side & Rear Cameras', description: 'Sees all around the car. +20 mi/s', baseCost: 2500, costGrowth: 1.2, speedPerLevel: 20, mulPerLevel: 0 },
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
}

export function newGame(now: number): GameState {
  return { version: SAVE_VERSION, odometer: 0, miles: 0, levels: {}, lastTick: now };
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

export function upgradeCost(state: GameState, id: string): number {
  const u = findUpgrade(id);
  return Math.ceil(u.baseCost * Math.pow(u.costGrowth, level(state, id)));
}

export function canBuy(state: GameState, id: string): boolean {
  return state.miles >= upgradeCost(state, id);
}

export function buy(state: GameState, id: string): GameState {
  const cost = upgradeCost(state, id);
  if (state.miles < cost) return state;
  return {
    ...state,
    miles: state.miles - cost,
    levels: { ...state.levels, [id]: level(state, id) + 1 },
  };
}

/** Advance the simulation by `seconds`. */
export function advance(state: GameState, seconds: number): GameState {
  if (seconds <= 0) return state;
  const gained = speed(state) * seconds;
  return { ...state, odometer: state.odometer + gained, miles: state.miles + gained };
}

/** Advance to wall-clock `now`, capping offline time. Returns new state and seconds simulated. */
export function catchUp(state: GameState, now: number): { state: GameState; seconds: number } {
  const seconds = Math.min(Math.max(0, (now - state.lastTick) / 1000), MAX_OFFLINE_SECONDS);
  return { state: { ...advance(state, seconds), lastTick: now }, seconds };
}

/** Tapping the horn gives a small boost: one second of driving, minimum 1 mile. */
export function honk(state: GameState): GameState {
  const gained = Math.max(1, speed(state));
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
    return {
      version: SAVE_VERSION,
      odometer: s.odometer,
      miles: s.miles,
      levels: migrateLevels(s.levels),
      lastTick: typeof s.lastTick === 'number' ? s.lastTick : now,
    };
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
    out[to] = (out[to] ?? 0) + Math.floor(lv);
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

function findUpgrade(id: string): Upgrade {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown upgrade: ${id}`);
  return u;
}
