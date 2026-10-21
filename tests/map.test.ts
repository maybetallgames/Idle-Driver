import { describe, expect, it } from 'vitest';
import {
  buildingHeight, classifyNlcd, haversine, mercator, resample, ringArea, simplify, smooth,
  terrariumHeight, unmercator, wayLanes,
} from '../src/map/geo';
import { chunkIndex, expandLanes, laneOffset, poseAt, roadEdges, terrainGrid, type MapChunk } from '../src/map/chunk';

describe('geo helpers', () => {
  it('mercator round-trips', () => {
    const [x, y] = mercator(40.3772, -105.5217);
    const [lat, lon] = unmercator(x, y);
    expect(lat).toBeCloseTo(40.3772, 6);
    expect(lon).toBeCloseTo(-105.5217, 6);
  });

  it('haversine matches a known distance (Orlando to Atlanta, ~650 km straight line)', () => {
    expect(haversine(28.5383, -81.3792, 33.749, -84.388) / 1000).toBeCloseTo(645, -1);
  });

  it('resamples a line at even spacing', () => {
    const line = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }]; // ~1113 m
    const pts = resample(line, 100);
    expect(pts.length).toBe(13);
    expect(pts[1].s).toBe(100);
    expect(pts[pts.length - 1].s).toBeCloseTo(1112, 0);
  });

  it('smooths with a moving average', () => {
    expect(smooth([0, 0, 9, 0, 0], 1)).toEqual([0, 3, 3, 3, 0]);
  });

  it('simplifies nearly straight lines', () => {
    const pts: [number, number][] = [[0, 0], [1, 0.01], [2, 0], [3, 5]];
    expect(simplify(pts, 0.1)).toEqual([[0, 0], [2, 0], [3, 5]]);
  });

  it('decodes terrarium heights and NLCD colors', () => {
    expect(terrariumHeight(128, 0, 0)).toBe(0);
    expect(terrariumHeight(128, 100, 128)).toBe(100.5);
    expect(classifyNlcd(0x46, 0x6b, 0x9f)).toBe('w');
    expect(classifyNlcd(0x1c, 0x5f, 0x2d)).toBe('e');
    expect(classifyNlcd(0, 0, 0, 0)).toBe('g');
  });

  it('reads lane counts from OSM tags', () => {
    expect(wayLanes({ highway: 'motorway', lanes: '3' }, true)).toEqual({ fwd: 3, back: 0 });
    expect(wayLanes({ highway: 'motorway' }, true)).toEqual({ fwd: 2, back: 0 });
    expect(wayLanes({ highway: 'primary', lanes: '4' }, true)).toEqual({ fwd: 2, back: 2 });
    expect(wayLanes({ highway: 'primary', 'lanes:forward': '2', 'lanes:backward': '1' }, false)).toEqual({ fwd: 1, back: 2 });
    expect(wayLanes({ highway: 'secondary' }, true)).toEqual({ fwd: 1, back: 1 });
  });

  it('estimates building heights', () => {
    expect(buildingHeight({ height: '42' }, 100)).toBe(42);
    expect(buildingHeight({ 'building:levels': '10' }, 100)).toBe(33);
    expect(buildingHeight({ building: 'house' }, 120)).toBe(6);
    expect(Math.abs(ringArea([0, 0, 10, 0, 10, 10, 0, 10]))).toBe(100);
  });
});

/** A straight test chunk heading north with 2 lanes, at the equator (scale 1). */
function testChunk(): MapChunk {
  const r: number[] = [];
  for (let i = 0; i <= 10; i++) r.push(0, i * 20, i);
  const tr: number[] = [];
  for (let i = 0; i <= 5; i++) tr.push(0, i * 40, 1, 0);
  return { i: 0, s0: 0, lat: 0, o: [1000, 2000], r, ln: [6, 2, 0, 5, 3, 0], tr, th: [], tc: '', b: [], w: [], t: [] };
}

describe('driving along a chunk', () => {
  it('expands run-length lanes', () => {
    expect(expandLanes([2, 2, 0, 1, 1, 1])).toEqual([[2, 0], [2, 0], [1, 1]]);
  });

  it('places lanes on one-way and two-way roads', () => {
    expect(roadEdges(2, 0)).toEqual({ left: -3.6, right: 3.6 });
    expect(roadEdges(1, 1)).toEqual({ left: -3.6, right: 3.6 });
    expect(laneOffset(2, 0, 1)).toBeCloseTo(1.8);
    expect(laneOffset(1, 1, 0)).toBeCloseTo(1.8);
    expect(laneOffset(3, 0, 0)).toBeCloseTo(-3.6);
  });

  it('interpolates position, heading, grade and lanes', () => {
    const p = poseAt(testChunk(), 30);
    expect(p.x).toBe(1000);
    expect(p.y).toBeCloseTo(2030);
    expect(p.h).toBeCloseTo(1.5);
    expect(p.dx).toBeCloseTo(0);
    expect(p.dy).toBeCloseTo(1);
    expect(p.grade).toBeCloseTo(0.05);
    expect([p.fwd, p.back]).toEqual([2, 0]);
    expect(poseAt(testChunk(), 180).fwd).toBe(3);
  });

  it('finds the chunk for a distance', () => {
    expect(chunkIndex({ chunkLen: 4000, chunks: 3 }, 0)).toBe(0);
    expect(chunkIndex({ chunkLen: 4000, chunks: 3 }, 8001)).toBe(2);
    expect(chunkIndex({ chunkLen: 4000, chunks: 3 }, 1e9)).toBe(2);
  });

  it('terrain grid never folds back on a tight curve', () => {
    // Rows turning 90 degrees within 40 m: far columns would cross without the fix.
    const tr = [0, 0, 1, 0, 0, 40, 1, 0, 20, 60, 0.7071, -0.7071, 40, 60, 0, -1];
    const chunk = { ...testChunk(), tr };
    const cols = [-500, 0, 500];
    const g = terrainGrid(chunk, cols);
    for (let row = 1; row < 4; row++) for (let c = 0; c < 3; c++) {
      const k = (row * 3 + c) * 2, pk = ((row - 1) * 3 + c) * 2;
      const nx = tr[row * 4 + 2], ny = tr[row * 4 + 3];
      expect((g[k] - g[pk]) * -ny + (g[k + 1] - g[pk + 1]) * nx).toBeGreaterThan(0);
    }
  });
});

describe('baked map data', () => {
  const load = async (i: number) =>
    (await import(`../public/map/c/${String(i).padStart(4, '0')}.json`)).default as MapChunk;

  it('route index and chunks line up', async () => {
    const index = (await import('../public/map/route.json')).default;
    expect(index.waypoints[0].name).toBe('Orlando, FL');
    expect(index.waypoints.at(-1)!.s).toBeLessThanOrEqual(index.total);
    expect(index.chunks).toBe(Math.ceil(index.total / index.chunkLen));
    const last = await load(index.chunks - 1);
    expect(last.i).toBe(index.chunks - 1);
    expect(poseAt(last, index.total).h).toBeGreaterThan(2500); // Rocky Mountain National Park is high up
  });

  it('a real chunk builds meshes with no broken vertices', async () => {
    const { buildChunk } = await import('../src/scene/mapMeshes');
    const { Mesh } = await import('three');
    const built = buildChunk(await load(0));
    let meshes = 0;
    built.group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      meshes++;
      for (const v of o.geometry.attributes.position.array as Float32Array) expect(Number.isFinite(v)).toBe(true);
    });
    expect(meshes).toBeGreaterThan(4);
    built.dispose();
  });
});
