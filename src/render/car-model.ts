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
function makeDetailMat(base: THREE.Color, offset = true): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: base, vertexColors: true, roughness: 0.6, metalness: 0, polygonOffset: offset, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  m.shadowSide = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRM;\nattribute float aGlow;\nvarying vec3 vRMG;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRMG = vec3(aRM, aGlow);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRMG;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRMG.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vRMG.y - 2.0 * step(1.5, vRMG.y);') // métal ≥ 2 : cabochon de clignotant (émission orange)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mix(diffuseColor.rgb, vec3(1.0, 0.4, 0.03), step(1.5, vRMG.y)) * vRMG.z * 5.0;');
  };
  m.customProgramCacheKey = () => 'vehicule-details';
  return m;
}
let _detailMat: THREE.MeshStandardMaterial | null = null, _wheelMat: THREE.MeshStandardMaterial | null = null, _cabinMat: THREE.MeshStandardMaterial | null = null;
const cabinMat = (): THREE.MeshStandardMaterial => (_cabinMat ??= makeDetailMat(DETAIL_BASE, false));
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
  bus?: boolean; van?: boolean;
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
    const n = a[4] ?? clamp(Math.ceil(Math.max((b[0] - a[0]) / (coarse ? 0.32 : 0.29), Math.abs(b[1] - a[1]) / 0.22, Math.abs(b[2] - a[2]) / 0.3)), 1, 14);
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
const PAINT = DMk(0, 0), GLASS = DMk(0x4c5760, 0.04, 1), TRIM = DMk(0x0e0e0f, 0.7), GLOSS = DMk(0x060607, 0.12), UNDER = DMk(0x050505, 0.95), GRILLE = DMk(0x08080a, 0.45),
  HEAD = DMk(0x8d98a4, 0.08, 0.75, L_HEAD), TAIL = DMk(0x8a0c12, 0.16, 0, L_TAIL), BRK = DMk(0x6a090e, 0.16, 0, L_BRAKE), REV = DMk(0xd2d6da, 0.14, 0.2, L_REV),
  INDL = DMk(0xb9b3a8, 0.1, 2.4, L_LEFT), INDR = DMk(0xb9b3a8, 0.1, 2.4, L_RIGHT), BLUE = DMk(0x58b4e6, 0.3), SILVER = DMk(0xb4b7ba, 0.3, 0.8), LED = DMk(0xff8a14, 0.3, 0, L_ON);

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
const noseKeys = (hN: number, hT: number, g: number): KeyRow[] => [[0, hN, hN], [0.004, hN + 0.33 * (hT - hN), hN - 0.32 * (hN - g)], [0.016, hN + 0.6 * (hT - hN), hN - 0.64 * (hN - g)], [0.045, hN + 0.85 * (hT - hN), hN - 0.9 * (hN - g)], [0.11, hT, g]];
/** clés de poupe sous la clé « haut de poupe » (hT) : pointe arrière à hR, dessous g */
const tailKeys = (L: number, hR: number, hT: number, g: number): KeyRow[] => [[L - 0.07, hR + 0.78 * (hT - hR), g + 0.01], [L - 0.03, hR + 0.52 * (hT - hR), hR - 0.62 * (hR - g)], [L - 0.008, hR + 0.25 * (hT - hR), hR - 0.3 * (hR - g)], [L, hR, hR]];

