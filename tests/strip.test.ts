import { describe, expect, it } from 'vitest';
import { buildStrip } from '../src/map/strip';
import route from '../public/map/route.json';
import { LANDMARKS, TRIP_LENGTH } from '../src/game';

describe('route strip', () => {
  const strip = buildStrip(route.overview as [number, number][], TRIP_LENGTH, 360, 150);

  it('starts in Florida (bottom right) and ends in Colorado (top left)', () => {
    const [sx, sy] = strip.at(0), [ex, ey] = strip.at(TRIP_LENGTH);
    expect(sx).toBeGreaterThan(ex);
    expect(sy).toBeGreaterThan(ey);
    expect(strip.path.startsWith('M')).toBe(true);
  });

  it('stays inside the box and moves forward with the miles', () => {
    let last = -1;
    for (let m = 0; m <= TRIP_LENGTH; m += 50) {
      const [x, y] = strip.at(m);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(360);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(150);
      const share = strip.drawnShare(m);
      expect(share).toBeGreaterThanOrEqual(last);
      last = share;
    }
    expect(strip.drawnShare(TRIP_LENGTH)).toBeCloseTo(1);
    expect(strip.drawnShare(-5)).toBe(0);
  });

  it('puts St. Louis about halfway across', () => {
    const stl = LANDMARKS.find((l) => l.name.startsWith('St. Louis'))!;
    const [x] = strip.at(stl.at);
    expect(x).toBeGreaterThan(120);
    expect(x).toBeLessThan(260);
  });
});
