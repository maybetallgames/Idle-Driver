// Map chunk format (written by scripts/bake-map.ts) and pure helpers to drive along it.
import { LANE_W, ROUTE_STEP } from './geo';

export interface RouteIndex {
  total: number;
  chunkLen: number;
  chunks: number;
  waypoints: { name: string; s: number }[];
  overview: [number, number][];
  credits: string;
}

export interface MapChunk {
  i: number;
  /** Route distance (m) where this chunk starts. */
  s0: number;
  /** Latitude of the chunk origin, for the mercator scale. */
  lat: number;
  /** Chunk origin in mercator meters. All x/y below are offsets from it (y = north). */
  o: [number, number];
  /** Driven route: x, y, h per point, every ROUTE_STEP meters from s0. */
  r: number[];
  /** Lanes, run-length encoded: [count, forward, back, ...] per route point. */
  ln: number[];
  /** Terrain rows: x, y, nx, ny (unit normal to the right of travel). */
  tr: number[];
  /** Terrain heights, row-major, TERRAIN_COLS per row. */
  th: number[];
  /** Land class letter per terrain sample. */
  tc: string;
  /** Terrain cells (row * (cols - 1) + col) to leave out because they lie over another part of the route. */
  hx?: number[];
  /** Buildings: [height, base, kind, x0, y0, x1, y1, ...]. */
  b: (number | string)[][];
  /** Roads: [kind, width, x, y, h, ...]. */
  w: (number | string)[][];
  /** Single trees: x, y, h. */
  t: number[];
}

/** Expand run-length lanes to one [forward, back] per route point. */
export function expandLanes(ln: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 2 < ln.length; i += 3) for (let k = 0; k < ln[i]; k++) out.push([ln[i + 1], ln[i + 2]]);
  return out;
}

/**
 * Road cross-section relative to the route line (meters, + = right of travel).
 * One-way roads (back = 0) are centered on the line; two-way roads have the line in the middle
 * with our lanes on the right.
 */
export function roadEdges(fwd: number, back: number): { left: number; right: number } {
  if (back === 0) return { left: (-fwd * LANE_W) / 2, right: (fwd * LANE_W) / 2 };
  return { left: -back * LANE_W, right: fwd * LANE_W };
}

/** Center offset of forward lane i (0 = leftmost of our lanes). */
export function laneOffset(fwd: number, back: number, lane: number): number {
  const { right } = roadEdges(fwd, back);
  return right - (fwd - lane - 0.5) * LANE_W;
}

export interface RoutePose {
  /** Mercator position (global). */
  x: number;
  y: number;
  h: number;
  /** Unit direction of travel in mercator (y = north). */
  dx: number;
  dy: number;
  /** Road grade (rise over run). */
  grade: number;
  fwd: number;
  back: number;
}

/** Where the route is at distance s inside a chunk (clamped to the chunk). */
export function poseAt(chunk: MapChunk, s: number, lanes = expandLanes(chunk.ln)): RoutePose {
  const n = chunk.r.length / 3;
  const f = Math.max(0, Math.min(n - 1.001, (s - chunk.s0) / ROUTE_STEP));
  const i = Math.floor(f), t = f - i;
  const ax = chunk.r[i * 3], ay = chunk.r[i * 3 + 1], ah = chunk.r[i * 3 + 2];
  const bx = chunk.r[i * 3 + 3], by = chunk.r[i * 3 + 4], bh = chunk.r[i * 3 + 5];
  // Direction from a slightly wider window so heading doesn't snap at every point.
  const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 2);
  let dx = chunk.r[i1 * 3] - chunk.r[i0 * 3], dy = chunk.r[i1 * 3 + 1] - chunk.r[i0 * 3 + 1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const scale = Math.cos((chunk.lat * Math.PI) / 180);
  const run = Math.hypot(bx - ax, by - ay) * scale || ROUTE_STEP;
  const [fwd, back] = lanes[Math.min(lanes.length - 1, Math.round(f))] ?? [2, 0];
  return {
    x: chunk.o[0] + ax + (bx - ax) * t,
    y: chunk.o[1] + ay + (by - ay) * t,
    h: ah + (bh - ah) * t,
    dx, dy, grade: (bh - ah) / run, fwd, back,
  };
}

/** Which chunk holds route distance s. */
export function chunkIndex(index: Pick<RouteIndex, 'chunkLen' | 'chunks'>, s: number): number {
  return Math.max(0, Math.min(index.chunks - 1, Math.floor(s / index.chunkLen)));
}

/**
 * Terrain vertex positions (chunk-local mercator x, y) for each row and column.
 * Where the route curves tightly the far columns of neighbouring rows can cross over each other;
 * those samples are pulled back so the mesh never folds.
 */
export function terrainGrid(chunk: MapChunk, cols: readonly number[]): Float64Array {
  const rows = chunk.tr.length / 4;
  const scale = Math.cos((chunk.lat * Math.PI) / 180);
  const out = new Float64Array(rows * cols.length * 2);
  for (let r = 0; r < rows; r++) {
    const cx = chunk.tr[r * 4], cy = chunk.tr[r * 4 + 1], nx = chunk.tr[r * 4 + 2], ny = chunk.tr[r * 4 + 3];
    // Direction of travel is the normal rotated left: (-ny, nx).
    const tx = -ny, ty = nx;
    for (let c = 0; c < cols.length; c++) {
      let x = cx + (nx * cols[c]) / scale, y = cy + (ny * cols[c]) / scale;
      if (r > 0) {
        const k = ((r - 1) * cols.length + c) * 2;
        const px = out[k], py = out[k + 1];
        if ((x - px) * tx + (y - py) * ty < 0.5) {
          x = px + tx * 0.5;
          y = py + ty * 0.5;
        }
      }
      out[(r * cols.length + c) * 2] = x;
      out[(r * cols.length + c) * 2 + 1] = y;
    }
  }
  return out;
}
