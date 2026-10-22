import { describe, expect, it } from 'vitest';
import {
  BASE_MPH, BASE_VIEWERS, DAD_RESOLVE_SECONDS, GAS_STOP_SECONDS, LANDMARKS, MAX_MPH, MAX_OFFLINE_SECONDS,
  QUICK_GAS_STOP_SECONDS, SAVE_VERSION, STATES, TAKEOVER_BONUS_SECONDS, TAKEOVER_INTERVAL, TANK_GALLONS, TIRE_RATE,
  TOW_SECONDS, TRIP_LENGTH, UPGRADES,
  advance, arrived, autonomyLevel, buy, canBuy, canBuyCoffee, catchUp, coffee, coffeeCost, crashChance, crashKind,
  currentLandmark, currentSpeed, deserialize, formatCash, formatNumber, gasPrice, honk, hurryTow, income, isMaxed,
  level, missingRequirements, mpg, newGame, nextLandmark, resolveTakeover, serialize, speed, stopReason,
  takeoverGap, targetViewers, tripProgress, upgradeCost, viewers, type GameState,
  START_CLOCK, TIME_SCALE, SPEED_CAP, daylight, hourOf, isNight, regionAt, DAY, hint, tripDay, tripSummary,
} from '../src/game';

/** A game with no takeovers coming, for testing one thing at a time. */
const calm = (over: Partial<GameState> = {}): GameState => ({ ...newGame(0), untilTakeover: 1e9, ...over });

describe('driving', () => {
  it('drives real miles at Dad\'s pace', () => {
    // (L0 Dad nods off after ~400 s, so keep it short.)
    const s = advance(calm(), 360);
    expect(s.odometer).toBeCloseTo(BASE_MPH / 10, 3);
    expect(currentSpeed(s)).toBe(BASE_MPH);
  });

  it('upgrades add mph and multipliers, up to a top speed', () => {
    expect(speed(calm({ levels: { radar: 1, acc: 1 } }))).toBeCloseTo((BASE_MPH + 3) * 1.1);
    expect(speed(calm({ levels: { lidar: 40 } }))).toBe(SPEED_CAP[0]);
    expect(speed(calm({ levels: { lidar: 40, fsd: 1 } }))).toBe(MAX_MPH);
  });

  it('stops at the end of the trip', () => {
    const s = advance(calm({ odometer: TRIP_LENGTH - 1 }), 3600);
    expect(s.odometer).toBe(TRIP_LENGTH);
    expect(arrived(s)).toBe(true);
    expect(stopReason(s)).toBe('arrived');
    expect(tripProgress(s)).toBe(1);
  });
});

describe('stream', () => {
  it('earns money from viewers the whole time', () => {
    const s = advance(calm(), 100);
    expect(s.cash).toBeGreaterThan(newGame(0).cash);
    expect(s.stats.earned).toBeCloseTo(s.cash - newGame(0).cash);
    expect(s.followers).toBeGreaterThan(0);
  });

  it('viewers drift toward the target, and followers raise it', () => {
    const s = advance(calm({ viewers: 0 }), 600);
    expect(s.viewers).toBeCloseTo(targetViewers(s), 0);
    expect(targetViewers(calm({ followers: 100 }))).toBeGreaterThan(targetViewers(calm()));
  });

  it('stream gear brings more viewers and more $ per viewer', () => {
    const base = calm();
    const geared = calm({ levels: { phonecam: 2, merch: 1 } });
    expect(targetViewers(geared)).toBeGreaterThan(targetViewers(base));
    expect(income(geared)).toBeGreaterThan(income(base));
  });

  it('hype fades', () => {
    const s = advance(calm({ hype: 100 }), 350);
    expect(s.hype).toBeLessThan(3);
  });

  it('honking adds a little hype, but not forever', () => {
    let s = calm();
    for (let i = 0; i < 100; i++) s = honk(s);
    expect(s.hype).toBeGreaterThan(0);
    expect(s.hype).toBeLessThanOrEqual(0.5 * s.viewers + 6);
    expect(viewers(s)).toBe(s.viewers + s.hype);
  });

  it('a parked car draws fewer viewers', () => {
    const s = calm({ takeover: { kind: 'deer', waited: 0 } });
    expect(targetViewers(s)).toBeLessThan(targetViewers(calm()));
  });
});

