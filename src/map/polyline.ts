// Polyligne 2D (x, z) avec abscisse curviligne, projection et décalage latéral.

export interface PolyPoint {
  x: number;
  z: number;
  /** tangente unitaire */
  tx: number;
  tz: number;
}

export interface Projection {
  /** abscisse curviligne du point projeté */
  s: number;
  /** distance latérale signée : > 0 à droite du sens de parcours */
  d: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  seg: number;
}

export class Polyline {
  /** coordonnées à plat x0,z0,x1,z1,... */
  readonly pts: Float64Array;
  /** abscisses cumulées (une par point) */
  readonly cum: Float64Array;
  readonly n: number;
  readonly length: number;
  minX = Infinity; minZ = Infinity; maxX = -Infinity; maxZ = -Infinity;

  constructor(flat: ArrayLike<number>) {
    // supprime les points confondus
    const tmp: number[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i], z = flat[i + 1];
      const k = tmp.length;
      if (k >= 2 && Math.hypot(x - tmp[k - 2], z - tmp[k - 1]) < 1e-4) continue;
      tmp.push(x, z);
    }
    if (tmp.length < 4) tmp.push(tmp[0] + 0.01, tmp[1]);
    this.pts = Float64Array.from(tmp);
    this.n = this.pts.length / 2;
    this.cum = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const x = this.pts[i * 2], z = this.pts[i * 2 + 1];
      if (i > 0) this.cum[i] = this.cum[i - 1] + Math.hypot(x - this.pts[i * 2 - 2], z - this.pts[i * 2 - 1]);
      if (x < this.minX) this.minX = x;
      if (x > this.maxX) this.maxX = x;
      if (z < this.minZ) this.minZ = z;
      if (z > this.maxZ) this.maxZ = z;
    }
    this.length = this.cum[this.n - 1];
  }

  /** Indice du segment contenant l'abscisse s (recherche dichotomique). */
  segAt(s: number): number {
    if (s <= 0) return 0;
    if (s >= this.length) return this.n - 2;
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  at(s: number, out: PolyPoint = { x: 0, z: 0, tx: 1, tz: 0 }): PolyPoint {
    const i = this.segAt(s);
    const ax = this.pts[i * 2], az = this.pts[i * 2 + 1];
    const bx = this.pts[i * 2 + 2], bz = this.pts[i * 2 + 3];
    const l = this.cum[i + 1] - this.cum[i] || 1e-9;
    const t = (s - this.cum[i]) / l; // extrapolation autorisée hors bornes
    out.x = ax + (bx - ax) * t;
    out.z = az + (bz - az) * t;
    out.tx = (bx - ax) / l;
    out.tz = (bz - az) / l;
    return out;
  }

  /** Point décalé latéralement de `off` (positif = à droite du sens de parcours). */
  atOffset(s: number, off: number, out: PolyPoint = { x: 0, z: 0, tx: 1, tz: 0 }): PolyPoint {
    this.at(s, out);
    out.x += -out.tz * off;
    out.z += out.tx * off;
    return out;
  }

  project(x: number, z: number): Projection {
    let best = Infinity;
    const r: Projection = { s: 0, d: 0, x: 0, z: 0, tx: 1, tz: 0, seg: 0 };
    for (let i = 0; i < this.n - 1; i++) {
      const ax = this.pts[i * 2], az = this.pts[i * 2 + 1];
      const dx = this.pts[i * 2 + 2] - ax, dz = this.pts[i * 2 + 3] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) {
        best = d2;
        const l = Math.sqrt(l2) || 1e-9;
        r.s = this.cum[i] + t * l;
        r.x = px; r.z = pz; r.tx = dx / l; r.tz = dz / l; r.seg = i;
        // latéral signé : produit vectoriel tangente × (p - proj), positif à droite
        r.d = r.tx * (z - pz) - r.tz * (x - px);
      }
    }
    return r;
  }

  /** Courbure signée approximative à l'abscisse s (1/m, > 0 = virage à droite). */
  curvatureAt(s: number, span = 4): number {
    const a = this.at(Math.max(0, s - span));
    const b = this.at(Math.min(this.length, s + span));
    const ds = Math.min(this.length, s + span) - Math.max(0, s - span);
    if (ds < 0.5) return 0;
    const cross = a.tx * b.tz - a.tz * b.tx;
    const dot = a.tx * b.tx + a.tz * b.tz;
    return Math.atan2(cross, dot) / ds;
  }

  /** Sous-polyligne entre s0 et s1, décalée latéralement, éventuellement inversée. */
  slice(s0: number, s1: number, off = 0, reverse = false): Polyline {
    s0 = Math.max(0, Math.min(this.length, s0));
    s1 = Math.max(s0, Math.min(this.length, s1));
    const out: number[] = [];
    const p = { x: 0, z: 0, tx: 1, tz: 0 };
    const push = (s: number, nx: number, nz: number) => {
      this.at(s, p);
      out.push(p.x + nx * off, p.z + nz * off);
    };
    const i0 = this.segAt(s0), i1 = this.segAt(s1);
    // normales aux sommets (mitre limitée)
    const normalAtVertex = (i: number): [number, number] => {
      const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1);
      let tx0 = this.pts[i * 2] - this.pts[a * 2], tz0 = this.pts[i * 2 + 1] - this.pts[a * 2 + 1];
      let tx1 = this.pts[b * 2] - this.pts[i * 2], tz1 = this.pts[b * 2 + 1] - this.pts[i * 2 + 1];
      const l0 = Math.hypot(tx0, tz0) || 1, l1 = Math.hypot(tx1, tz1) || 1;
      tx0 /= l0; tz0 /= l0; tx1 /= l1; tz1 /= l1;
      if (i === 0) { tx0 = tx1; tz0 = tz1; }
      if (i === this.n - 1) { tx1 = tx0; tz1 = tz0; }
      let mx = tx0 + tx1, mz = tz0 + tz1;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      // normale à droite = (-tz, tx) ; facteur de mitre 1/cos(demi-angle), limité
      const cosHalf = Math.max(0.5, mx * tx0 + mz * tz0);
      return [-mz / cosHalf, mx / cosHalf];
    };
    this.at(s0, p);
    push(s0, -p.tz, p.tx);
    for (let i = i0 + 1; i <= i1; i++) {
      if (this.cum[i] <= s0 + 1e-6 || this.cum[i] >= s1 - 1e-6) continue;
      const [nx, nz] = normalAtVertex(i);
      out.push(this.pts[i * 2] + nx * off, this.pts[i * 2 + 1] + nz * off);
    }
    this.at(s1, p);
    push(s1, -p.tz, p.tx);
    if (reverse) {
      const rev: number[] = [];
      for (let i = out.length - 2; i >= 0; i -= 2) rev.push(out[i], out[i + 1]);
      return new Polyline(rev);
    }
    return new Polyline(out);
  }

  /** Échantillonne tous les `step` mètres (inclut les extrémités). */
  sample(step: number): PolyPoint[] {
    const res: PolyPoint[] = [];
    const n = Math.max(1, Math.ceil(this.length / step));
    for (let i = 0; i <= n; i++) res.push(this.at((this.length * i) / n));
    return res;
  }
}

/** Courbe de Bézier cubique échantillonnée entre deux poses (position + direction). */
export function bezierLink(
  x0: number, z0: number, tx0: number, tz0: number,
  x1: number, z1: number, tx1: number, tz1: number,
  step = 1.0,
): Polyline {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  // distance de contrôle qui approche un arc de cercle : (4/3)·tan(θ/4)·R avec corde = 2R·sin(θ/2)
  const dot = Math.max(-1, Math.min(1, tx0 * tx1 + tz0 * tz1));
  const theta = Math.acos(dot);
  const k = dist * (theta < 0.05 ? 1 / 3 : Math.min(0.62, ((4 / 3) * Math.tan(theta / 4)) / (2 * Math.sin(theta / 2))));
  const c0x = x0 + tx0 * k, c0z = z0 + tz0 * k;
  const c1x = x1 - tx1 * k, c1z = z1 - tz1 * k;
  const n = Math.max(2, Math.ceil((dist * 1.3) / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push(a * x0 + b * c0x + c * c1x + d * x1, a * z0 + b * c0z + c * c1z + d * z1);
  }
  return new Polyline(out);
}
