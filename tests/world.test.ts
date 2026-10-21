import { describe, expect, it } from 'vitest';
import {
  MIN_GAP, PLAYER_LANE, VIEW_AHEAD, VIEW_BEHIND, initTraffic, laneBlocked, rng, stepTraffic,
} from '../src/world';

describe('rng', () => {
  it('seeded rng is reproducible', () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe('traffic', () => {
  function gapsOk(cars: ReturnType<typeof initTraffic>) {
    for (const c of cars) {
      // Nobody overlaps the SUV once lane changes have finished.
      if (c.lane === PLAYER_LANE && c.x === PLAYER_LANE) expect(Math.abs(c.z)).toBeGreaterThan(4.5);
    }
  }

  it('spawns cars with spacing in every lane', () => {
    const cars = initTraffic(9, 30, rng(1));
    expect(cars.length).toBe(9);
    for (const c of cars) expect(laneBlocked(cars, c.lane, c.z, c)).toBe(false);
    for (const c of cars) if (c.lane === PLAYER_LANE) expect(Math.abs(c.z)).toBeGreaterThanOrEqual(MIN_GAP);
  });

  it('keeps flowing for a long drive without hitting the SUV or leaving the view', () => {
    const r = rng(7);
    const cars = initTraffic(9, 30, r);
    for (let i = 0; i < 20 * 60 * 10; i++) {
      stepTraffic(cars, 0.1, 30, r);
      gapsOk(cars);
    }
    expect(cars.length).toBe(9);
    for (const c of cars) {
      expect(c.z).toBeGreaterThan(-VIEW_AHEAD - 20);
      expect(c.z).toBeLessThan(VIEW_BEHIND + 20);
    }
  });

  it('works on a two-lane road with the SUV in the right lane', () => {
    const road = { lanes: 2, playerLane: 1 };
    const r = rng(11);
    const cars = initTraffic(6, 30, r, road);
    for (let i = 0; i < 6000; i++) {
      stepTraffic(cars, 0.1, 30, r, road);
      for (const c of cars) {
        expect(c.lane).toBeLessThan(2);
        if (c.lane === 1 && c.x === 1) expect(Math.abs(c.z)).toBeGreaterThan(4.5);
      }
    }
  });

  it('cars in a lane that ends move over or leave', () => {
    const cars = [{ lane: 2, x: 2, z: -100, cruise: 30, speed: 30, color: 0 }];
    stepTraffic(cars, 0.1, 30, rng(1), { lanes: 2, playerLane: 1 });
    expect(cars[0].lane).toBe(1);
  });

  it('a slow car right ahead of the SUV gets out of its lane', () => {
    const cars = [{ lane: PLAYER_LANE, x: 0, z: -15, cruise: 20, speed: 20, color: 0 }];
    stepTraffic(cars, 0.1, 30, rng(3));
    expect(cars[0].lane).not.toBe(PLAYER_LANE);
  });
});