describe('gas', () => {
  it('burns gas by the mile', () => {
    const s = advance(calm(), 360);
    expect(TANK_GALLONS - s.gas).toBeCloseTo(BASE_MPH / 10 / mpg(s), 5);
    expect(mpg(calm({ levels: { ecotires: 2 } }))).toBeGreaterThan(mpg(calm()));
  });

  it('Dad fills up when the tank runs dry, and the stop takes a minute', () => {
    const s = advance(calm({ gas: 0.001, cash: 100 }), 10);
    expect(s.refuel).toBeDefined();
    expect(s.gas).toBeGreaterThan(TANK_GALLONS - 1);
    expect(s.cash).toBeLessThan(100 - 40);
    expect(s.stats.fuelSpent).toBeGreaterThan(40);
    expect(stopReason(s)).toBe('refuel');
    const later = advance(s, GAS_STOP_SECONDS);
    expect(later.refuel).toBeUndefined();
    expect(later.odometer).toBeGreaterThan(s.odometer);
  });

  it('self-refuel makes gas stops quick', () => {
    const s = advance(calm({ gas: 0, cash: 100, levels: { selfrefuel: 1 } }), 1);
    expect(s.refuel!.left).toBeLessThanOrEqual(QUICK_GAS_STOP_SECONDS);
  });

  it('without money for gas the car waits while the stream earns, then fills up', () => {
    const broke = calm({ gas: 0, cash: 0 });
    const s = advance(broke, 5);
    expect(stopReason(s)).toBe('gas');
    expect(s.cash).toBeGreaterThan(0);
    const later = advance(broke, 3 * 3600);
    expect(later.odometer).toBeGreaterThan(0);
  });

  it('gas prices change by state', () => {
    expect(gasPrice(calm())).toBe(STATES[0].gas);
    expect(gasPrice(calm({ odometer: 1300 }))).toBe(STATES.find((x) => x.code === 'KS')!.gas);
  });
});

describe('upgrades', () => {
  it('cannot buy without enough money', () => {
    const s = calm({ cash: 0 });
    expect(canBuy(s, 'camera')).toBe(false);
    expect(buy(s, 'camera')).toBe(s);
  });

  it('buying spends money, raises level, speed and next cost', () => {
    const s = calm({ cash: 100 });
    const before = upgradeCost(s, 'camera');
    const after = buy(s, 'camera');
    expect(after.cash).toBe(100 - before);
    expect(level(after, 'camera')).toBe(1);
    expect(speed(after)).toBeGreaterThan(speed(s));
    expect(upgradeCost(after, 'camera')).toBeGreaterThan(before);
  });

  it('every requirement names a real upgrade', () => {
    const ids = new Set(UPGRADES.map((u) => u.id));
    for (const u of UPGRADES) for (const req of Object.keys(u.requires ?? {})) expect(ids.has(req)).toBe(true);
  });
});