function styleOf(kind: CarKind): Style {
  const d = CAR_DIMS[kind], L = d.length;
  const base = { d, crown: 0.045, pillars: [] as number[], cladding: 0, archGap: 0.048, step: 0.074, plateF: 0.45, plateR: 0.7 };
  switch (kind) {
    case 'citadine': return {
      ...base, plate: 'EN-129-RT',
      keys: [...noseKeys(0.48, 0.775, 0.19), [0.62, 0.905, 0.19], [1.17, 0.955, 0.185, 1], [1.215, 0.982, 0.185], [1.77, 1.345, 0.175], [1.88, 1.405, 0.175], [2.45, 1.44, 0.175], [3.1, 1.425, 0.18], [3.64, 1.375, 0.2, 1], [3.92, 1.0, 0.27, 1], ...tailKeys(L, 0.6, 1.0, 0.27)],
      iCowl: 6, iHead: 9, iRoofEnd: 12, iGlass: 13, iTail: 13,
      bow: [0, 0.24, 0.13, 0.235, 0.62, 0.19, 1.17, 0.13, 1.88, 0.09, 2.45, 0.03, 3.1, -0.02, 3.64, -0.05, 3.92, -0.1, 4.05, -0.14],
      w: [0.24, 0.8, 0.42, 0.865, 0.83, 0.9, 1.4, 0.89, 2.5, 0.89, 3.41, 0.9, 3.82, 0.87, 3.91, 0.82],
      belt: [1.3, 0.9, 2.5, 0.935, 3.3, 0.985, 3.82, 1.0], roofW: [1.88, 0.585, 2.45, 0.61, 3.1, 0.6, 3.64, 0.565],
      glass: [1.36, 3.3], pillars: [2.5], doors: [1.36, 2.5, 3.26], lampF: [0.657, 0.73], lampR: [0.8, 0.985],
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
      ...base, van: true, plate: 'TL-197-EU', plateF: 0.5, plateR: 0.62, crown: 0.07, archGap: 0.07, cladding: 0.37,
      keys: [...noseKeys(0.56, 1.0, 0.24), [0.45, 1.1, 0.23], [0.82, 1.16, 0.22, 1], [0.86, 1.19, 0.22], [1.42, 1.8, 0.21], [1.56, 1.9, 0.21], [2.2, 1.95, 0.21, 0, 3], [3.6, 1.95, 0.21, 0, 3], [4.76, 1.925, 0.23], [4.84, 1.84, 0.27], [4.875, 1.55, 0.3], [4.89, 1.15, 0.36], [4.897, 0.85, 0.5], [4.9, 0.68, 0.68]],
      iCowl: 6, iHead: 9, iRoofEnd: 12, iGlass: 13, iTail: 13,
      bow: [0, 0.2, 0.13, 0.195, 0.45, 0.17, 0.82, 0.13, 1.56, 0.08, 2.2, 0.02, 4.0, 0, 4.76, -0.04, 4.84, -0.06, 4.9, -0.08],
      w: [0.2, 0.85, 0.4, 0.92, 0.93, 0.95, 1.6, 0.945, 4.03, 0.95, 4.6, 0.945, 4.82, 0.9],
      belt: [0.95, 1.08, 1.5, 1.1, 2.4, 1.12, 4.8, 1.12], roofW: [1.56, 0.72, 2.2, 0.8, 4.76, 0.8],
      glass: [0.99, 2.28], doors: [0.99, 2.3, 3.55], lampF: [0.824, 0.934], lampR: [0.95, 1.5],
    };
    default: return {
      ...base, bus: true, plate: 'EN-737-RL', plateF: 0.6, plateR: 0.8, crown: 0.19, archGap: 0.09, step: 0.085,
      keys: [[0, 1.0, 1.0], [0.012, 1.2, 0.74], [0.04, 1.9, 0.5, 0, 3], [0.075, 2.45, 0.38], [0.115, 2.78, 0.33], [0.21, 2.9, 0.31], [0.5, 2.93, 0.3, 0, 7], [6, 2.93, 0.3, 0, 7], [11.5, 2.93, 0.3], [11.8, 2.9, 0.32], [11.9, 2.76, 0.36], [11.955, 2.3, 0.42], [11.985, 1.6, 0.6, 0, 2], [12, 1.0, 1.0]],
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
      if (hc === 16 && (seg === 2 || seg === 3)) return seg === 2 ? IND : HEAD;
      if ((seg < st.iTail && hc >= 15 && ss > sT - 0.2 && y > st.lampR[0] - 0.04) || (seg === st.iTail && hc >= 15) || (seg === st.iTail + 1 && hc === 16)) return TAIL;
      return y < st.cladding ? TRIM : PAINT;
    }
    if (hc < 22) { // vitrage latéral
      const g = hc - 17;
      if (seg === 2 || seg === 3) return seg === 2 ? IND : HEAD;
      if (seg === st.iTail || seg === st.iTail + 1) return TAIL;
      if (g === 4 || ss < st.glass[0] || ss > st.glass[1] || seg < st.iCowl || seg >= st.iGlass) return PAINT;
      if (st.pillars.some((p) => Math.abs(ss - p) < 0.04)) return GLOSS;
      return g === 0 ? TRIM : GLASS;
    }
    const tc = hc - 22; // dessus : 0 = bord … 7 = axe
    if (seg < 4) return seg === 2 ? (tc === 0 ? IND : tc <= 3 ? HEAD : GRILLE) : seg === 1 && tc >= 3 ? GRILLE : PAINT;
    if (seg >= st.iCowl && seg < st.iHead) return tc >= 2 ? (seg === st.iCowl ? TRIM : GLASS) : PAINT;
    if (seg >= st.iRoofEnd && seg < st.iGlass) return tc >= 2 && !st.van ? GLASS : PAINT;
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

// ───────────────────────────── accastillage ─────────────────────────────

const gp = (L: Loft, k: number): V3 => V(L.P[k * 3], L.P[k * 3 + 1], L.P[k * 3 + 2]);
/** fin ruban sombre (jour d'ouvrant) posé sur la carrosserie le long d'une suite de sommets de la grille */
function ribbon(gb: GB, L: Loft, ks: number[], w = 0.007): void {
  const { P, N } = L, e = V(), t = V(), n = V();
  let prev = -1, pa = -1, pb = -1;
  for (let q = 0; q < ks.length; q++) {
    const k = ks[q];
    if (k < 0) { prev = -1; continue; }
    let k0 = ks[Math.max(0, q - 1)], k1 = ks[Math.min(ks.length - 1, q + 1)];
    if (k0 < 0) k0 = k; if (k1 < 0) k1 = k;
    t.set(P[k1 * 3] - P[k0 * 3], P[k1 * 3 + 1] - P[k0 * 3 + 1], P[k1 * 3 + 2] - P[k0 * 3 + 2]).normalize();
    n.set(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]); e.crossVectors(n, t).multiplyScalar(w / 2);
    const x = P[k * 3] + n.x * 0.002, y = P[k * 3 + 1] + n.y * 0.002, z = P[k * 3 + 2] + n.z * 0.002;
    const a = gb.v(x - e.x, y - e.y, z - e.z, n.x, n.y, n.z), b = gb.v(x + e.x, y + e.y, z + e.z, n.x, n.y, n.z);
    if (prev >= 0) gb.ix.push(pa, b, pb, pa, a, b);
    prev = k; pa = a; pb = b;
  }
}
/** indice de la station la plus proche du s latéral donné / de la clé donnée */
const stationAt = (L: Loft, ss: number): number => { let b = 0; for (let i = 1; i < L.ns; i++) if (Math.abs(L.SS[i] - ss) < Math.abs(L.SS[b] - ss)) b = i; return b; };
const stationKey = (L: Loft, k: number): number => L.T.findIndex((t) => t >= k);

function plate(det: GB, text: string, y: number, z: number, dir: number): void {
  const at = (px: number, o: number) => (u: number, v: number): V3 => V(dir * u * px, y + v * px, z + dir * o);
  const q = (hw: number, hh: number, o: number, u0 = 0): void => { const f = at(1, o); det.face(f(u0 - hw, -hh), f(u0 + hw, -hh), f(u0 + hw, hh), f(u0 - hw, hh)); };
  det.mat(0x0b0b0c, 0.6); q(0.268, 0.063, 0);
  det.mat(0xecedea, 0.35); q(0.26, 0.055, 0.003);
  det.mat(0x1a3f9a, 0.35); q(0.02, 0.055, 0.006, -0.24); q(0.02, 0.055, 0.006, 0.24);
  det.mat(0x0c0c0d, 0.4); dotText(det, text, at(0.0078, 0.006));
}

function carDetails(st: Style, L: Loft, paint: GB, det: GB): void {
  const d = st.d, { P, z0, ns } = L, Ra = d.wheelRadius + st.archGap;
  // passages de roue : coquille sombre + flasque intérieur
  det.mat(UNDER.hex, 0.95);
  for (const ar of L.arches) {
    const pts = ar.rim.map((k) => gp(L, k)), xi = ar.side * (d.width / 2 - (st.bus ? 0.42 : 0.3)), ctr = V(xi, d.wheelRadius, ar.zc);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1]; if (a.distanceToSquared(b) < 1e-8 || a.y + b.y < d.wheelRadius * 1.5) continue;
      const ai = V(xi, a.y, a.z), bi = V(xi, b.y, b.z), hint = V(0, ctr.y - (a.y + b.y) / 2, ctr.z - (a.z + b.z) / 2);
      det.tri(a, ai, b, hint).tri(b, ai, bi, hint).tri(ctr, ai, bi, V(ar.side, 0, 0));
    }
    if (st.cladding) { // élargisseurs d'aile en plastique noir
      det.mat(TRIM.hex, TRIM.rough);
      const out = (p: V3): V3 => { const a = Math.atan2(p.y - d.wheelRadius, p.z - ar.zc), y = d.wheelRadius + Math.sin(a) * (Ra + 0.05), z = ar.zc + Math.cos(a) * (Ra + 0.05); return V(ar.side * (sideX(L, z - z0, y) + 0.006), y, z); };
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k].clone(), b = pts[k + 1].clone(); if (a.distanceToSquared(b) < 1e-8) continue;
        a.x += ar.side * 0.006; b.x += ar.side * 0.006;
        const ao = out(a), bo = out(b), hint = V(ar.side, 0, 0);
        det.tri(a, ao, b, hint).tri(b, ao, bo, hint);
      }
      det.mat(UNDER.hex, 0.95);
    }
  }
  // plancher sommaire (ferme la caisse vue de côté et pour les ombres)
  for (let i = 0; i < ns - 1; i++) {
    const a = L.PRM[i], b = L.PRM[i + 1]; if (a[1] - a[2] < 0.3 || b[1] - b[2] < 0.3) continue;
    const xa = a[4] - 0.31, xb = b[4] - 0.31, za = z0 + a[0] + a[3], zb = z0 + b[0] + b[3], dn = V(0, -1, 0);
    det.tri(V(-xa, a[2] + 0.03, za), V(xa, a[2] + 0.03, za), V(xb, b[2] + 0.03, zb), dn).tri(V(-xa, a[2] + 0.03, za), V(xb, b[2] + 0.03, zb), V(-xb, b[2] + 0.03, zb), dn);
  }
  // plaques d'immatriculation (blanches à l'avant comme à l'arrière, bandes bleues)
  plate(det, st.plate, st.plateF, faceZ(L, 0, st.plateF, false) - 0.014, -1);
  plate(det, st.plate, st.plateR, faceZ(L, 0, st.plateR, true) + 0.014, 1);
  if (st.bus) {
    // girouette à diodes orange, climatisation de toiture, rétroviseurs sur bras
    det.mat(LED.hex, LED.rough, 0, L_ON);
    dotText(det, '129 MONTREUIL', (u, v) => { const x = -u * 0.021, y = 2.615 + v * 0.021; return V(x, y, faceZ(L, x, y, false) - 0.008); });
    dotText(det, '129', (u, v) => { const x = u * 0.03, y = 2.53 + v * 0.03; return V(x, y, faceZ(L, x, y, true) + 0.008); });
    sweep(paint, [V(0, 2.99, z0 + 3.6), V(0, 3.0, z0 + 3.9), V(0, 3.0, z0 + 6.4), V(0, 2.99, z0 + 6.7)], V(1, 0, 0), [0.8, 0.9, 0.9, 0.8], [0.07, 0.1, 0.1, 0.07], 12, 4);
    for (const s of [-1, 1]) {
      det.mat(TRIM.hex, 0.6);
      sweep(det, [V(s * 1.16, 2.72, z0 + 0.3), V(s * 1.4, 2.66, z0 + 0.02), V(s * 1.45, 2.42, z0 - 0.02)], V(0, 0, 1), 0.02, 0.02, 6);
      det.box(0.07, 0.4, 0.2, TR(s * 1.45, 2.2, z0 + 0.0, 0, s * 0.3));
      det.mat(0x8f979f, 0.04, 1).face(V(s * 1.45 - 0.085, 2.03, z0 + 0.105), V(s * 1.45 + 0.085, 2.03, z0 + 0.105 - s * 0.05), V(s * 1.45 + 0.085, 2.37, z0 + 0.105 - s * 0.05), V(s * 1.45 - 0.085, 2.37, z0 + 0.105));
    }
    return;
  }
  // troisième feu stop, en haut de lunette
  const yb3 = st.keys[st.iRoofEnd][1] - 0.05;
  det.mat(BRK.hex, BRK.rough, 0, L_BRAKE).box(0.3, 0.016, 0.012, TR(0, yb3, faceZ(L, 0, yb3, true) + 0.004, -0.6));
  // jours d'ouvrants : portes, capot, hayon ou coffre
  det.mat(0x070708, 0.7);
  const inArch = (k: number): boolean => L.arches.some((a) => Math.hypot(P[k * 3 + 2] - a.zc, P[k * 3 + 1] - d.wheelRadius) < Ra + 0.004);
  for (const sd of st.doors) {
    const i = stationAt(L, sd);
    for (const s of [0, 1]) ribbon(det, L, Array.from({ length: 9 }, (_, q) => { const k = i * NR + (s ? NR - 9 - q : 9 + q); return inArch(k) ? -1 : k; }));
  }
  const i4 = stationKey(L, 4), iC = stationKey(L, st.iCowl), iR = stationKey(L, st.iGlass === st.iTail ? st.iRoofEnd : st.iGlass), iT = stationKey(L, st.iTail + 1);
  const across = (i: number): number[] => Array.from({ length: 13 }, (_, q) => i * NR + 24 + q);
  const along = (i0: number, i1: number, j: number): number[] => Array.from({ length: i1 - i0 + 1 }, (_, q) => (i0 + q) * NR + j);
  ribbon(det, L, across(i4)); ribbon(det, L, along(i4, iC, 24)); ribbon(det, L, along(i4, iC, 36));
  ribbon(det, L, across(iR)); ribbon(det, L, across(iT)); ribbon(det, L, along(iR, iT, 24)); ribbon(det, L, along(iR, iT, 36));
  // rétroviseurs extérieurs : coque peinte, pied noir, glace, répétiteur de clignotant
  const sC = st.keys[st.iCowl][0], sM = sC + pl(sC, st.bow) + 0.14, yM = pl(sM, st.belt) + 0.085, zM = z0 + sM;
  for (const s of [-1, 1]) {
    const xb = sideX(L, sM, yM - 0.05), cx = s * (xb + 0.115), zr = zM + 0.055 * 0.46;
    paint.add(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, 2.05), TR(cx, yM, zM, -Math.PI / 2, 0, 0, 0.105, 0.055, 0.068));
    det.mat(TRIM.hex, TRIM.rough).box(0.09, 0.028, 0.05, TR(s * (xb + 0.02), yM - 0.045, zM));
    det.add(new THREE.CircleGeometry(1, 10), TR(cx, yM, zr, 0, 0, 0, 0.094, 0.061, 1));
    det.mat(0x8f979f, 0.04, 1).add(new THREE.CircleGeometry(1, 10), TR(cx, yM, zr + 0.003, 0, 0, 0, 0.084, 0.051, 1));
    const ind = s < 0 ? INDL : INDR;
    det.mat(ind.hex, ind.rough, ind.metal, ind.lamp).box(0.06, 0.012, 0.014, TR(s * (xb + 0.185), yM, zM - 0.03, 0, s * -0.9));
  }
  // poignées de porte (ton caisse)
  for (const sd of st.doors.slice(1)) {
    const sh = sd - 0.13, yh = pl(sh, st.belt) - 0.085;
    for (const s of [-1, 1]) paint.box(0.024, 0.026, 0.15, TR(s * (sideX(L, sh, yh) + 0.004), yh, z0 + sh));
  }
  if (st.cladding && st.iGlass === st.iTail && st.pillars.length) { // barres de toit du SUV
    const i0 = stationKey(L, st.iHead) + 1, i1 = stationKey(L, st.iRoofEnd) - 1;
    for (const j of [25, 35]) sweep(det.mat(0x1a1b1d, 0.4, 0.3), along(i0, i1, j).map((k) => gp(L, k).add(V(0, 0.03, 0))), V(1, 0, 0), 0.016, 0.014, 6);
  }
}

