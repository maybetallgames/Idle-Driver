// Bakes the real-world map for the trip into public/map/ so the game needs no map APIs at runtime.
//
//   node scripts/bake-map.ts                 # whole route
//   node scripts/bake-map.ts --chunks 0-5    # just a few chunks (quick test)
//
// Sources (downloads are cached in .cache/bake/, which is gitignored):
// - Route: OSRM public demo server (OpenStreetMap data).
// - Buildings and roads: OpenStreetMap via OpenFreeMap vector tiles. Lane counts: OSM via Overpass.
// - Terrain height: AWS Terrain Tiles (Terrarium format; USGS 3DEP / SRTM and others).
// - Land cover (forest, water, farms, towns): USGS National Land Cover Database 2021 (MRLC).
//
// Output: public/map/route.json (index + overview line) and public/map/c/NNNN.json (one per 4 km).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import {
  CHUNK_LEN, EARTH_R, ROUTE_STEP, ROW_STEP, TERRAIN_COLS, buildingHeight, classifyNlcd,
  mercator, mercatorScale, resample, ringArea, simplify, smooth, terrariumHeight,
  unmercator, wayLanes, type LandClass, type LatLon, type Tags,
} from '../src/map/geo.ts';

const ROOT = join(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache', 'bake');
const OUT = join(ROOT, 'public', 'map');

/**
 * Routing points, in order. Only where the fastest route would otherwise go another way; points
 * sit on the highway itself so the route doesn't detour into downtown streets.
 */
const VIA: { lat: number; lon: number }[] = [
  { lat: 28.5383, lon: -81.3792 }, // Orlando
  { lat: 33.7537, lon: -84.3863 }, // Atlanta, on the I-75/85 Downtown Connector
  { lat: 38.6195, lon: -90.1810 }, // St. Louis, I-64 by the Gateway Arch
  { lat: 40.0150, lon: -105.2705 }, // Boulder (US-36)
  { lat: 40.3772, lon: -105.5217 }, // Estes Park
  { lat: 40.3930, lon: -105.6360 }, // Rocky Mountain National Park
];

/** Cities and sights shown along the way, placed at the nearest point of the route. */
const WAYPOINTS: { name: string; lat: number; lon: number }[] = [
  { name: 'Orlando, FL', lat: 28.5383, lon: -81.3792 },
  { name: 'Atlanta, GA', lat: 33.7537, lon: -84.3863 },
  { name: 'Chattanooga, TN', lat: 35.0456, lon: -85.3097 },
  { name: 'Nashville, TN', lat: 36.1627, lon: -86.7816 },
  { name: 'St. Louis, MO', lat: 38.6247, lon: -90.1848 },
  { name: 'Kansas City, MO', lat: 39.0997, lon: -94.5786 },
  { name: 'Denver, CO', lat: 39.7392, lon: -104.9903 },
  { name: 'Boulder, CO', lat: 40.0150, lon: -105.2705 },
  { name: 'Lyons, CO', lat: 40.2247, lon: -105.2714 },
  { name: 'Estes Park, CO', lat: 40.3772, lon: -105.5217 },
  { name: 'Rocky Mountain National Park', lat: 40.3930, lon: -105.6360 },
];

const OVERPASS = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const DEM_Z = 12;
const BUILDING_RADIUS = 450;
const ROAD_RADIUS = 700;

const args = process.argv.slice(2);
const chunkArg = args.includes('--chunks') ? args[args.indexOf('--chunks') + 1] : undefined;

/** Short content hash for cache file names. */
const hash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r1 = (v: number) => Math.round(v * 10) / 10;

async function cached(file: string, fetcher: () => Promise<Buffer>): Promise<Buffer> {
  const path = join(CACHE, file);
  if (existsSync(path)) return readFileSync(path);
  const data = await fetcher();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return data;
}

async function download(url: string, init?: RequestInit, tries = 8, check?: (b: Buffer) => boolean, maxWait = 60_000): Promise<Buffer> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(240_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && (!check || check(buf))) return buf;
      if (res.status === 404) throw new Error(`404 ${url}`);
      throw new Error(`HTTP ${res.status}: ${buf.subarray(0, 120).toString()}`);
    } catch (e) {
      if (i >= tries - 1 || String(e).includes('404')) throw e;
      const wait = Math.min(maxWait, 2000 * 2 ** i);
      if (i % 5 === 4) console.warn(`  retry ${i + 1} in ${wait / 1000}s: ${String(e).slice(0, 80).replace(/\s+/g, ' ')}`);
      await sleep(wait);
    }
  }
}