describe('features and autonomy', () => {
  it('features need their sensors first and are bought once', () => {
    const s = calm({ cash: 1e6 });
    expect(canBuy(s, 'acc')).toBe(false);
    expect(missingRequirements(s, 'acc').map(([u, lv]) => [u.id, lv])).toEqual([['radar', 1]]);
    const owned = buy(buy(s, 'radar'), 'acc');
    expect(level(owned, 'acc')).toBe(1);
    expect(isMaxed(owned, 'acc')).toBe(true);
    expect(buy(owned, 'acc')).toBe(owned);
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

  it('reaching a new level is a stream moment and spaces the next takeover out', () => {
    const s = calm({ cash: 1e6, levels: { radar: 1 }, untilTakeover: 1 });
    const after = buy(s, 'acc');
    expect(after.untilTakeover).toBeGreaterThan(TAKEOVER_INTERVAL[1] * 0.5);
    expect(after.hype).toBeGreaterThan(s.hype + 20);
  });
});

describe('takeovers', () => {
  const soon = (t = 5): GameState => calm({ untilTakeover: t });

  it('the car stops and waits when it needs help', () => {
    const s = advance(soon(), 30);
    expect(s.takeover).toBeDefined();
    expect(s.odometer).toBeCloseTo((BASE_MPH * 5) / 3600);
    expect(currentSpeed(s)).toBe(0);
    expect(advance(s, 1000).odometer).toBe(s.odometer); // offline: waits for you
  });

  it('online, Dad sorts it out himself after a while', () => {
    const s = advance(soon(), 5 + DAD_RESOLVE_SECONDS + 3, { dadHelps: true });
    expect(s.takeover).toBeUndefined();
    expect(s.takeovers).toBe(1);
    expect(s.odometer).toBeCloseTo((BASE_MPH * 8) / 3600);
  });

  it('tapping resolves it with tips and hype, and schedules the next one', () => {
    const stuck = advance(soon(), 10);
    const s = resolveTakeover(stuck);
    expect(s.takeover).toBeUndefined();
    expect(s.cash - stuck.cash).toBeCloseTo(income(stuck) * TAKEOVER_BONUS_SECONDS);
    expect(s.hype).toBeGreaterThan(stuck.hype);
    expect(s.untilTakeover).toBe(takeoverGap(0, 1));
    expect(resolveTakeover(s)).toBe(s);
  });

  it('gaps vary but stay near the level average, and L5 never asks', () => {
    const gaps = Array.from({ length: 50 }, (_, i) => takeoverGap(2, i));
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(TAKEOVER_INTERVAL[2] * 0.6);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(TAKEOVER_INTERVAL[2] * 1.4);
    expect(new Set(gaps).size).toBeGreaterThan(10);
    expect(takeoverGap(5, 3)).toBe(Infinity);
    const fsd = advance(calm({ levels: { fsd: 1 }, untilTakeover: Infinity, cash: 1e6 }), 1e5);
    expect(fsd.takeovers).toBe(0);
  });
});

describe('tiredness and crashes', () => {
  it('Dad gets tired driving and rests while stopped', () => {
    const driven = advance(calm(), 100);
    expect(driven.tiredness).toBeCloseTo(100 * TIRE_RATE[0]);
    const stuck = advance({ ...driven, untilTakeover: 0.001 }, 60);
    expect(stuck.takeover).toBeDefined();
    expect(stuck.tiredness).toBeLessThan(driven.tiredness);
  });

  it('autonomy and snacks tire Dad less, and at L5 not at all', () => {
    const l0 = advance(calm(), 100).tiredness;
    expect(advance(calm({ levels: { autosteer: 1 } }), 100).tiredness).toBeLessThan(l0);
    expect(advance(calm({ levels: { snacks: 2 } }), 100).tiredness).toBeLessThan(l0);
    expect(advance(calm({ levels: { fsd: 1 }, cash: 1e6 }), 1e5).tiredness).toBe(0);
  });

  it('falling asleep at the wheel crashes the car', () => {
    const s = advance(calm({ cash: 1000, tiredness: 0.99 }), 60);
    expect(s.crash?.kind).toBe('nodoff');
    expect(crashKind(s)?.emoji).toBe('😴');
    expect(s.crashes).toBe(1);
    expect(s.tiredness).toBeLessThanOrEqual(0.3);
    expect(currentSpeed(s)).toBe(0);
  });

  it('a crash costs repairs, goes viral, and waits for the tow truck (only while you watch)', () => {
    const before = calm({ cash: 1000, tiredness: 1 - 1e-6 });
    const s = advance(before, 1);
    expect(s.crash).toBeDefined();
    expect(s.crash!.cost).toBeGreaterThan(0);
    expect(s.cash).toBeLessThan(before.cash);
    expect(s.hype).toBeGreaterThan(before.hype + 10);
    expect(s.followers).toBeGreaterThan(before.followers + 2);
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
        const s = calm({ takeovers: i, tiredness, takeover: { kind: 'deer', waited: 0 } });
        if (advance(s, DAD_RESOLVE_SECONDS + 0.1, { dadHelps: true }).crash) crashes++;
      }
      return crashes / 400;
    };
    expect(count(0)).toBeLessThan(0.15);
    expect(count(0.9)).toBeGreaterThan(0.35);
    expect(crashChance(1)).toBeLessThan(1);
  });

  it('coffee perks Dad up for a price', () => {
    const s = calm({ cash: 100, tiredness: 0.8 });
    expect(canBuyCoffee(s)).toBe(true);
    const c = coffee(s);
    expect(c.tiredness).toBeCloseTo(0.3);
    expect(c.cash).toBe(100 - coffeeCost(s));
    expect(coffee({ ...s, cash: 0 }).tiredness).toBe(0.8);
  });
});

