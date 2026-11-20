#!/usr/bin/env node
// Rendu 2D de contrôle de la carte : node tools/render-map.mjs <cx> <cz> <taille_m> <sortie.png> [px]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url)));
const [cx, cz, size, outFile, pxArg] = [parseFloat(process.argv[2] ?? '0'), parseFloat(process.argv[3] ?? '0'), parseFloat(process.argv[4] ?? '600'), process.argv[5] ?? 'map.png', parseInt(process.argv[6] ?? '1600')];
const x0 = cx - size / 2, z0 = cz - size / 2;
const px = pxArg, k = px / size;
const X = (x) => ((x - x0) * k).toFixed(1), Z = (z) => ((z - z0) * k).toFixed(1);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"><rect width="100%" height="100%" fill="#cfcabd"/>`;
const C = map.chunk;
const ringPath = (r, ox, oz, s = 0.01) => { let d = ''; for (let i = 0; i < r.length; i += 2) d += (i ? 'L' : 'M') + X(ox + r[i] * s) + ' ' + Z(oz + r[i + 1] * s); return d + 'Z'; };
// espaces
const AREA = { park: '#9fc48a', grass: '#b5d29c', wood: '#86b178', pitch: '#8fc7a0', water: '#9cc4e4', cemetery: '#b9c9a8', parking: '#bdbdbd', plaza: '#ddd6c6', dirt: '#c9b698' };
for (const key of Object.keys(map.chunks)) {
  const [ci, cj] = key.split(',').map(Number);
  const ox = ci * C, oz = cj * C;
  if (ox + C < x0 || oz + C < z0 || ox > x0 + size || oz > z0 + size) continue;
  for (const a of map.chunks[key].a ?? []) svg += `<path d="${ringPath(a.o, ox, oz)}${(a.h ?? []).map((h) => ringPath(h, ox, oz)).join('')}" fill="${AREA[a.k] ?? '#ccc'}" fill-rule="evenodd"/>`;
}
for (const key of Object.keys(map.chunks)) {
  const [ci, cj] = key.split(',').map(Number);
  const ox = ci * C, oz = cj * C;
  if (ox + C < x0 || oz + C < z0 || ox > x0 + size || oz > z0 + size) continue;
  for (const p of map.chunks[key].r) svg += `<path d="${ringPath(p.o, ox, oz)}${p.h.map((h) => ringPath(h, ox, oz)).join('')}" fill="#5b5d63" fill-rule="evenodd"/>`;
}
for (const b of map.buildings) svg += `<path d="${ringPath(b.p, 0, 0, 1)}" fill="${b.pa ? '#e9dcc5' : '#e3cfc0'}" stroke="#9c8b7b" stroke-width="0.6"/>`;
for (const b of map.barriers) { let d = ''; for (let i = 0; i < b.p.length; i += 2) d += (i ? 'L' : 'M') + X(b.p[i]) + ' ' + Z(b.p[i + 1]); svg += `<path d="${d}" fill="none" stroke="${b.k === 'hedge' ? '#5d8a4b' : '#7b6b5b'}" stroke-width="1"/>`; }
// arêtes : voies
const COL = { L: '#ffffff', B: '#ffcf4d', C: '#57c26b', P: '#8fb7ff' };
for (const e of map.edges) {
  const pts = []; for (let i = 0; i < e.p.length; i += 2) pts.push([e.p[i], e.p[i + 1]]);
  const W = e.st.reduce((s, x) => s + x[1], 0);
  let off = -W / 2;
  for (const st of e.st) {
    const c = off + st[1] / 2; off += st[1];
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
      d += (i ? 'L' : 'M') + X(pts[i][0] - tz * c) + ' ' + Z(pts[i][1] + tx * c);
    }
    svg += `<path d="${d}" fill="none" stroke="${COL[st[0]]}" stroke-opacity="${st[0] === 'L' ? 0.25 : 0.55}" stroke-width="${Math.max(1, st[1] * k * 0.8).toFixed(1)}" ${st[2] < 0 ? 'stroke-dasharray="6 3"' : ''}/>`;
  }
  // axe + sens
  let d = ''; pts.forEach((p, i) => { d += (i ? 'L' : 'M') + X(p[0]) + ' ' + Z(p[1]); });
  svg += `<path d="${d}" fill="none" stroke="${e.ow ? '#ff5d5d' : '#ffe14d'}" stroke-width="0.8"/>`;
  for (const f of e.f ?? []) {
    let acc = 0, pos = pts[0];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (f.s <= acc + l) { const t = (f.s - acc) / l; pos = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; break; } acc += l; }
    const col = f.k === 'sig' ? '#ff2a2a' : f.k === 'stop' ? '#b3002d' : f.k === 'yield' ? '#ff9d00' : f.k === 'x' ? (f.sig ? '#ff7ad1' : '#ffffff') : '#00e0ff';
    svg += `<circle cx="${X(pos[0])}" cy="${Z(pos[1])}" r="${f.k === 'x' ? 2.5 : 4}" fill="${col}" stroke="#000" stroke-width="0.5"/>`;
  }
  if (size <= 700 && e.n) {
    const m = pts[Math.floor(pts.length / 2)];
    svg += `<text x="${X(m[0])}" y="${Z(m[1])}" font-size="9" fill="#113" font-family="sans-serif">${e.n.replace(/&/g, '&amp;')} ${e.ms || ''}</text>`;
  }
}
map.vertices.forEach((v) => { if (v.sig || v.exit || v.dead) svg += `<circle cx="${X(v.x)}" cy="${Z(v.z)}" r="5" fill="none" stroke="${v.sig ? '#ff2a2a' : v.exit ? '#00c' : '#444'}" stroke-width="2"/>`; });
for (const t of map.trees) svg += `<circle cx="${X(t[0])}" cy="${Z(t[1])}" r="${Math.max(1.2, 2.2 * k).toFixed(1)}" fill="#2f7d32" fill-opacity="0.7"/>`;
svg += '</svg>';
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: px, height: px } });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.screenshot({ path: outFile });
await browser.close();
console.log('écrit', outFile);
