import { describe, expect, it } from 'vitest';
import {
  MAX_OFFLINE_SECONDS, TRIP_LENGTH, advance, buy, canBuy, catchUp, currentLandmark,
  deserialize, formatNumber, honk, level, newGame, nextLandmark, serialize, speed,
  tripProgress, upgradeCost,
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
    expect(canBuy(s, 'cruise')).toBe(false);
    expect(buy(s, 'cruise')).toBe(s);
  });

  it('buying spends miles, raises level, raises speed and next cost', () => {
    const s = { ...newGame(0), miles: 100 };
    const before = upgradeCost(s, 'cruise');
    const after = buy(s, 'cruise');
    expect(after.miles).toBe(100 - before);
    expect(level(after, 'cruise')).toBe(1);
    expect(speed(after)).toBeGreaterThan(speed(s));
    expect(upgradeCost(after, 'cruise')).toBeGreaterThan(before);
    expect(after.odometer).toBe(s.odometer); // spending doesn't move you backwards
  });

  it('multiplier upgrades scale flat speed', () => {
    const s = { ...newGame(0), levels: { tires: 1, snacks: 2 } };
    expect(speed(s)).toBeCloseTo((0.2 + 3) * 1.2);
  });
});

describe('offline progress', () => {
  it('catches up elapsed time', () => {
    const { state, seconds } = catchUp(newGame(0), 60_000);
    expect(seconds).toBe(60);
    expect(state.odometer).toBeCloseTo(12);
    expect(state.lastTick).toBe(60_000);
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
    const s = { ...newGame(5), miles: 42, odometer: 99, levels: { cruise: 3 } };
    expect(deserialize(serialize(s), 0)).toEqual(s);
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
