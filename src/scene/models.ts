// Low-poly, flat-shaded models built from code (no downloads).
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, MeshBasicMaterial, OctahedronGeometry,
  type BufferGeometry, type Material,
} from 'three';

const flat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

function mesh(geo: BufferGeometry, mat: Material, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

const seeThrough = (m: MeshLambertMaterial, opacity: number) => {
  m.transparent = true;
  m.opacity = opacity;
  m.depthWrite = false;
  return m;
};

/**
 * The family SUV: boxy, teal, roof box on top. About 1.9 x 1.8 x 4.7 m, front toward -z.
 * `xray` makes the body and windows see-through, so the family is visible during a crash.
 */
export function makeSuv(xray = false): Group {
  const g = new Group();
  const paint = xray ? seeThrough(flat(0x2a9d8f), 0.35) : flat(0x2a9d8f);
  const glass = xray ? seeThrough(flat(0x9fd3f0), 0.15) : flat(0x1b2a38);
  const dark = flat(0x222222);
  g.add(mesh(new BoxGeometry(1.9, 0.9, 4.7), paint, 0, 0.75, 0));
  g.add(mesh(new BoxGeometry(1.75, 0.75, 3.0), glass, 0, 1.55, 0.35));
  g.add(mesh(new BoxGeometry(1.8, 0.08, 3.05), paint, 0, 1.95, 0.35));
  if (!xray) g.add(mesh(new BoxGeometry(1.2, 0.4, 1.9), flat(0xe9c46a), 0, 2.2, 0.5)); // roof box (flies off)
  const wheel = new CylinderGeometry(0.42, 0.42, 0.35, 10);
  wheel.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.9, -1.5], [0.9, -1.5], [-0.9, 1.5], [0.9, 1.5]]) g.add(mesh(wheel, dark, x, 0.42, z));
  const lamp = new BoxGeometry(0.45, 0.18, 0.05);
  const tail = new MeshBasicMaterial({ color: 0xff3b3b });
  g.add(mesh(lamp, tail, -0.65, 0.95, 2.36));
  g.add(mesh(lamp, tail, 0.65, 0.95, 2.36));
  return g;
}

const SKIN = 0xf1c27d;
/** Shirt colors and skin for the family; colors for the stuff. */
const RIDER_LOOK: Record<string, number> = {
  dad: 0x3a6ea5, mom: 0xd1495b, kid1: 0xf4b942, kid2: 0x5cc98b, dog: 0x9c6b3c,
  suitcase1: 0x6d597a, suitcase2: 0xe76f51, snack1: 0xff3b3b, snack2: 0xffd23f, snack3: 0x3bb4ff,
};

/**
 * One crash rider (family member, dog, luggage or snack) as a mesh sized to its physics box
 * (half extents `half`, centered on the origin). Returns the group and its head height for stars.
 */
export function makeRider(id: string, half: readonly [number, number, number]): { group: Group; head: number } {
  const g = new Group();
  const [hx, hy, hz] = half;
  const color = RIDER_LOOK[id] ?? 0xcccccc;
  const person = id === 'dad' || id === 'mom' || id.startsWith('kid');
  if (person) {
    // Torso, head, and a little hair; arms stick out to flail.
    const torsoH = hy * 1.2;
    g.add(mesh(new BoxGeometry(hx * 2, torsoH, hz * 2), flat(color), 0, -hy + torsoH / 2, 0));
    const head = Math.min(hx, hy) * 1.25;
    g.add(mesh(new BoxGeometry(head, head, head), flat(SKIN), 0, hy - head / 2, 0));
    g.add(mesh(new BoxGeometry(head * 1.05, head * 0.3, head * 1.05), flat(id === 'mom' ? 0x8a4b2a : 0x3b2a1a), 0, hy - head * 0.1, 0));
    const arm = new BoxGeometry(hx * 1.6, hy * 0.22, hz * 0.8);
    g.add(mesh(arm, flat(SKIN), -hx * 1.5, -hy * 0.1, 0));
    g.add(mesh(arm, flat(SKIN), hx * 1.5, -hy * 0.1, 0));
    return { group: g, head: hy + 0.15 };
  }
  if (id === 'dog') {
    g.add(mesh(new BoxGeometry(hx * 2, hy * 1.4, hz * 1.6), flat(color), 0, -hy * 0.3, hz * 0.2));
    g.add(mesh(new BoxGeometry(hx * 1.7, hy * 1.2, hz * 0.6), flat(color), 0, hy * 0.4, -hz * 0.75));
    g.add(mesh(new BoxGeometry(hx * 0.5, hy * 0.6, hz * 0.2), flat(0x4a3020), -hx * 0.6, hy * 0.95, -hz * 0.7));
    g.add(mesh(new BoxGeometry(hx * 0.5, hy * 0.6, hz * 0.2), flat(0x4a3020), hx * 0.6, hy * 0.95, -hz * 0.7));
    return { group: g, head: hy + 0.3 };
  }
  g.add(mesh(new BoxGeometry(hx * 2, hy * 2, hz * 2), flat(color), 0, 0, 0));
  return { group: g, head: -1 };
}

/** Dizzy cartoon stars that circle a head. */
export function makeStars(): Group {
  const g = new Group();
  const geo = new OctahedronGeometry(0.07);
  const mat = new MeshBasicMaterial({ color: 0xffe14d });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(mesh(geo, mat, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22));
  }
  return g;
}

/** Traffic car body and cabin as separate geometries, so they can be instanced. */
export function trafficGeometries() {
  const body = new BoxGeometry(1.8, 0.8, 4.4);
  body.translate(0, 0.65, 0);
  const cabin = new BoxGeometry(1.6, 0.6, 2.2);
  cabin.translate(0, 1.35, 0.2);
  return { body, cabin };
}

/** Palm tree parts, positioned at the origin so they can be instanced. */
export function palmGeometries() {
  const trunk = new CylinderGeometry(0.18, 0.3, 6, 6);
  trunk.translate(0, 3, 0);
  const fronds = new ConeGeometry(2.6, 1.4, 7);
  fronds.translate(0, 6.3, 0);
  return { trunk, fronds };
}

/** A rough bush for between the palms. */
export function bushGeometry() {
  const b = new ConeGeometry(1.2, 1.4, 6);
  b.translate(0, 0.7, 0);
  return b;
}

export { flat };