describe('offline progress', () => {
  it('catches up elapsed time', () => {
    const { state, seconds } = catchUp(calm(), 60_000);
    expect(seconds).toBe(60);
    expect(state.odometer).toBeCloseTo((BASE_MPH * 60) / 3600);
    expect(state.lastTick).toBe(60_000);
  });

  it('stops driving at the first takeover, but the stream keeps earning', () => {
    const { state } = catchUp(calm({ untilTakeover: 30 }), 3_600_000);
    expect(state.odometer).toBeCloseTo((BASE_MPH * 30) / 3600);
    expect(state.takeover).toBeDefined();
    expect(state.cash).toBeGreaterThan(newGame(0).cash + 3000 * 0.5 * BASE_VIEWERS * 0.004 * 0.5);
  });

  it('caps long absences', () => {
    expect(catchUp(newGame(0), 1e12).seconds).toBe(MAX_OFFLINE_SECONDS);
  });

  it('ignores clocks going backwards', () => {
    expect(catchUp(newGame(1000), 0).seconds).toBe(0);
  });

  it('a long trip at full autonomy fills up along the way', () => {
    const s = advance(calm({ levels: { fsd: 1, lidar: 10 }, cash: 1e5, untilTakeover: Infinity }), MAX_OFFLINE_SECONDS);
    expect(s.odometer).toBeGreaterThan(400);
    expect(s.stats.fuelSpent).toBeGreaterThan(50);
  });
});

describe('trip', () => {
  it('tracks real landmarks along the route', () => {
    const s = calm({ odometer: 500 });
    expect(currentLandmark(s).name).toBe('Atlanta, GA');
    expect(nextLandmark(s)?.name).toBe('Welcome to Tennessee');
    expect(nextLandmark(calm({ odometer: TRIP_LENGTH }))).toBeUndefined();
  });

  it('landmarks match the baked map', async () => {
    const route = (await import('../public/map/route.json')).default as { total: number; waypoints: { name: string; s: number }[] };
    expect(TRIP_LENGTH).toBeCloseTo(route.total / 1609.344, 0);
    const cities = LANDMARKS.filter((l) => l.kind === 'city');
    expect(cities.map((l) => l.name)).toEqual(route.waypoints.map((w) => w.name));
    route.waypoints.forEach((w, i) => expect(cities[i].at).toBeCloseTo(w.s / 1609.344, 0));
    for (let i = 1; i < LANDMARKS.length; i++) expect(LANDMARKS[i].at).toBeGreaterThan(LANDMARKS[i - 1].at);
  });

  it('passing a sight spikes the stream', () => {
    const s = calm({ odometer: 989.9, followers: 2000, viewers: 70 });
    const after = advance(s, 60);
    expect(after.odometer).toBeGreaterThan(990);
    expect(after.hype).toBeGreaterThan(30);
  });

  it('scenery changes the audience: Kansas is the grind, the Rockies pay', () => {
    const at = (odometer: number) => targetViewers(calm({ odometer, followers: 100 }));
    expect(regionAt(1400).name).toMatch(/Kansas/);
    expect(at(1400)).toBeLessThan(at(100));
    expect(at(1890)).toBeGreaterThan(at(100));
  });

  it('cities ask for help more often', () => {
    const resolved = (odometer: number) => resolveTakeover(calm({ odometer, takeovers: 5, takeover: { kind: 'merge', waited: 0 } })).untilTakeover;
    expect(resolved(440)).toBeLessThan(resolved(100));
  });
});

