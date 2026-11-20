// Modèles procéduraux de véhicules (aucun fichier externe) : carrosseries extérieures loftées
// (citadine, berline, SUV, utilitaire, bus) et poste de conduite à gauche vu à la première personne.
// Repère modèle : +X à droite, +Y vers le haut, −Z vers l'avant ; origine au sol, au milieu de l'empattement.

import * as THREE from 'three';

export type CarKind = 'citadine' | 'berline' | 'suv' | 'utilitaire' | 'bus';
export interface CarDims { length: number; width: number; height: number; wheelbase: number; track: number; wheelRadius: number; frontOverhang: number }
export const CAR_DIMS: Record<CarKind, CarDims> = {
  citadine: { length: 4.05, width: 1.80, height: 1.44, wheelbase: 2.583, track: 1.50, wheelRadius: 0.308, frontOverhang: 0.83 },
  berline: { length: 4.62, width: 1.82, height: 1.45, wheelbase: 2.70, track: 1.55, wheelRadius: 0.322, frontOverhang: 0.93 },
  suv: { length: 4.42, width: 1.84, height: 1.63, wheelbase: 2.67, track: 1.57, wheelRadius: 0.35, frontOverhang: 0.90 },
  utilitaire: { length: 4.90, width: 1.90, height: 1.95, wheelbase: 3.10, track: 1.62, wheelRadius: 0.33, frontOverhang: 0.93 },
  bus: { length: 12.0, width: 2.55, height: 3.10, wheelbase: 5.90, track: 2.10, wheelRadius: 0.48, frontOverhang: 2.70 },
};
export interface CarLights { brake: boolean; left: boolean; right: boolean; reverse: boolean; head: boolean }
export interface CarVisual {
  group: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  setLights(l: CarLights): void;
  dims: CarDims;
}
/** Palette réaliste d'un parking français : beaucoup de blanc, de gris et de noir, un peu de bleu et de rouge. */
export const CAR_COLORS: number[] = [
  0xf3f3f1, 0xf3f3f1, 0xeceeef, 0xfafaf8, 0xe4e6e8,
  0xb7babd, 0x9a9da1, 0x7f8387, 0x5c6065, 0x45484d, 0x33363a,
  0x101113, 0x0b0c0e, 0x1a1b1e,
  0x1d3b6e, 0x2c5c9e, 0x16283f, 0x6f8fae,
  0x9b1620, 0xb3271f, 0x6e1218,
  0x2f463a, 0xb4a48a, 0xc56a1c,
];

export interface CockpitGauges { speedKmh: number; rpm: number; gear: string; left: boolean; right: boolean; handbrake: boolean; seatbelt: boolean; engineOn: boolean; stalled: boolean; lights: boolean; shiftHint: -1 | 0 | 1; limitKmh: number }
export interface Cockpit {
  group: THREE.Group;
  eye: THREE.Vector3;
  steeringWheel: THREE.Object3D;
  mirrors: { left: THREE.Mesh; center: THREE.Mesh; right: THREE.Mesh };
  screen: THREE.Mesh;
  setGauges(g: CockpitGauges): void;
  setWipers?(angle: number): void;
  setBodyColor?(hex: number): void;
}

// ───────────────────────────── outils ─────────────────────────────

type V3 = THREE.Vector3;
const V = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (t: number): number => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
/** table linéaire par morceaux [x0, y0, x1, y1, …] */
function pl(x: number, t: number[]): number {
  if (x <= t[0]) return t[1];
  for (let i = 2; i < t.length; i += 2) if (x <= t[i]) return lerp(t[i - 1], t[i + 1], (x - t[i - 2]) / (t[i] - t[i - 2] || 1));
  return t[t.length - 1];
}
const _c = new THREE.Color(), _a = V(), _b = V(), _d = V(), _m3 = new THREE.Matrix3();

/** Couleur de base des matériaux « détails » : les couleurs par sommet sont exprimées relativement à elle. */
const DETAIL_BASE = new THREE.Color(0x15171a), WHEEL_BASE = new THREE.Color(0x2c2d30);
// identifiants de feux (attribut par sommet, pilotés par setLights)
const L_HEAD = 1, L_TAIL = 2, L_LEFT = 3, L_RIGHT = 4, L_REV = 5, L_ON = 6, L_BRAKE = 7;

/** Accumulateur de géométrie : position, normale, couleur, (rugosité, métal), identifiant de feu. */
class GB {
  p: number[] = []; n: number[] = []; c: number[] = []; rm: number[] = []; lamp: number[] = []; ix: number[] = [];
  private cr = 1; private cg = 1; private cb = 1; private ro = 0.6; private me = 0; private la = 0;
  mat(hex: number, rough = 0.6, metal = 0, lamp = 0): this {
    _c.set(hex); this.cr = _c.r; this.cg = _c.g; this.cb = _c.b; this.ro = rough; this.me = metal; this.la = lamp; return this;
  }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(this.cr, this.cg, this.cb); this.rm.push(this.ro, this.me); this.lamp.push(this.la);
    return this.lamp.length - 1;
  }
  get tris(): number { return this.ix.length / 3; }
  /** quadrilatère plan a,b,c,d (sens trigonométrique vu de face) */
  face(a: V3, b: V3, c: V3, d: V3): this {
    _a.subVectors(c, a); _b.subVectors(d, b); _d.crossVectors(_a, _b).normalize();
    const i = this.v(a.x, a.y, a.z, _d.x, _d.y, _d.z);
    this.v(b.x, b.y, b.z, _d.x, _d.y, _d.z); this.v(c.x, c.y, c.z, _d.x, _d.y, _d.z); this.v(d.x, d.y, d.z, _d.x, _d.y, _d.z);
    this.ix.push(i, i + 1, i + 2, i, i + 2, i + 3); return this;
  }
  /** triangle plan orienté du côté de `hint` */
  tri(a: V3, b: V3, c: V3, hint: V3): this {
    _a.subVectors(b, a); _b.subVectors(c, a); _d.crossVectors(_a, _b).normalize();
    const f = _d.dot(hint) < 0; if (f) _d.negate();
    const i = this.v(a.x, a.y, a.z, _d.x, _d.y, _d.z);
    this.v(b.x, b.y, b.z, _d.x, _d.y, _d.z); this.v(c.x, c.y, c.z, _d.x, _d.y, _d.z);
    if (f) this.ix.push(i, i + 2, i + 1); else this.ix.push(i, i + 1, i + 2); return this;
  }
  /** ajoute une géométrie three (avec ses normales), éventuellement transformée */
  add(g: THREE.BufferGeometry, m?: THREE.Matrix4): this {
    const pa = g.getAttribute('position'), na = g.getAttribute('normal'), base = this.lamp.length;
    const flip = m ? m.determinant() < 0 : false;
    if (m) _m3.getNormalMatrix(m);
    for (let i = 0; i < pa.count; i++) {
      _a.fromBufferAttribute(pa, i); _b.fromBufferAttribute(na, i);
      if (m) { _a.applyMatrix4(m); _b.applyMatrix3(_m3).normalize(); }
      this.v(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
    }
    const ix = g.index, n = ix ? ix.count : pa.count;
    for (let i = 0; i < n; i += 3) {
      const a = base + (ix ? ix.getX(i) : i), b = base + (ix ? ix.getX(i + 1) : i + 1), c = base + (ix ? ix.getX(i + 2) : i + 2);
      if (flip) this.ix.push(a, c, b); else this.ix.push(a, b, c);
    }
    g.dispose();
    return this;
  }
  /** boîte centrée (dimensions dx, dy, dz) */
  box(dx: number, dy: number, dz: number, m: THREE.Matrix4): this { return this.add(new THREE.BoxGeometry(dx, dy, dz), m); }
  /** géométrie finale ; `base` : couleur du matériau par laquelle diviser les couleurs par sommet (undefined → peinture, sans couleurs) */
  build(base?: THREE.Color): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (base) {
      const col = new Float32Array(this.c.length);
      for (let i = 0; i < col.length; i += 3) { col[i] = this.c[i] / base.r; col[i + 1] = this.c[i + 1] / base.g; col[i + 2] = this.c[i + 2] / base.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.rm, 2));
      g.userData.lamp = Uint8Array.from(this.lamp);
    }
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.ix, 1) : new THREE.Uint16BufferAttribute(this.ix, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** matrice de placement : translation + rotations d'Euler (ordre YXZ) + échelle */
function TR(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(sx, sy, sz));
}

