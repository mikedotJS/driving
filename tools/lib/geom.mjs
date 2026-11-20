// Petits utilitaires géométriques 2D (plan x,z en mètres) pour le constructeur de carte.

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polyLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Aire signée (formule du lacet) d'un anneau [[x,z],...] */
export function ringArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ringCentroid(pts) {
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  return [cx / pts.length, cz / pts.length];
}

/** Douglas-Peucker sur polyligne ouverte. */
export function simplifyDP(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const pa = pts[a], pb = pts[b];
    const dx = pb[0] - pa[0], dz = pb[1] - pa[1];
    const l2 = dx * dx + dz * dz;
    let best = -1, bestD = eps * eps;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i];
      let t = l2 > 0 ? ((p[0] - pa[0]) * dx + (p[1] - pa[1]) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = pa[0] + t * dx - p[0], ez = pa[1] + t * dz - p[1];
      const d2 = ex * ex + ez * ez;
      if (d2 > bestD) { bestD = d2; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplification d'un anneau fermé (sans répétition du premier point). */
export function simplifyRing(pts, eps) {
  if (pts.length < 5) return pts.slice();
  // on ouvre l'anneau au point le plus éloigné du centroïde pour stabiliser
  const c = ringCentroid(pts);
  let k = 0, best = -1;
  pts.forEach((p, i) => { const d = dist(p, c); if (d > best) { best = d; k = i; } });
  const open = [...pts.slice(k), ...pts.slice(0, k), pts[k]];
  const s = simplifyDP(open, eps);
  s.pop();
  return s.length >= 3 ? s : pts.slice();
}

/**
 * Arrondit les sommets intérieurs d'une polyligne par des arcs (Bézier quadratiques),
 * sans jamais dépasser le tracé d'origine. dcap = longueur max de tangente.
 */
export function roundCorners(pts, dcap = 8) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const l1 = dist(p0, p1), l2 = dist(p1, p2);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u1 = [(p1[0] - p0[0]) / l1, (p1[1] - p0[1]) / l1];
    const u2 = [(p2[0] - p1[0]) / l2, (p2[1] - p1[1]) / l2];
    const dot = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
    const ang = Math.acos(dot);
    if (ang < 0.035) { out.push(p1); continue; } // < 2°
    // aux extrémités de la polyligne on peut utiliser tout le segment, sinon la moitié
    const f1 = i === 1 ? 0.9 : 0.48, f2 = i === pts.length - 2 ? 0.9 : 0.48;
    const d = Math.min(dcap, l1 * f1, l2 * f2);
    const a = [p1[0] - u1[0] * d, p1[1] - u1[1] * d];
    const b = [p1[0] + u2[0] * d, p1[1] + u2[1] * d];
    const n = Math.max(2, Math.ceil(ang / 0.1));
    for (let k = 0; k <= n; k++) {
      const t = k / n, s = 1 - t;
      out.push([
        s * s * a[0] + 2 * s * t * p1[0] + t * t * b[0],
        s * s * a[1] + 2 * s * t * p1[1] + t * t * b[1],
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  // supprime les points quasi confondus
  const res = [out[0]];
  for (let i = 1; i < out.length; i++) if (dist(out[i], res[res.length - 1]) > 0.05) res.push(out[i]);
  if (res.length < 2) res.push(out[out.length - 1]);
  return res;
}

/** Projection d'un point sur une polyligne : abscisse curviligne s, distance d, côté (+1 = à droite du sens de parcours). */
export function projectOnPolyline(pts, p) {
  let best = { s: 0, d: Infinity, i: 0, t: 0, x: pts[0][0], z: pts[0][1], side: 0 };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    const l = Math.sqrt(l2);
    let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx, z = a[1] + t * dz;
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best.d) {
      const cross = dx * (p[1] - a[1]) - dz * (p[0] - a[0]);
      best = { s: acc + t * l, d, i: i - 1, t, x, z, side: Math.sign(cross) };
    }
    acc += l;
  }
  return best;
}

/** Point et tangente à l'abscisse s d'une polyligne. */
export function pointAt(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = dist(a, b);
    if (s <= acc + l || i === pts.length - 1) {
      const t = l > 0 ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: l > 0 ? (b[0] - a[0]) / l : 1, tz: l > 0 ? (b[1] - a[1]) / l : 0 };
    }
    acc += l;
  }
  const a = pts[0];
  return { x: a[0], z: a[1], tx: 1, tz: 0 };
}

/** Grille spatiale de segments pour les requêtes de dégagement latéral. */
export class SegGrid {
  constructor(cell = 20) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i * 100003 + j; }
  add(x1, z1, x2, z2, tag = 0) {
    const c = this.cell;
    const i0 = Math.floor(Math.min(x1, x2) / c), i1 = Math.floor(Math.max(x1, x2) / c);
    const j0 = Math.floor(Math.min(z1, z2) / c), j1 = Math.floor(Math.max(z1, z2) / c);
    const seg = [x1, z1, x2, z2, tag];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(seg);
    }
  }
  /** Distances minimales à gauche et à droite du point p orienté selon la tangente (tx,tz). */
  clearance(px, pz, tx, tz, radius) {
    const c = this.cell;
    const i0 = Math.floor((px - radius) / c), i1 = Math.floor((px + radius) / c);
    const j0 = Math.floor((pz - radius) / c), j1 = Math.floor((pz + radius) / c);
    let left = radius, right = radius;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.map.get(this.key(i, j));
      if (!a) continue;
      for (const s of a) {
        const dx = s[2] - s[0], dz = s[3] - s[1];
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((px - s[0]) * dx + (pz - s[1]) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = s[0] + t * dx - px, qz = s[1] + t * dz - pz;
        const d = Math.hypot(qx, qz);
        if (d >= radius) continue;
        // composante le long de la tangente : on ignore ce qui est loin devant/derrière
        const along = qx * tx + qz * tz;
        if (Math.abs(along) > 3 + d * 0.5) continue;
        const lat = tx * qz - tz * qx; // > 0 : à droite (repère x est, z sud)
        if (lat > 0) { if (d < right) right = d; } else if (d < left) left = d;
      }
    }
    return { left, right };
  }
}
