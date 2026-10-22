import { describe, expect, it } from 'vitest';
import {
  DAD_RESOLVE_SECONDS, MAX_OFFLINE_SECONDS, TAKEOVER_BONUS_SECONDS, TAKEOVER_INTERVAL, TRIP_LENGTH, UPGRADES,
  advance, autonomyLevel, buy, canBuy, catchUp, currentLandmark, currentSpeed, deserialize, formatNumber,
  honk, isMaxed, level, missingRequirements, newGame, nextLandmark, resolveTakeover, serialize, speed,
  takeoverGap, tripProgress, upgradeCost, type GameState,
  TIRE_RATE, TOW_SECONDS, REPAIR_COST_SECONDS, canBuyCoffee, coffee, coffeeCost, crashChance, crashKind, hurryTow,
} from '../src/game';

describe('driving', () => {
  it('always moves at a small base speed', () => {
    const s = advance(newGame(0), 10);
    expect(s.odometer).toBeCloseTo(2);
    expect(s.miles).toBeCloseTo(2);
  });

  it('honk gives at least one mile', () => {
    expect(honk(newGame(0)).miles).toBe(1);
  });
});

describe('upgrades', () => {
  it('cannot buy without enough miles', () => {
    const s = newGame(0);
    expect(canBuy(s, 'camera')).toBe(false);
    expect(buy(s, 'camera')).toBe(s);
  });

  it('buying spends miles, raises level, raises speed and next cost', () => {
    const s = { ...newGame(0), miles: 100 };
    const before = upgradeCost(s, 'camera');
    const after = buy(s, 'camera');
    expect(after.miles).toBe(100 - before);
    expect(level(after, 'camera')).toBe(1);
    expect(speed(after)).toBeGreaterThan(speed(s));
    expect(upgradeCost(after, 'camera')).toBeGreaterThan(before);
    expect(after.odometer).toBe(s.odometer); // spending doesn't move you backwards
  });

  it('multiplier upgrades scale flat speed', () => {
    const s = { ...newGame(0), levels: { radar: 1, snacks: 2 } };
    expect(speed(s)).toBeCloseTo((0.2 + 3) * 1.2);
  });
});

describe('features and autonomy', () => {
  it('features need their sensors first and are bought once', () => {
    const s = { ...newGame(0), miles: 1e6 };
    expect(canBuy(s, 'acc')).toBe(false);
    expect(missingRequirements(s, 'acc').map(([u, lv]) => [u.id, lv])).toEqual([['radar', 1]]);
    const withRadar = buy(s, 'radar');
    expect(canBuy(withRadar, 'acc')).toBe(true);
    const owned = buy(withRadar, 'acc');
    expect(level(owned, 'acc')).toBe(1);
    expect(isMaxed(owned, 'acc')).toBe(true);
    expect(buy(owned, 'acc')).toBe(owned);
  });

  it('every requirement names a real upgrade', () => {
    const ids = new Set(UPGRADES.map((u) => u.id));
    for (const u of UPGRADES) for (const req of Object.keys(u.requires ?? {})) expect(ids.has(req)).toBe(true);
  });

  it('autonomy level follows the features owned', () => {
    expect(autonomyLevel({})).toBe(0);
    expect(autonomyLevel({ radar: 3, camera: 9 })).toBe(0);
    expect(autonomyLevel({ lanekeep: 1 })).toBe(1);
    expect(autonomyLevel({ acc: 1, lanekeep: 1, autosteer: 1 })).toBe(2);
    expect(autonomyLevel({ navhwy: 1 })).toBe(3);
    expect(autonomyLevel({ citystreets: 1 })).toBe(4);
    expect(autonomyLevel({ fsd: 1 })).toBe(5);
  });

  it('features multiply speed', () => {
    const s = { ...newGame(0), levels: { radar: 1, acc: 1 } };
    expect(speed(s)).toBeCloseTo((0.2 + 3) * 1.25);
  });

  it('reaching a new level spaces the next takeover out', () => {
    const s: GameState = { ...newGame(0), miles: 1e6, levels: { radar: 1 }, untilTakeover: 1 };
    expect(buy(s, 'acc').untilTakeover).toBeGreaterThan(TAKEOVER_INTERVAL[1] * 0.5);
  });
});