/** Normales lissées d'une grille nu×nv (les sommets confondus sont soudés) ; `skip(i,j)` écarte le carreau (i,j). */
function gridNormals(P: Float32Array, nu: number, nv: number, wrapV: boolean, skip?: (i: number, j: number) => boolean): Float32Array {
  const N = new Float32Array(P.length), rep = new Int32Array(nu * nv), seen = new Map<string, number>();
  for (let k = 0; k < nu * nv; k++) {
    const key = `${Math.round(P[k * 3] * 5000)},${Math.round(P[k * 3 + 1] * 5000)},${Math.round(P[k * 3 + 2] * 5000)}`;
    const r = seen.get(key); if (r === undefined) { seen.set(key, k); rep[k] = k; } else rep[k] = r;
  }
  const nvq = wrapV ? nv : nv - 1;
  for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nvq; j++) {
    if (skip && skip(i, j)) continue;
    const j1 = (j + 1) % nv, a = i * nv + j, b = i * nv + j1, c = (i + 1) * nv + j1, d = (i + 1) * nv + j;
    // normale = diagonales croisées (a→c) × (b→d), sens (a, b, c, d)
    const ux = P[c * 3] - P[a * 3], uy = P[c * 3 + 1] - P[a * 3 + 1], uz = P[c * 3 + 2] - P[a * 3 + 2];
    const vx = P[d * 3] - P[b * 3], vy = P[d * 3 + 1] - P[b * 3 + 1], vz = P[d * 3 + 2] - P[b * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c, d]) { const r = rep[k] * 3; N[r] += nx; N[r + 1] += ny; N[r + 2] += nz; }
  }
  for (let k = 0; k < nu * nv; k++) {
    const r = rep[k] * 3, l = Math.hypot(N[r], N[r + 1], N[r + 2]) || 1;
    if (rep[k] === k) { N[r] /= l; N[r + 1] /= l; N[r + 2] /= l; }
  }
  for (let k = 0; k < nu * nv; k++) if (rep[k] !== k) { const r = rep[k] * 3; N[k * 3] = N[r]; N[k * 3 + 1] = N[r + 1]; N[k * 3 + 2] = N[r + 2]; }
  return N;
}

/** Émet une grille entière dans un accumulateur (normales lissées ; `flip` inverse l'orientation). */
function emitGrid(gb: GB, P: Float32Array, nu: number, nv: number, wrapV = false, flip = false): void {
  const N = gridNormals(P, nu, nv, wrapV), base = gb.lamp.length, s = flip ? -1 : 1;
  for (let k = 0; k < nu * nv; k++) gb.v(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], N[k * 3] * s, N[k * 3 + 1] * s, N[k * 3 + 2] * s);
  const nvq = wrapV ? nv : nv - 1;
  for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nvq; j++) {
    const j1 = (j + 1) % nv, a = base + i * nv + j, b = base + i * nv + j1, c = base + (i + 1) * nv + j1, d = base + (i + 1) * nv + j;
    if (flip) gb.ix.push(a, c, b, a, d, c); else gb.ix.push(a, b, c, a, c, d);
  }
}

/** Balayage d'une section super-elliptique (demi-axes ru, rv) le long d'un chemin ; `uHint` oriente l'axe u. */
function sweep(gb: GB, path: V3[], uHint: V3, ru: number | number[], rv: number | number[], sides = 8, pow = 2, caps = true): void {
  const n = path.length, P = new Float32Array(n * sides * 3), T = V(), U = V(), W = V();
  for (let i = 0; i < n; i++) {
    T.subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    U.copy(uHint).addScaledVector(T, -uHint.dot(T)).normalize(); W.crossVectors(T, U);
    const a = typeof ru === 'number' ? ru : ru[i], b = typeof rv === 'number' ? rv : rv[i];
    for (let k = 0; k < sides; k++) {
      const f = (k / sides) * Math.PI * 2, cs = Math.cos(f), sn = Math.sin(f);
      const cu = Math.sign(cs) * Math.abs(cs) ** (2 / pow) * a, cv = Math.sign(sn) * Math.abs(sn) ** (2 / pow) * b, o = (i * sides + k) * 3;
      P[o] = path[i].x + U.x * cu + W.x * cv; P[o + 1] = path[i].y + U.y * cu + W.y * cv; P[o + 2] = path[i].z + U.z * cu + W.z * cv;
    }
  }
  emitGrid(gb, P, n, sides, true);
  if (!caps) return;
  for (const e of [0, n - 1]) {
    const hint = V().subVectors(path[e], path[e === 0 ? 1 : n - 2]);
    for (let k = 1; k < sides - 1; k++) {
      const q = (j: number): V3 => V(P[(e * sides + j) * 3], P[(e * sides + j) * 3 + 1], P[(e * sides + j) * 3 + 2]);
      gb.tri(q(0), q(k), q(k + 1), hint);
    }
  }
}

