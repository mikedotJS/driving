// Génération du décor par dalles de 100 m : chaussée, trottoirs, bordures granit, caniveaux,
// marquages, immeubles (façades par travées), murs et clôtures, espaces verts.

import * as THREE from 'three';
import type { RoadNet, RawBuilding, RawPoly } from '../map/roadnet';
import type { MaterialLib } from '../render/materials';
import { GeoBuilder } from './geo';
import { buildMarkings, type MarkingSet } from './markings';
import { BAY_W, type FacadeStyle } from './facades';
import { hash32, Rng } from '../core/math';

export const KERB_H = 0.14;
const CM = 0.01;

interface Chunk { group: THREE.Group; ci: number; cj: number }

type RGB = [number, number, number];
const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
// vertex colors : three.js les attend en espace linéaire
const lin = (c: RGB): RGB => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as RGB;
const PALETTES: Record<FacadeStyle, RGB[]> = {
  haussmann: [0xffffff, 0xf7f0e2, 0xf2ead8, 0xfffaf0].map(hex),
  faubourg: [0xffffff, 0xf6efe0, 0xeeeae2, 0xf4e6c8, 0xe9ded0, 0xdfe3e2, 0xf1d9c0].map(hex),
  brique: [0xffffff, 0xf2d9c4, 0xe9c2a8, 0xfff0d0, 0xd9a58c].map(hex),
  pavillon: [0xffffff, 0xf3e3c3, 0xe9d2b0, 0xf0c9a8, 0xd9dccf, 0xe6c3b3, 0xcfd9df, 0xf5edd6].map(hex),
  moderne: [0xffffff, 0xe6e6e2, 0xd9dcdc, 0xf0e8d8].map(hex),
  contemporain: [0xffffff, 0xf2f2f0, 0xe2e4e3].map(hex),
  industriel: [0xffffff, 0xd8dcd9, 0xbfc7cf, 0xcfc4b0, 0x9fb0bf].map(hex),
  public: [0xffffff, 0xf2e2cf, 0xe6d4c0].map(hex),
};
const ROOF_TINT: Record<FacadeStyle, RGB[]> = {
  haussmann: [0x8f979e, 0x9aa2a8].map(hex),
  faubourg: [0x8f979e, 0xa49d92, 0x9aa2a8].map(hex),
  brique: [0x8a857c, 0x9a958c].map(hex),
  pavillon: [0xb0694a, 0xa35d44, 0x8b6f5c, 0x6f7479].map(hex),
  moderne: [0xa8a59c, 0x9c9a94].map(hex),
  contemporain: [0xb2b0a8, 0x8f979e].map(hex),
  industriel: [0x9aa0a3, 0x7f878c, 0xa69f93].map(hex),
  public: [0x9c9a94, 0x8f979e].map(hex),
};

const COMMERCIAL = /^(primary|secondary|tertiary)$/;

export class City {
  readonly group = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private pending: [number, number][] = [];
  private markings: MarkingSet;
  private bBuckets = new Map<string, RawBuilding[]>();
  private barBuckets = new Map<string, { k: string; h: number; p: number[] }[]>();
  private shared = new Set<string>();
  readonly size: number;
  /** nombre de dalles construites */
  built = 0;
  /** compléments de décor ajoutés à chaque dalle (mobilier, voitures garées…) */
  decorators: ((key: string, group: THREE.Group) => void)[] = [];