/** Run `fn` over items with limited concurrency. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---------- Terrain (Terrarium tiles) ----------

const demTiles = new Map<string, Float32Array | null>();
const tileKey = (x: number, y: number) => `${x}/${y}`;

function tileXY(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return [x, y];
}

async function loadDem(x: number, y: number) {
  const key = tileKey(x, y);
  if (demTiles.has(key)) return;
  demTiles.set(key, null);
  const buf = await cached(`dem/${DEM_Z}/${x}/${y}.png`, () =>
    download(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_Z}/${x}/${y}.png`));
  const png = PNG.sync.read(buf);
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = terrariumHeight(png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]);
  demTiles.set(key, h);
}

/** Make sure every DEM tile covering these points is loaded. */
async function ensureDem(points: LatLon[]) {
  const need = new Set<string>();
  for (const p of points) {
    const [tx, ty] = tileXY(p.lat, p.lon, DEM_Z);
    for (const dx of [-0.01, 0.01]) for (const dy of [-0.01, 0.01]) need.add(tileKey(Math.floor(tx + dx), Math.floor(ty + dy)));
  }
  await pool([...need].filter((k) => !demTiles.get(k)), 6, async (k) => {
    const [x, y] = k.split('/').map(Number);
    await loadDem(x, y);
  });
}

function demPixel(px: number, py: number): number {
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const t = demTiles.get(tileKey(tx, ty));
  if (!t) throw new Error(`DEM tile ${tx}/${ty} not loaded`);
  return t[(py - ty * 256) * 256 + (px - tx * 256)];
}

/** Bilinear terrain height (m) at a lat/lon. */
function elevation(lat: number, lon: number): number {
  const [tx, ty] = tileXY(lat, lon, DEM_Z);
  const px = tx * 256 - 0.5, py = ty * 256 - 0.5;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const fx = px - x0, fy = py - y0;
  const a = demPixel(x0, y0), b = demPixel(x0 + 1, y0), c = demPixel(x0, y0 + 1), d = demPixel(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// ---------- Land cover (NLCD) ----------

async function landCover(chunk: number, minX: number, minY: number, maxX: number, maxY: number, scale: number) {
  const w = Math.max(16, Math.min(512, Math.round(((maxX - minX) * scale) / 30)));
  const h = Math.max(16, Math.min(512, Math.round(((maxY - minY) * scale) / 30)));
  const url = 'https://www.mrlc.gov/geoserver/mrlc_display/wms?service=WMS&version=1.1.1&request=GetMap'
    + `&layers=NLCD_2021_Land_Cover_L48&styles=&srs=EPSG:3857&bbox=${minX},${minY},${maxX},${maxY}`
    + `&width=${w}&height=${h}&format=image/png`;
  const buf = await cached(`nlcd/${chunk}-${hash(url)}.png`, () =>
    download(url, undefined, 8, (b) => b.subarray(1, 4).toString() === 'PNG'));
  const png = PNG.sync.read(buf);
  return (x: number, y: number): LandClass => {
    const px = Math.min(w - 1, Math.max(0, Math.floor(((x - minX) / (maxX - minX)) * w)));
    const py = Math.min(h - 1, Math.max(0, Math.floor(((maxY - y) / (maxY - minY)) * h)));
    const i = (py * w + px) * 4;
    return classifyNlcd(png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]);
  };
}

// ---------- OpenStreetMap: lanes (Overpass) ----------

interface OsmWay { tags?: Tags; geometry?: LatLon[] }

/** Highways right along the route, for lane counts. Best effort: returns [] if the server keeps failing. */
async function routeWays(key: string, line: LatLon[]): Promise<OsmWay[]> {
  const ll = line.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',');
  const q = `[out:json][timeout:300];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link)$"](around:15,${ll});out tags geom;`;
  try {
    const buf = await cached(`lanes/${key}-${hash(q)}.json`, () => download(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'idle-driver-map-bake/1.0' },
      body: 'data=' + encodeURIComponent(q),
    }, 25, (b) => b[0] === 0x7b && !b.toString().includes('runtime error'), 8000));
    return (JSON.parse(buf.toString()) as { elements: OsmWay[] }).elements;
  } catch (e) {
    console.warn(`  lanes for ${key} unavailable, using defaults: ${String(e).slice(0, 100)}`);
    return [];
  }
}

