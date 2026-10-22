import { describe, expect, it } from 'vitest';
import { Quaternion, Vec3 } from 'cannon-es';
import { CRASH_KINDS } from '../src/game';
import { RIDERS, simulateCrash } from '../src/crashSim';

const up = (q: [number, number, number, number]) => new Quaternion(...q).vmult(new Vec3(0, 1, 0));

describe('crash simulation', () => {
  it('is the same every time for a seed', () => {
    expect(simulateCrash(42, 'nodoff')).toEqual(simulateCrash(42, 'nodoff'));
    expect(simulateCrash(42, 'nodoff')).not.toEqual(simulateCrash(43, 'nodoff'));
  });

  it.each(CRASH_KINDS.map((k) => k.id))('%s: flips over, then lands on its wheels with everyone inside', (kind) => {
    for (const seed of [1, 7, 99]) checkCrash(simulateCrash(seed, kind));
  });
});

function checkCrash(frames: ReturnType<typeof simulateCrash>) {
  {
    const minUp = Math.min(...frames.map((f) => up(f.car.q).y));
    expect(minUp).toBeLessThan(0.3); // tipped way over at some point
    const maxHeight = Math.max(...frames.map((f) => f.car.p[1]));
    expect(maxHeight).toBeGreaterThan(0.8);
    const end = frames[frames.length - 1];
    expect(up(end.car.q).y).toBeCloseTo(1, 3);
    expect(Math.abs(end.car.p[1])).toBeLessThan(0.05);
    // Nobody got lost: everyone stayed near the car the whole time.
    for (const f of frames) {
      for (const r of f.riders) expect(Math.hypot(r.p[0] - f.car.p[0], r.p[1] - f.car.p[1], r.p[2] - f.car.p[2])).toBeLessThan(6);
    }
    expect(end.riders).toHaveLength(RIDERS.length);
  }
}