describe('day and night', () => {
  it('the game clock runs faster than real time', () => {
    const s = advance(calm(), 600);
    expect(s.clock - START_CLOCK).toBeCloseTo(600 * TIME_SCALE);
    expect(hourOf(newGame(0))).toBe(8);
  });

  it('knows night from day, with dawn and dusk', () => {
    const at = (h: number) => calm({ clock: h * 3600 });
    expect(isNight(at(23))).toBe(true);
    expect(isNight(at(2 + 24 * 3))).toBe(true);
    expect(isNight(at(12))).toBe(false);
    expect(daylight(at(12))).toBe(1);
    expect(daylight(at(7))).toBeCloseTo(0.5);
    expect(daylight(at(1))).toBe(0);
  });

  it('Dad tires faster at night (until the car can drive at night), and fewer people watch', () => {
    const night = calm({ clock: 22 * 3600 }), day = calm({ clock: 12 * 3600 });
    expect(advance(night, 100).tiredness).toBeGreaterThan(advance(day, 100).tiredness);
    const l4 = { citystreets: 1 };
    expect(advance({ ...night, levels: l4 }, 100).tiredness).toBeCloseTo(advance({ ...day, levels: l4 }, 100).tiredness);
    expect(targetViewers(night)).toBeLessThan(targetViewers(day));
  });
});

describe('saves', () => {
  it('round-trips', () => {
    const s = advance(calm({ cash: 42, odometer: 99, levels: { camera: 3 } }), 100);
    expect(deserialize(serialize(s), 0)).toEqual(s);
  });

  it('keeps a takeover, crash and gas stop in progress across a reload', () => {
    const stuck = advance(calm({ untilTakeover: 1 }), 5);
    expect(deserialize(serialize(stuck), 0)).toEqual(stuck);
    const crashed = advance(calm({ tiredness: 1 - 1e-6, cash: 50 }), 1);
    expect(deserialize(serialize(crashed), 0)).toEqual(crashed);
    const fueling = advance(calm({ gas: 0, cash: 100 }), 1);
    expect(deserialize(serialize(fueling), 0)).toEqual(fueling);
  });

  it('L5 (no takeovers ever) survives JSON', () => {
    const s = calm({ levels: { fsd: 1 }, untilTakeover: Infinity });
    expect(deserialize(serialize(s), 0).untilTakeover).toBe(Infinity);
  });

  it('loads version 2 saves: same share of the trip, miles become some cash', () => {
    const old = JSON.stringify({ version: 2, odometer: 7500, miles: 2000, levels: { camera: 4, acc: 1, snacks: 1 }, lastTick: 9, untilTakeover: 12, takeovers: 3, tiredness: 0.4, crashes: 1 });
    const s = deserialize(old, 0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.odometer).toBeCloseTo(TRIP_LENGTH * 0.1);
    expect(s.cash).toBeCloseTo(newGame(0).cash + 100);
    expect(s.levels).toEqual({ camera: 4, acc: 1, snacks: 1 });
    expect(s.gas).toBe(TANK_GALLONS);
    expect(s.viewers).toBe(BASE_VIEWERS);
    expect(s.tiredness).toBe(0.4);
    expect(s.takeovers).toBe(3);
    expect(s.clock).toBe(START_CLOCK);
  });

  it('loads version 1 saves, moving old upgrades to the sensors that replaced them', () => {
    const old = JSON.stringify({ version: 1, odometer: 500, miles: 20, levels: { cruise: 4, tires: 2, snacks: 1, lane: 3, bogus: 2 }, lastTick: 9 });
    const s = deserialize(old, 0);
    expect(s.levels).toEqual({ camera: 4, radar: 2, snacks: 1, sidecams: 3 });
    expect(s.untilTakeover).toBeGreaterThan(0);
    expect(s.tiredness).toBe(0);
  });

  it('falls back to a new game on bad data', () => {
    expect(deserialize(null, 7)).toEqual(newGame(7));
    expect(deserialize('not json', 7)).toEqual(newGame(7));
    expect(deserialize('{"foo":1}', 7)).toEqual(newGame(7));
  });
});