// police matricielle 5×7 (plaques, girouette du bus)
const FONT: Record<string, number[]> = {
  '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [30, 1, 1, 14, 1, 1, 30], '5': [31, 16, 30, 1, 1, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '9': [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], I: [14, 4, 4, 4, 4, 4, 14], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], R: [30, 17, 17, 30, 20, 18, 17], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14], '-': [0, 0, 0, 14, 0, 0, 0],
};
/** Texte matriciel : `at(u, v)` donne le point 3D pour u (vers la droite du lecteur) et v (vers le haut), en pixels depuis le centre. */
function dotText(gb: GB, text: string, at: (u: number, v: number) => V3): void {
  const w = text.length * 6 - 1;
  for (let ci = 0; ci < text.length; ci++) {
    const g = FONT[text[ci]]; if (!g) continue;
    for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) {
      if (!(g[r] & (16 >> b))) continue;
      let e = b; while (e < 4 && g[r] & (16 >> (e + 1))) e++;
      const u0 = ci * 6 + b - w / 2, u1 = ci * 6 + e + 1 - w / 2 - 0.12, v1 = 3.5 - r, v0 = v1 - 0.88;
      gb.face(at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)); b = e;
    }
  }
}

// ───────────────────────────── matériaux ─────────────────────────────

const paintCache = new Map<number, THREE.MeshPhysicalMaterial>();
/** Peinture carrosserie (vernie) ; `material.color` est exactement la couleur demandée. */
function paintMat(hex: number): THREE.MeshPhysicalMaterial {
  let m = paintCache.get(hex);
  if (!m) {
    const hsl = { h: 0, s: 0, l: 0 }; _c.set(hex).getHSL(hsl);
    const metal = hsl.l > 0.8 ? 0.5 : hsl.s < 0.12 ? (hsl.l < 0.12 ? 0.7 : 0.85) : 0.65;
    m = new THREE.MeshPhysicalMaterial({ color: hex, metalness: metal, roughness: hsl.l > 0.8 ? 0.5 : 0.42, clearcoat: 1, clearcoatRoughness: 0.08 });
    m.shadowSide = THREE.DoubleSide;
    paintCache.set(hex, m);
  }
  return m;
}
/** Matériau « détails » : couleur, rugosité, métal et émission par sommet (vitrages, plastiques, feux, jantes…). */
function makeDetailMat(base: THREE.Color): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: base, vertexColors: true, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  m.shadowSide = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRM;\nattribute float aGlow;\nvarying vec3 vRMG;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRMG = vec3(aRM, aGlow);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRMG;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRMG.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vRMG.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vRMG.z * 5.0;');
  };
  m.customProgramCacheKey = () => 'vehicule-details';
  return m;
}
let _detailMat: THREE.MeshStandardMaterial | null = null, _wheelMat: THREE.MeshStandardMaterial | null = null;
const detailMat = (): THREE.MeshStandardMaterial => (_detailMat ??= makeDetailMat(DETAIL_BASE));
const wheelMat = (): THREE.MeshStandardMaterial => (_wheelMat ??= makeDetailMat(WHEEL_BASE));

// ───────────────────────────── carrosserie loftée ─────────────────────────────
// La caisse est une grille stations × anneau. Une station est une « tranche » de la voiture (profil axial donné par
// des clés interpolées), courbée en plan (flèche `bow`) ; l'anneau enchaîne dessous, flanc, vitrage latéral et dessus.
// Les vitres, optiques, calandre… sont des carreaux de cette même grille : aucun jour ni scintillement entre panneaux.