// ---------- OpenStreetMap: buildings and roads (OpenFreeMap vector tiles) ----------

const TILE_Z = 14;
const TILE_URL = await (async () => {
  const tj = JSON.parse((await cached('openfreemap.json', () => download('https://tiles.openfreemap.org/planet'))).toString());
  return tj.tiles[0] as string;
})();
const TILE_VERSION = TILE_URL.split('/').slice(-4, -3)[0];

interface TileFeature {
  layer: 'building' | 'road';
  props: Record<string, string | number | boolean>;
  /** Mercator coordinates. Buildings: rings. Roads: lines. */
  parts: [number, number][][];
  /** Building centroid inside this tile's own area (not its overlap buffer). */
  own: boolean;
}
const tileCache = new Map<string, TileFeature[]>();

type P = { x: number; y: number };
/** Clip segment a-b to the square [0, ext] (Liang-Barsky). Returns the endpoints, reusing a/b when unclipped. */
function clipSegment(a: P, b: P, ext: number): [P, P] | undefined {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x], [dx, ext - a.x], [-dy, a.y], [dy, ext - a.y]]) {
    if (p === 0) { if (q < 0) return undefined; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return undefined; if (t > t0) t0 = t; }
    else { if (t < t0) return undefined; if (t < t1) t1 = t; }
  }
  return [t0 === 0 ? a : { x: a.x + dx * t0, y: a.y + dy * t0 }, t1 === 1 ? b : { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

async function loadTile(x: number, y: number): Promise<TileFeature[]> {
  const key = `${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const buf = await cached(`tiles/${TILE_VERSION}/${TILE_Z}/${x}/${y}.pbf`, () => download(TILE_URL.replace('{z}', String(TILE_Z)).replace('{x}', String(x)).replace('{y}', String(y))));
  const feats: TileFeature[] = [];
  const vt = new VectorTile(new Protobuf(buf));
  const world = 2 * Math.PI * EARTH_R, n = 2 ** TILE_Z;
  for (const layerName of ['building', 'transportation'] as const) {
    const layer = vt.layers[layerName];
    if (!layer) continue;
    const ext = layer.extent;
    const toMerc = (p: { x: number; y: number }): [number, number] =>
      [((x + p.x / ext) / n) * world - world / 2, world / 2 - ((y + p.y / ext) / n) * world];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (layerName === 'building') {
        // Split into one feature per outer ring (with holes ignored: they're courtyards).
        for (const ring of f.loadGeometry()) {
          if (ring.length < 4) continue;
          let a = 0;
          for (let k = 0; k < ring.length - 1; k++) a += ring[k].x * ring[k + 1].y - ring[k + 1].x * ring[k].y;
          if (a <= 0) continue; // tile y is down, so outer rings have positive area here
          const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length, cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
          feats.push({ layer: 'building', props: f.properties, parts: [ring.map(toMerc)], own: cx >= 0 && cx < ext && cy >= 0 && cy < ext });
        }
      } else if (f.type === 2) {
        // Clip to the tile's own square so roads in the overlap buffer aren't baked twice.
        const own: [number, number][][] = [];
        for (const line of f.loadGeometry()) {
          let cur: [number, number][] = [];
          for (let k = 1; k < line.length; k++) {
            const seg = clipSegment(line[k - 1], line[k], ext);
            if (!seg) { if (cur.length > 1) own.push(cur); cur = []; continue; }
            const [p0, p1] = seg.map(toMerc);
            if (!cur.length) cur.push(p0);
            cur.push(p1);
            if (seg[1] !== line[k]) { own.push(cur); cur = []; }
          }
          if (cur.length > 1) own.push(cur);
        }
        if (own.length) feats.push({ layer: 'road', props: f.properties, parts: own, own: true });
      }
    }
  }
  if (tileCache.size > 200) tileCache.delete(tileCache.keys().next().value!);
  tileCache.set(key, feats);
  return feats;
}

// ---------- Route ----------

interface RoutePt extends LatLon { s: number; x: number; y: number; h: number }

async function bakeRoute(): Promise<RoutePt[]> {
  const coords = VIA.map((w) => `${w.lon},${w.lat}`).join(';');
  const buf = await cached(`osrm-${hash(coords)}.json`, () => download(
    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=true`));
  const json = JSON.parse(buf.toString());
  const line: LatLon[] = json.routes[0].geometry.coordinates.map(([lon, lat]: number[]) => ({ lat, lon }));
  const pts = resample(line, ROUTE_STEP);
  console.log(`Route: ${(pts[pts.length - 1].s / 1609.344).toFixed(0)} miles, ${pts.length} points`);
  return pts.map((p) => {
    const [x, y] = mercator(p.lat, p.lon);
    return { ...p, x, y, h: 0 };
  });
}

