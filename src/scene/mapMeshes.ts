// Builds Three.js meshes for one baked map chunk: terrain, the driven road and its markings,
// nearby roads, buildings and trees. Geometry is in chunk-local mercator meters
// (x = east, y = height, z = -north); the caller scales the group to real meters.
import {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group,
  IcosahedronGeometry, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D,
  ShapeUtils, Vector2, type Material,
} from 'three';
import { TERRAIN_COLS, ROW_STEP } from '../map/geo';
import { expandLanes, roadEdges, terrainGrid, type MapChunk } from '../map/chunk';
import { rng } from '../world';

const LAND_COLORS: Record<string, number> = {
  w: 0x4f86c0, o: 0x97b872, l: 0xa6b083, m: 0xa39f8f, h: 0x8e8a86, b: 0xc4b79c,
  d: 0x5d9446, e: 0x3f6f3d, x: 0x6a954c, s: 0xb3a36b, g: 0xb7c178, p: 0xc5c56b,
  c: 0xc8a964, v: 0x6b956b, n: 0x8db39a,
};

const mats = {
  terrain: new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }),
  road: new MeshLambertMaterial({ color: 0x3b3f45, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  sideRoad: new MeshLambertMaterial({ color: 0x55595f, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  lines: new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  building: new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }),
  trunk: new MeshLambertMaterial({ color: 0x7a5a3c, flatShading: true }),
  crown: new MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
};

const treeGeo = (() => {
  const trunk = new CylinderGeometry(0.15, 0.25, 1, 5);
  trunk.translate(0, 0.5, 0);
  const cone = new ConeGeometry(1, 1, 6);
  cone.translate(0, 0.5, 0);
  const round = new IcosahedronGeometry(1, 0);
  const palm = new ConeGeometry(1, 0.35, 7);
  palm.translate(0, 0, 0);
  return { trunk, cone, round, palm };
})();

export interface ChunkMeshes {
  group: Group;
  dispose(): void;
}

/** A growable float list (avoids huge intermediate arrays of arrays). */
class Floats {
  a = new Float32Array(4096);
  n = 0;
  push(...v: number[]) {
    if (this.n + v.length > this.a.length) {
      const b = new Float32Array(Math.max(this.a.length * 2, this.n + v.length));
      b.set(this.a);
      this.a = b;
    }
    for (const x of v) this.a[this.n++] = x;
  }
  get array() { return this.a.subarray(0, this.n); }
}

function geometry(pos: Floats, col?: Floats): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos.array.slice(), 3));
  if (col) g.setAttribute('color', new BufferAttribute(col.array.slice(), 3));
  g.computeVertexNormals();
  return g;
}