// ───────────────────────────── roues ─────────────────────────────

/** Roue d'axe X centrée à l'origine, face extérieure du côté `sx` : pneu, jante alliage à 5 doubles branches (ou voile de bus). */
function buildWheel(R: number, w: number, rimR: number, truck: boolean, sx: number): THREE.BufferGeometry {
  const gb = new GB(), seg = 18, hw = w / 2;
  const lathe = (prof: number[][]): void => {
    const P = new Float32Array(prof.length * seg * 3);
    prof.forEach(([x, r], i) => { for (let j = 0; j < seg; j++) { const f = (j / seg) * Math.PI * 2, o = (i * seg + j) * 3; P[o] = sx * x; P[o + 1] = r * Math.cos(f); P[o + 2] = r * Math.sin(f); } });
    emitGrid(gb, P, prof.length, seg, true, sx < 0);
  };
  gb.mat(0x0c0c0d, 0.88);
  lathe([[-hw * 0.85, R - 0.01], [hw * 0.8, R], [hw, R - 0.035], [hw + 0.004, (R + rimR) / 2 + 0.01], [hw * 0.95, rimR + 0.01]]);
  if (truck) {
    gb.mat(0xa4a7aa, 0.5, 0.6);
    lathe([[hw * 0.95, rimR + 0.01], [hw * 0.9, rimR - 0.012], [hw * 0.45, rimR - 0.03], [hw * 0.3, rimR * 0.6], [hw * 0.62, rimR * 0.46], [hw * 0.78, 0.07], [hw * 0.78, 0.0001]]);
  } else {
    gb.mat(0xb6b9bc, 0.3, 0.8);
    lathe([[hw * 0.95, rimR + 0.01], [hw * 0.97, rimR - 0.004], [hw * 0.72, rimR - 0.018]]);
    gb.mat(0x3a3c3f, 0.5, 0.8); lathe([[hw * 0.72, rimR - 0.018], [0.01, rimR - 0.02], [0.01, 0.0001]]); // fût et disque
    gb.mat(0xb6b9bc, 0.3, 0.8);
    lathe([[hw * 0.6, 0.064], [hw * 0.66, 0.04], [hw * 0.66, 0.0001]]);                     // moyeu
    const ro = rimR - 0.017, out = V(sx, 0, 0);
    for (let s = 0; s < 10; s++) { // branches
      const a0 = ((s >> 1) / 5) * Math.PI * 2 + (s & 1 ? 0.2 : -0.2), a1 = ((s >> 1) / 5) * Math.PI * 2 + (s & 1 ? 0.07 : -0.07);
      const pt = (r: number, a: number, da: number, x: number): V3 => V(sx * x, r * Math.cos(a + da / r), r * Math.sin(a + da / r));
      const h0 = pt(0.05, a1, -0.014, hw * 0.64), h1 = pt(0.05, a1, 0.014, hw * 0.64), r0 = pt(ro, a0, -0.011, hw * 0.8), r1 = pt(ro, a0, 0.011, hw * 0.8);
      const dx = V(-sx * 0.03, 0, 0), tg = V().subVectors(h1, h0);
      gb.tri(h0, h1, r1, out).tri(h0, r1, r0, out);
      gb.tri(h1, r1, r1.clone().add(dx), tg).tri(h1, r1.clone().add(dx), h1.clone().add(dx), tg);
      tg.negate(); gb.tri(h0, r0, r0.clone().add(dx), tg).tri(h0, r0.clone().add(dx), h0.clone().add(dx), tg);
    }
  }
  return gb.build(WHEEL_BASE);
}

