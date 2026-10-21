// Low-poly, flat-shaded models built from code (no downloads).
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, MeshBasicMaterial,
  type BufferGeometry, type Material,
} from 'three';

const flat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

function mesh(geo: BufferGeometry, mat: Material, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** The family SUV: boxy, teal, roof box on top. About 1.9 x 1.8 x 4.7 m, front toward -z. */
export function makeSuv(): Group {
  const g = new Group();
  const paint = flat(0x2a9d8f);
  const glass = flat(0x1b2a38);
  const dark = flat(0x222222);
  g.add(mesh(new BoxGeometry(1.9, 0.9, 4.7), paint, 0, 0.75, 0));
  g.add(mesh(new BoxGeometry(1.75, 0.75, 3.0), glass, 0, 1.55, 0.35));
  g.add(mesh(new BoxGeometry(1.8, 0.08, 3.05), paint, 0, 1.95, 0.35));
  g.add(mesh(new BoxGeometry(1.2, 0.4, 1.9), flat(0xe9c46a), 0, 2.2, 0.5)); // roof box
  const wheel = new CylinderGeometry(0.42, 0.42, 0.35, 10);
  wheel.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.9, -1.5], [0.9, -1.5], [-0.9, 1.5], [0.9, 1.5]]) g.add(mesh(wheel, dark, x, 0.42, z));
  const lamp = new BoxGeometry(0.45, 0.18, 0.05);
  const tail = new MeshBasicMaterial({ color: 0xff3b3b });
  g.add(mesh(lamp, tail, -0.65, 0.95, 2.36));
  g.add(mesh(lamp, tail, 0.65, 0.95, 2.36));
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