/** Ribbon quads along a polyline of [x, y(north), h] points with left/right offsets per point. */
function ribbon(
  pos: Floats, pts: ArrayLike<number>, stride: number, lift: number, scale: number,
  edges: (i: number) => [number, number] | undefined,
  col?: Floats, color?: Color, skip?: (i: number) => boolean,
) {
  const n = Math.floor(pts.length / stride);
  const dir = (i: number) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = pts[b * stride] - pts[a * stride], dy = pts[b * stride + 1] - pts[a * stride + 1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const corner = (i: number, off: number): [number, number, number] => {
    const [tx, ty] = dir(i);
    // Right of travel in mercator is (ty, -tx); scene z is -north.
    const x = pts[i * stride] + (ty * off) / scale, y = pts[i * stride + 1] - (tx * off) / scale;
    return [x, pts[i * stride + 2] + lift, -y];
  };
  for (let i = 0; i < n - 1; i++) {
    if (skip?.(i)) continue;
    const e0 = edges(i), e1 = edges(i + 1);
    if (!e0 || !e1) continue;
    const a = corner(i, e0[0]), b = corner(i, e0[1]), c = corner(i + 1, e1[0]), d = corner(i + 1, e1[1]);
    pos.push(...a, ...c, ...b, ...b, ...c, ...d);
    if (col && color) for (let k = 0; k < 6; k++) col.push(color.r, color.g, color.b);
  }
}

export function buildChunk(chunk: MapChunk): ChunkMeshes {
  const group = new Group();
  const scale = Math.cos((chunk.lat * Math.PI) / 180);
  const r = rng(chunk.i * 7919 + 17);
  const geos: BufferGeometry[] = [];
  const add = (g: BufferGeometry, m: Material) => { geos.push(g); group.add(new Mesh(g, m)); };
  const tmp = new Color();

  // ---- Terrain ----
  const cols = TERRAIN_COLS.length;
  const rows = chunk.tr.length / 4;
  const grid = terrainGrid(chunk, TERRAIN_COLS);
  const holes = new Set(chunk.hx ?? []);
  {
    const g = new BufferGeometry();
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    for (let i = 0; i < rows * cols; i++) {
      pos[i * 3] = grid[i * 2];
      pos[i * 3 + 1] = chunk.th[i];
      pos[i * 3 + 2] = -grid[i * 2 + 1];
      tmp.setHex(LAND_COLORS[chunk.tc[i]] ?? 0xb7c178).offsetHSL(0, 0, (r() - 0.5) * 0.05);
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    const idx: number[] = [];
    for (let ro = 0; ro < rows - 1; ro++) for (let c = 0; c < cols - 1; c++) {
      if (holes.has(ro * (cols - 1) + c)) continue;
      const a = ro * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    add(g, mats.terrain);
  }

  // ---- The driven road and its markings ----
  const lanes = expandLanes(chunk.ln);
  {
    const pos = new Floats();
    ribbon(pos, chunk.r, 3, 0.05, scale, (i) => {
      const [f, b] = lanes[i] ?? [2, 0];
      const e = roadEdges(f, b);
      return [e.left - 1.2, e.right + 1.2];
    });
    add(geometry(pos), mats.road);

    const lp = new Floats(), lc = new Floats();
    const white = new Color(0xf2f2ee), yellow = new Color(0xf2c94c);
    const W = 0.16;
    const line = (offset: (f: number, b: number) => number | undefined, color: Color, dashed: boolean) =>
      ribbon(lp, chunk.r, 3, 0.09, scale, (i) => {
        const [f, b] = lanes[i] ?? [2, 0];
        const o = offset(f, b);
        return o === undefined ? undefined : [o - W / 2, o + W / 2];
      }, lc, color, dashed ? (i) => i % 2 === 1 : undefined);
    line((f, b) => roadEdges(f, b).right - 0.3, white, false);
    line((f, b) => (b === 0 ? roadEdges(f, b).left + 0.3 : undefined), yellow, false);
    line((f, b) => (b > 0 ? roadEdges(f, b).left + 0.3 : undefined), white, false);
    line((_f, b) => (b > 0 ? -0.15 : undefined), yellow, false);
    line((_f, b) => (b > 0 ? 0.15 : undefined), yellow, false);
    for (let k = 1; k < 6; k++) {
      line((f, b) => (k < f ? roadEdges(f, b).right - k * 3.6 : undefined), white, true);
      line((f, b) => (k < b ? roadEdges(f, b).left + k * 3.6 : undefined), white, true);
    }
    add(geometry(lp, lc), mats.lines);
  }

  // ---- Nearby roads ----
  {
    const pos = new Floats();
    for (const w of chunk.w) {
      const width = Number(w[1]);
      const pts = w.slice(2) as number[];
      ribbon(pos, pts, 3, 0.12, scale, () => [-width / 2, width / 2]);
    }
    if (pos.n) add(geometry(pos), mats.sideRoad);
  }

  // ---- Buildings ----
  {
    const pos = new Floats(), col = new Floats();
    const wall = new Color(), roof = new Color();
    for (const bld of chunk.b) {
      const height = Number(bld[0]), base = Number(bld[1]), kind = String(bld[2]);
      const flat = bld.slice(3) as number[];
      const n = flat.length / 2;
      const top = base + height;
      const v = (r() - 0.5) * 0.08;
      if (kind === 'h') { wall.setHex([0xe8dcc4, 0xd9c8a9, 0xf0ece4, 0xc9b49a, 0xdfe3e6][Math.floor(r() * 5)]); roof.setHex(0x6e5d50); }
      else if (kind === 'i') { wall.setHex(0xc9ccd0); roof.setHex(0xa9adb2); }
      else if (height >= 25) { wall.setHex([0x8fa9c4, 0x9fb2c2, 0x7d94ad, 0xb9c2cc][Math.floor(r() * 4)]); roof.setHex(0x6f7a85); }
      else { wall.setHex([0xd6cfc4, 0xc8c3bb, 0xe0d4c0, 0xb8b0a6][Math.floor(r() * 4)]); roof.setHex(0x8a8580); }
      wall.offsetHSL(0, 0, v);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = flat[i * 2], az = -flat[i * 2 + 1], bx = flat[j * 2], bz = -flat[j * 2 + 1];
        pos.push(ax, base, az, bx, base, bz, bx, top, bz, ax, base, az, bx, top, bz, ax, top, az);
        for (let k = 0; k < 6; k++) col.push(wall.r, wall.g, wall.b);
      }
      const contour = Array.from({ length: n }, (_, i) => new Vector2(flat[i * 2], flat[i * 2 + 1]));
      for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
        for (const k of [a, b, c]) {
          pos.push(contour[k].x, top, -contour[k].y);
          col.push(roof.r, roof.g, roof.b);
        }
      }
    }
    if (pos.n) add(geometry(pos, col), mats.building);
  }

  // ---- Trees, scattered in the real forests and yards ----
  {
    const density: Record<string, number> = { e: 1 / 140, d: 1 / 140, x: 1 / 140, v: 1 / 220, l: 1 / 500, o: 1 / 700, m: 1 / 2500, s: 1 / 1500, g: 1 / 8000, p: 1 / 9000, n: 1 / 3000 };
    const florida = chunk.lat < 30.7;
    const mountains = chunk.lat > 39.5 && chunk.o[0] < -11_675_000; // west of about -104.9°
    type Tree = { x: number; y: number; z: number; s: number; kind: 0 | 1 | 2; c: number };
    const trees: Tree[] = [];
    const MAX = 3500;
    for (let ro = 0; ro < rows - 1 && trees.length < MAX; ro++) for (let c = 0; c < cols - 1; c++) {
      const cls = chunk.tc[ro * cols + c];
      let dens = density[cls] ?? 0;
      const d0 = TERRAIN_COLS[c], d1 = TERRAIN_COLS[c + 1];
      if (Math.min(Math.abs(d0), Math.abs(d1)) < 20 || holes.has(ro * (cols - 1) + c)) continue; // keep roads clear
      if (Math.max(Math.abs(d0), Math.abs(d1)) > 520) dens *= 0.3;
      const area = ROW_STEP * Math.abs(d1 - d0);
      let count = area * dens;
      count = Math.floor(count) + (r() < count % 1 ? 1 : 0);
      for (let k = 0; k < Math.min(count, 40) && trees.length < MAX; k++) {
        const u = r(), w = r();
        const i00 = ro * cols + c, i01 = i00 + 1, i10 = i00 + cols, i11 = i10 + 1;
        const lerp = (a: number, b: number, cc: number, d: number) => (a * (1 - u) + b * u) * (1 - w) + (cc * (1 - u) + d * u) * w;
        const x = lerp(grid[i00 * 2], grid[i01 * 2], grid[i10 * 2], grid[i11 * 2]);
        const y = lerp(grid[i00 * 2 + 1], grid[i01 * 2 + 1], grid[i10 * 2 + 1], grid[i11 * 2 + 1]);
        const h = lerp(chunk.th[i00], chunk.th[i01], chunk.th[i10], chunk.th[i11]);
        let kind: 0 | 1 | 2 = cls === 'e' || mountains ? 0 : cls === 'x' || cls === 'v' ? (r() < 0.5 ? 0 : 1) : 1;
        if (florida && (cls === 'l' || cls === 'o' || r() < 0.2)) kind = 2;
        trees.push({ x, y: h, z: -y, s: 0.8 + r() * 0.6, kind, c: r() });
      }
    }
    const dummy = new Object3D();
    const trunks = new InstancedMesh(treeGeo.trunk, mats.trunk, trees.length);
    const crowns = [treeGeo.cone, treeGeo.round, treeGeo.palm].map((g, kind) =>
      new InstancedMesh(g, mats.crown, Math.max(1, trees.filter((t) => t.kind === kind).length)));
    const counts = [0, 0, 0];
    const greens = [[0x2f5d34, 0x3b6b3a, 0x2a5230], [0x4d8a3a, 0x5c9440, 0x3f7a35, 0x6b9a45], [0x4c8c3e, 0x5a9a44]];
    trees.forEach((t, i) => {
      const trunkH = t.kind === 2 ? 7 * t.s : t.kind === 0 ? 2.5 * t.s : 3 * t.s;
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, t.c * 6, 0);
      dummy.scale.set(t.s * (t.kind === 2 ? 0.8 : 1), trunkH, t.s * (t.kind === 2 ? 0.8 : 1));
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      if (t.kind === 0) { dummy.position.set(t.x, t.y + trunkH * 0.6, t.z); dummy.scale.set(2.6 * t.s, 9 * t.s, 2.6 * t.s); }
      else if (t.kind === 1) { dummy.position.set(t.x, t.y + trunkH + 2.2 * t.s, t.z); dummy.scale.set(3.2 * t.s, 2.8 * t.s, 3.2 * t.s); }
      else { dummy.position.set(t.x, t.y + trunkH, t.z); dummy.scale.set(3 * t.s, 2 * t.s, 3 * t.s); }
      dummy.updateMatrix();
      const m = crowns[t.kind];
      m.setMatrixAt(counts[t.kind], dummy.matrix);
      const pal = greens[t.kind];
      m.setColorAt(counts[t.kind], tmp.setHex(pal[Math.floor(t.c * pal.length)]));
      counts[t.kind]++;
    });
    crowns.forEach((m, k) => { m.count = counts[k]; });
    group.add(trunks, ...crowns);
  }

  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      group.traverse((o) => { if (o instanceof InstancedMesh) o.dispose(); });
    },
  };
}