// ───────────────────────────── véhicule extérieur ─────────────────────────────

interface KindGeo { paint: THREE.BufferGeometry; detail: THREE.BufferGeometry; lampV: number[]; lampId: number[]; wheelR: THREE.BufferGeometry; wheelL: THREE.BufferGeometry }
const kindCache = new Map<CarKind, KindGeo>();
function kindGeo(kind: CarKind): KindGeo {
  let k = kindCache.get(kind);
  if (!k) {
    const st = styleOf(kind), L = buildLoft(st), paint = new GB(), det = new GB(), d = st.d;
    emitLoft(L, st.bus ? busClass(st) : carClass(st), paint, det);
    carDetails(st, L, paint, det);
    const detail = det.build(DETAIL_BASE), lampV: number[] = [], lampId: number[] = [];
    det.lamp.forEach((l, i) => { if (l) { lampV.push(i); lampId.push(l); } });
    const ww = st.bus ? 0.29 : kind === 'suv' ? 0.225 : 0.2, rr = st.bus ? 0.29 : Math.round((d.wheelRadius - 0.1) / 0.0127) * 0.0127;
    k = { paint: paint.build(), detail, lampV, lampId, wheelR: buildWheel(d.wheelRadius, ww, rr, !!st.bus, 1), wheelL: buildWheel(d.wheelRadius, ww, rr, !!st.bus, -1) };
    kindCache.set(kind, k);
  }
  return k;
}

/** `color` = teinte de carrosserie. Géométries et matériaux (hors peinture, mise en cache par teinte) partagés entre instances. */
export function createCarVisual(kind: CarKind, color: number): CarVisual {
  const k = kindGeo(kind), d = CAR_DIMS[kind], group = new THREE.Group(), body = new THREE.Group();
  group.add(body);
  const pm = new THREE.Mesh(k.paint, paintMat(color));
  // géométrie « détails » propre à l'instance : attributs partagés, sauf l'émission des feux
  const dg = new THREE.BufferGeometry();
  dg.setIndex(k.detail.index);
  for (const n of ['position', 'normal', 'color', 'aRM']) dg.setAttribute(n, k.detail.getAttribute(n));
  const glow = new Uint8Array(k.detail.getAttribute('position').count), ga = new THREE.BufferAttribute(glow, 1, true);
  dg.setAttribute('aGlow', ga);
  dg.boundingSphere = k.detail.boundingSphere; dg.boundingBox = k.detail.boundingBox;
  const dm = new THREE.Mesh(dg, detailMat());
  pm.castShadow = dm.castShadow = true;
  body.add(pm, dm);
  const wheels: THREE.Object3D[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Object3D();
    pivot.position.set((sx * d.track) / 2, d.wheelRadius, (sz * d.wheelbase) / 2);
    const m = new THREE.Mesh(sx > 0 ? k.wheelR : k.wheelL, wheelMat());
    m.castShadow = true; pivot.add(m); group.add(pivot); wheels.push(pivot);
  }
  let last = -1;
  const setLights = (l: CarLights): void => {
    const key = (l.brake ? 1 : 0) | (l.left ? 2 : 0) | (l.right ? 4 : 0) | (l.reverse ? 8 : 0) | (l.head ? 16 : 0);
    if (key === last) return; last = key;
    const lv = [0, l.head ? 230 : 0, l.brake ? 255 : l.head ? 55 : 0, l.left ? 255 : 0, l.right ? 255 : 0, l.reverse ? 210 : 0, 150, l.brake ? 255 : 0];
    for (let i = 0; i < k.lampV.length; i++) glow[k.lampV[i]] = lv[k.lampId[i]];
    ga.needsUpdate = true;
  };
  setLights({ brake: false, left: false, right: false, reverse: false, head: false });
  return { group, body, wheels, setLights, dims: d };
}

// ───────────────────────────── combiné d'instruments ─────────────────────────────

