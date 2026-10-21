import { describe, expect, it } from 'vitest';
import {
  LANES, MIN_GAP, PLAYER_LANE, VIEW_AHEAD, VIEW_BEHIND, initTraffic, laneBlocked, laneX, recycledZ,
  rng, stepTraffic, visualSpeed, wrap,
} from '../src/world';

describe('recycling', () => {
  it('wrap is always in [0, m)', () => {
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(25, 10)).toBe(5);
    expect(wrap(0, 10)).toBe(0);
  });

  it('recycled objects stay inside the view window as the road scrolls', () => {
    const loop = VIEW_AHEAD + VIEW_BEHIND;
    for (let d = 0; d < 5000; d += 37.3) {
      for (const base of [0, 50, 150, 299]) {
        const z = recycledZ(base, d, loop);
        expect(z).toBeGreaterThanOrEqual(-VIEW_AHEAD);
        expect(z).toBeLessThan(VIEW_BEHIND);
      }
    }
  });

  it('objects slide toward the camera, then jump back to the horizon', () => {
    const loop = 300;
    const a = recycledZ(100, 0, loop);
    expect(recycledZ(100, 10, loop)).toBeCloseTo(a + 10);
    // After a full loop the object is back where it started.
    expect(recycledZ(100, loop, loop)).toBeCloseTo(a);
  });
});

describe('lanes and speed', () => {
  it('lanes are centered on the road with the SUV in the middle', () => {
    expect(laneX(PLAYER_LANE)).toBe(0);
    expect(laneX(0)).toBeCloseTo(-laneX(LANES - 1));
  });

  it('visual speed grows with idle speed but stays readable', () => {
    expect(visualSpeed(0)).toBe(20);
    expect(visualSpeed(10)).toBeGreaterThan(visualSpeed(1));
    expect(visualSpeed(1e12)).toBe(48);
  });

  it('seeded rng is reproducible', () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe('traffic', () => {
  function gapsOk(cars: ReturnType<typeof initTraffic>) {
    for (const c of cars) {
      // Nobody overlaps the SUV once lane changes have finished.
      if (c.lane === PLAYER_LANE && c.x === laneX(PLAYER_LANE)) expect(Math.abs(c.z)).toBeGreaterThan(4.5);
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

  it('a slow car right ahead of the SUV gets out of its lane', () => {
    const cars = [{ lane: PLAYER_LANE, x: 0, z: -15, cruise: 20, speed: 20, color: 0 }];
    stepTraffic(cars, 0.1, 30, rng(3));
    expect(cars[0].lane).not.toBe(PLAYER_LANE);
  });
});
