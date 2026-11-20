// Signalisation horizontale française (instruction interministérielle, 7e partie).
// En agglomération parisienne l'unité de largeur vaut u = 6 cm ; lignes de 2u (12 cm).
//   T1  : 3 m de trait / 10 m de vide      (axe et séparation de voies)
//   T'1 : 1,5 m / 5 m                       (variante urbaine courte)
//   T3  : 3 m / 1,33 m                      (ligne d'avertissement, délimitation de voie bus/vélo en 5u)
//   T'2 : 0,5 m / 0,5 m                     (stationnement en 2u, cédez-le-passage en 50 cm, effet des feux en 15 cm)
//   Stop : ligne continue de 50 cm. Passages piétons : bandes de 50 cm espacées de 50 cm.

import type { Edge, EdgeEnd, RoadNet } from '../map/roadnet';
import type { Polyline } from '../map/polyline';
import { GeoBuilder } from './geo';

export const U = 0.06;
const Y = 0.008; // légèrement au-dessus de l'enrobé
const UV = 0.9;

export interface SolidRange { s0: number; s1: number; off: number }
/** Lignes continues axiales relevées pendant la génération (utilisées par les règles). */
export const solidLines = new WeakMap<Edge, SolidRange[]>();

export class MarkingSet {
  white = new Map<string, GeoBuilder>();
  constructor(private chunk: number) {}
  private bucket(x: number, z: number): GeoBuilder {
    const k = `${Math.floor(x / this.chunk)},${Math.floor(z / this.chunk)}`;
    let g = this.white.get(k);
    if (!g) this.white.set(k, (g = new GeoBuilder()));
    return g;
  }
  /** Quadrilatère au sol défini par ses 4 coins (ordre quelconque cohérent). */
  quad(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
    const g = this.bucket((ax + cx) / 2, (az + cz) / 2);
    const i = g.vertexCount;
    g.vertex(ax, Y, az, 0, 1, 0, ax * UV, az * UV);
    g.vertex(bx, Y, bz, 0, 1, 0, bx * UV, bz * UV);
    g.vertex(cx, Y, cz, 0, 1, 0, cx * UV, cz * UV);
    g.vertex(dx, Y, dz, 0, 1, 0, dx * UV, dz * UV);
    // orientation vers le haut
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny >= 0) g.quadIdx(i, i + 1, i + 2, i + 3); else g.quadIdx(i, i + 3, i + 2, i + 1);
  }
  /** Ruban le long d'une polyligne entre s0 et s1, décalé de `off`, de largeur `w`. */
  strip(L: Polyline, off: number, s0: number, s1: number, w: number) {
    if (s1 - s0 < 0.02) return;
    const n = Math.max(1, Math.ceil((s1 - s0) / 2.5));
    const p = { x: 0, z: 0, tx: 1, tz: 0 };
    let plx = 0, plz = 0, prx = 0, prz = 0;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      L.at(s, p);
      const nx = -p.tz, nz = p.tx;
      const lx = p.x + nx * (off - w / 2), lz = p.z + nz * (off - w / 2);
      const rx = p.x + nx * (off + w / 2), rz = p.z + nz * (off + w / 2);
      if (i > 0) this.quad(plx, plz, prx, prz, rx, rz, lx, lz);
      plx = lx; plz = lz; prx = rx; prz = rz;
    }
  }
  /** Ligne discontinue (trait/vide) en évitant les intervalles `gaps`. */
  dashed(L: Polyline, off: number, s0: number, s1: number, w: number, dash: number, gap: number, gaps: [number, number][] = []) {
    const period = dash + gap;
    // on centre le motif
    const count = Math.floor((s1 - s0 + gap) / period);
    if (count < 1) return;
    const start = s0 + (s1 - s0 - (count * period - gap)) / 2;
    for (let i = 0; i < count; i++) {
      const a = start + i * period, b = a + dash;
      if (gaps.some((g) => a < g[1] && b > g[0])) continue;
      this.strip(L, off, a, b, w);
    }
  }
  solid(L: Polyline, off: number, s0: number, s1: number, w: number, gaps: [number, number][] = []) {
    let a = s0;
    const sorted = gaps.filter((g) => g[1] > s0 && g[0] < s1).sort((p, q) => p[0] - q[0]);
    for (const g of sorted) {
      if (g[0] > a) this.strip(L, off, a, Math.min(g[0], s1), w);
      a = Math.max(a, g[1]);
    }
    if (a < s1) this.strip(L, off, a, s1, w);
  }
  /** Bande transversale (ligne d'arrêt…) : de off0 à off1, épaisseur `thick` à partir de s (vers s+thick). */
  across(L: Polyline, s: number, thick: number, off0: number, off1: number, dash = 0, gap = 0) {
    const p = L.at(s);
    const q = L.at(s + thick);
    const seg = (a: number, b: number) => {
      this.quad(
        p.x - p.tz * a, p.z + p.tx * a, p.x - p.tz * b, p.z + p.tx * b,
        q.x - q.tz * b, q.z + q.tx * b, q.x - q.tz * a, q.z + q.tx * a,
      );
    };
    if (!dash) { seg(off0, off1); return; }
    const period = dash + gap;
    const n = Math.max(1, Math.floor((off1 - off0 + gap) / period));
    const start = off0 + (off1 - off0 - (n * period - gap)) / 2;
    for (let i = 0; i < n; i++) seg(start + i * period, start + i * period + dash);
  }
}