const CW = 1024, CH = 352, DIAL_R = 150, TACH_X = 178, SPEED_X = 846, DIAL_Y = 182;
const dialAngle = (f: number): number => (135 + 270 * clamp(f, 0, 1)) * Math.PI / 180;
function drawDialFace(g: CanvasRenderingContext2D, cx: number, max: number, majors: number, minors: number, label: (v: number) => string | null, big: (v: number) => boolean, redFrom: number, unit: string): void {
  const grad = g.createRadialGradient(cx, DIAL_Y, 20, cx, DIAL_Y, DIAL_R);
  grad.addColorStop(0, '#15171a'); grad.addColorStop(0.86, '#0b0c0e'); grad.addColorStop(1, '#1d2024');
  g.fillStyle = grad; g.beginPath(); g.arc(cx, DIAL_Y, DIAL_R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3c4046'; g.lineWidth = 3; g.beginPath(); g.arc(cx, DIAL_Y, DIAL_R - 2, 0, Math.PI * 2); g.stroke();
  if (redFrom < max) { g.strokeStyle = '#d0271d'; g.lineWidth = 9; g.beginPath(); g.arc(cx, DIAL_Y, DIAL_R - 13, dialAngle(redFrom / max), dialAngle(1)); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let v = 0; v <= max + 1e-6; v += minors) {
    const a = dialAngle(v / max), major = Math.abs(v / majors - Math.round(v / majors)) < 1e-6, txt = major ? label(v) : null;
    const r1 = DIAL_R - 8, r0 = r1 - (txt ? 20 : major ? 14 : 8), c = Math.cos(a), s = Math.sin(a);
    g.strokeStyle = v >= redFrom && redFrom < max ? '#ff5a4d' : txt ? '#f2f4f6' : '#9aa0a8'; g.lineWidth = txt ? 4 : major ? 3 : 1.6;
    g.beginPath(); g.moveTo(cx + c * r0, DIAL_Y + s * r0); g.lineTo(cx + c * r1, DIAL_Y + s * r1); g.stroke();
    if (txt) {
      const b = big(v); g.font = `${b ? 'bold 32px' : '600 21px'} "Segoe UI", Arial, sans-serif`; g.fillStyle = b ? '#ffffff' : '#aab0b7';
      g.fillText(txt, cx + c * (r0 - (b ? 25 : 17)), DIAL_Y + s * (r0 - (b ? 21 : 16)));
    }
  }
  g.font = '15px Arial, sans-serif'; g.fillStyle = '#8b9199'; g.fillText(unit, cx, DIAL_Y + 62);
}
function drawNeedle(g: CanvasRenderingContext2D, cx: number, f: number, on: boolean): void {
  const a = dialAngle(f);
  g.save(); g.translate(cx, DIAL_Y); g.rotate(a);
  g.shadowColor = on ? 'rgba(255,60,40,0.7)' : 'transparent'; g.shadowBlur = 8;
  g.fillStyle = on ? '#ff3b2a' : '#7a2a24'; g.beginPath(); g.moveTo(-22, -4); g.lineTo(DIAL_R - 14, -1.2); g.lineTo(DIAL_R - 14, 1.2); g.lineTo(-22, 4); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#1b1d20'; g.beginPath(); g.arc(cx, DIAL_Y, 17, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4a4e55'; g.lineWidth = 2; g.stroke();
}
/** flèche de clignotant (dir = −1 gauche, +1 droite) ou de changement de rapport (verticale) */
function arrow(g: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, color: string): void {
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = color;
  g.beginPath(); g.moveTo(s, 0); g.lineTo(0, -s); g.lineTo(0, -s * 0.42); g.lineTo(-s, -s * 0.42); g.lineTo(-s, s * 0.42); g.lineTo(0, s * 0.42); g.lineTo(0, s); g.closePath(); g.fill();
  g.restore();
}
function drawCluster(g: CanvasRenderingContext2D, bg: HTMLCanvasElement, q: CockpitGauges): void {
  g.drawImage(bg, 0, 0);
  const on = q.engineOn, lit = (c: string, off = '#22252a'): string => c || off;
  drawNeedle(g, TACH_X, (on ? q.rpm : 0) / 7000, true);
  drawNeedle(g, SPEED_X, q.speedKmh / 220, true);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  arrow(g, 404, 56, 21, Math.PI, lit(q.left ? '#35e04a' : ''));
  arrow(g, 620, 56, 21, 0, lit(q.right ? '#35e04a' : ''));
  // vitesse numérique
  g.fillStyle = '#f4f6f8'; g.font = 'bold 84px "Segoe UI", Arial, sans-serif'; g.fillText(String(Math.round(Math.max(0, q.speedKmh))), 512, 128);
  g.fillStyle = '#8b9199'; g.font = '17px Arial, sans-serif'; g.fillText('km/h', 512, 178);
  // rapport engagé et conseil de changement de rapport
  g.strokeStyle = '#596069'; g.lineWidth = 2.5; g.beginPath(); g.roundRect(424, 204, 66, 74, 9); g.stroke();
  g.fillStyle = q.gear === 'R' ? '#ffb347' : '#ffffff'; g.font = 'bold 56px "Segoe UI", Arial, sans-serif'; g.fillText(q.gear, 457, 244);
  if (q.shiftHint > 0) arrow(g, 514, 240, 15, -Math.PI / 2, '#35e04a');
  if (q.shiftHint < 0) arrow(g, 514, 244, 15, Math.PI / 2, '#ffb11f');
  // limitation en vigueur (panneau B14)
  if (q.limitKmh > 0) {
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(590, 241, 37, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d3131c'; g.lineWidth = 9; g.beginPath(); g.arc(590, 241, 32, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#111'; g.font = `bold ${q.limitKmh >= 100 ? 27 : 33}px Arial, sans-serif`; g.fillText(String(q.limitKmh), 590, 243);
  }
  // témoins : frein à main, ceinture, moteur, feux
  const lamp = (x: number, c: string, draw: () => void): void => { g.save(); g.translate(x, 320); g.strokeStyle = g.fillStyle = c || '#23262b'; g.lineWidth = 3; g.shadowColor = c || 'transparent'; g.shadowBlur = c ? 10 : 0; draw(); g.restore(); };
  lamp(416, q.handbrake ? '#ff2d22' : '', () => {
    g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, 19, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(0, 0, 19, Math.PI - 0.9, Math.PI + 0.9); g.stroke();
    g.font = 'bold 17px Arial, sans-serif'; g.shadowBlur = 0; g.fillText('P', 0, 1);
  });
  lamp(474, q.seatbelt ? '#ff2d22' : '', () => {
    g.beginPath(); g.arc(0, -11, 6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-10, 16); g.lineTo(-8, -1); g.lineTo(8, -1); g.lineTo(10, 16); g.closePath(); g.fill();
    g.strokeStyle = '#0b0c0e'; g.shadowBlur = 0; g.lineWidth = 3.5; g.beginPath(); g.moveTo(9, -4); g.lineTo(-9, 13); g.stroke();
  });
  lamp(538, q.stalled || !on ? '#ffb11f' : '', () => {
    g.beginPath(); g.moveTo(-14, -5); g.lineTo(-8, -5); g.lineTo(-5, -10); g.lineTo(8, -10); g.lineTo(8, -5); g.lineTo(14, -5); g.lineTo(14, 10); g.lineTo(-8, 10); g.lineTo(-8, 4); g.lineTo(-14, 4); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-3, -15); g.lineTo(6, -15); g.moveTo(-19, -3); g.lineTo(-19, 3); g.moveTo(18, -1); g.lineTo(18, 7); g.stroke();
  });
  lamp(600, q.lights ? '#35e04a' : '', () => {
    g.beginPath(); g.moveTo(2, -11); g.quadraticCurveTo(17, 0, 2, 11); g.closePath(); g.stroke();
    for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(-4, k * 8); g.lineTo(-17, k * 8 + 4); g.stroke(); }
  });
  if (q.stalled) { g.fillStyle = '#ffb11f'; g.font = 'bold 15px Arial, sans-serif'; g.fillText('MOTEUR CALÉ', 512, 292); }
  if (!on) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, CW, CH); }
}
function clusterBackground(): HTMLCanvasElement {
  const bg = document.createElement('canvas'); bg.width = CW; bg.height = CH;
  const g = bg.getContext('2d')!;
  g.fillStyle = '#050607'; g.fillRect(0, 0, CW, CH);
  g.fillStyle = '#0a0b0d'; g.beginPath(); g.roundRect(362, 14, 300, CH - 28, 16); g.fill();
  drawDialFace(g, TACH_X, 7, 1, 0.5, (v) => String(Math.round(v)), () => true, 6.4, '×1000 tr/min');
  drawDialFace(g, SPEED_X, 220, 10, 5, (v) => (Math.round(v / 10) % 2 === 1 ? String(Math.round(v)) : null), (v) => v >= 30 && v <= 130, 999, 'km/h');
  return bg;
}