/** clé du profil axial : [s (m depuis le nez), y haut, y bas, arête vive (1), subdivisions imposées] */
type KeyRow = [number, number, number, number?, number?];
interface Style {
  d: CarDims;
  keys: KeyRow[];
  iCowl: number; iHead: number; iRoofEnd: number; iGlass: number; iTail: number; // clés : base et haut de pare-brise, fin de pavillon, base de lunette, haut de poupe
  bow: number[];      // [s, flèche en plan] (> 0 : coins reculés)
  w: number[];        // [s latéral, demi-largeur maxi]
  belt: number[];     // [s latéral, hauteur de ceinture de caisse]
  roofW: number[];    // [s, demi-largeur du pavillon]
  crown: number;      // chute du bord de pavillon
  glass: [number, number]; // étendue du vitrage latéral (s latéral)
  pillars: number[]; doors: number[]; cladding: number;
  lampF: [number, number]; lampR: [number, number]; // bandes de hauteur des optiques avant / arrière
  archGap: number; step: number;
  plate: string; plateF: number; plateR: number;
  bus?: boolean;
}
const A8 = [0, 0.21, 0.42, 0.61, 0.76, 0.87, 0.94, 0.98, 1];
const SV = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.72, 0.86, 1];
const GV = [0.08, 0.36, 0.66, 0.92, 1];
const NH = 30, NR = 60;
// paramètres d'une station : 0 s, 1 yt, 2 yb, 3 bow, 4 w, 5 wbelt, 6 wtop, 7 wbot, 8 ybelt, 9 ytopE, 10 ybE, 11 ysh
function keyParams(st: Style, k: number): number[] {
  const [s, yt, yb] = st.keys[k], hgt = yt - yb, col = clamp(hgt / 0.3, 0, 1);
  const bow = pl(s, st.bow), ss = s + bow, w = pl(ss, st.w);
  let gh = 1;
  if (!st.bus) {
    const sC = st.keys[st.iCowl][0], sH = st.keys[st.iHead][0], sR = st.keys[st.iRoofEnd][0], sG = st.keys[st.iGlass][0];
    gh = k <= st.iCowl || k >= st.iGlass ? 0 : k < st.iHead ? (s - sC) / (sH - sC) : k > st.iRoofEnd ? (sG - s) / (sG - sR) : 1;
  }
  gh *= col;
  const ytE0 = yt - 0.045 * hgt, yb0 = ytE0 - 0.03 * hgt; // sans pavillon : capot, coffre, boucliers
  const ybF = Math.min(pl(ss, st.belt), yb0), ytEF = Math.max(yt - st.crown, ybF + 0.02);
  const ybelt = lerp(yb0, ybF, sstep(gh * 3)), ytopE = lerp(ytE0, ytEF, gh);
  const wbelt = lerp(w - 0.012 * col, w - 0.03, gh), wtop = lerp(w - 0.05 * col, pl(s, st.roofW), gh);
  const ybE = yb + Math.min(0.05 * hgt, 0.035), wbot = w - 0.05 * col;
  return [s, yt, yb, bow, w, wbelt, wtop, wbot, ybelt, ytopE, ybE, lerp(ybE, ybelt, 0.62)];
}
/** interpolation d'Hermite des clés (paramétrage centripète, tangentes unilatérales aux arêtes vives) */
function makeSpline(K: number[][], sharp: boolean[]): (t: number) => number[] {
  const n = K.length, u = [0];
  for (let k = 1; k < n; k++) u.push(u[k - 1] + Math.sqrt(Math.hypot(K[k][0] - K[k - 1][0], K[k][1] - K[k - 1][1], K[k][2] - K[k - 1][2])) + 1e-6);
  return (t) => {
    const k = clamp(Math.floor(t), 0, n - 2), f = t - k, du = u[k + 1] - u[k], a = K[k], b = K[k + 1], out = new Array<number>(a.length);
    const f2 = f * f, f3 = f2 * f, h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
    for (let q = 0; q < a.length; q++) {
      const d = (b[q] - a[q]) / du;
      const m0 = k === 0 || sharp[k] ? d : 0.5 * (d + (a[q] - K[k - 1][q]) / (u[k] - u[k - 1]));
      const m1 = k === n - 2 || sharp[k + 1] ? d : 0.5 * (d + (K[k + 2][q] - b[q]) / (u[k + 2] - u[k + 1]));
      out[q] = h00 * a[q] + h10 * du * m0 + h01 * b[q] + h11 * du * m1;
    }
    return out;
  };
}
/** forme en plan : fraction de la flèche appliquée à l'abscisse relative a (parabole → super-ellipse pour les boucliers) */
function planB(a: number, bow: number): number {
  const k = clamp((Math.abs(bow) - 0.1) / 0.08, 0, 1);
  return lerp(a * a, 1 - (1 - a ** 2.7) ** (1 / 2.7), k);
}
/** point j (0 = axe dessous … 30 = axe dessus) du demi-anneau droit → out = [x, y, s] */
function ringPoint(p: number[], j: number, out: number[]): void {
  let x: number, y: number, a = 1;
  if (j <= 8) { a = A8[j]; x = a * p[7]; y = p[2] + (p[10] - p[2]) * a ** 4; }
  else if (j <= 17) {
    y = lerp(p[10], p[8], SV[j - 9]);
    if (y < p[11]) x = p[4] - (p[4] - p[7]) * ((p[11] - y) / Math.max(p[11] - p[10], 1e-6)) ** 2.2;
    else x = p[4] - (p[4] - p[5]) * ((y - p[11]) / Math.max(p[8] - p[11], 1e-6)) ** 2;
  } else if (j <= 22) { const g = GV[j - 18]; y = lerp(p[8], p[9], g); x = lerp(p[5], p[6], g) + 0.03 * (p[9] - p[8]) * Math.sin(Math.PI * g); }
  else { a = A8[30 - j]; x = a * p[6]; y = p[9] + (p[1] - p[9]) * (1 - a ** 2.4); }
  out[0] = x; out[1] = y; out[2] = p[0] + p[3] * planB(a, p[3]);
}

interface Loft {
  st: Style; ns: number; z0: number;
  T: number[];                 // paramètre de clé de chaque station
  SS: Float64Array;            // s latéral de chaque station
  PRM: number[][];             // paramètres de chaque station
  P: Float32Array; P0: Float32Array; N: Float32Array; // positions (après / avant découpe des passages de roue), normales
  cut: Uint8Array;             // carreaux supprimés (passages de roue)
  arches: { zc: number; side: number; rim: number[] }[]; // bord de chaque passage de roue (indices de sommets, triés par angle)
}