  constructor(readonly net: RoadNet, readonly mats: MaterialLib) {
    this.size = net.map.chunk;
    this.markings = buildMarkings(net);
    mats.roof.vertexColors = true;
    const C = this.size;
    // répartition des bâtiments par dalle + repérage des murs mitoyens
    const seen = new Map<string, number>();
    for (const b of net.map.buildings) {
      let cx = 0, cz = 0;
      const n = b.p.length / 2;
      for (let i = 0; i < n; i++) { cx += b.p[i * 2]; cz += b.p[i * 2 + 1]; }
      const key = `${Math.floor(cx / n / C)},${Math.floor(cz / n / C)}`;
      let l = this.bBuckets.get(key);
      if (!l) this.bBuckets.set(key, (l = []));
      l.push(b);
      for (let i = 0; i < n; i++) {
        const k = segKey(b.p[i * 2], b.p[i * 2 + 1], b.p[((i + 1) % n) * 2], b.p[((i + 1) % n) * 2 + 1]);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    for (const [k, c] of seen) if (c > 1) this.shared.add(k);
    for (const b of net.map.barriers) {
      const key = `${Math.floor(b.p[0] / C)},${Math.floor(b.p[1] / C)}`;
      let l = this.barBuckets.get(key);
      if (!l) this.barBuckets.set(key, (l = []));
      l.push(b);
    }
  }

  /** Construit immédiatement toutes les dalles dans un rayon donné. */
  ensureAround(x: number, z: number, radius: number) {
    const C = this.size;
    for (let ci = Math.floor((x - radius) / C); ci <= Math.floor((x + radius) / C); ci++) {
      for (let cj = Math.floor((z - radius) / C); cj <= Math.floor((z + radius) / C); cj++) this.buildChunk(ci, cj);
    }
  }

  /** Planifie les dalles proches et en construit quelques-unes (budget en millisecondes). */
  update(x: number, z: number, radius: number, budgetMs = 5) {
    const C = this.size;
    const ci0 = Math.floor(x / C), cj0 = Math.floor(z / C);
    const r = Math.ceil(radius / C);
    if (!this.pending.length) {
      for (let d = 0; d <= r; d++) {
        for (let i = -d; i <= d; i++) for (let j = -d; j <= d; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== d) continue;
          const key = `${ci0 + i},${cj0 + j}`;
          if (!this.chunks.has(key) && this.net.map.chunks[key]) this.pending.push([ci0 + i, cj0 + j]);
        }
      }
    }
    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < budgetMs) {
      const [ci, cj] = this.pending.shift()!;
      this.buildChunk(ci, cj);
    }
    // visibilité selon la distance
    for (const c of this.chunks.values()) {
      const dx = (c.ci + 0.5) * C - x, dz = (c.cj + 0.5) * C - z;
      c.group.visible = dx * dx + dz * dz < (radius + C) * (radius + C);
    }
    return this.pending.length;
  }

  private buildChunk(ci: number, cj: number) {
    const key = `${ci},${cj}`;
    if (this.chunks.has(key)) return;
    const raw = this.net.map.chunks[key];
    const group = new THREE.Group();
    group.name = 'dalle ' + key;
    this.chunks.set(key, { group, ci, cj });
    if (!raw) { this.group.add(group); return; }
    const C = this.size, ox = ci * C, oz = cj * C;
    const m = this.mats;
    const add = (g: GeoBuilder, mat: THREE.Material, cast = false, receive = true) => {
      if (g.empty) return;
      const mesh = new THREE.Mesh(g.build(), mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };

    // ── chaussée et trottoirs ──
    const road = new GeoBuilder(), walk = new GeoBuilder();
    for (const p of raw.r) road.polygon(p.o, p.h, 0, 1 / 3.2, ox, oz, CM);
    for (const p of raw.w) walk.polygon(p.o, p.h, KERB_H, 1 / 2.6, ox, oz, CM);
    add(road, m.road); add(walk, m.sidewalk);

    // ── bordures et caniveaux ──
    const kerb = new GeoBuilder(), gutter = new GeoBuilder();
    const lim = C / CM;
    const ring = (r: number[], isHole: boolean) => {
      const n = r.length / 2;
      let area = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; }
      // côté chaussée : intérieur de l'anneau extérieur, extérieur des trous
      const insideLeft = area > 0;
      const roadLeft = isHole ? !insideLeft : insideLeft;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        // segments artificiels sur le bord de la dalle
        if ((ax <= 1 && bx <= 1) || (ax >= lim - 1 && bx >= lim - 1) || (az <= 1 && bz <= 1) || (az >= lim - 1 && bz >= lim - 1)) continue;
        const x0 = ox + ax * CM, z0 = oz + az * CM, x1 = ox + bx * CM, z1 = oz + bz * CM;
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
        if (l < 0.01) continue;
        // normale unitaire pointant vers la chaussée
        let nx = -dz / l, nz = dx / l;
        if (!roadLeft) { nx = -nx; nz = -nz; }
        const u0 = (x0 + z0) * 0.8, u1 = u0 + l * 0.8;
        // face verticale
        let a = kerb.vertex(x0, 0, z0, nx, 0, nz, u0, 0), b = kerb.vertex(x1, 0, z1, nx, 0, nz, u1, 0);
        let c = kerb.vertex(x1, KERB_H, z1, nx, 0, nz, u1, 0.12), d = kerb.vertex(x0, KERB_H, z0, nx, 0, nz, u0, 0.12);
        orient(kerb, a, b, c, d, nx, 0, nz);
        // dessus en granit (16 cm) côté trottoir
        const w = 0.16, y = KERB_H + 0.003;
        a = kerb.vertex(x0, y, z0, 0, 1, 0, u0, 0.12); b = kerb.vertex(x1, y, z1, 0, 1, 0, u1, 0.12);
        c = kerb.vertex(x1 - nx * w, y, z1 - nz * w, 0, 1, 0, u1, 0.26); d = kerb.vertex(x0 - nx * w, y, z0 - nz * w, 0, 1, 0, u0, 0.26);
        orient(kerb, a, b, c, d, 0, 1, 0);
        // caniveau (28 cm) côté chaussée
        const gw = 0.28, gy = 0.004;
        a = gutter.vertex(x0, gy, z0, 0, 1, 0, u0, 0); b = gutter.vertex(x1, gy, z1, 0, 1, 0, u1, 0);
        c = gutter.vertex(x1 + nx * gw, gy, z1 + nz * gw, 0, 1, 0, u1, 0.3); d = gutter.vertex(x0 + nx * gw, gy, z0 + nz * gw, 0, 1, 0, u0, 0.3);
        orient(gutter, a, b, c, d, 0, 1, 0);
      }
    };
    for (const p of raw.r) { ring(p.o, false); for (const h of p.h) ring(h, true); }
    add(kerb, m.kerb); add(gutter, m.gutter);