/** Étendue latérale des voies qui arrivent sur une extrémité (hors stationnement). */
export function arrivingSpan(end: EdgeEnd): [number, number] | null {
  const dir = end.atA ? -1 : 1;
  let lo = Infinity, hi = -Infinity;
  for (const s of end.edge.strips) {
    if (s.kind === 'P' || s.dir !== dir) continue;
    lo = Math.min(lo, s.off - s.w / 2); hi = Math.max(hi, s.off + s.w / 2);
  }
  return lo < hi ? [lo, hi] : null;
}

export function buildMarkings(net: RoadNet): MarkingSet {
  const set = new MarkingSet(net.map.chunk);
  for (const e of net.edges) {
    const L = e.line;
    const len = L.length;
    const A = e.endA, B = e.endB;
    // étendue longitudinale des lignes : entre les lignes d'arrêt (ou les embouchures)
    const sA = (A.canArrive ? Math.max(A.stopDist, A.trim) : A.trim) + 0.3;
    const sB = len - (B.canArrive ? Math.max(B.stopDist, B.trim) : B.trim) - 0.3;
    const gaps: [number, number][] = e.crossings.map((c) => [c.s - c.halfLen - 0.4, c.s + c.halfLen + 0.4]);
    const solids: SolidRange[] = [];

    if (sB - sA > 3 && !e.roundabout) {
      const travelW = e.strips.filter((s) => s.kind !== 'P').reduce((s, x) => s + x.w, 0);
      const minor = e.cls === 'residential' || e.cls === 'living_street' || e.cls === 'service' || e.cls === 'unclassified';
      for (let i = 0; i < e.strips.length - 1; i++) {
        const a = e.strips[i], b = e.strips[i + 1];
        const off = a.off + a.w / 2;
        const pair = a.kind + b.kind;
        if (a.kind === 'P' || b.kind === 'P') {
          // limite de stationnement
          set.dashed(L, off, sA + 4, sB - 4, 2 * U, 0.5, 0.5, gaps);
        } else if (a.kind === 'L' && b.kind === 'L') {
          if (a.dir !== b.dir) {
            // axe de la chaussée
            if (minor && travelW < 5.4) continue;
            const multi = e.lanesF.length > 1 || e.lanesB.length > 1;
            if (multi) { set.solid(L, off, sA, sB, 2 * U, gaps); solids.push({ s0: sA, s1: sB, off }); }
            else {
              // continue à l'approche des carrefours réglementés, discontinue ailleurs
              const ca = A.control !== 'none' ? Math.min(14, (sB - sA) * 0.3) : 0;
              const cb = B.control !== 'none' ? Math.min(14, (sB - sA) * 0.3) : 0;
              if (ca > 3) { set.solid(L, off, sA, sA + ca, 2 * U, gaps); solids.push({ s0: sA, s1: sA + ca, off }); }
              if (cb > 3) { set.solid(L, off, sB - cb, sB, 2 * U, gaps); solids.push({ s0: sB - cb, s1: sB, off }); }
              if (e.limit >= 50) set.dashed(L, off, sA + ca + 1, sB - cb - 1, 2 * U, 3, 10, gaps);
              else set.dashed(L, off, sA + ca + 1, sB - cb - 1, 2 * U, 1.5, 5, gaps);
            }
          } else {
            // séparation de voies de même sens : T1, puis T3 à l'approche du carrefour
            const end = a.dir > 0 ? sB : sA;
            const warn = Math.min(20, (sB - sA) * 0.35);
            if (a.dir > 0) {
              set.dashed(L, off, sA, end - warn, 2 * U, 3, 10, gaps);
              set.dashed(L, off, end - warn, end, 2 * U, 3, 1.33, gaps);
            } else {
              set.dashed(L, off, sA + warn, sB, 2 * U, 3, 10, gaps);
              set.dashed(L, off, sA, sA + warn, 2 * U, 3, 1.33, gaps);
            }
          }
        } else if (pair.includes('B')) {
          // voie de bus : ligne large (5u), continue si à contresens
          if (a.dir !== b.dir) { set.solid(L, off, sA, sB, 5 * U, gaps); solids.push({ s0: sA, s1: sB, off }); }
          else set.dashed(L, off, sA, sB, 5 * U, 3, 1.33, gaps);
        } else if (pair.includes('C')) {
          // bande cyclable
          set.dashed(L, off, sA, sB, 5 * U * 0.8, 3, 1.33, gaps);
        }
      }
    } else if (e.roundabout && e.lanesF.length > 1) {
      for (let i = 0; i < e.strips.length - 1; i++) {
        const a = e.strips[i], b = e.strips[i + 1];
        if (a.kind === 'L' && b.kind === 'L') set.dashed(L, a.off + a.w / 2, 0, len, 2 * U, 1.5, 3.5, gaps);
      }
    }
    if (solids.length) solidLines.set(e, solids);

    // lignes transversales : stop, cédez-le-passage, effet des feux
    for (const end of [A, B]) {
      if (!end.canArrive || end.control === 'none') continue;
      const span = arrivingSpan(end);
      if (!span) continue;
      // la ligne se trouve juste après le point d'arrêt, côté carrefour
      const thick = end.control === 'signal' ? 0.15 : 0.5;
      const sLine = end.atA ? end.stopDist - thick : len - end.stopDist;
      if (sLine < 0 || sLine > len) continue;
      if (end.control === 'stop') set.across(L, sLine, thick, span[0] + 0.1, span[1] - 0.1);
      else set.across(L, sLine, thick, span[0] + 0.1, span[1] - 0.1, 0.5, 0.5);
    }
    // feux en section courante
    for (const lane of e.allLanes) {
      for (const st of lane.stops) {
        if (st.kind !== 'signal' || st.atEnd) continue;
        const es = lane.toEdgeS(st.s);
        const sLine = lane.dir > 0 ? es : es - 0.15;
        set.across(L, sLine, 0.15, lane.off - lane.width / 2 + 0.1, lane.off + lane.width / 2 - 0.1, 0.5, 0.5);
      }
    }

    // passages piétons : bandes de 50 cm parallèles à l'axe
    for (const c of e.crossings) {
      const s0 = c.s - c.halfLen, s1 = c.s + c.halfLen;
      if (s0 < 0.2 || s1 > len - 0.2) continue;
      const half = e.half - 0.2;
      const n = Math.max(2, Math.floor((2 * half + 0.5) / 1.0));
      const start = -((n * 1.0 - 0.5) / 2);
      for (let i = 0; i < n; i++) set.strip(L, start + i * 1.0 + 0.25, s0, s1, 0.5);
    }
  }
  return set;
}