function buildLoft(st: Style, coarse = false): Loft {
  const nk = st.keys.length, d = st.d, K = st.keys.map((_, k) => keyParams(st, k)), ev = makeSpline(K, st.keys.map((r) => !!r[3]));
  const sideS = (t: number): number => { const p = ev(t); return p[0] + p[3]; };
  const T: number[] = [];
  for (let k = 0; k < nk - 1; k++) {
    const a = st.keys[k], b = st.keys[k + 1];
    const n = a[4] ?? clamp(Math.ceil(Math.max((b[0] - a[0]) / (coarse ? 0.3 : 0.19), Math.abs(b[1] - a[1]) / 0.16, Math.abs(b[2] - a[2]) / 0.25)), 1, 14);
    for (let q = 0; q < n; q++) T.push(k + q / n);
  }
  T.push(nk - 1);
  const archS = [d.frontOverhang, d.frontOverhang + d.wheelbase], Ra = d.wheelRadius + st.archGap;
  if (!coarse) {
    for (let guard = 0; guard < 60; guard++) { // stations resserrées autour des passages de roue
      let done = true;
      for (let i = 0; i < T.length - 1; i++) {
        const s0 = sideS(T[i]), s1 = sideS(T[i + 1]);
        if (s1 - s0 > st.step && archS.some((c) => s1 > c - Ra - 0.03 && s0 < c + Ra + 0.03)) { T.splice(i + 1, 0, (T[i] + T[i + 1]) / 2); done = false; i++; }
      }
      if (done) break;
    }
    for (const sReq of [...st.doors, ...st.pillars.flatMap((p) => [p - 0.04, p + 0.04]), ...st.glass]) { // stations imposées
      let i = 0; while (i < T.length - 2 && sideS(T[i + 1]) < sReq) i++;
      if (Math.abs(sideS(T[i]) - sReq) < 0.012 || Math.abs(sideS(T[i + 1]) - sReq) < 0.012) continue;
      let lo = T[i], hi = T[i + 1];
      for (let q = 0; q < 30; q++) { const m = (lo + hi) / 2; if (sideS(m) < sReq) lo = m; else hi = m; }
      T.splice(i + 1, 0, (lo + hi) / 2);
    }
  }
  const ns = T.length, P = new Float32Array(ns * NR * 3), PRM: number[][] = [], SS = new Float64Array(ns), z0 = -(d.wheelbase / 2 + d.frontOverhang), o = [0, 0, 0];
  for (let i = 0; i < ns; i++) {
    const p = ev(T[i]); PRM.push(p); SS[i] = p[0] + p[3];
    for (let j = 0; j < NR; j++) {
      const m = j > NH; ringPoint(p, m ? NR - j : j, o);
      const q = (i * NR + j) * 3; P[q] = m ? -o[0] : o[0]; P[q + 1] = o[1]; P[q + 2] = z0 + o[2];
    }
  }
  const P0 = P.slice(), cut = new Uint8Array(ns * NR), arches: Loft['arches'] = [];
  if (!coarse) for (const c of archS) { // passages de roue : carreaux intérieurs supprimés, bord ramené sur le cercle
    const zc = z0 + c, yc = d.wheelRadius, inside = new Uint8Array(ns * NR);
    for (let i = 0; i < ns; i++) for (let j = 0; j < NR; j++) {
      const hj = j > NH ? NR - j : j, q = (i * NR + j) * 3;
      if (hj >= 8 && hj <= 17 && Math.hypot(P[q + 2] - zc, P[q + 1] - yc) < Ra) inside[i * NR + j] = 1;
    }
    const all = (i: number, j: number): boolean => i >= 0 && i < ns - 1 && !!inside[i * NR + j] && !!inside[i * NR + ((j + 1) % NR)] && !!inside[(i + 1) * NR + j] && !!inside[(i + 1) * NR + ((j + 1) % NR)];
    for (let i = 0; i < ns - 1; i++) for (let j = 0; j < NR; j++) if (all(i, j)) cut[i * NR + j] = 1;
    const rims: number[][] = [[], []];
    for (let i = 0; i < ns; i++) for (let j = 0; j < NR; j++) {
      if (!inside[i * NR + j]) continue;
      const jm = (j + NR - 1) % NR;
      if (all(i, j) && all(i - 1, j) && all(i, jm) && all(i - 1, jm)) continue; // sommet entièrement intérieur
      const q = (i * NR + j) * 3, dz = P[q + 2] - zc, dy = P[q + 1] - yc, l = Math.hypot(dz, dy) || 1;
      P[q + 2] = zc + (dz / l) * Ra; P[q + 1] = yc + (dy / l) * Ra;
      rims[j > NH ? 1 : 0].push(i * NR + j);
    }
    const ang = (k: number): number => { const a = Math.atan2(P[k * 3 + 1] - yc, P[k * 3 + 2] - zc); return a < -Math.PI / 2 ? a + Math.PI * 2 : a; };
    rims.forEach((r, q) => arches.push({ zc, side: q ? -1 : 1, rim: r.sort((a, b) => ang(a) - ang(b)) }));
  }
  const N = gridNormals(P, ns, NR, true, (i, j) => cut[i * NR + j] === 1);
  return { st, ns, z0, T, SS, PRM, P, P0, N, cut, arches };
}

/** demi-largeur de la caisse (avant découpe) au s latéral `ss` et à la hauteur y */
function sideX(L: Loft, ss: number, y: number): number {
  let i = 0; while (i < L.ns - 2 && L.SS[i + 1] < ss) i++;
  const at = (i: number): number => {
    for (let j = 8; j < 22; j++) {
      const a = (i * NR + j) * 3, b = a + 3;
      if (y <= L.P0[b + 1] || j === 21) return lerp(L.P0[a], L.P0[b], clamp((y - L.P0[a + 1]) / (L.P0[b + 1] - L.P0[a + 1] || 1), 0, 1));
    }
    return 0;
  };
  return lerp(at(i), at(i + 1), clamp((ss - L.SS[i]) / (L.SS[i + 1] - L.SS[i] || 1), 0, 1));
}
/** z (modèle) de la face avant ou arrière à l'abscisse x et à la hauteur y */
function faceZ(L: Loft, x: number, y: number, rear: boolean): number {
  const n = L.ns, eq = L.PRM[rear ? n - 1 : 0][1], q = y >= eq ? 1 : 2, up = y >= eq;
  for (let k = 0; k < n - 1; k++) {
    const a = L.PRM[rear ? n - 1 - k : k], b = L.PRM[rear ? n - 2 - k : k + 1];
    if (up ? b[q] >= y : b[q] <= y) {
      const f = clamp((y - a[q]) / (b[q] - a[q] || 1), 0, 1), bow = lerp(a[3], b[3], f), w = lerp(a[up ? 6 : 7], b[up ? 6 : 7], f);
      return L.z0 + lerp(a[0], b[0], f) + bow * planB(clamp(Math.abs(x) / w, 0, 1), bow);
    }
  }
  return L.z0;
}

interface DM { id: number; hex: number; rough: number; metal: number; lamp: number }
let dmN = 0;
const DMk = (hex: number, rough: number, metal = 0, lamp = 0): DM => ({ id: ++dmN, hex, rough, metal, lamp });
const PAINT = DMk(0, 0), GLASS = DMk(0x0a0c0f, 0.05), TRIM = DMk(0x0e0e0f, 0.7), GLOSS = DMk(0x060607, 0.12), UNDER = DMk(0x050505, 0.95), GRILLE = DMk(0x08080a, 0.45),
  HEAD = DMk(0xdfe5ec, 0.12, 0.3, L_HEAD), TAIL = DMk(0x8a0c12, 0.16, 0, L_TAIL), BRK = DMk(0x6a090e, 0.16, 0, L_BRAKE), REV = DMk(0xd2d6da, 0.14, 0.2, L_REV),
  INDL = DMk(0xd9831c, 0.15, 0, L_LEFT), INDR = DMk(0xd9831c, 0.15, 0, L_RIGHT), BLUE = DMk(0x58b4e6, 0.3), SILVER = DMk(0xb4b7ba, 0.3, 0.8), LED = DMk(0xff8a14, 0.3, 0, L_ON);