    // ── marquages ──
    const mk = this.markings.white.get(key);
    if (mk) add(mk, m.paint);

    // ── espaces verts, places ──
    if (raw.a) {
      const byMat = new Map<THREE.Material, GeoBuilder>();
      let layer = 0;
      for (const a of raw.a as (RawPoly & { k: string })[]) {
        const mat = a.k === 'water' ? m.water : a.k === 'plaza' ? m.plaza : a.k === 'parking' ? m.road : a.k === 'dirt' ? m.dirt : m.grass;
        let g = byMat.get(mat);
        if (!g) byMat.set(mat, (g = new GeoBuilder()));
        g.polygon(a.o, a.h, KERB_H + 0.012 + (layer++ % 4) * 0.002, mat === m.grass ? 1 / 4 : 1 / 3, ox, oz, CM);
      }
      for (const [mat, g] of byMat) add(g, mat);
    }

    // ── bâtiments ──
    const list = this.bBuckets.get(key);
    if (list) {
      const walls = new GeoBuilder(true, 3, 'facade'), roofs = new GeoBuilder(true);
      for (const b of list) this.building(b, walls, roofs);
      add(walls, m.facade, true); add(roofs, m.roof, true);
    }

    // ── murs, clôtures, haies ──
    const bars = this.barBuckets.get(key);
    if (bars) {
      const wall = new GeoBuilder(), fence = new GeoBuilder(), hedge = new GeoBuilder();
      for (const b of bars) {
        const g = b.k === 'hedge' ? hedge : b.k === 'wall' ? wall : fence;
        const t = b.k === 'hedge' ? 0.7 : b.k === 'wall' ? 0.24 : 0.05;
        for (let i = 0; i + 3 < b.p.length; i += 2) boxWall(g, b.p[i], b.p[i + 1], b.p[i + 2], b.p[i + 3], KERB_H, KERB_H + b.h, t);
      }
      add(wall, m.wall, true); add(fence, m.fence, true); add(hedge, m.hedge, true);
    }

