// The route strip: the whole trip drawn as a small line map, with a dot for the car.
// Pure geometry from the baked overview line ([lat, lon] points); main.ts turns it into SVG.

export interface Strip {
  width: number;
  height: number;
  /** SVG path data for the whole route. */
  path: string;
  /** Point on the strip at a route mile. */
  at(mile: number): [number, number];
  /** Share of the drawn line's length up to a route mile (for drawing the part already driven). */
  drawnShare(mile: number): number;
}

const R_MILES = 3958.8;
const RAD = Math.PI / 180;

function haversine(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(h));
}

/** Fit the route into a width x height box (keeping its shape) with `pad` around it. */
export function buildStrip(overview: readonly (readonly [number, number])[], totalMiles: number, width: number, height: number, pad = 8): Strip {
  const lats = overview.map((p) => p[0]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos(midLat * RAD);
  const raw = overview.map(([lat, lon]) => [lon * k, -lat] as [number, number]);
  const minX = Math.min(...raw.map((p) => p[0])), maxX = Math.max(...raw.map((p) => p[0]));
  const minY = Math.min(...raw.map((p) => p[1])), maxY = Math.max(...raw.map((p) => p[1]));
  const scale = Math.min((width - 2 * pad) / (maxX - minX || 1), (height - 2 * pad) / (maxY - minY || 1));
  const ox = (width - (maxX - minX) * scale) / 2, oy = (height - (maxY - minY) * scale) / 2;
  const pts = raw.map(([x, y]) => [ox + (x - minX) * scale, oy + (y - minY) * scale] as [number, number]);

  // Route miles along the overview (scaled so the line's end is the trip's end), and drawn length.
  const miles = [0], drawn = [0];
  for (let i = 1; i < overview.length; i++) {
    miles.push(miles[i - 1] + haversine(overview[i - 1], overview[i]));
    drawn.push(drawn[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const toTrip = totalMiles / miles[miles.length - 1];
  for (let i = 0; i < miles.length; i++) miles[i] *= toTrip;

  function locate(mile: number): [number, number] {
    const m = Math.min(Math.max(mile, 0), totalMiles);
    let i = 1;
    while (i < miles.length - 1 && miles[i] < m) i++;
    const t = (m - miles[i - 1]) / (miles[i] - miles[i - 1] || 1);
    return [i, Math.min(1, Math.max(0, t))];
  }

  return {
    width,
    height,
    path: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(''),
    at(mile) {
      const [i, t] = locate(mile);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    },
    drawnShare(mile) {
      const [i, t] = locate(mile);
      return (drawn[i - 1] + (drawn[i] - drawn[i - 1]) * t) / drawn[drawn.length - 1];
    },
  };
}