interface Cell { i: number; seg: number; first: boolean; hc: number; side: number; y: number; ss: number }
/** Émet les carreaux de la grille dans les accumulateurs peinture / détails selon `cls` (null = carreau omis). */
function emitLoft(L: Loft, cls: (c: Cell) => DM | null, paint: GB, det: GB): void {
  const { P, N, ns } = L, ids = new Map<number, number>(), cell: Cell = { i: 0, seg: 0, first: false, hc: 0, side: 1, y: 0, ss: 0 };
  const vert = (k: number, m: DM): number => {
    const key = k * 32 + m.id; let r = ids.get(key);
    if (r === undefined) {
      const gb = m === PAINT ? paint : det; if (m !== PAINT) gb.mat(m.hex, m.rough, m.metal, m.lamp);
      r = gb.v(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], N[k * 3], N[k * 3 + 1], N[k * 3 + 2]); ids.set(key, r);
    }
    return r;
  };
  const flat = (a: number, b: number, c: number): boolean => {
    _a.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]); _b.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
    return _a.cross(_b).lengthSq() < 1e-12;
  };
  for (let i = 0; i < ns - 1; i++) {
    const tm = (L.T[i] + L.T[i + 1]) / 2;
    cell.i = i; cell.seg = Math.floor(tm); cell.first = L.T[i] === cell.seg; cell.ss = (L.SS[i] + L.SS[i + 1]) / 2;
    for (let c = 0; c < NR; c++) {
      if (L.cut[i * NR + c]) continue;
      const c1 = (c + 1) % NR, a = i * NR + c, b = i * NR + c1, e = (i + 1) * NR + c1, f = (i + 1) * NR + c;
      cell.hc = c < NH ? c : NR - 1 - c; cell.side = c < NH ? 1 : -1;
      cell.y = (P[a * 3 + 1] + P[b * 3 + 1] + P[e * 3 + 1] + P[f * 3 + 1]) / 4;
      const m = cls(cell); if (!m) continue;
      const gb = m === PAINT ? paint : det;
      if (!flat(a, b, e)) gb.ix.push(vert(a, m), vert(b, m), vert(e, m));
      if (!flat(a, e, f)) gb.ix.push(vert(a, m), vert(e, m), vert(f, m));
    }
  }
}

// ───────────────────────────── gabarits ─────────────────────────────

/** clés de bouclier avant : pointe (hauteur hN), bord d'attaque du capot (hT), dessous (g) */
const noseKeys = (hN: number, hT: number, g: number): KeyRow[] => [[0, hN, hN], [0.005, hN + 0.33 * (hT - hN), hN - 0.32 * (hN - g)], [0.022, hN + 0.6 * (hT - hN), hN - 0.64 * (hN - g)], [0.06, hN + 0.85 * (hT - hN), hN - 0.9 * (hN - g)], [0.13, hT, g]];
/** clés de poupe sous la clé « haut de poupe » (hT) : pointe arrière à hR, dessous g */
const tailKeys = (L: number, hR: number, hT: number, g: number): KeyRow[] => [[L - 0.07, hR + 0.78 * (hT - hR), g + 0.01], [L - 0.03, hR + 0.52 * (hT - hR), hR - 0.62 * (hR - g)], [L - 0.008, hR + 0.25 * (hT - hR), hR - 0.3 * (hR - g)], [L, hR, hR]];