// ───────────────────────────── poste de conduite ─────────────────────────────

const C_DASH = 0x18191b, C_LOW = 0x26272b, C_BAND = 0x62656a, C_HEAD = 0x9d9b95, C_PILLAR = 0x858480, C_LEATHER = 0x141416, C_PIANO = 0x060607, C_CHROME = 0xc4c7ca;
type MatOf = (i: number, j: number) => [number, number, number?];
/** grille lissée émise bande par bande (j → j+1), la matière de chaque sommet étant donnée par `matOf(i, j)` */
function emitStrips(gb: GB, P: Float32Array, nu: number, nv: number, matOf: MatOf, flip = false): void {
  const N = gridNormals(P, nu, nv, false), s = flip ? -1 : 1;
  for (let j = 0; j < nv - 1; j++) {
    const base = gb.lamp.length;
    for (let i = 0; i < nu; i++) {
      const m = matOf(i, j); gb.mat(m[0], m[1], m[2] ?? 0);
      for (const k of [i * nv + j, i * nv + j + 1]) gb.v(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], N[k * 3] * s, N[k * 3 + 1] * s, N[k * 3 + 2] * s);
    }
    for (let i = 0; i < nu - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 3, d = a + 2;
      if (flip) gb.ix.push(a, c, b, a, d, c); else gb.ix.push(a, b, c, a, c, d);
    }
  }
}
const gridOf = (rows: V3[][]): Float32Array => Float32Array.from(rows.flatMap((r) => r.flatMap((p) => [p.x, p.y, p.z])));

