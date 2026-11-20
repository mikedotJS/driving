// Requêtes de terrain pour la physique et les règles : chaussée ou trottoir sous un point,
// obstacles fixes (murs des bâtiments, clôtures) pour les collisions.

import type { MapFile, RawPoly } from '../map/roadnet';

export const KERB_HEIGHT = 0.14;

function inRing(r: number[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export interface Segment { x0: number; z0: number; x1: number; z1: number; kind: 'building' | 'wall' | 'fence' | 'hedge' }

export class Ground {
  private chunk: number;
  private segGrid = new Map<number, Segment[]>();
  private cell = 16;

  constructor(private map: MapFile) {
    this.chunk = map.chunk;
    for (const b of map.buildings) {
      if (b.t === 'roof') continue;
      const n = b.p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.addSeg({ x0: b.p[i * 2], z0: b.p[i * 2 + 1], x1: b.p[j * 2], z1: b.p[j * 2 + 1], kind: 'building' });
      }
    }
    for (const b of map.barriers) {
      const kind = b.k === 'wall' ? 'wall' : b.k === 'hedge' ? 'hedge' : 'fence';
      for (let i = 0; i + 3 < b.p.length; i += 2) this.addSeg({ x0: b.p[i], z0: b.p[i + 1], x1: b.p[i + 2], z1: b.p[i + 3], kind });
    }
  }

  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }
  private addSeg(s: Segment) {
    const c = this.cell;
    const i0 = Math.floor(Math.min(s.x0, s.x1) / c), i1 = Math.floor(Math.max(s.x0, s.x1) / c);
    const j0 = Math.floor(Math.min(s.z0, s.z1) / c), j1 = Math.floor(Math.max(s.z0, s.z1) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let a = this.segGrid.get(k);
      if (!a) this.segGrid.set(k, (a = []));
      a.push(s);
    }
  }

  /** Le point est-il sur la chaussée ? */
  isRoad(x: number, z: number): boolean {
    const C = this.chunk;
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    const ck = this.map.chunks[`${ci},${cj}`];
    if (!ck) return false;
    const lx = (x - ci * C) * 100, lz = (z - cj * C) * 100;
    for (const p of ck.r as RawPoly[]) {
      if (!inRing(p.o, lx, lz)) continue;
      let hole = false;
      for (const h of p.h) if (inRing(h, lx, lz)) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }

  /** Hauteur du sol : 0 sur la chaussée, hauteur de bordure ailleurs. */
  height(x: number, z: number): number { return this.isRoad(x, z) ? 0 : KERB_HEIGHT; }

  /** Obstacles fixes dont la boîte englobante touche le disque (x, z, r). */
  segmentsNear(x: number, z: number, r: number, out: Segment[] = []): Segment[] {
    out.length = 0;
    const c = this.cell;
    const seen = new Set<Segment>();
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const a = this.segGrid.get(this.key(i, j));
        if (!a) continue;
        for (const s of a) if (!seen.has(s)) { seen.add(s); out.push(s); }
      }
    }
    return out;
  }
}

/**
 * Collision d'un rectangle orienté (voiture) avec un segment.
 * Renvoie la pénétration et la normale (du segment vers la voiture), ou null.
 */
export function boxVsSegment(
  cx: number, cz: number, fx: number, fz: number, halfLen: number, halfWid: number, centerShift: number,
  s: Segment,
): { nx: number; nz: number; depth: number; px: number; pz: number } | null {
  // repère du rectangle : origine au centre géométrique, axe u = avant, v = droite
  const ox = cx + fx * centerShift, oz = cz + fz * centerShift;
  const rx = -fz, rz = fx;
  const ax = (s.x0 - ox) * fx + (s.z0 - oz) * fz, ay = (s.x0 - ox) * rx + (s.z0 - oz) * rz;
  const bx = (s.x1 - ox) * fx + (s.z1 - oz) * fz, by = (s.x1 - ox) * rx + (s.z1 - oz) * rz;
  // découpe du segment par le rectangle (Liang-Barsky)
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!(clip(-dx, ax + halfLen) && clip(dx, halfLen - ax) && clip(-dy, ay + halfWid) && clip(dy, halfWid - ay))) return null;
  if (t0 > t1) return null;
  // point milieu de la portion à l'intérieur
  const tm = (t0 + t1) / 2;
  const mx = ax + dx * tm, my = ay + dy * tm;
  // direction de sortie la plus courte, perpendiculaire au segment
  const sl = Math.hypot(dx, dy) || 1;
  let nx = -dy / sl, ny = dx / sl; // normale du segment (repère rectangle)
  // on pousse le rectangle du côté où se trouve son centre
  const side = -(ax * nx + ay * ny); // distance signée du centre (0,0) à la droite
  if (side < 0) { nx = -nx; ny = -ny; }
  // pénétration : étendue du rectangle projetée sur la normale, moins la distance du centre
  const ext = Math.abs(nx) * halfLen + Math.abs(ny) * halfWid;
  const depth = ext - Math.abs(side);
  if (depth <= 0) return null;
  // retour au repère monde
  return {
    nx: nx * fx + ny * rx, nz: nx * fz + ny * rz, depth: Math.min(depth, 1.2),
    px: ox + mx * fx + my * rx, pz: oz + mx * fz + my * rz,
  };
}
