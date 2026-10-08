// Generates public/shared/worldmap.js: a world-map land path warped to the stylised board.
// 1. Fit an affine lon/lat -> board transform over all 48 cities.
// 2. Bend it with a thin-plate spline through the residuals so every city sits exactly on its
//    real location on the map (this enlarges Europe etc., much like the physical board).
// Usage: node tools/build-worldmap.js
const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');
const D = require('../public/shared/data');

const RES = process.env.RES || '50m';
const MIN_STEP = 1.4; // px: drop points closer than this
const topo = require(`world-atlas/land-${RES}.json`);
const land = topojson.feature(topo, topo.objects.land);

const cities = Object.values(D.CITIES);

// Least squares for x = a*lon + b*lat + c (and same for y)
function fit(target) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  cities.forEach(c => {
    const r = [c.lon, c.lat, 1];
    for (let i = 0; i < 3; i++) { v[i] += r[i] * c[target]; for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; }
  });
  // Gaussian elimination
  for (let i = 0; i < 3; i++) {
    const p = M[i][i];
    for (let j = i + 1; j < 3; j++) {
      const f = M[j][i] / p;
      for (let k = i; k < 3; k++) M[j][k] -= f * M[i][k];
      v[j] -= f * v[i];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = v[i];
    for (let k = i + 1; k < 3; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x;
}
const ax = fit('x'), ay = fit('y');
const affine = (lon, lat) => [ax[0] * lon + ax[1] * lat + ax[2], ay[0] * lon + ay[1] * lat + ay[2]];
const anchors = cities.map(c => { const [x, y] = affine(c.lon, c.lat); return { x, y, dx: c.x - x, dy: c.y - y }; });
const resid = anchors.map(a => Math.hypot(a.dx, a.dy));
console.log(`affine fit: mean residual ${(resid.reduce((t, r) => t + r, 0) / resid.length).toFixed(1)}px, max ${Math.max(...resid).toFixed(1)}px`);

// Thin-plate spline on the residuals: smooth, and exact at every city.
const U = (r2) => (r2 === 0 ? 0 : r2 * Math.log(r2) / 2); // r^2 log r
function solve(A, b) {
  const n = b.length;
  A = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
    [A[i], A[piv]] = [A[piv], A[i]];
    for (let j = i + 1; j < n; j++) {
      const f = A[j][i] / A[i][i];
      for (let k = i; k <= n; k++) A[j][k] -= f * A[i][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n];
    for (let k = i + 1; k < n; k++) s -= A[i][k] * x[k];
    x[i] = s / A[i][i];
  }
  return x;
}
const n = anchors.length;
const LAMBDA = Number(process.env.LAMBDA || 0);
const L = [];
for (let i = 0; i < n + 3; i++) L.push(new Array(n + 3).fill(0));
anchors.forEach((a, i) => {
  anchors.forEach((b, j) => { L[i][j] = U((a.x - b.x) ** 2 + (a.y - b.y) ** 2) + (i === j ? LAMBDA : 0); });
  [1, a.x, a.y].forEach((v, k) => { L[i][n + k] = v; L[n + k][i] = v; });
});
const wx = solve(L, [...anchors.map(a => a.dx), 0, 0, 0]);
const wy = solve(L, [...anchors.map(a => a.dy), 0, 0, 0]);
function tps(w, x, y) {
  let s = w[n] + w[n + 1] * x + w[n + 2] * y;
  for (let i = 0; i < n; i++) s += w[i] * U((x - anchors[i].x) ** 2 + (y - anchors[i].y) ** 2);
  return s;
}
function warp(lon, lat) {
  const [x, y] = affine(lon, lat);
  return [x + tps(wx, x, y), y + tps(wy, x, y)];
}
const worst = Math.max(...cities.map(c => { const [x, y] = warp(c.lon, c.lat); return Math.hypot(x - c.x, y - c.y); }));
console.log(`spline error at cities: ${worst.toFixed(3)}px`);

// Keep rings continuous across the antimeridian (e.g. eastern Russia) instead of drawing lines across the map.
function unwrap(ring) {
  const out = [ring[0].slice()];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (prev - lon > 180) lon += 360;
    out.push([lon, ring[i][1]]);
  }
  // Shift the whole ring so most of it lies within [-180, 180].
  const mean = out.reduce((s, p) => s + p[0], 0) / out.length;
  const k = Math.round(mean / 360) * 360;
  return k ? out.map(([lon, lat]) => [lon - k, lat]) : out;
}

let d = '';
let points = 0;
const geoms = land.type === 'FeatureCollection' ? land.features.map(f => f.geometry) : [land.geometry];
const polys = geoms.flatMap(g => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]));
for (const poly of polys) {
  for (const ring of poly) {
    if (ring.every(([, lat]) => lat < -58)) continue; // skip Antarctica
    const pts = [];
    for (const [lon, lat] of unwrap(ring)) {
      const p = warp(lon, lat);
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_STEP) pts.push(p);
    }
    if (pts.length < 3) continue;
    points += pts.length;
    d += 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
  }
}
const out = `// Generated by tools/build-worldmap.js from Natural Earth (via world-atlas, public domain). Do not edit.
(typeof self !== 'undefined' ? self : this).WORLD_LAND = ${JSON.stringify(d)};
`;
const file = path.join(__dirname, '../public/shared/worldmap.js');
fs.writeFileSync(file, out);
console.log(`wrote ${file}: ${points} points, ${(out.length / 1024).toFixed(0)} KB`);
