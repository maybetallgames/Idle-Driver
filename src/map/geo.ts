// Pure geo helpers shared by the map bake script (scripts/bake-map.ts, run by Node) and the game.
// No imports, so Node can load this file directly with type stripping.

export const EARTH_R = 6378137;
/** Route length covered by one map chunk file (real meters). */
export const CHUNK_LEN = 4000;
/** Spacing of the driven route line inside a chunk (real meters). */
export const ROUTE_STEP = 20;
/** Spacing of terrain rows along the route (real meters). */
export const ROW_STEP = 40;
/** Terrain sample offsets across the route (real meters, + is right of travel). Dense near the road. */
export const TERRAIN_COLS = [
  -1500, -1050, -750, -520, -360, -250, -170, -115, -75, -45, -25, -12, 0,
  12, 25, 45, 75, 115, 170, 250, 360, 520, 750, 1050, 1500,
];
export const LANE_W = 3.6;

/** Land cover classes (from the USGS National Land Cover Database). One letter each in chunk files. */
export const LAND = {
  water: 'w', developedOpen: 'o', developedLow: 'l', developedMed: 'm', developedHigh: 'h',
  barren: 'b', deciduous: 'd', evergreen: 'e', mixed: 'x', shrub: 's', grass: 'g',
  pasture: 'p', crops: 'c', woodyWetland: 'v', wetland: 'n',
} as const;
export type LandClass = (typeof LAND)[keyof typeof LAND];

/** NLCD legend colors (as served by the MRLC map service) to our classes. */
const NLCD_COLORS: [number, LandClass][] = [
  [0x466b9f, 'w'], [0xd1defa, 'w'], [0xdec5c5, 'o'], [0xd99282, 'l'], [0xeb0000, 'm'], [0xab0000, 'h'],
  [0xb3ac9f, 'b'], [0x68ab5f, 'd'], [0x1c5f2c, 'e'], [0xb5c58f, 'x'], [0xccb879, 's'],
  [0xdfdfc2, 'g'], [0xdcd939, 'p'], [0xab6c28, 'c'], [0xb8d9eb, 'v'], [0x6c9fb8, 'n'],
];

/** Nearest NLCD class for a pixel color. Transparent / no-data pixels count as grass. */
export function classifyNlcd(r: number, g: number, b: number, a = 255): LandClass {
  if (a < 128) return 'g';
  let best: LandClass = 'g';
  let bestD = Infinity;
  for (const [c, cls] of NLCD_COLORS) {
    const d = ((c >> 16) - r) ** 2 + (((c >> 8) & 255) - g) ** 2 + ((c & 255) - b) ** 2;
    if (d < bestD) { bestD = d; best = cls; }
  }
  return best;
}

/** Height in meters from a Terrarium-encoded elevation tile pixel. */
export function terrariumHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Web Mercator meters for a lat/lon in degrees. */
export function mercator(lat: number, lon: number): [number, number] {
  const rad = Math.PI / 180;
  return [EARTH_R * lon * rad, EARTH_R * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2))];
}

export function unmercator(x: number, y: number): [number, number] {
  const deg = 180 / Math.PI;
  return [(2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) * deg, (x / EARTH_R) * deg];
}

/** Real meters per mercator meter at a latitude. */
export function mercatorScale(lat: number): number {
  return Math.cos((lat * Math.PI) / 180);
}

/** Great-circle distance in meters. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface LatLon { lat: number; lon: number }

/** Resample a lat/lon line to points every `step` meters. Returns points with their distance `s`. */
export function resample(line: readonly LatLon[], step: number): (LatLon & { s: number })[] {
  const out: (LatLon & { s: number })[] = [];
  if (!line.length) return out;
  out.push({ ...line[0], s: 0 });
  let total = 0;
  let next = step;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    while (d > 0 && total + d >= next) {
      const t = (next - total) / d;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, s: next });
      next += step;
    }
    total += d;
  }
  const last = line[line.length - 1];
  if (total > out[out.length - 1].s + 1e-6) out.push({ ...last, s: total });
  return out;
}