describe('takeovers', () => {
  const soon = (s: GameState, t = 5): GameState => ({ ...s, untilTakeover: t });

  it('the car stops and waits when it needs help', () => {
    const s = advance(soon(newGame(0)), 30);
    expect(s.takeover).toBeDefined();
    expect(s.odometer).toBeCloseTo(0.2 * 5);
    expect(currentSpeed(s)).toBe(0);
    expect(advance(s, 1000).odometer).toBe(s.odometer); // offline: waits for you
  });

  it('online, Dad sorts it out himself after a while', () => {
    const s = advance(soon(newGame(0)), 5 + DAD_RESOLVE_SECONDS + 3, { dadHelps: true });
    expect(s.takeover).toBeUndefined();
    expect(s.takeovers).toBe(1);
    expect(s.odometer).toBeCloseTo(0.2 * 8);
  });

  it('tapping resolves it with a bonus and schedules the next one', () => {
    const stuck = advance(soon(newGame(0)), 10);
    const s = resolveTakeover(stuck);
    expect(s.takeover).toBeUndefined();
    expect(s.miles - stuck.miles).toBeCloseTo(0.2 * TAKEOVER_BONUS_SECONDS);
    expect(s.untilTakeover).toBe(takeoverGap(0, 1));
    expect(resolveTakeover(s)).toBe(s);
  });

  it('gaps vary but stay near the level average, and L5 never asks', () => {
    const gaps = Array.from({ length: 50 }, (_, i) => takeoverGap(2, i));
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(TAKEOVER_INTERVAL[2] * 0.6);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(TAKEOVER_INTERVAL[2] * 1.4);
    expect(new Set(gaps).size).toBeGreaterThan(10);
    expect(takeoverGap(5, 3)).toBe(Infinity);
    const fsd = advance({ ...newGame(0), levels: { fsd: 1 }, untilTakeover: Infinity }, 1e6);
    expect(fsd.takeover).toBeUndefined();
  });
});

describe('tiredness and crashes', () => {
  it('Dad gets tired driving and rests while stopped', () => {
    const driven = advance({ ...newGame(0), untilTakeover: 1000 }, 100);
    expect(driven.tiredness).toBeCloseTo(100 * TIRE_RATE[0]);
    const stuck = advance({ ...driven, untilTakeover: 0.001 }, 60);
    expect(stuck.takeover).toBeDefined();
    expect(stuck.tiredness).toBeLessThan(driven.tiredness);
  });

  it('higher autonomy tires Dad less, and at L5 not at all', () => {
    const base = { ...newGame(0), untilTakeover: 1e9 };
    const l0 = advance(base, 100).tiredness;
    const l2 = advance({ ...base, levels: { autosteer: 1 } }, 100).tiredness;
    expect(l2).toBeLessThan(l0);
    expect(advance({ ...base, levels: { fsd: 1 } }, 1e6).tiredness).toBe(0);
  });

  it('falling asleep at the wheel crashes the car', () => {
    const s = advance({ ...newGame(0), untilTakeover: 1e9, miles: 1000, tiredness: 0.99 }, 60);
    expect(s.crash?.kind).toBe('nodoff');
    expect(crashKind(s)?.emoji).toBe('😴');
    expect(s.crashes).toBe(1);
    expect(s.tiredness).toBeLessThanOrEqual(0.3);
    expect(currentSpeed(s)).toBe(0);
  });

  it('a crash costs repairs and the tow truck takes a while (only while you watch)', () => {
    const s = advance({ ...newGame(0), untilTakeover: 1e9, miles: 1000, tiredness: 1 - 1e-6 }, 1);
    expect(s.crash).toBeDefined();
    expect(s.miles).toBeCloseTo(1000 - 0.2 * REPAIR_COST_SECONDS, 3);
    expect(advance(s, 1e5).crash).toBeDefined(); // offline: waits for you
    const later = advance(s, TOW_SECONDS + 5, { dadHelps: true });
    expect(later.crash).toBeUndefined();
    expect(later.odometer).toBeGreaterThan(s.odometer);
    expect(hurryTow(s).crash!.left).toBeLessThan(s.crash!.left);
  });

  it('untapped takeovers sometimes crash, more often when Dad is tired', () => {
    const count = (tiredness: number) => {
      let crashes = 0;
      for (let i = 0; i < 400; i++) {
        const s: GameState = { ...newGame(0), takeovers: i, tiredness, takeover: { kind: 'deer', waited: 0 }, untilTakeover: 1e9 };
        if (advance(s, DAD_RESOLVE_SECONDS + 0.1, { dadHelps: true }).crash) crashes++;
      }
      return crashes / 400;
    };
    const fresh = count(0), tired = count(0.9);
    expect(fresh).toBeLessThan(0.15);
    expect(tired).toBeGreaterThan(0.35);
    expect(crashChance(1)).toBeLessThan(1);
  });

  it('coffee perks Dad up for a price', () => {
    const s: GameState = { ...newGame(0), miles: 100, tiredness: 0.8 };
    expect(canBuyCoffee(s)).toBe(true);
    const c = coffee(s);
    expect(c.tiredness).toBeCloseTo(0.3);
    expect(c.miles).toBe(100 - coffeeCost(s));
    expect(coffee({ ...s, miles: 0 }).tiredness).toBe(0.8);
  });

  it('old saves without tiredness load fresh', () => {
    const s = deserialize(JSON.stringify({ version: 2, odometer: 5, miles: 5, levels: {}, lastTick: 0, untilTakeover: 10, takeovers: 2 }), 0);
    expect(s.tiredness).toBe(0);
    expect(s.crashes).toBe(0);
    expect(s.crash).toBeUndefined();
    const crashed = advance({ ...s, tiredness: 1 - 1e-6, untilTakeover: 1e9 }, 1);
    expect(deserialize(serialize(crashed), 0)).toEqual(crashed);
  });
});