    for (const d of this.decorators) d(key, group);
    group.updateMatrixWorld(true);
    this.group.add(group);
    this.built++;
  }

  private pickStyle(b: RawBuilding, rng: Rng): FacadeStyle {
    const r = rng.next();
    if (b.t === 'indus') return 'industriel';
    if (b.t === 'com') return r < 0.5 ? 'contemporain' : 'industriel';
    if (b.t === 'pub') return 'public';
    if (b.t === 'church') return 'haussmann';
    if (b.t === 'house') return 'pavillon';
    if (b.pa) {
      if (b.l >= 5) return r < 0.42 ? 'haussmann' : r < 0.66 ? 'faubourg' : r < 0.86 ? 'brique' : 'moderne';
      return r < 0.7 ? 'faubourg' : 'brique';
    }
    if (b.l <= 2) return r < 0.7 ? 'pavillon' : 'faubourg';
    if (b.l <= 5) return r < 0.5 ? 'faubourg' : r < 0.65 ? 'brique' : r < 0.82 ? 'contemporain' : 'moderne';
    return r < 0.6 ? 'moderne' : 'contemporain';
  }

  private building(b: RawBuilding, g: GeoBuilder, roofs: GeoBuilder) {
    const p = b.p, n = p.length / 2;
    const seed = hash32(`${p[0]}|${p[1]}|${n}`);
    const rng = new Rng(seed);
    const style = this.pickStyle(b, rng);
    const tint = lin(rng.pick(PALETTES[style]));
    const roofTint = lin(rng.pick(ROOF_TINT[style]));
    const F = this.mats.facades;
    const top = KERB_H + b.h;
    const open = b.t === 'roof';

    // toit
    roofs.polygon(p, [], top, 1 / 3, 0, 0, 1, roofTint[0], roofTint[1], roofTint[2]);
    if (open) { roofs.polygon(p, [], top - 0.25, 1 / 3, 0, 0, 1, roofTint[0] * 0.6, roofTint[1] * 0.6, roofTint[2] * 0.6); return; }

    // sens de parcours → normale sortante
    let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
    const sgn = area > 0 ? 1 : -1;

    const groundH = Math.min(b.h, style === 'pavillon' ? 2.9 : style === 'industriel' ? Math.min(b.h, 4.2) : 3.5);
    const upperFloors = Math.max(0, b.l - 1);
    const band = upperFloors > 0 ? Math.min(0.7, (b.h - groundH) * 0.12) : 0;
    const yG = KERB_H + groundH;
    const yU = top - band;
    const upRole = rng.next() < 0.5 ? 'upperA' : 'upperB';
    const lUpper = F.layer(style, upRole), lUpper2 = F.layer(style, upRole === 'upperA' ? 'upperB' : 'upperA');
    const lGround = F.layer(style, 'ground'), lDoor = F.layer(style, 'door'), lPlain = F.layer(style, 'plain');
    const shopBuilding = b.t === 'res' && b.l >= 2 && style !== 'pavillon' && rng.next() < 0.8;
    const shopBase = rng.int(0, 5);

    // mur le plus long donnant sur une rue → porte d'entrée
    interface Wall { i: number; len: number; facing: boolean; commercial: boolean; nx: number; nz: number; party: boolean }
    const wallsInfo: Wall[] = [];
    let doorWall = -1, doorLen = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      const nx = (sgn * dz) / (len || 1), nz = (-sgn * dx) / (len || 1);
      const party = this.shared.has(segKey(x0, z0, x1, z1));
      let facing = false, commercial = false;
      if (!party && len > 1.6) {
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const loc = this.net.locate(mx + nx * 3, mz + nz * 3);
        if (loc && loc.dist < 9) {
          const pt = loc.edge.line.at(loc.s);
          if ((pt.x - mx) * nx + (pt.z - mz) * nz > 0) {
            facing = true;
            commercial = COMMERCIAL.test(loc.edge.cls) || /^Rue (de Paris|du Capitaine Dreyfus|d'Avron|de Bagnolet|des Pyrénées)$/.test(loc.edge.name);
          }
        }
      }
      if (facing && len > doorLen) { doorLen = len; doorWall = i; }
      wallsInfo.push({ i, len, facing, commercial, nx, nz, party });
    }

    for (const w of wallsInfo) {
      const i = w.i, j = (i + 1) % n;
      const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
      if (w.len < 0.05) continue;
      const blind = w.party || w.len < 1.7;
      // teinte légèrement plus sombre pour les pignons aveugles et les façades sur cour
      const k = blind ? 0.86 : w.facing ? 1 : 0.93;
      const r = tint[0] * k, gg = tint[1] * k, bb = tint[2] * k;
      const nb = Math.max(1, Math.round(w.len / BAY_W));
      const q = (xa: number, za: number, xb: number, zb: number, yb: number, yt: number, ua: number, ub: number, vt: number, vb: number, layer: number, s = 1) => {
        const a = g.vertex(xa, yb, za, w.nx, 0, w.nz, ua, vb, r * s, gg * s, bb * s, ua, vb, layer);
        const b2 = g.vertex(xb, yb, zb, w.nx, 0, w.nz, ub, vb, r * s, gg * s, bb * s, ub, vb, layer);
        const c = g.vertex(xb, yt, zb, w.nx, 0, w.nz, ub, vt, r * s, gg * s, bb * s, ub, vt, layer);
        const d = g.vertex(xa, yt, za, w.nx, 0, w.nz, ua, vt, r * s, gg * s, bb * s, ua, vt, layer);
        orient(g, a, b2, c, d, w.nx, 0, w.nz);
      };
      if (blind) {
        // mur aveugle : enduit uni sur toute la hauteur
        q(x0, z0, x1, z1, KERB_H, top, w.len / BAY_W, 0, 0, b.h / 3, lPlain);
        continue;
      }
      // rez-de-chaussée, travée par travée (u décroissant le long du mur : texture non inversée vue de la rue)
      const shop = shopBuilding && w.commercial;
      const doorBay = i === doorWall ? Math.floor(nb / 2) : -1;
      for (let k2 = 0; k2 < nb; k2++) {
        const ta = k2 / nb, tb = (k2 + 1) / nb;
        let layer = lGround;
        if (shop) layer = k2 === doorBay && nb > 2 ? lDoor : F.shop(shopBase + Math.floor(k2 / 2) + i);
        else if (k2 === doorBay) layer = lDoor;
        else if (style === 'pavillon' && (k2 + seed) % 3 !== 0) layer = F.layer(style, 'upperA');
        else if (!w.facing && style !== 'industriel') layer = (k2 + i) % 2 ? lGround : lPlain;
        q(x0 + (x1 - x0) * ta, z0 + (z1 - z0) * ta, x0 + (x1 - x0) * tb, z0 + (z1 - z0) * tb, KERB_H, yG, 1, 0, 0, 1, layer);
      }
      // étages
      if (upperFloors > 0 && yU > yG + 0.5) {
        const lay = (i % 3 === 2 && nb > 1) ? lUpper2 : lUpper;
        q(x0, z0, x1, z1, yG, yU, nb, 0, 0, upperFloors, w.facing || nb > 1 ? lay : lPlain);
        // bandeau de couronnement
        if (band > 0.05) q(x0, z0, x1, z1, yU, top, w.len / BAY_W, 0, 0, band / 3, lPlain, 0.9);
      } else if (top > yG + 0.02) {
        q(x0, z0, x1, z1, yG, top, w.len / BAY_W, 0, 0, (top - yG) / 3, lPlain, 0.95);
      }
    }
  }
}