/** Moving average with a window of `radius` samples each side (edges use what's available). */
export function smooth(values: readonly number[], radius: number): number[] {
  const out: number[] = new Array(values.length);
  let sum = 0;
  let lo = 0, hi = -1;
  for (let i = 0; i < values.length; i++) {
    const a = Math.max(0, i - radius), b = Math.min(values.length - 1, i + radius);
    while (hi < b) sum += values[++hi];
    while (lo < a) sum -= values[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/** Douglas-Peucker simplification of 2D points [x, y][] with a tolerance in the same units. */
export function simplify(pts: readonly [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1, worstD = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / len;
      if (d > worstD) { worstD = d; worst = k; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([i, worst], [worst, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export type Tags = Record<string, string | undefined>;

/**
 * Lanes in our direction of travel and against it, for an OSM highway way.
 * `sameDir` says whether the way is drawn in our direction (matters for two-way roads).
 */
export function wayLanes(tags: Tags, sameDir: boolean): { fwd: number; back: number } {
  const hw = tags.highway ?? '';
  const oneway = tags.oneway === 'yes' || tags.oneway === '1' || hw === 'motorway' || hw.endsWith('_link') && tags.oneway !== 'no';
  const n = (v?: string) => {
    const x = parseInt(v ?? '', 10);
    return Number.isFinite(x) && x > 0 ? Math.min(x, 8) : undefined;
  };
  const total = n(tags.lanes);
  if (oneway) return { fwd: total ?? (hw.endsWith('_link') ? 1 : 2), back: 0 };
  let f = n(tags['lanes:forward']);
  let b = n(tags['lanes:backward']);
  if (f === undefined && b === undefined) {
    const t = total ?? 2;
    f = Math.ceil(t / 2);
    b = Math.max(1, t - f);
  }
  f ??= Math.max(1, (total ?? 2) - (b ?? 1));
  b ??= Math.max(1, (total ?? 2) - f);
  return sameDir ? { fwd: f, back: b } : { fwd: b, back: f };
}

/** Building kind letter for coloring: h house, a apartments, c commercial/retail/office, i industrial, o other. */
export function buildingKind(tags: Tags): string {
  const b = tags.building ?? 'yes';
  if (['house', 'detached', 'residential', 'semidetached_house', 'bungalow', 'terrace', 'farm', 'cabin', 'garage', 'shed', 'hut'].includes(b)) return 'h';
  if (['apartments', 'dormitory', 'hotel'].includes(b)) return 'a';
  if (['commercial', 'retail', 'office', 'supermarket', 'civic', 'public', 'school', 'hospital', 'university', 'church', 'government'].includes(b)) return 'c';
  if (['industrial', 'warehouse', 'manufacture', 'barn', 'farm_auxiliary', 'hangar', 'silo', 'storage_tank'].includes(b)) return 'i';
  return 'o';
}

/** Building height in meters: real tags when present, otherwise a guess from its kind and size. */
export function buildingHeight(tags: Tags, area: number): number {
  const h = parseFloat(tags.height ?? '');
  if (Number.isFinite(h) && h > 1 && h < 600) return h;
  const lv = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(lv) && lv > 0 && lv < 150) return lv * 3.2 + 1;
  switch (buildingKind(tags)) {
    case 'h': return area > 300 ? 8 : 6;
    case 'a': return 12;
    case 'c': return area > 3000 ? 12 : 8;
    case 'i': return area > 5000 ? 11 : 8;
    default: return area > 2000 ? 10 : 6;
  }
}

/** Signed area (m²) of a closed ring [x0, y0, x1, y1, ...]. Positive = counter-clockwise. */
export function ringArea(flat: readonly number[]): number {
  let a = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1];
  }
  return a / 2;
}