export function createCockpit(): Cockpit {
  const st = styleOf('citadine'), L = buildLoft(st, true), z0 = L.z0, DEG = Math.PI / 180;
  const group = new THREE.Group(), eye = V(-0.36, 1.17, 0.15), g = new GB(), pb = new GB();
  const beltY = (z: number): number => pl(z - z0, st.belt), doorX = (z: number, y: number): number => sideX(L, z - z0, y);
  const iC = stationKey(L, st.iCowl), iH = stationKey(L, st.iHead);
  const mesh = (gb: GB, paint = false): THREE.Mesh => new THREE.Mesh(gb.build(paint ? undefined : DETAIL_BASE), paint ? paintMat(0xb9bec4) : cabinMat());

  // ── capot et ailes vus à travers le pare-brise (même surface que la carrosserie extérieure)
  emitLoft(L, (c) => (c.seg < st.iCowl && c.hc >= 14 ? PAINT : null), pb, g);
  // baie d'essuie-glace : paroi sombre entre l'arrière du capot et l'avant de la planche de bord
  const cowl = Array.from({ length: 17 }, (_, q) => gp(L, iC * NR + 22 + q));
  g.mat(0x0a0a0b, 0.85);
  emitGrid(g, gridOf([cowl, cowl.map((p) => V(p.x * 0.985, 0.9, p.z + 0.02))]), 2, 17);

  // ── planche de bord : profil (z, y) balayé en x, casquette et puits du combiné côté conducteur
  const xs = [-0.82, -0.74, -0.62, -0.585, -0.55, -0.45, -0.36, -0.27, -0.17, -0.135, -0.1, 0, 0.12, 0.3, 0.5, 0.68, 0.76, 0.82], ZR = -0.47;
  const binW = (x: number): number => 1 - sstep((Math.abs(x + 0.36) - 0.19) / 0.035);
  const dash = xs.map((x) => {
    const zf = -0.975 + 0.15 * (x / 0.8) ** 2, b = binW(x), zm = lerp(zf, ZR, 0.5);
    const base = [[zf - 0.03, 0.9], [zf, 0.925], [zm, 0.95], [ZR - 0.05, 0.95], [ZR - 0.008, 0.932], [ZR + 0.008, 0.9], [ZR + 0.004, 0.862], [ZR, 0.8], [ZR - 0.015, 0.73], [ZR - 0.05, 0.6], [ZR - 0.16, 0.5]];
    const bin = [[zf - 0.03, 0.9], [zf, 0.925], [zm, 0.953], [-0.6, 0.973], [-0.515, 0.988], [-0.527, 0.972], [-0.7, 0.94], [-0.712, 0.8], [-0.6, 0.775], [-0.5, 0.76], [-0.5, 0.5]];
    return base.map((p, k) => V(x, lerp(p[1], bin[k][1], b), lerp(p[0], bin[k][0], b)));
  });
  emitStrips(g, gridOf(dash), xs.length, 11, (i, j) => (j === 6 && binW(xs[i]) < 0.5 ? [C_BAND, 0.42, 0.55] : j >= 7 ? [C_LOW, 0.8] : [C_DASH, 0.9]));
  // écran central 9 pouces 16:9 (dalle + coque), orienté vers le conducteur
  const SM = TR(0.03, 0.94, -0.45, -0.17, -0.22), at = (m: THREE.Matrix4, x: number, y: number, z: number): THREE.Matrix4 => m.clone().multiply(TR(x, y, z));
  g.mat(C_PIANO, 0.25).box(0.216, 0.129, 0.012, at(SM, 0, 0, -0.0065));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.1992, 0.1121), new THREE.MeshBasicMaterial({ color: 0x10151b }));
  screen.position.set(0.03, 0.94, -0.45); screen.rotation.set(-0.17, -0.22, 0, 'YXZ');
  // aérateurs, commandes de climatisation, boîte à gants
  for (const x of [-0.69, -0.075, 0.135, 0.69]) {
    g.mat(C_PIANO, 0.3).box(0.118, 0.054, 0.012, TR(x, 0.832, ZR + 0.005));
    g.mat(0x34363a, 0.5, 0.3);
    for (const dy of [-0.015, 0, 0.015]) g.box(0.104, 0.0045, 0.006, TR(x, 0.832 + dy, ZR + 0.011, 0.35));
    g.box(0.012, 0.03, 0.008, TR(x, 0.832, ZR + 0.014));
  }
  for (const dx of [-0.07, 0, 0.07]) {
    g.mat(C_CHROME, 0.3, 0.9).add(new THREE.CylinderGeometry(0.019, 0.019, 0.016, 14), TR(0.03 + dx, 0.757, ZR - 0.004, Math.PI / 2));
    g.mat(C_PIANO, 0.3).add(new THREE.CylinderGeometry(0.015, 0.015, 0.018, 14), TR(0.03 + dx, 0.757, ZR - 0.004, Math.PI / 2));
  }
  g.mat(0x09090a, 0.8).box(0.5, 0.004, 0.004, TR(0.47, 0.778, ZR - 0.004)).box(0.004, 0.16, 0.004, TR(0.22, 0.7, ZR - 0.022, 0.2)).box(0.004, 0.16, 0.004, TR(0.72, 0.7, ZR - 0.022, 0.2));
  g.mat(C_BAND, 0.45, 0.5).box(0.08, 0.012, 0.01, TR(0.47, 0.75, ZR - 0.008));
  // console centrale, levier de vitesses, frein à main, plancher et tablier
  g.mat(C_LOW, 0.8).box(0.2, 0.3, 1.1, TR(0, 0.45, 0.02)).mat(C_DASH, 0.8).box(0.19, 0.012, 0.5, TR(0, 0.606, 0.28));
  g.mat(C_LEATHER, 0.7).add(new THREE.CylinderGeometry(0.018, 0.055, 0.1, 10), TR(0, 0.645, -0.15, -0.12)).add(new THREE.SphereGeometry(0.028, 10, 8), TR(0, 0.715, -0.158, 0, 0, 0, 1, 1.15, 1));
  g.mat(C_DASH, 0.6).box(0.036, 0.032, 0.24, TR(0.035, 0.64, 0.17, 0.12));
  g.mat(0x0c0c0d, 0.95).face(V(-0.85, 0.3, -1.0), V(-0.85, 0.3, 0.8), V(0.85, 0.3, 0.8), V(0.85, 0.3, -1.0)).face(V(-0.85, 0.3, -0.62), V(0.85, 0.3, -0.62), V(0.85, 0.62, -0.72), V(-0.85, 0.62, -0.72));

  // ── colonne de direction, commodos et volant (plan du volant incliné de 24°)
  const WC = V(-0.36, 0.87, -0.31), AX = V(0, Math.sin(24 * DEG), Math.cos(24 * DEG)), along = (d: number, x = 0, y = 0): V3 => WC.clone().addScaledVector(AX, d).add(V(x, y, 0));
  g.mat(C_DASH, 0.75); sweep(g, [along(-0.035), along(-0.16), along(-0.32)], V(1, 0, 0), [0.05, 0.062, 0.07], [0.043, 0.055, 0.06], 10, 3);
  for (const s of [-1, 1]) { g.mat(0x18191b, 0.6); sweep(g, [along(-0.085, s * 0.04), along(-0.09, s * 0.15, 0.008), along(-0.092, s * 0.215, 0.014)], V(0, 1, 0), [0.009, 0.009, 0.014], [0.009, 0.009, 0.012], 6); }
  const sw = new GB().mat(C_LEATHER, 0.5);
  sw.add(new THREE.TorusGeometry(0.169, 0.0165, 10, 40));
  const plate = new THREE.Shape();
  plate.moveTo(0.165, 0.032); plate.lineTo(0.165, -0.03); plate.quadraticCurveTo(0.1, -0.03, 0.065, -0.05); plate.quadraticCurveTo(0.03, -0.075, 0.024, -0.165);
  plate.lineTo(-0.024, -0.165); plate.quadraticCurveTo(-0.03, -0.075, -0.065, -0.05); plate.quadraticCurveTo(-0.1, -0.03, -0.165, -0.03); plate.lineTo(-0.165, 0.032);
  plate.quadraticCurveTo(-0.09, 0.036, -0.06, 0.058); plate.lineTo(0.06, 0.058); plate.quadraticCurveTo(0.09, 0.036, 0.165, 0.032);
  sw.mat(0x1b1c1f, 0.62).add(new THREE.ExtrudeGeometry(plate, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 5 }), TR(0, 0, -0.036));
  const boss = new THREE.Shape();
  boss.moveTo(-0.05, 0.05); boss.quadraticCurveTo(0, 0.058, 0.05, 0.05); boss.quadraticCurveTo(0.07, 0.045, 0.066, 0.015); boss.quadraticCurveTo(0.06, -0.04, 0.03, -0.058);
  boss.quadraticCurveTo(0, -0.066, -0.03, -0.058); boss.quadraticCurveTo(-0.06, -0.04, -0.066, 0.015); boss.quadraticCurveTo(-0.07, 0.045, -0.05, 0.05);
  sw.mat(C_LEATHER, 0.7).add(new THREE.ExtrudeGeometry(boss, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 5 }), TR(0, 0, -0.016));
  sw.mat(C_CHROME, 0.25, 0.9).add(new THREE.TorusGeometry(0.015, 0.0022, 5, 16), TR(0, 0, 0.007));
  for (const s of [-1, 1]) sw.mat(0x0c0c0d, 0.45).box(0.05, 0.034, 0.004, TR(s * 0.108, 0, -0.0135)).mat(C_BAND, 0.4, 0.6).box(0.03, 0.006, 0.005, TR(s * 0.108, -0.024, -0.0135));
  const column = new THREE.Group(); column.position.copy(WC); column.rotation.x = -24 * DEG;
  const steeringWheel = new THREE.Object3D(); steeringWheel.add(mesh(sw)); column.add(steeringWheel);

  // ── combiné d'instruments (texture canvas)
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
  const ctx = cv.getContext('2d')!, bg = clusterBackground(), tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.1134), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  cluster.position.set(-0.36, 0.858, -0.686); cluster.rotation.x = -0.36;
  let lastKey = '', lastFlags = '', lastT = -1e9;
  const setGauges = (q: CockpitGauges): void => {
    const flags = `${q.gear}|${+q.left}${+q.right}${+q.handbrake}${+q.seatbelt}${+q.engineOn}${+q.stalled}${+q.lights}|${q.shiftHint}|${q.limitKmh}`;
    const key = `${Math.round(q.speedKmh * 2)}|${Math.round(q.rpm / 25)}|${flags}`;
    if (key === lastKey) return;
    const now = performance.now();
    if (flags === lastFlags && now - lastT < 33) return; // aiguilles : 30 Hz au plus
    lastKey = key; lastFlags = flags; lastT = now;
    drawCluster(ctx, bg, q); tex.needsUpdate = true;
  };
  setGauges({ speedKmh: 0, rpm: 0, gear: 'N', left: false, right: false, handbrake: true, seatbelt: false, engineOn: false, stalled: false, lights: false, shiftHint: 0, limitKmh: 0 });

  // ── garnitures : portes, montants, pavillon, pare-soleil
  for (const s of [-1, 1]) {
    const rows = [-0.92, -0.75, -0.55, -0.3, 0, 0.3, 0.62].map((z) => {
      const S = beltY(z) + 0.035, xo = doorX(z, S) - 0.028;
      return [[0, S - 0.03], [-0.012, S], [-0.045, S + 0.006], [-0.072, S - 0.02], [-0.08, S - 0.1], [-0.115, 0.735], [-0.125, 0.7], [-0.09, 0.66], [-0.08, 0.42], [-0.075, 0.3]].map(([dx, y]) => V(s * (xo + dx), y, z));
    });
    emitStrips(g, gridOf(rows), 7, 10, (_, j) => (j < 4 ? [C_DASH, 0.8] : j < 7 ? [C_LOW, 0.75] : [C_DASH, 0.85]), s < 0);
    const je = s > 0 ? 22 : 38, edge = (i: number, dx: number, dy: number, dz: number): V3 => gp(L, i * NR + je).add(V(-s * dx, dy, dz));
    // montant de pare-brise, traverse de baie latérale, montant milieu
    const ap = Array.from({ length: iH - iC + 1 }, (_, q) => edge(iC + q, 0.03, -0.025, 0.02));
    g.mat(C_PILLAR, 0.9); sweep(g, [ap[0].clone().add(V(s * 0.01, -0.12, -0.07)), ...ap, ap[ap.length - 1].clone().add(V(-s * 0.012, 0.012, 0.07))], V(s * 0.45, 0, 0.9), 0.037, 0.024, 8, 3);
    const iB = stationAt(L, st.pillars[0]), rail = Array.from({ length: iB - iH + 3 }, (_, q) => edge(iH + q, 0.02, -0.045, 0));
    g.mat(C_HEAD, 0.92); sweep(g, rail, V(0, 1, 0), 0.03, 0.028, 6);
    const zB = z0 + st.pillars[0], xB = s * (doorX(zB, 0.95) - 0.05);
    g.mat(C_PILLAR, 0.9); sweep(g, [V(xB, 0.45, zB), V(xB, 0.97, zB), edge(iB, 0.035, -0.03, 0)], V(0, 0, 1), 0.065, 0.035, 8, 3);
    // pare-soleil relevé contre le pavillon
    const vy = (x: number): number => 1.375 - 0.045 * (Math.abs(x) / 0.6) ** 2.4 - 0.017;
    g.mat(0xa8a6a0, 0.9); sweep(g, [0.13, 0.34, 0.55].map((x) => V(s * x, vy(x), -0.1 + 0.01 * (x / 0.55))), V(0, 0.07, 1), 0.068, 0.011, 8, 4);
  }
  const iE = stationAt(L, 3.1), roof = Array.from({ length: iE - iH + 1 }, (_, r) => Array.from({ length: 17 }, (_, q) => gp(L, (iH + r) * NR + 22 + q).add(V(0, q === 0 || q === 16 ? -0.05 : -0.04, 0))));
  g.mat(C_HEAD, 0.95); emitGrid(g, gridOf(roof), roof.length, 17, false, true);
  sweep(g, roof[0].map((p) => p.clone().add(V(0, -0.004, 0.05))), V(0, 0, 1), 0.04, 0.018, 6);

  // ── rétroviseurs : coques + surfaces réfléchissantes (plans, +Z local côté conducteur)
  const glass = (w: number, h: number, m: THREE.Matrix4): THREE.Mesh => {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x7f8d9a }));
    m.decompose(r.position, r.quaternion, r.scale); return r;
  };
  const loc = (m: THREE.Matrix4, x: number, y: number, z: number): V3 => V(x, y, z).applyMatrix4(m), dir = (m: THREE.Matrix4, x: number, y: number, z: number): V3 => V(x, y, z).transformDirection(m);
  const MC = TR(0, 1.29, -0.32, 0.14, -0.325);
  g.mat(C_DASH, 0.6); sweep(g, [-0.128, -0.11, 0, 0.11, 0.128].map((x) => loc(MC, x, 0, -0.021)), dir(MC, 0, 0, 1), [0.008, 0.017, 0.02, 0.017, 0.008], [0.027, 0.038, 0.04, 0.038, 0.027], 8, 3);
  sweep(g, [loc(MC, 0, 0.012, -0.03), V(0, 1.325, -0.365), V(0, 1.345, -0.375)], V(1, 0, 0), 0.013, 0.013, 6);
  const sM = st.keys[st.iCowl][0] + pl(st.keys[st.iCowl][0], st.bow) + 0.14, zM = z0 + sM, yM = beltY(zM) + 0.09;
  const side = (s: number): THREE.Mesh => {
    const xb = doorX(zM, yM - 0.05), M = TR(s * (xb + 0.125), yM, zM + 0.03, -0.05, s < 0 ? 0.34 : -0.5);
    sweep(pb, [-0.085, -0.06, -0.025, -0.004].map((z) => loc(M, 0, 0, z)), dir(M, 1, 0, 0), [0.04, 0.085, 0.103, 0.103], [0.025, 0.052, 0.066, 0.066], 10, 3);
    g.mat(C_PIANO, 0.35); sweep(g, [loc(M, 0, 0, -0.012), loc(M, 0, 0, -0.0015)], dir(M, 1, 0, 0), 0.1045, 0.0675, 10, 3);
    g.mat(0x0e0e0f, 0.7); sweep(g, [loc(M, -s * 0.06, -0.05, -0.035), V(s * (xb - 0.01), yM - 0.07, zM - 0.02)], V(0, 0, 1), 0.024, 0.014, 6);
    return glass(0.19, 0.115, M);
  };
  const mirrors = { left: side(-1), center: glass(0.24, 0.065, MC), right: side(1) };

  // ── essuie-glaces au repos au pied du pare-brise (bras + balai), pivotant dans le plan de la vitre
  const wn = V(0, 0.855, -0.518), wipers: THREE.Object3D[] = [];
  for (const [px, py, pz, len, ex] of [[-0.03, 0.972, -0.934, 0.62, V(-0.58, 0.05, 0.088)], [0.58, 0.953, -0.871, 0.54, V(-0.5, -0.012, -0.058)]] as [number, number, number, number, V3][]) {
    const X = ex.normalize(), Z = wn.clone().addScaledVector(X, -wn.dot(X)).normalize(), Y = V().crossVectors(Z, X);
    const holder = new THREE.Object3D(); holder.position.set(px, py, pz).addScaledVector(Z, 0.004);
    holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    const wb = new GB().mat(0x0b0b0c, 0.6);
    wb.box(len * 0.6, 0.012, 0.007, TR(len * 0.3, 0, 0.014)).box(len - 0.07, 0.009, 0.013, TR((len + 0.07) / 2, 0, 0.0065)).add(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), TR(0, 0, 0.01, Math.PI / 2));
    const arm = mesh(wb); holder.add(arm); wipers.push(arm); group.add(holder);
  }
  const paintMesh = mesh(pb, true);
  group.add(mesh(g), paintMesh, column, cluster, screen, mirrors.left, mirrors.center, mirrors.right);
  return {
    group, eye, steeringWheel, mirrors, screen, setGauges,
    setWipers(angle) { for (const w of wipers) w.rotation.z = angle; },
    setBodyColor(hex) { paintMesh.material = paintMat(hex); },
  };
}