describe('formatting', () => {
  it.each([
    [0, '0.0'], [5.55, '5.5'], [999, '999'], [1500, '1.50K'], [25_000, '25.0K'], [3_200_000, '3.20M'],
  ])('%d -> %s', (n, out) => {
    expect(formatNumber(n)).toBe(out);
  });

  it('formats money', () => {
    expect(formatCash(3.456)).toBe('$3.46');
    expect(formatCash(1500)).toBe('$1.50K');
  });
});

describe('ending and hints', () => {
  const allFeatures = { camera: 5, radar: 2, acc: 1, lanekeep: 1, autosteer: 0 };
  it('records the day the car first steers itself', () => {
    const levels = { ...allFeatures };
    const ready = calm({ cash: 1e6, levels, clock: START_CLOCK + 2 * DAY });
    const s = buy(ready, 'autosteer');
    expect(autonomyLevel(s.levels)).toBeGreaterThanOrEqual(2);
    expect(s.stats.autopilotDay).toBe(3);
    expect(tripDay(s)).toBe(3);
    // Later levels don't move it.
    const later = buy({ ...s, clock: START_CLOCK + 4 * DAY, levels: { ...s.levels, sidecams: 1 } }, 'lanechange');
    expect(later.stats.autopilotDay).toBe(3);
  });

  it('keeps autopilotDay through a save and loads old saves without it', () => {
    const s = calm({ stats: { earned: 1, fuelSpent: 0, gallons: 0, peakViewers: 9, autopilotDay: 4 } });
    expect(deserialize(serialize(s), 0).stats.autopilotDay).toBe(4);
    expect(deserialize(serialize(calm()), 0).stats.autopilotDay).toBeUndefined();
  });

  it('summarizes the trip', () => {
    const s = calm({ odometer: TRIP_LENGTH, clock: START_CLOCK + 6.5 * DAY, crashes: 3 });
    const rows = Object.fromEntries(tripSummary(s).map(([, k, v]) => [k, v]));
    expect(rows['Days on the road']).toBe('6.5 days');
    expect(rows['Crashes']).toBe('3');
    expect(rows['Car first steered itself']).toMatch(/never/);
  });

  it('gives hints for a new player, then gets out of the way', () => {
    expect(hint(newGame(0))).toMatch(/Camera|Honk/);
    expect(hint(calm({ levels: { camera: 1 } }))).toMatch(/Stream tab/);
    expect(hint(calm({ levels: { camera: 1, mount: 1 } }))).toMatch(/Radar/);
    expect(hint(calm({ levels: { camera: 1, mount: 1, radar: 1, acc: 1 } }))).toBeUndefined();
    expect(hint(calm({ odometer: TRIP_LENGTH }))).toBeUndefined();
  });
});