describe('offline progress', () => {
  it('catches up elapsed time', () => {
    const { state, seconds } = catchUp({ ...newGame(0), untilTakeover: 1000 }, 60_000);
    expect(seconds).toBe(60);
    expect(state.odometer).toBeCloseTo(12);
    expect(state.lastTick).toBe(60_000);
  });

  it('stops at the first takeover', () => {
    const { state } = catchUp({ ...newGame(0), untilTakeover: 30 }, 3_600_000);
    expect(state.odometer).toBeCloseTo(6);
    expect(state.takeover).toBeDefined();
  });

  it('caps long absences', () => {
    const { seconds } = catchUp(newGame(0), 1e12);
    expect(seconds).toBe(MAX_OFFLINE_SECONDS);
  });

  it('ignores clocks going backwards', () => {
    expect(catchUp(newGame(1000), 0).seconds).toBe(0);
  });
});

describe('trip', () => {
  it('tracks landmarks and progress', () => {
    const s = { ...newGame(0), odometer: 60 };
    expect(currentLandmark(s).at).toBe(50);
    expect(nextLandmark(s)?.at).toBe(300);
    expect(tripProgress({ ...s, odometer: TRIP_LENGTH * 2 })).toBe(1);
    expect(nextLandmark({ ...s, odometer: TRIP_LENGTH })).toBeUndefined();
  });
});

describe('saves', () => {
  it('round-trips', () => {
    const s = { ...newGame(5), miles: 42, odometer: 99, levels: { camera: 3 } };
    expect(deserialize(serialize(s), 0)).toEqual(s);
  });

  it('loads version 1 saves, moving old upgrades to the sensors that replaced them', () => {
    const old = JSON.stringify({ version: 1, odometer: 500, miles: 20, levels: { cruise: 4, tires: 2, snacks: 1, lane: 3 }, lastTick: 9 });
    const s = deserialize(old, 0);
    expect(s.version).toBe(2);
    expect(s.levels).toEqual({ camera: 4, radar: 2, snacks: 1, sidecams: 3 });
    expect(s.odometer).toBe(500);
    expect(speed(s)).toBeCloseTo((0.2 + 0.5 * 4 + 3 * 2 + 20 * 3) * 1.1);
    expect(s.untilTakeover).toBeGreaterThan(0);
    expect(s.takeovers).toBe(0);
    expect(s.takeover).toBeUndefined();
  });

  it('keeps a takeover in progress across a reload', () => {
    const stuck = advance({ ...newGame(0), untilTakeover: 1 }, 5);
    expect(deserialize(serialize(stuck), 0)).toEqual(stuck);
  });

  it('falls back to a new game on bad data', () => {
    expect(deserialize(null, 7)).toEqual(newGame(7));
    expect(deserialize('not json', 7)).toEqual(newGame(7));
    expect(deserialize('{"foo":1}', 7)).toEqual(newGame(7));
  });
});

describe('formatNumber', () => {
  it.each([
    [0, '0.0'], [5.55, '5.5'], [999, '999'], [1500, '1.50K'], [25_000, '25.0K'], [3_200_000, '3.20M'],
  ])('%d -> %s', (n, out) => {
    expect(formatNumber(n)).toBe(out);
  });
});