/** Position (mercator) and lat at route distance s, interpolated. */
function at(route: RoutePt[], s: number) {
  const i = Math.max(0, Math.min(route.length - 2, Math.floor(s / ROUTE_STEP)));
  const a = route[i], b = route[i + 1];
  const t = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: a.h + (b.h - a.h) * t, lat: a.lat + (b.lat - a.lat) * t };
}

// ---------- Spatial index over route points ----------

class RouteIndex {
  private cells = new Map<string, number[]>();
  private route: RoutePt[];
  private cell: number;
  constructor(route: RoutePt[], cell = 500) {
    this.route = route;
    this.cell = cell;
    route.forEach((p, i) => {
      const k = this.key(p.x, p.y);
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i);
    });
  }
  private key(x: number, y: number) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`; }
  /** Indices of route points inside a box. */
  within(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const out: number[] = [];
    for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
      for (let cy = Math.floor(minY / this.cell); cy <= Math.floor(maxY / this.cell); cy++) {
        for (const i of this.cells.get(`${cx},${cy}`) ?? []) {
          const p = this.route[i];
          if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) out.push(i);
        }
      }
    }
    return out;
  }
  /** Nearest route point index and distance (mercator meters), searching `reach` cells around. */
  nearest(x: number, y: number, reach = 3): { i: number; d: number } {
    let best = { i: -1, d: Infinity };
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      for (const i of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const p = this.route[i];
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < best.d) best = { i, d };
      }
    }
    return best;
  }
}

// ---------- Main ----------

const route = await bakeRoute();
const total = route[route.length - 1].s;
const chunkCount = Math.ceil(total / CHUNK_LEN);
const [firstChunk, lastChunk] = chunkArg ? chunkArg.split('-').map(Number) : [0, chunkCount - 1];
const index = new RouteIndex(route);

// Road elevation along the whole route, smoothed so the drive isn't bumpy (DEM is ~30 m).
console.log('Route elevation...');
for (let i = 0; i < route.length; i += 2000) await ensureDem(route.slice(i, i + 2000));
const rawH = route.map((p) => elevation(p.lat, p.lon));
const roadH = smooth(rawH, 6);
route.forEach((p, i) => { p.h = roadH[i]; });

interface Seg { ax: number; ay: number; bx: number; by: number; tags: Tags }

/** Nearest road segment roughly parallel to the route at route point i, within 12 m. */
function matchRoad(segs: Seg[], i: number): { same: boolean; tags: Tags } | undefined {
  const p = route[i], q = route[Math.min(route.length - 1, i + 1)], prev = route[Math.max(0, i - 1)];
  const tx = q.x - prev.x, ty = q.y - prev.y;
  const tl = Math.hypot(tx, ty) || 1;
  const scale = mercatorScale(p.lat);
  let best: { d: number; same: boolean; tags: Tags } | undefined;
  for (const sg of segs) {
    if (Math.min(sg.ax, sg.bx) > p.x + 200 || Math.max(sg.ax, sg.bx) < p.x - 200) continue;
    if (Math.min(sg.ay, sg.by) > p.y + 200 || Math.max(sg.ay, sg.by) < p.y - 200) continue;
    const dx = sg.bx - sg.ax, dy = sg.by - sg.ay;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - sg.ax) * dx + (p.y - sg.ay) * dy) / L2));
    const d = Math.hypot(sg.ax + dx * t - p.x, sg.ay + dy * t - p.y) * scale;
    if (d > 12 || (best && d >= best.d)) continue;
    const cos = (dx * tx + dy * ty) / (Math.sqrt(L2) * tl);
    if (Math.abs(cos) < 0.8) continue;
    best = { d, same: cos > 0, tags: sg.tags };
  }
  return best;
}

// Lane counts for route points, from OSM ways along the route (batched ~40 km per request).
// Requests run ahead of the chunk loop since the Overpass server is slow.
const LANE_GROUP = 10;
const lanesAll: ([number, number] | undefined)[] = new Array(route.length);
const laneJobs = new Map<number, Promise<void>>();
function lanesFor(c: number): Promise<void> {
  const g = Math.floor(c / LANE_GROUP) * LANE_GROUP;
  if (g >= chunkCount) return Promise.resolve();
  if (!laneJobs.has(g)) laneJobs.set(g, (async () => {
    const s0 = g * CHUNK_LEN, s1 = Math.min(total, (g + LANE_GROUP) * CHUNK_LEN);
    const i0 = Math.floor(s0 / ROUTE_STEP), i1 = Math.min(route.length - 1, Math.ceil(s1 / ROUTE_STEP) + 1);
    const line = route.slice(i0, i1 + 1).filter((_, k) => k % 12 === 0);
    line.push(route[i1]);
    const ways = await routeWays(`${g}x${LANE_GROUP}`, line);
    const segs: Seg[] = [];
    for (const w of ways) {
      if (!w.geometry || !w.tags) continue;
      const pts = w.geometry.map((p) => mercator(p.lat, p.lon));
      for (let k = 1; k < pts.length; k++) segs.push({ ax: pts[k - 1][0], ay: pts[k - 1][1], bx: pts[k][0], by: pts[k][1], tags: w.tags });
    }
    for (let i = i0; i <= i1; i++) {
      const m = matchRoad(segs, i);
      if (m) {
        const l = wayLanes(m.tags, m.same);
        lanesAll[i] = [l.fwd, l.back];
      }
    }
    console.log(`  lanes for chunks ${g}..${g + LANE_GROUP - 1}: ${ways.length} ways`);
  })());
  return laneJobs.get(g)!;
}

interface Chunk {
  i: number; s0: number; lat: number; o: [number, number];
  r: number[]; ln: number[]; tr: number[]; th: number[]; tc: string; hx: number[];
  b: (number | string)[][]; w: (number | string)[][]; t: number[];
}

mkdirSync(join(OUT, 'c'), { recursive: true });
const started = Date.now();
for (let c = firstChunk; c <= lastChunk; c++) {
  const cs0 = c * CHUNK_LEN, cs1 = Math.min(total, (c + 1) * CHUNK_LEN);
  const iStart = Math.round(cs0 / ROUTE_STEP), iEnd = Math.min(route.length - 1, Math.ceil(cs1 / ROUTE_STEP));
  const pts = route.slice(iStart, iEnd + 1);
  for (let ahead = 1; ahead <= 3; ahead++) void lanesFor(c + ahead * LANE_GROUP);
  // Don't hold up the whole bake on a slow lane request: fall back to road-class defaults.
  await Promise.race([lanesFor(c), sleep(90_000)]);
  const o: [number, number] = [Math.round(pts[0].x), Math.round(pts[0].y)];
  const lat = pts[0].lat;
  const scale = mercatorScale(lat);

  // Terrain rows across the route.
  const rows: { x: number; y: number; nx: number; ny: number; h: number }[] = [];
  for (let s = cs0; s <= cs1 + 1e-6; s += ROW_STEP) {
    const p = at(route, s);
    const a = at(route, Math.max(0, s - 300)), b = at(route, Math.min(total, s + 300));
    const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Right of travel is (ty, -tx) in mercator (y is north).
    rows.push({ x: p.x, y: p.y, nx: (b.y - a.y) / tl, ny: -(b.x - a.x) / tl, h: p.h });
  }
  const samples: LatLon[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rows) for (const d of TERRAIN_COLS) {
    const x = r.x + (r.nx * d) / scale, y = r.y + (r.ny * d) / scale;
    const [la, lo] = unmercator(x, y);
    samples.push({ lat: la, lon: lo });
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  await ensureDem(samples);
  const cover = await landCover(c, Math.floor(minX - 200), Math.floor(minY - 200), Math.ceil(maxX + 200), Math.ceil(maxY + 200), scale);
  const th: number[] = [];
  let tc = '';
  rows.forEach((r, ri) => TERRAIN_COLS.forEach((d, ci) => {
    const sp = samples[ri * TERRAIN_COLS.length + ci];
    const dem = elevation(sp.lat, sp.lon);
    const ad = Math.abs(d);
    // Flatten the ground right under the road; blend back to real terrain a little further out.
    let h = ad <= 12 ? r.h - 0.3 : ad <= 25 ? (r.h + dem) / 2 - 0.3 : dem;
    // Roads in hills run through cuts the 30 m terrain data smooths over: keep the ground from
    // rising faster than 1:2 away from the nearest bit of road (on any leg of a switchback), so the
    // road and the camera aren't buried in the hillside.
    if (ad > 12) {
      const x = r.x + (r.nx * d) / scale, y = r.y + (r.ny * d) / scale;
      const near = index.nearest(x, y, 1);
      const dist = near.d * scale;
      if (near.i >= 0 && dist < 300) h = Math.min(h, route[near.i].h + Math.max(0, dist - 10) * 0.5);
    }
    th.push(r1(h));
    tc += cover(r.x + (r.nx * d) / scale, r.y + (r.ny * d) / scale);
  }));

  // Terrain cells that lie over a different stretch of the route (switchbacks, loops) are left out,
  // or their far-away corners would cover that road like a lid. That road's own terrain fills in.
  const holes: number[] = [];
  const C = TERRAIN_COLS.length;
  const sx = (ri: number, ci: number) => rows[ri].x + (rows[ri].nx * TERRAIN_COLS[ci]) / scale;
  const sy = (ri: number, ci: number) => rows[ri].y + (rows[ri].ny * TERRAIN_COLS[ci]) / scale;
  for (let ri = 0; ri < rows.length - 1; ri++) for (let ci = 0; ci < C - 1; ci++) {
    if (Math.min(Math.abs(TERRAIN_COLS[ci]), Math.abs(TERRAIN_COLS[ci + 1])) < 25) continue;
    const quad: [number, number][] = [[sx(ri, ci), sy(ri, ci)], [sx(ri, ci + 1), sy(ri, ci + 1)], [sx(ri + 1, ci + 1), sy(ri + 1, ci + 1)], [sx(ri + 1, ci), sy(ri + 1, ci)]];
    const xs = quad.map((q) => q[0]), ys = quad.map((q) => q[1]);
    const rowS = cs0 + ri * ROW_STEP;
    const hit = index.within(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)).some((i) => {
      if (Math.abs(route[i].s - rowS) < 150) return false;
      // Point in quad (even-odd rule).
      let inside = false;
      for (let a = 0, b = 3; a < 4; b = a++) {
        const [ax, ay] = quad[a], [bx, by] = quad[b];
        if ((ay > route[i].y) !== (by > route[i].y) && route[i].x < ((bx - ax) * (route[i].y - ay)) / (by - ay) + ax) inside = !inside;
      }
      return inside;
    });
    if (hit) holes.push(ri * (C - 1) + ci);
  }

  // Vector tiles covering the corridor near the road.
  const need = new Set<string>();
  for (const r of rows) for (const d of [-ROAD_RADIUS, -BUILDING_RADIUS, -150, 0, 150, BUILDING_RADIUS, ROAD_RADIUS]) {
    const [la, lo] = unmercator(r.x + (r.nx * d) / scale, r.y + (r.ny * d) / scale);
    const [tx, ty] = tileXY(la, lo, TILE_Z);
    need.add(`${Math.floor(tx)}/${Math.floor(ty)}`);
  }
  const feats: TileFeature[] = [];
  await pool([...need], 4, async (k) => {
    const [x, y] = k.split('/').map(Number);
    feats.push(...(await loadTile(x, y)));
  });

  const owner = (x: number, y: number) => {
    const n = index.nearest(x, y, 3);
    return n.i < 0 ? undefined : { s: route[n.i].s, d: n.d * scale };
  };
  const inChunk = (s: number) => s >= cs0 && (s < cs1 || c === chunkCount - 1);

  // Lanes: OSM lane data where we have it, else a guess from the road class in the tiles.
  const tileSegs: Seg[] = [];
  for (const f of feats) if (f.layer === 'road') {
    const cls = String(f.props.class);
    if (!/^(motorway|trunk|primary|secondary|tertiary|minor)$/.test(cls)) continue;
    const tags: Tags = { highway: f.props.ramp ? `${cls}_link` : cls, oneway: f.props.oneway === 1 ? 'yes' : undefined };
    for (const line of f.parts) for (let k = 1; k < line.length; k++) tileSegs.push({ ax: line[k - 1][0], ay: line[k - 1][1], bx: line[k][0], by: line[k][1], tags });
  }
  const lanes: [number, number][] = pts.map((_, k) => {
    const i = iStart + k;
    if (lanesAll[i]) return lanesAll[i]!;
    const m = matchRoad(tileSegs, i);
    if (!m) return [2, 0];
    const l = wayLanes(m.tags, m.same);
    return [l.fwd, l.back];
  });
  for (let i = 1; i < lanes.length - 1; i++) {
    const [a, b, d] = [lanes[i - 1], lanes[i], lanes[i + 1]];
    if (a[0] === d[0] && a[1] === d[1] && (b[0] !== a[0] || b[1] !== a[1])) lanes[i] = a;
  }
  const ln: number[] = [];
  for (const l of lanes) {
    if (ln.length && ln[ln.length - 2] === l[0] && ln[ln.length - 1] === l[1]) ln[ln.length - 3]++;
    else ln.push(1, l[0], l[1]);
  }

  // Make sure terrain is loaded under every feature we keep.
  const featPts: LatLon[] = [];
  for (const f of feats) for (const part of f.parts) for (const [x, y] of part) {
    const [la, lo] = unmercator(x, y);
    featPts.push({ lat: la, lon: lo });
  }
  await ensureDem(featPts);
  const elev = (x: number, y: number) => { const [la, lo] = unmercator(x, y); return elevation(la, lo); };

  const b: (number | string)[][] = [];
  const w: (number | string)[][] = [];
  for (const f of feats) {
    if (f.layer === 'building') {
      if (!f.own) continue;
      const ring = f.parts[0].slice(0, -1);
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const ow = owner(cx, cy);
      if (!ow || ow.d > BUILDING_RADIUS || ow.d < 14 || !inChunk(ow.s)) continue;
      const simple = simplify(ring.map(([x, y]) => [x - o[0], y - o[1]] as [number, number]), 0.4 / scale);
      if (simple.length < 3) continue;
      const flat = simple.flatMap(([x, y]) => [r1(x), r1(y)]);
      const area = Math.abs(ringArea(flat)) * scale * scale;
      if (area < 12) continue;
      const tagged = Number(f.props.render_height);
      const minH = Number(f.props.render_min_height) || 0;
      const height = Number.isFinite(tagged) && tagged > 0 ? tagged : buildingHeight({}, area);
      if (height - minH < 1) continue;
      const base = Math.min(...ring.map(([x, y]) => elev(x, y)));
      // Kind from size and height (tiles don't say what the building is).
      const kind = height >= 25 ? 'c' : area > 4000 ? 'i' : area > 400 ? 'c' : 'h';
      b.push([r1(height), r1(base + minH), kind, ...flat]);
    } else {
      const cls = String(f.props.class);
      if (!/^(motorway|trunk|primary|secondary|tertiary|minor)$/.test(cls) || f.props.brunnel === 'tunnel') continue;
      const bridge = f.props.brunnel === 'bridge';
      const width = { motorway: 10, trunk: 8, primary: 7.5, secondary: 7, tertiary: 6.5, minor: 5.5 }[cls]! * (f.props.ramp ? 0.5 : 1);
      for (const line of f.parts) {
        // Densify to ~25 m so the road follows the terrain, keep the parts near the route.
        const dense: [number, number][] = [];
        for (let k = 0; k < line.length; k++) {
          if (k) {
            const [px, py] = line[k - 1], [x, y] = line[k];
            const steps = Math.ceil((Math.hypot(x - px, y - py) * scale) / 25);
            for (let j = 1; j < steps; j++) dense.push([px + ((x - px) * j) / steps, py + ((y - py) * j) / steps]);
          }
          dense.push(line[k]);
        }
        const hA = elev(...dense[0]), hB = elev(...dense[dense.length - 1]);
        let run: number[] = [];
        let runS: number | undefined;
        const flush = () => {
          if (run.length >= 6 && runS !== undefined && inChunk(runS)) w.push([cls.slice(0, 3) + (f.props.ramp ? 'L' : ''), width, ...run]);
          run = [];
          runS = undefined;
        };
        dense.forEach(([x, y], k) => {
          const ow = owner(x, y);
          if (!ow || ow.d > (cls === 'minor' ? 450 : ROAD_RADIUS)) { flush(); return; }
          runS ??= ow.s;
          const h = bridge ? hA + ((hB - hA) * k) / Math.max(1, dense.length - 1) : elev(x, y);
          run.push(r1(x - o[0]), r1(y - o[1]), r1(h));
        });
        flush();
      }
    }
  }

  const chunk: Chunk = {
    i: c, s0: cs0, lat: Math.round(lat * 1e5) / 1e5, o,
    r: pts.flatMap((p) => [r1(p.x - o[0]), r1(p.y - o[1]), r1(p.h)]),
    ln,
    tr: rows.flatMap((r) => [r1(r.x - o[0]), r1(r.y - o[1]), Math.round(r.nx * 1e4) / 1e4, Math.round(r.ny * 1e4) / 1e4]),
    th, tc, hx: holes, b, w, t: [],
  };
  writeFileSync(join(OUT, 'c', `${String(c).padStart(4, '0')}.json`), JSON.stringify(chunk));
  const el = (Date.now() - started) / 1000, doneN = c - firstChunk + 1;
  console.log(`chunk ${c}: ${b.length} buildings, ${w.length} roads; ~${((el / doneN) * (lastChunk - c) / 60).toFixed(0)} min left`);
}

// Index file: chunk count, waypoint distances, and a light overview line for the route strip.
const overview = simplify(route.map((p) => [p.lon, p.lat] as [number, number]), 0.01).map(([lon, la]) => [Math.round(la * 1000) / 1000, Math.round(lon * 1000) / 1000]);
const waypoints = WAYPOINTS.map((wp) => {
  const [x, y] = mercator(wp.lat, wp.lon);
  let best = 0, bestD = Infinity;
  for (const p of route) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = p.s; }
  }
  return { name: wp.name, s: Math.round(best) };
});
writeFileSync(join(OUT, 'route.json'), JSON.stringify({
  total: Math.round(total), chunkLen: CHUNK_LEN, chunks: chunkCount, waypoints, overview,
  credits: 'Map data © OpenStreetMap contributors (ODbL), tiles by OpenFreeMap. Terrain: AWS Terrain Tiles (USGS 3DEP, SRTM and others). Land cover: USGS NLCD 2021.',
}));
console.log(`Wrote route.json: ${chunkCount} chunks, ${(total / 1609.344).toFixed(0)} miles`);