function styleOf(kind: CarKind): Style {
  const d = CAR_DIMS[kind], L = d.length;
  const base = { d, crown: 0.045, pillars: [] as number[], cladding: 0, archGap: 0.057, step: 0.056, plateF: 0.45, plateR: 0.7 };
  switch (kind) {
    case 'citadine': return {
      ...base, plate: 'EN-129-RT',
      keys: [...noseKeys(0.47, 0.745, 0.19), [0.62, 0.9, 0.19], [1.17, 0.955, 0.185, 1], [1.215, 0.982, 0.185], [1.77, 1.345, 0.175], [1.88, 1.405, 0.175], [2.45, 1.44, 0.175], [3.1, 1.425, 0.18], [3.64, 1.375, 0.2, 1], [3.92, 1.0, 0.27, 1], ...tailKeys(L, 0.6, 1.0, 0.27)],
      iCowl: 6, iHead: 9, iRoofEnd: 12, iGlass: 13, iTail: 13,
      bow: [0, 0.24, 0.13, 0.235, 0.62, 0.19, 1.17, 0.13, 1.88, 0.09, 2.45, 0.03, 3.1, -0.02, 3.64, -0.05, 3.92, -0.1, 4.05, -0.14],
      w: [0.24, 0.8, 0.42, 0.865, 0.83, 0.9, 1.4, 0.89, 2.5, 0.89, 3.41, 0.9, 3.82, 0.87, 3.91, 0.82],
      belt: [1.3, 0.9, 2.5, 0.935, 3.3, 0.985, 3.82, 1.0], roofW: [1.88, 0.585, 2.45, 0.61, 3.1, 0.6, 3.64, 0.565],
      glass: [1.36, 3.3], pillars: [2.5], doors: [1.36, 2.5, 3.26], lampF: [0.635, 0.704], lampR: [0.8, 0.985],
    };
    case 'berline': return {
      ...base, plate: 'LU-921-TM', plateR: 0.74,
      keys: [...noseKeys(0.47, 0.74, 0.18), [0.68, 0.895, 0.18], [1.27, 0.95, 0.18, 1], [1.315, 0.975, 0.18], [1.92, 1.345, 0.17], [2.04, 1.41, 0.17], [2.55, 1.45, 0.17], [3.15, 1.43, 0.175], [3.55, 1.365, 0.19], [4.2, 1.075, 0.25, 1], [4.5, 1.055, 0.27, 1], ...tailKeys(L, 0.62, 1.055, 0.27)],
      iCowl: 6, iHead: 9, iRoofEnd: 12, iGlass: 13, iTail: 14,
      bow: [0, 0.25, 0.13, 0.245, 0.68, 0.19, 1.27, 0.13, 2.04, 0.09, 2.55, 0.03, 3.15, -0.02, 3.55, -0.05, 4.2, -0.09, 4.5, -0.11, 4.62, -0.15],
      w: [0.25, 0.8, 0.45, 0.87, 0.93, 0.91, 1.5, 0.9, 2.7, 0.9, 3.63, 0.91, 4.39, 0.87, 4.47, 0.83],
      belt: [1.4, 0.895, 2.7, 0.93, 3.6, 0.98, 4.2, 1.02], roofW: [2.04, 0.59, 2.55, 0.615, 3.15, 0.6, 3.55, 0.56],
      glass: [1.46, 3.74], pillars: [2.62, 3.42], doors: [1.46, 2.62, 3.5], lampF: [0.632, 0.7], lampR: [0.84, 1.035],
    };
    case 'suv': return {
      ...base, plate: 'RM-212-NE', plateF: 0.56, plateR: 0.86, crown: 0.05, archGap: 0.07, cladding: 0.43,
      keys: [...noseKeys(0.58, 0.93, 0.26), [0.62, 1.07, 0.25], [1.2, 1.125, 0.23, 1], [1.245, 1.152, 0.23], [1.83, 1.515, 0.22], [1.95, 1.585, 0.22], [2.55, 1.63, 0.22], [3.3, 1.615, 0.225], [3.98, 1.56, 0.25, 1], [4.27, 1.2, 0.33, 1], ...tailKeys(L, 0.72, 1.2, 0.33)],
      iCowl: 6, iHead: 9, iRoofEnd: 12, iGlass: 13, iTail: 13,
      bow: [0, 0.22, 0.13, 0.215, 0.62, 0.17, 1.2, 0.12, 1.95, 0.08, 2.55, 0.03, 3.3, -0.02, 3.98, -0.05, 4.27, -0.09, 4.42, -0.12],
      w: [0.22, 0.83, 0.42, 0.89, 0.9, 0.92, 1.5, 0.905, 2.6, 0.905, 3.57, 0.92, 4.18, 0.89, 4.3, 0.85],
      belt: [1.32, 1.05, 2.5, 1.085, 3.4, 1.13, 4.18, 1.15], roofW: [1.95, 0.6, 2.55, 0.63, 3.3, 0.625, 3.98, 0.59],
      glass: [1.38, 3.95], pillars: [2.48, 3.36], doors: [1.38, 2.48, 3.32], lampF: [0.79, 0.878], lampR: [0.98, 1.185],
    };
    case 'utilitaire': return {
      ...base, plate: 'TL-197-EU', plateF: 0.5, plateR: 0.62, crown: 0.07, archGap: 0.07, cladding: 0.37,
      keys: [...noseKeys(0.56, 1.0, 0.24), [0.45, 1.1, 0.23], [0.82, 1.16, 0.22, 1], [0.86, 1.19, 0.22], [1.42, 1.8, 0.21], [1.56, 1.9, 0.21], [2.2, 1.95, 0.21], [3.6, 1.95, 0.21], [4.76, 1.925, 0.23], [4.84, 1.84, 0.27], [4.875, 1.55, 0.3], [4.89, 1.15, 0.36], [4.897, 0.85, 0.5], [4.9, 0.68, 0.68]],
      iCowl: 6, iHead: 9, iRoofEnd: 12, iGlass: 13, iTail: 13,
      bow: [0, 0.2, 0.13, 0.195, 0.45, 0.17, 0.82, 0.13, 1.56, 0.08, 2.2, 0.02, 4.0, 0, 4.76, -0.04, 4.84, -0.06, 4.9, -0.08],
      w: [0.2, 0.85, 0.4, 0.92, 0.93, 0.95, 1.6, 0.945, 4.03, 0.95, 4.6, 0.945, 4.82, 0.9],
      belt: [0.95, 1.08, 1.5, 1.1, 2.4, 1.12, 4.8, 1.12], roofW: [1.56, 0.72, 2.2, 0.8, 4.76, 0.8],
      glass: [0.99, 2.28], doors: [0.99, 2.3, 3.55], lampF: [0.824, 0.934], lampR: [0.95, 1.5],
    };
    default: return {
      ...base, bus: true, plate: 'EN-737-RL', plateF: 0.6, plateR: 0.8, crown: 0.19, archGap: 0.09, step: 0.085,
      keys: [[0, 1.0, 1.0], [0.012, 1.2, 0.74], [0.04, 1.9, 0.5, 0, 3], [0.075, 2.45, 0.38], [0.115, 2.78, 0.33], [0.21, 2.9, 0.31], [0.5, 2.93, 0.3], [6, 2.93, 0.3], [11.5, 2.93, 0.3], [11.8, 2.9, 0.32], [11.9, 2.76, 0.36], [11.955, 2.3, 0.42], [11.985, 1.6, 0.6, 0, 2], [12, 1.0, 1.0]],
      iCowl: 0, iHead: 0, iRoofEnd: 8, iGlass: 9, iTail: 9,
      bow: [0, 0.22, 0.5, 0.2, 1.2, 0, 10.8, 0, 11.5, -0.14, 12, -0.16],
      w: [0.22, 1.19, 0.6, 1.275, 11.4, 1.275, 11.84, 1.2], belt: [0, 1.12, 12, 1.12], roofW: [0, 1.15, 12, 1.15],
      glass: [0.6, 11.2], doors: [0.75, 0.8, 1.32, 1.38, 1.9, 1.95, 5.6, 5.65, 6.22, 6.28, 6.85, 6.9], lampF: [0.5, 0.74], lampR: [0.6, 1.6],
    };
  }
}

/** attribution des carreaux d'une voiture (citadine, berline, SUV, utilitaire) */
function carClass(st: Style): (x: Cell) => DM | null {
  const nk = st.keys.length, d = st.d, Ra = d.wheelRadius + st.archGap, aF = d.frontOverhang - Ra, aR = d.frontOverhang + d.wheelbase + Ra;
  const sN = st.keys[0][0] + st.bow[1], sT = d.length + st.bow[st.bow.length - 1];
  return (x) => {
    const { seg, hc, y, ss } = x, IND = x.side < 0 ? INDL : INDR, tailSeg = nk - 2 - seg;
    if (hc < 8) { // dessous et bas des boucliers
      if (seg < 4) return seg === 1 && hc < 5 ? GRILLE : seg === 2 ? TRIM : seg === 3 ? UNDER : PAINT;
      if (tailSeg < 4) return tailSeg < 2 ? PAINT : tailSeg === 2 ? TRIM : UNDER;
      return ss < aF || ss > aR ? UNDER : null;
    }
    if (hc < 17) { // flancs
      if (ss < sN + 0.2 && y > st.lampF[0] - 0.03 && y < st.lampF[1]) return HEAD;
      if (ss > sT - 0.2 && y > st.lampR[0] && y < st.lampR[1]) return TAIL;
      return y < st.cladding ? TRIM : PAINT;
    }
    if (hc < 22) { // vitrage latéral
      const g = hc - 17;
      if (g === 4 || ss < st.glass[0] || ss > st.glass[1] || seg < st.iCowl || seg >= st.iGlass) return PAINT;
      if (st.pillars.some((p) => Math.abs(ss - p) < 0.04)) return GLOSS;
      return g === 0 ? TRIM : GLASS;
    }
    const tc = hc - 22; // dessus : 0 = bord … 7 = axe
    if (seg < 4) return seg === 2 ? (tc <= 3 ? HEAD : tc === 4 ? IND : GLOSS) : seg === 1 && tc >= 3 ? GRILLE : PAINT;
    if (seg >= st.iCowl && seg < st.iHead) return tc >= 2 ? (seg === st.iCowl ? TRIM : GLASS) : PAINT;
    if (seg >= st.iRoofEnd && seg < st.iGlass) return tc >= 2 ? (x.first && tc >= 5 ? BRK : GLASS) : PAINT;
    if (seg >= st.iTail && y > st.lampR[0] && y < st.lampR[1]) return tc <= 3 ? TAIL : tc === 4 ? (y > (st.lampR[0] + st.lampR[1]) / 2 ? IND : REV) : PAINT;
    return PAINT;
  };
}