function segKey(x0: number, z0: number, x1: number, z1: number): string {
  const a = `${Math.round(x0 * 4)},${Math.round(z0 * 4)}`, b = `${Math.round(x1 * 4)},${Math.round(z1 * 4)}`;
  return a < b ? a + '|' + b : b + '|' + a;
}

/** Indexe le quadrilatère a,b,c,d de façon que sa face avant regarde vers (nx,ny,nz). */
function orient(g: GeoBuilder, a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number) {
  const P = g.pos;
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[d * 3] - P[a * 3], vy = P[d * 3 + 1] - P[a * 3 + 1], vz = P[d * 3 + 2] - P[a * 3 + 2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  if (cx * nx + cy * ny + cz * nz >= 0) g.quadIdx(a, b, c, d); else g.quadIdx(a, d, c, b);
}

/** Mur épais (deux faces + dessus) entre deux points. */
function boxWall(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, yb: number, yt: number, t: number) {
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
  if (l < 0.05) return;
  const nx = -dz / l, nz = dx / l, h = t / 2;
  const us = l / 2.5, vs = (yt - yb) / 2.5;
  for (const s of [1, -1]) {
    const ox = nx * h * s, oz = nz * h * s;
    const a = g.vertex(x0 + ox, yb, z0 + oz, nx * s, 0, nz * s, 0, 0), b = g.vertex(x1 + ox, yb, z1 + oz, nx * s, 0, nz * s, us, 0);
    const c = g.vertex(x1 + ox, yt, z1 + oz, nx * s, 0, nz * s, us, vs), d = g.vertex(x0 + ox, yt, z0 + oz, nx * s, 0, nz * s, 0, vs);
    orient(g, a, b, c, d, nx * s, 0, nz * s);
  }
  const a = g.vertex(x0 + nx * h, yt, z0 + nz * h, 0, 1, 0, 0, 0), b = g.vertex(x1 + nx * h, yt, z1 + nz * h, 0, 1, 0, us, 0);
  const c = g.vertex(x1 - nx * h, yt, z1 - nz * h, 0, 1, 0, us, 0.1), d = g.vertex(x0 - nx * h, yt, z0 - nz * h, 0, 1, 0, 0, 0.1);
  orient(g, a, b, c, d, 0, 1, 0);
}
