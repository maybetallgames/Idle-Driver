import { describe, expect, it } from 'vitest';
import { HEADLIGHTS, forwardRange, inCone, perceives, sensorCones } from '../src/perception';

describe('perception', () => {
  it('with no sensors only the headlights see, a short way ahead', () => {
    const cones = sensorCones({});
    expect(cones).toEqual([HEADLIGHTS]);
    expect(perceives(cones, 15, 0)).toBe(true);
    expect(perceives(cones, 40, 0)).toBe(false);
    expect(perceives(cones, -5, 0)).toBe(false); // nothing behind
  });

  it('the front camera sees farther ahead, and more with each level', () => {
    expect(forwardRange(sensorCones({ camera: 1 }))).toBe(45);
    expect(forwardRange(sensorCones({ camera: 3 }))).toBe(57);
    expect(forwardRange(sensorCones({ camera: 1000 }))).toBe(160);
  });

  it('radar is long but narrow', () => {
    const cones = sensorCones({ radar: 1 });
    expect(perceives(cones, 85, 2)).toBe(true);
    expect(perceives(cones, 85, 30)).toBe(false);
  });

  it('side cameras see all around, including behind', () => {
    const cones = sensorCones({ sidecams: 1 });
    expect(perceives(cones, -15, 3)).toBe(true);
    expect(perceives(cones, 0, -10)).toBe(true);
  });

  it('wedges respect their angle', () => {
    const c = { id: 'x', dir: Math.PI / 2, half: Math.PI / 8, range: 50 };
    expect(inCone(c, 0, 20)).toBe(true); // pointing right
    expect(inCone(c, 20, 0)).toBe(false);
    expect(inCone(c, 0, -20)).toBe(false);
  });
});