const BUS_DOORS = [[0.75, 1.95], [5.6, 6.9]];
/** attribution des carreaux du bus : grand vitrage, deux portes à droite, bandeau bleu clair, girouette */
function busClass(st: Style): (x: Cell) => DM | null {
  const nk = st.keys.length, d = st.d, Ra = d.wheelRadius + st.archGap, aF = d.frontOverhang - Ra, aR = d.frontOverhang + d.wheelbase + Ra;
  return (x) => {
    const { seg, hc, y, ss } = x, IND = x.side < 0 ? INDL : INDR, tailSeg = nk - 2 - seg;
    const door = x.side > 0 && BUS_DOORS.some(([a, b]) => ss > a && ss < b);
    const frame = x.side > 0 && BUS_DOORS.some(([a, b]) => Math.abs(ss - a - 0.025) < 0.03 || Math.abs(ss - b + 0.025) < 0.03 || Math.abs(ss - (a + b) / 2) < 0.035);
    if (hc < 8) {
      if (seg < 3) return seg === 0 ? PAINT : seg === 1 ? (hc >= 6 ? IND : hc >= 4 ? HEAD : PAINT) : TRIM;
      if (tailSeg < 3) return tailSeg === 0 ? (hc >= 5 ? (x.first ? REV : TAIL) : PAINT) : tailSeg === 1 ? (hc < 5 ? GRILLE : TRIM) : TRIM;
      return ss < aF || ss > aR ? UNDER : null;
    }
    if (hc < 17) return y > 0.37 && frame ? GLOSS : y > 0.37 && door ? GLASS : y < 0.8 ? BLUE : PAINT;
    if (hc < 22) {
      const g = hc - 17;
      if (frame) return GLOSS;
      if (g === 4) return door ? GLOSS : PAINT;
      if (ss < st.glass[0] || ss > st.glass[1]) return g === 0 ? PAINT : GLOSS;
      return g === 0 && !door ? GLOSS : GLASS;
    }
    const tc = hc - 22;
    if (seg < 4) return seg === 0 ? PAINT : seg === 3 ? GLOSS : tc >= 1 ? GLASS : GLOSS;
    if (tailSeg === 2) return GLOSS;
    if (tailSeg === 1) return tc >= 2 ? GLASS : GLOSS;
    if (tailSeg === 0) return tc <= 2 ? (x.first ? IND : TAIL) : PAINT;
    return PAINT;
  };
}

/*PART4*/
// ───────────────────────────── version provisoire (remplacée plus bas au fil de l'eau) ─────────────────────────────

/*TEMP-BEGIN*/
export function createCarVisual(kind: CarKind, color: number): CarVisual {
  const d = CAR_DIMS[kind], group = new THREE.Group(), body = new THREE.Group();
  group.add(body);
  const zf = -(d.wheelbase / 2 + d.frontOverhang), zc = zf + d.length / 2;
  const pb = new GB();
  pb.box(d.width, d.height * 0.42, d.length, TR(0, d.height * 0.36, zc));
  pb.box(d.width * 0.86, d.height * 0.4, d.length * 0.55, TR(0, d.height * 0.78, zc + d.length * 0.06));
  const paint = new THREE.Mesh(pb.build(), paintMat(color));
  paint.castShadow = true; body.add(paint);
  const wb = new GB().mat(0x111111, 0.9);
  wb.add(new THREE.CylinderGeometry(d.wheelRadius, d.wheelRadius, 0.2, 18), TR(0, 0, 0, 0, 0, Math.PI / 2));
  const wg = wb.build(WHEEL_BASE), wheels: THREE.Object3D[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Object3D();
    pivot.position.set((sx * d.track) / 2, d.wheelRadius, (sz * d.wheelbase) / 2);
    const m = new THREE.Mesh(wg, wheelMat()); m.castShadow = true; pivot.add(m); group.add(pivot); wheels.push(pivot);
  }
  return { group, body, wheels, setLights() { /* provisoire */ }, dims: d };
}

export function createCockpit(): Cockpit {
  const group = new THREE.Group(), eye = V(-0.36, 1.17, 0.15);
  const gb = new GB().mat(0x1c1d20, 0.8);
  gb.box(1.5, 0.3, 0.5, TR(0, 0.78, -0.72));
  group.add(new THREE.Mesh(gb.build(DETAIL_BASE), detailMat()));
  const col = new THREE.Group(); col.position.set(-0.36, 0.87, -0.31); col.rotation.x = -24 * Math.PI / 180; group.add(col);
  const steeringWheel = new THREE.Object3D(); col.add(steeringWheel);
  const sg = new GB().mat(0x121214, 0.6); sg.add(new THREE.TorusGeometry(0.17, 0.016, 8, 32));
  steeringWheel.add(new THREE.Mesh(sg.build(DETAIL_BASE), detailMat()));
  const mk = (w: number, h: number, x: number, y: number, z: number, ry: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x8899aa }));
    m.position.set(x, y, z); m.rotation.set(0, ry, 0, 'YXZ'); group.add(m); return m;
  };
  const mirrors = { left: mk(0.19, 0.115, -1.03, 1.0, -0.66, 0.34), center: mk(0.24, 0.065, 0, 1.29, -0.32, -0.32), right: mk(0.19, 0.115, 1.03, 1.0, -0.66, -0.52) };
  const screen = mk(0.2, 0.1125, 0.02, 0.93, -0.5, -0.14);
  return { group, eye, steeringWheel, mirrors, screen, setGauges() { /* provisoire */ } };
}
/*TEMP-END*/
