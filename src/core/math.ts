// Utilitaires mathématiques communs (plan horizontal : x vers l'est, z vers le sud, y vers le haut).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const KMH = 1 / 3.6; // km/h → m/s

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const sq = (v: number) => v * v;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Rapproche `v` de `target` d'au plus `maxDelta`. */
export const approach = (v: number, target: number, maxDelta: number) =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
/** Lissage exponentiel indépendant du pas de temps. */
export const damp = (v: number, target: number, rate: number, dt: number) => lerp(v, target, 1 - Math.exp(-rate * dt));

/** Ramène un angle dans ]-π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const angleDiff = (a: number, b: number) => wrapAngle(a - b);

/** Interpolation linéaire dans une table [x0,y0,x1,y1,...] triée par x. */
export function table(tab: readonly number[], x: number): number {
  const n = tab.length;
  if (x <= tab[0]) return tab[1];
  if (x >= tab[n - 2]) return tab[n - 1];
  for (let i = 2; i < n; i += 2) {
    if (x <= tab[i]) {
      const t = (x - tab[i - 2]) / (tab[i] - tab[i - 2]);
      return tab[i - 1] + (tab[i + 1] - tab[i - 1]) * t;
    }
  }
  return tab[n - 1];
}

export function hash32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number | string = 1) {
    this.s = (typeof seed === 'string' ? hash32(seed) : seed) >>> 0 || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number) { return this.next() < p; }
}

/** Cap (heading) d'un vecteur direction (dx, dz) : 0 = vers le nord (-z), positif vers l'est (sens horaire vu de dessus). */
export const headingOf = (dx: number, dz: number) => Math.atan2(dx, -dz);
/** Vecteur unitaire avant pour un cap donné. */
export const forwardOf = (heading: number): [number, number] => [Math.sin(heading), -Math.cos(heading)];
