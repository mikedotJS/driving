// Piétons, cyclistes et usagers de trottinette — entièrement procéduraux (aucun asset).
//
// Piétons : UNE seule InstancedMesh (un draw call). Le maillage « humain » est découpé en
// segments rigides (bassin/torse, tête, bras, avant-bras, cuisses, tibias, pieds, accessoires) ;
// chaque sommet porte `partId` + `pivot` (articulation) et le vertex shader reconstruit la pose
// à partir du cycle de marche de l'instance : cinématique inverse à deux os pour les jambes
// (les pieds restent plantés au sol pendant l'appui, donc pas de glissement), balancement
// opposé des bras, rotation du bassin et des épaules, oscillation verticale. Le même code est
// injecté dans le matériau de profondeur pour que les ombres suivent les membres.
// Ombres reçues du soleil : échantillonnées sur l'axe du piéton (décalé vers la lumière), ce qui
// évite l'auto-ombrage crénelé d'un maillage basse définition tout en gardant l'ombre des immeubles.
//
// Cyclistes / trottinettes : un SkinnedMesh par usager (1 draw call), os rigides pour les roues,
// le pédalier et les jambes (IK calculée dans `update`).
//
// Conventions : mètres, +Y vers le haut, x = est, z = sud. `heading` = 0 vers le nord (−Z),
// croissant dans le sens horaire vu de dessus. Espace modèle : le personnage regarde −Z.

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Petits utilitaires
// ─────────────────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Générateur déterministe (mulberry32) à partir d'une graine quelconque. */
function makeRng(seed: number): () => number {
  let s = (Math.floor(seed * 7919) ^ 0x9e3779b9) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0;
  s = Math.imul(s ^ (s >>> 12), 0x297a2d39) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Squelette de référence (adulte de 1,75 m, chaussé)
// ─────────────────────────────────────────────────────────────────────────────

const REF_HEIGHT = 1.75;
const HIP_X = 0.088;
const HIP_Y = 0.91;
const KNEE_Y = 0.5;
const ANKLE_Y = 0.09;
const L_THIGH = HIP_Y - KNEE_Y;
const L_SHIN = KNEE_Y - ANKLE_Y;
const WAIST_Y = 1.1;
const CHEST_Y = 1.36;
const SH_X = 0.185;
const SH_Y = 1.405;
const SH_Z = 0.005;
const L_UARM = 0.31;
const EL_Y = SH_Y - L_UARM;
const L_FOREARM = 0.25; // coude → poignet
const NECK_Y = 1.5;
const NECK_Z = 0.005;
const HEAD_CY = 0.145; // centre de la tête au-dessus du pivot du cou
const HEAD_CZ = -0.012;
const HEAD_RX = 0.08;
const HEAD_RY_UP = 0.105;
const HEAD_RY_DOWN = 0.13;
const HEAD_RZ = 0.1;

/** Rayon de collision d'un piéton (m), pour la logique de jeu. */
export const PEDESTRIAN_RADIUS = 0.3;

// Emplacements de couleur (attribut `colorSlot`).
const SLOT_SKIN = 0;
const SLOT_TOP = 1;
const SLOT_BOTTOM = 2;
const SLOT_SHOES = 3;
const SLOT_HAIR = 4;
const SLOT_ACC = 5;
const SLOT_FOREARM = 6;
const SLOT_SHIN = 7;
const SLOT_UPPERARM = 8; // piétons : même couleur que le haut ; usagers : manche sous le gilet
const SLOT_HELMET = 9;
const SLOT_FRAME = 10;
const SLOT_TYRE = 11;
const SLOT_METAL = 12;
const SLOT_DARK = 13;
const SLOT_LIGHT_FRONT = 14;
const SLOT_LIGHT_REAR = 15;
const SLOT_ACCENT = 16;

// Identifiants de segment (attribut `partId`).
const PART_TRUNK = 0;
const PART_HEAD = 1;
const PART_HAIR_LONG = 2;
const PART_UARM_L = 3;
const PART_FARM_L = 4;
const PART_UARM_R = 5;
const PART_FARM_R = 6;
const PART_THIGH_L = 7;
const PART_SHIN_L = 8;
const PART_FOOT_L = 9;
const PART_THIGH_R = 10;
const PART_SHIN_R = 11;
const PART_FOOT_R = 12;
const PART_PACK = 13;
const PART_BAG = 14;
const PART_COAT = 15;

// Drapeaux d'apparence (par instance).
const FLAG_PACK = 1;
const FLAG_BAG = 2;
const FLAG_LONG_HAIR = 4;
const FLAG_COAT = 8;
const FLAG_PHONE = 16;

// ─────────────────────────────────────────────────────────────────────────────
// Construction de géométrie : « peaux » tendues sur des anneaux
// ─────────────────────────────────────────────────────────────────────────────

interface Part {
  pos: number[];
  nrm: number[];
  idx: number[];
  slot: number[];
  shade: number[];
}

type V3 = [number, number, number];

interface RingPts {
  pts: number[];
  slot: number;
  shade: number | number[];
}

interface Pole {
  p: V3;
  slot?: number;
  shade?: number;
}

function newPart(): Part {
  return { pos: [], nrm: [], idx: [], slot: [], shade: [] };
}

/** Oriente vers l'extérieur les triangles à partir de `triStart` (par rapport au point intérieur donné). */
function orientOutward(p: Part, triStart: number, ix: number, iy: number, iz: number): void {
  const P = p.pos;
  for (let t = triStart; t < p.idx.length; t += 3) {
    const a = p.idx[t] * 3;
    const b = p.idx[t + 1] * 3;
    const c = p.idx[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const cx = (P[a] + P[b] + P[c]) / 3 - ix;
    const cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - iy;
    const cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - iz;
    if (nx * cx + ny * cy + nz * cz < 0) {
      const tmp = p.idx[t + 1];
      p.idx[t + 1] = p.idx[t + 2];
      p.idx[t + 2] = tmp;
    }
  }
}

/** Normales lissées (pondérées par l'aire) ; `weld` fusionne les sommets confondus. */
function computeNormals(p: Part, weld: boolean): void {
  const P = p.pos;
  const n = new Float64Array(P.length);
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = p.idx[t] * 3;
    const b = p.idx[t + 1] * 3;
    const c = p.idx[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      n[v] += nx;
      n[v + 1] += ny;
      n[v + 2] += nz;
    }
  }
  if (weld) {
    const acc = new Map<string, [number, number, number]>();
    const keys: string[] = [];
    for (let v = 0; v < P.length; v += 3) {
      const k = `${Math.round(P[v] * 2e4)},${Math.round(P[v + 1] * 2e4)},${Math.round(P[v + 2] * 2e4)}`;
      keys.push(k);
      const e = acc.get(k);
      if (e) {
        e[0] += n[v];
        e[1] += n[v + 1];
        e[2] += n[v + 2];
      } else acc.set(k, [n[v], n[v + 1], n[v + 2]]);
    }
    for (let v = 0, i = 0; v < P.length; v += 3, i++) {
      const e = acc.get(keys[i])!;
      n[v] = e[0];
      n[v + 1] = e[1];
      n[v + 2] = e[2];
    }
  }
  p.nrm.length = 0;
  for (let v = 0; v < P.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    p.nrm.push(n[v] / l, n[v + 1] / l, n[v + 2] / l);
  }
}

function ringCentre(r: RingPts): V3 {
  let x = 0, y = 0, z = 0;
  const n = r.pts.length / 3;
  for (let i = 0; i < r.pts.length; i += 3) {
    x += r.pts[i];
    y += r.pts[i + 1];
    z += r.pts[i + 2];
  }
  return [x / n, y / n, z / n];
}

/** Tend une peau entre des anneaux successifs (même nombre de points), avec pôles optionnels. */
function skinRings(rings: RingPts[], top: Pole | null, bottom: Pole | null): Part {
  const part = newPart();
  const seg = rings[0].pts.length / 3;
  const start: number[] = [];
  const ctr: V3[] = [];
  for (const r of rings) {
    start.push(part.pos.length / 3);
    for (let j = 0; j < seg; j++) {
      part.pos.push(r.pts[j * 3], r.pts[j * 3 + 1], r.pts[j * 3 + 2]);
      part.slot.push(r.slot);
      part.shade.push(typeof r.shade === 'number' ? r.shade : r.shade[j]);
    }
    ctr.push(ringCentre(r));
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    const t0 = part.idx.length;
    const A = start[i];
    const B = start[i + 1];
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      // diagonales en miroir de part et d'autre du plan sagittal (ombrage symétrique)
      if (j * 2 < seg) part.idx.push(A + j, A + j1, B + j, A + j1, B + j1, B + j);
      else part.idx.push(A + j, A + j1, B + j1, A + j, B + j1, B + j);
    }
    orientOutward(part, t0, (ctr[i][0] + ctr[i + 1][0]) / 2, (ctr[i][1] + ctr[i + 1][1]) / 2, (ctr[i][2] + ctr[i + 1][2]) / 2);
  }
  const fan = (pole: Pole, ringIndex: number, inner: V3): void => {
    const v = part.pos.length / 3;
    part.pos.push(pole.p[0], pole.p[1], pole.p[2]);
    part.slot.push(pole.slot ?? rings[ringIndex].slot);
    const sh = rings[ringIndex].shade;
    part.shade.push(pole.shade ?? (typeof sh === 'number' ? sh : sh[0]));
    const t0 = part.idx.length;
    const A = start[ringIndex];
    for (let j = 0; j < seg; j++) part.idx.push(v, A + j, A + ((j + 1) % seg));
    orientOutward(part, t0, inner[0], inner[1], inner[2]);
  };
  if (top) fan(top, 0, ctr[Math.min(1, ctr.length - 1)]);
  if (bottom) fan(bottom, rings.length - 1, ctr[Math.max(0, ctr.length - 2)]);
  computeNormals(part, true);
  return part;
}

interface Ring {
  y: number;
  rx: number;
  rz?: number;
  rzF?: number; // demi-profondeur vers l'avant (−Z)
  rzB?: number; // demi-profondeur vers l'arrière (+Z)
  cx?: number;
  cz?: number;
  n?: number; // exposant de super-ellipse (2 = ellipse)
  slot?: number;
  shade?: number;
}

/** Anneau (super-)elliptique horizontal ; un sommet est toujours placé plein avant (−Z). */
function ellipseRing(r: Ring, seg: number, defSlot: number, defN = 2): RingPts {
  const pts: number[] = [];
  const n = r.n ?? defN;
  for (let j = 0; j < seg; j++) {
    const a = -Math.PI / 2 + (j / seg) * TAU;
    let c = Math.cos(a);
    let s = Math.sin(a);
    if (Math.abs(c) < 1e-9) c = 0;
    if (Math.abs(s) < 1e-9) s = 0;
    const ce = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const se = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    const rz = s < 0 ? (r.rzF ?? r.rz ?? r.rx) : (r.rzB ?? r.rz ?? r.rx);
    pts.push((r.cx ?? 0) + r.rx * ce, r.y, (r.cz ?? 0) + rz * se);
  }
  return { pts, slot: r.slot ?? defSlot, shade: r.shade ?? 1 };
}

function loft(rings: Ring[], seg: number, slot: number, top: Pole | null, bottom: Pole | null, n = 2): Part {
  return skinRings(rings.map((r) => ellipseRing(r, seg, slot, n)), top, bottom);
}

function transformPart(p: Part, m: THREE.Matrix4): Part {
  const out = newPart();
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < p.pos.length; i += 3) {
    v.set(p.pos[i], p.pos[i + 1], p.pos[i + 2]).applyMatrix4(m);
    out.pos.push(v.x, v.y, v.z);
    v.set(p.nrm[i], p.nrm[i + 1], p.nrm[i + 2]).applyMatrix3(nm).normalize();
    out.nrm.push(v.x, v.y, v.z);
  }
  out.idx = p.idx.slice();
  out.slot = p.slot.slice();
  out.shade = p.shade.slice();
  return out;
}

function translatePart(p: Part, x: number, y: number, z: number): Part {
  return transformPart(p, new THREE.Matrix4().makeTranslation(x, y, z));
}

function mergeParts(parts: Part[]): Part {
  const out = newPart();
  for (const p of parts) {
    const base = out.pos.length / 3;
    for (const v of p.pos) out.pos.push(v);
    for (const v of p.nrm) out.nrm.push(v);
    for (const v of p.slot) out.slot.push(v);
    for (const v of p.shade) out.shade.push(v);
    for (const i of p.idx) out.idx.push(base + i);
  }
  return out;
}

function recolor(p: Part, slot: number, shade = 1): Part {
  const out = transformPart(p, new THREE.Matrix4());
  out.slot.fill(slot);
  out.shade = out.shade.map((s) => s * shade);
  return out;
}

/** Boîte à faces planes. */
function boxPart(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, slot: number, shade = 1): Part {
  const p = newPart();
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces: [V3, V3, V3][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [n, u, v] of faces) {
    const base = p.pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      p.pos.push(
        cx + (n[0] + u[0] * su + v[0] * sv) * hx,
        cy + (n[1] + u[1] * su + v[1] * sv) * hy,
        cz + (n[2] + u[2] * su + v[2] * sv) * hz,
      );
      p.slot.push(slot);
      p.shade.push(shade);
    }
    const t0 = p.idx.length;
    p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    orientOutward(p, t0, cx, cy, cz);
  }
  computeNormals(p, false);
  return p;
}

/** Repère amenant l'espace canonique d'un membre (articulation à l'origine, membre vers −Y) sur le segment from→to. */
function limbFrame(from: THREE.Vector3, to: THREE.Vector3, lateral: THREE.Vector3, out = new THREE.Matrix4()): THREE.Matrix4 {
  const y = new THREE.Vector3().subVectors(from, to).normalize();
  const x = lateral.clone().addScaledVector(y, -lateral.dot(y));
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(y, -y.x);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  out.makeBasis(x, y, z);
  out.setPosition(from);
  return out;
}

/** Tube entre deux points (sans bouchons par défaut). */
function tubePart(a: THREE.Vector3, b: THREE.Vector3, r: number, slot: number, seg = 6, caps = false, r2 = r): Part {
  const len = a.distanceTo(b);
  const p = loft(
    [{ y: 0, rx: r }, { y: -len, rx: r2 }],
    seg,
    slot,
    caps ? { p: [0, 0, 0] } : null,
    caps ? { p: [0, -len, 0] } : null,
  );
  return transformPart(p, limbFrame(a, b, new THREE.Vector3(1, 0, 0.0001)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Segments du corps (espace canonique : articulation à l'origine, membre vers −Y)
// ─────────────────────────────────────────────────────────────────────────────

/** Bassin + torse + cou, en coordonnées « corps » (pieds à y = 0). */
function buildTrunk(): Part {
  const T = SLOT_TOP, B = SLOT_BOTTOM, S = SLOT_SKIN;
  return loft(
    [
      { y: 1.538, rx: 0.052, rzF: 0.052, rzB: 0.056, cz: 0.004, slot: S, n: 2 },
      { y: 1.494, rx: 0.057, rzF: 0.056, rzB: 0.062, cz: 0.008, slot: S, n: 2 },
      { y: 1.486, rx: 0.067, rzF: 0.062, rzB: 0.072, cz: 0.008, slot: T, n: 2 },
      { y: 1.468, rx: 0.118, rzF: 0.07, rzB: 0.086, cz: 0.006, slot: T, n: 2.2 },
      { y: 1.443, rx: 0.17, rzF: 0.084, rzB: 0.094, slot: T, n: 2.2 },
      { y: 1.345, rx: 0.174, rzF: 0.116, rzB: 0.104, slot: T },
      { y: 1.1, rx: 0.15, rzF: 0.107, rzB: 0.096, slot: T },
      { y: 0.96, rx: 0.168, rzF: 0.104, rzB: 0.117, slot: T },
      { y: 0.948, rx: 0.167, rzF: 0.102, rzB: 0.116, slot: B },
      { y: 0.874, rx: 0.167, rzF: 0.097, rzB: 0.119, slot: B },
      { y: 0.861, rx: 0.148, rzF: 0.084, rzB: 0.104, slot: B, shade: 0.85 },
    ],
    8,
    T,
    { p: [0, 1.556, 0.004] },
    { p: [0, 0.855, 0.004], shade: 0.8 },
    2.5,
  );
}

/** Tête en forme d'œuf (pivot du cou à l'origine), avec nez et menton. */
function buildHead(): Part {
  const seg = 8;
  // [hauteur / centre, demi-largeur, demi-profondeur avant, arrière, avance]
  const profile: [number, number, number, number, number][] = [
    [0.094, 0.037, 0.046, 0.046, 0],
    [0.064, 0.064, 0.08, 0.08, 0],
    [0.022, 0.079, 0.098, 0.099, 0],
    [-0.026, 0.078, 0.097, 0.09, 0.001],
    [-0.072, 0.066, 0.088, 0.074, 0.004],
    [-0.11, 0.042, 0.066, 0.04, 0.01],
  ];
  const rings: RingPts[] = profile.map(([y, rx, rzF, rzB, fwd], i) => {
    const r = ellipseRing({ y: HEAD_CY + y, rx, rzF, rzB, cz: HEAD_CZ - fwd }, seg, SLOT_SKIN, 2.15);
    // sommet 0 = plein avant : arcade, nez, bouche
    if (i === 2) r.pts[2] -= 0.003;
    if (i === 3) {
      r.pts[2] -= 0.02;
      r.pts[1] -= 0.006;
    }
    if (i === 4) r.pts[2] -= 0.005;
    return r;
  });
  const head = skinRings(rings, { p: [0, HEAD_CY + HEAD_RY_UP, HEAD_CZ] }, { p: [0, HEAD_CY - HEAD_RY_DOWN + 0.004, HEAD_CZ - 0.04] });
  // yeux : deux petits quadrilatères sombres posés sur le visage
  const eyes = newPart();
  for (const side of [-1, 1]) {
    const base = eyes.pos.length / 3;
    const y0 = HEAD_CY - 0.003, y1 = HEAD_CY + 0.009;
    const xi = side * 0.021, zi = HEAD_CZ - HEAD_RZ - 0.002;
    const xo = side * 0.041, zo = HEAD_CZ - HEAD_RZ + 0.011;
    eyes.pos.push(xi, y0, zi, xo, y0, zo, xo, y1, zo, xi, y1, zi);
    for (let k = 0; k < 4; k++) {
      eyes.slot.push(SLOT_SKIN);
      eyes.shade.push(0.1);
      eyes.nrm.push(side * 0.4, 0, -0.92);
    }
    if (side > 0) eyes.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else eyes.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return mergeParts([head, eyes]);
}

/** Calotte (cheveux ou casque) épousant le crâne, basculée vers l'arrière ; `edge(f)` = angle du bord (°) selon f = 1 devant … 0 côtés/arrière. */
function buildSkullCap(scale: number, extra: number, tilt: number, fracs: number[], edge: (front: number) => number, slot: number, tuck: boolean, seg = 8): Part {
  const rings: RingPts[] = [];
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const pt = (psiDeg: number, a: number): V3 => {
    const psi = (psiDeg * Math.PI) / 180;
    const dx = Math.sin(psi) * Math.cos(a);
    const dy0 = Math.cos(psi);
    const dz0 = Math.sin(psi) * Math.sin(a);
    const dy = dy0 * ct - dz0 * st;
    const dz = dy0 * st + dz0 * ct;
    const ry = dy >= 0 ? HEAD_RY_UP : HEAD_RY_DOWN * 0.92;
    return [dx * (HEAD_RX * scale + extra), HEAD_CY + dy * (ry * scale + extra), HEAD_CZ + dz * (HEAD_RZ * scale + extra)];
  };
  for (const fr of fracs) {
    const pts: number[] = [];
    for (let j = 0; j < seg; j++) {
      const a = -Math.PI / 2 + (j / seg) * TAU;
      const p = pt(fr * edge(Math.max(0, -Math.sin(a))), a);
      pts.push(p[0], p[1], p[2]);
    }
    rings.push({ pts, slot, shade: 1 });
  }
  const top = pt(0, 0);
  if (tuck) {
    // le bord de la calotte rentre dans le crâne : pas de jour entre les cheveux et la tête
    const last = rings[rings.length - 1].pts;
    const cz = HEAD_CZ + 0.004;
    for (let i = 0; i < last.length; i += 3) {
      last[i] *= 0.9;
      last[i + 1] = HEAD_CY + (last[i + 1] - HEAD_CY) * 0.9;
      last[i + 2] = cz + (last[i + 2] - cz) * 0.9;
    }
  }
  return skinRings(rings, { p: top }, null);
}

function buildHairCap(): Part {
  return buildSkullCap(1.06, 0.01, 0.3, [0.34, 0.64, 0.9, 1.04], (f) => 114 - 40 * f * f, SLOT_HAIR, true);
}

function buildHelmet(): Part {
  return buildSkullCap(1.16, 0.024, 0.1, [0.4, 0.75, 1], (f) => 88 - 8 * f, SLOT_HELMET, false);
}

/** Cheveux mi-longs tombant derrière la nuque (pivot du cou à l'origine). */
function buildLongHair(): Part {
  return loft(
    [
      { y: 0.19, rx: 0.074, rzF: 0.03, rzB: 0.03, cz: 0.064 },
      { y: 0.03, rx: 0.094, rzF: 0.052, rzB: 0.034, cz: 0.07 },
      { y: -0.12, rx: 0.086, rzF: 0.034, rzB: 0.024, cz: 0.08 },
    ],
    6,
    SLOT_HAIR,
    null,
    { p: [0, -0.15, 0.085] },
    2.4,
  );
}

function buildUpperArm(): Part {
  return loft(
    [
      { y: 0.018, rx: 0.04, rz: 0.045 },
      { y: -0.018, rx: 0.052, rz: 0.057 },
      { y: -L_UARM, rx: 0.042, rz: 0.044 },
    ],
    6,
    SLOT_UPPERARM,
    { p: [0, 0.038, 0] },
    { p: [0, -L_UARM - 0.034, 0] },
  );
}

/** Avant-bras + main (coude à l'origine). `fist` : main refermée (guidon). */
function buildForearm(fist: boolean): Part {
  const F = SLOT_FOREARM, S = SLOT_SKIN;
  const rings: Ring[] = [
    { y: -0.01, rx: 0.039, rz: 0.041, slot: F },
    { y: -L_FOREARM + 0.008, rx: 0.031, rz: 0.033, slot: F },
    { y: -L_FOREARM - 0.004, rx: 0.024, rz: 0.028, slot: S },
  ];
  if (fist) {
    rings.push({ y: -L_FOREARM - 0.05, rx: 0.03, rz: 0.04, cz: -0.006, slot: S });
    rings.push({ y: -L_FOREARM - 0.1, rx: 0.028, rz: 0.036, cz: -0.012, slot: S });
    return loft(rings, 6, F, { p: [0, 0.034, 0] }, { p: [0, -L_FOREARM - 0.118, -0.012], slot: S });
  }
  rings.push({ y: -L_FOREARM - 0.058, rx: 0.026, rz: 0.04, cz: -0.004, slot: S });
  rings.push({ y: -L_FOREARM - 0.138, rx: 0.022, rz: 0.032, cz: -0.02, slot: S });
  return loft(rings, 6, F, { p: [0, 0.03, 0] }, { p: [0, -L_FOREARM - 0.152, -0.024], slot: S });
}

function buildThigh(side: number): Part {
  return loft(
    [
      { y: 0.02, cx: -side * 0.011, rx: 0.077, rzF: 0.078, rzB: 0.09 },
      { y: -L_THIGH, rx: 0.055, rzF: 0.059, rzB: 0.055 },
      { y: -L_THIGH - 0.034, rx: 0.041, rz: 0.041 },
    ],
    6,
    SLOT_BOTTOM,
    { p: [-side * 0.011, 0.07, 0] },
    { p: [0, -L_THIGH - 0.05, 0] },
  );
}

function buildShin(): Part {
  return loft(
    [
      { y: -0.005, rx: 0.054, rzF: 0.055, rzB: 0.055 },
      { y: -0.14, rx: 0.05, rzF: 0.047, rzB: 0.058 },
      { y: -L_SHIN + 0.022, rx: 0.046, rzF: 0.048, rzB: 0.052 },
    ],
    6,
    SLOT_SHIN,
    { p: [0, 0.046, 0] },
    { p: [0, -L_SHIN + 0.012, 0] },
  );
}

/** Chaussure (cheville à l'origine, pointe vers −Z, semelle à y = −ANKLE_Y). */
function buildFoot(): Part {
  const bottom = -ANKLE_Y;
  const secs: [number, number, number][] = [
    [0.045, 0.035, -0.012],
    [-0.04, 0.047, -0.01],
    [-0.125, 0.051, -0.044],
    [-0.186, 0.037, -0.054],
  ];
  const rings: RingPts[] = secs.map(([z, hw, top]) => {
    const mid = bottom + 0.42 * (top - bottom);
    return {
      pts: [-hw * 0.82, bottom, z, hw * 0.82, bottom, z, hw, mid, z, hw * 0.6, top, z, -hw * 0.6, top, z, -hw, mid, z],
      slot: SLOT_SHOES,
      shade: [0.5, 0.5, 0.92, 1, 1, 0.92],
    };
  });
  return skinRings(rings, { p: [0, bottom + 0.035, 0.07], shade: 0.9 }, { p: [0, bottom + 0.018, -0.2], shade: 0.85 });
}

function buildBackpack(): Part {
  return loft(
    [
      { y: 1.4, rx: 0.112, rzF: 0.03, rzB: 0.055, cz: 0.132 },
      { y: 1.24, rx: 0.138, rzF: 0.04, rzB: 0.098, cz: 0.14 },
      { y: 1.07, rx: 0.126, rzF: 0.035, rzB: 0.085, cz: 0.138 },
    ],
    6,
    SLOT_ACC,
    { p: [0, 1.43, 0.13] },
    { p: [0, 1.035, 0.14], shade: 0.8 },
    3.2,
  );
}

/** Sac porté à l'épaule droite, avec ses deux anses. */
function buildBag(): Part {
  const bag = loft(
    [
      { y: 1.0, rx: 0.036, rz: 0.12, cx: 0.225, cz: 0.03 },
      { y: 0.8, rx: 0.05, rz: 0.135, cx: 0.225, cz: 0.03 },
    ],
    4,
    SLOT_ACC,
    { p: [0.225, 1.005, 0.03] },
    { p: [0.225, 0.785, 0.03], shade: 0.8 },
    4,
  );
  const top = new THREE.Vector3(0.168, 1.47, 0.012);
  const s1 = tubePart(new THREE.Vector3(0.222, 1.0, -0.05), top, 0.011, SLOT_ACC, 3);
  const s2 = tubePart(new THREE.Vector3(0.222, 1.0, 0.1), top, 0.011, SLOT_ACC, 3);
  return mergeParts([bag, recolor(s1, SLOT_ACC, 0.85), recolor(s2, SLOT_ACC, 0.85)]);
}

/** Pan de manteau (du bassin à mi-cuisse), ouvert en bas ; déformé par les cuisses dans le shader. */
function buildCoat(): Part {
  return loft(
    [
      { y: 0.985, rx: 0.176, rzF: 0.11, rzB: 0.121 },
      { y: 0.8, rx: 0.187, rzF: 0.116, rzB: 0.128 },
      { y: 0.61, rx: 0.197, rzF: 0.124, rzB: 0.136, shade: 0.94 },
    ],
    8,
    SLOT_TOP,
    null,
    null,
    2.5,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Apparence : tailles, corpulences, couleurs de vêtements
// ─────────────────────────────────────────────────────────────────────────────

const SKIN_TONES = [0xf3d6c2, 0xecc5a8, 0xe2b48f, 0xd3a077, 0xc08a5f, 0xa8744c, 0x8c5c3d, 0x6f4630, 0x543424, 0x3f281c];
const HAIR_DARK = [0x14100d, 0x1e1611, 0x2b1d14, 0x3a281b];
const HAIR_LIGHT = [0x4b3322, 0x6b4a2e, 0x8b6a41, 0xb89760, 0xd0b074, 0x7c3d20, 0x8f8f8c, 0xcfccc6, 0x5b5b5a];
const TOPS_NEUTRAL = [
  0x1e2942, 0x18191c, 0x2f3237, 0x4a4e55, 0x70747b, 0xb5a384, 0x9c7a50, 0x4b533f, 0x263e30, 0x4a372b, 0x3e5878, 0xd9d6cd,
  0x222a35, 0x595048, 0x8a8f96, 0xc9c2b2, 0x15161a, 0x2a3350,
];
const TOPS_ACCENT = [0x9e2c27, 0xb98c2f, 0x24509a, 0xad6078, 0xb85a2a, 0x1f6f6b, 0x5b1e29, 0x64487f, 0x3b7f49, 0xe0ded8];
const BOTTOMS = [
  0x26334b, 0x3c5473, 0x6f88a3, 0x17171a, 0x2c2e33, 0x54575d, 0xab9877, 0x69664a, 0x47382b, 0x1b2236, 0x1d1d22, 0x34425c,
  0x8a8d90, 0x2f3b35,
];
const SHOES = [0xe4e2dc, 0xdcdad3, 0x131313, 0x1c1c1e, 0x452d1e, 0x505357, 0x93703f, 0x161618, 0x2a3550, 0xbfbab0, 0x3a2a20, 0x8a2a2a];
const ACCESSORIES = [0x1a1a1d, 0x1d2640, 0x484b52, 0x85592f, 0x9c2b2b, 0x4a5340, 0x2a59a8, 0xc9a02c, 0x6a6e75, 0x2f6b62, 0x111113];
const HIVIS = 0xd4e21e;
const HELMETS = [0xe8e8e4, 0x1a1a1c, 0xb02a26, 0x2552a0, 0x6f7479, 0xd9c530, 0x2f7a5a];
const BIKE_FRAMES = [0x1c1d20, 0x8a9096, 0x1f3d6b, 0x7a1f1f, 0x2c5a48, 0xd8d6cf, 0x59636b, 0x8a6a2f];

interface Look {
  height: number;
  build: number;
  shoulders: number;
  headScale: number;
  scale: number; // facteur d'échelle uniforme de l'instance
  flags: number;
  child: boolean;
  skin: number;
  top: number;
  bottom: number;
  shoes: number;
  hair: number;
  acc: number;
  forearm: number;
  shin: number;
}

/** Apparence aléatoire mais déterministe. */
function makeLook(seed: number, adultOnly = false): Look {
  const rnd = makeRng(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length) % arr.length];
  const tri = (): number => (rnd() + rnd()) / 2;

  const child = !adultOnly && rnd() < 0.09;
  const feminine = rnd() < 0.5;
  let height: number;
  if (child) height = 1.08 + rnd() * 0.3;
  else if (feminine) height = clamp(1.5 + tri() * 0.3, 1.5, 1.82);
  else height = clamp(1.6 + tri() * 0.32, 1.58, 1.9);
  const build = child ? 0.9 + rnd() * 0.12 : clamp(0.86 + tri() * 0.3 + (rnd() < 0.12 ? 0.1 : 0), 0.86, 1.24);
  const shoulders = child ? 0.9 + rnd() * 0.05 : feminine ? 0.87 + rnd() * 0.08 : 0.98 + rnd() * 0.08;

  // Tête proportionnellement plus grosse chez les petits gabarits (enfants).
  let scale = height / REF_HEIGHT;
  let headScale = 1;
  for (let i = 0; i < 3; i++) {
    headScale = clamp(Math.pow(1 / scale, 0.62), 0.94, 1.32);
    const modelHeight = NECK_Y + (HEAD_CY + HEAD_RY_UP + 0.012) * headScale;
    scale = height / modelHeight;
  }

  const skinIdx = Math.floor(Math.pow(rnd(), 0.85) * SKIN_TONES.length) % SKIN_TONES.length;
  const skin = SKIN_TONES[skinIdx];
  let hair = skinIdx >= 5 || rnd() < 0.45 ? pick(HAIR_DARK) : pick(HAIR_LIGHT);
  const top = rnd() < 0.15 ? pick(TOPS_ACCENT) : pick(TOPS_NEUTRAL);
  const bottom = pick(BOTTOMS);
  const shoes = pick(SHOES);
  const acc = pick(ACCESSORIES);

  let flags = 0;
  const rAcc = rnd();
  if (rAcc < (child ? 0.55 : 0.27)) flags |= FLAG_PACK;
  else if (rAcc < 0.5 && !child) flags |= FLAG_BAG;
  if (rnd() < (feminine ? 0.62 : 0.06)) flags |= FLAG_LONG_HAIR;
  const coat = !child && rnd() < 0.26;
  if (coat) flags |= FLAG_COAT;
  if (!child && !(flags & FLAG_BAG) && rnd() < 0.1) flags |= FLAG_PHONE;

  const shortSleeves = !coat && rnd() < 0.2;
  const bareLegs = rnd() < (coat ? 0.3 : shortSleeves ? 0.4 : 0.06);
  const rHead = rnd();
  if (!feminine && !child && rHead < 0.07) hair = skin; // crâne rasé
  else if (rHead > 0.9 && !(flags & FLAG_LONG_HAIR)) hair = pick([0x1b1b1e, 0x2a3350, 0x5b1e29, 0x54575d, 0xb5a384, 0x263e30]); // bonnet
  const tights = bareLegs && rnd() < 0.45;

  return {
    height,
    build,
    shoulders,
    headScale,
    scale,
    flags,
    child,
    skin,
    top,
    bottom,
    shoes,
    hair,
    acc,
    forearm: shortSleeves ? skin : top,
    shin: bareLegs ? (tights ? 0x1b1b1f : skin) : bottom,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Piétons : géométrie fusionnée + shader d'animation
// ─────────────────────────────────────────────────────────────────────────────

interface HumanGeometry {
  geometry: THREE.BufferGeometry;
  triangles: number;
}

let humanGeometryCache: HumanGeometry | null = null;

function buildHumanGeometry(): HumanGeometry {
  if (humanGeometryCache) return humanGeometryCache;
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const partId: number[] = [];
  const pivot: number[] = [];
  const slot: number[] = [];

  const add = (p: Part, id: number, px: number, py: number, pz: number): void => {
    const base = pos.length / 3;
    for (let i = 0; i < p.pos.length; i += 3) {
      pos.push(p.pos[i], p.pos[i + 1], p.pos[i + 2]);
      nrm.push(p.nrm[i], p.nrm[i + 1], p.nrm[i + 2]);
      const s = p.shade[i / 3];
      col.push(s, s, s);
      partId.push(id);
      pivot.push(px, py, pz);
      const sl = p.slot[i / 3];
      slot.push(sl === SLOT_UPPERARM ? SLOT_TOP : sl);
    }
    for (const i of p.idx) idx.push(base + i);
  };
  const at = (p: Part, x: number, y: number, z: number): Part => translatePart(p, x, y, z);

  add(buildTrunk(), PART_TRUNK, 0, HIP_Y, 0);
  add(at(mergeParts([buildHead(), buildHairCap()]), 0, NECK_Y, NECK_Z), PART_HEAD, 0, NECK_Y, NECK_Z);
  add(at(buildLongHair(), 0, NECK_Y, NECK_Z), PART_HAIR_LONG, 0, NECK_Y, NECK_Z);

  const upper = buildUpperArm();
  const fore = buildForearm(false);
  const shin = buildShin();
  const foot = buildFoot();
  for (const side of [-1, 1]) {
    const L = side < 0;
    const thigh = buildThigh(side);
    add(at(upper, side * SH_X, SH_Y, SH_Z), L ? PART_UARM_L : PART_UARM_R, side * SH_X, SH_Y, SH_Z);
    add(at(fore, side * SH_X, EL_Y, SH_Z), L ? PART_FARM_L : PART_FARM_R, side * SH_X, EL_Y, SH_Z);
    add(at(thigh, side * HIP_X, HIP_Y, 0), L ? PART_THIGH_L : PART_THIGH_R, side * HIP_X, HIP_Y, 0);
    add(at(shin, side * HIP_X, KNEE_Y, 0), L ? PART_SHIN_L : PART_SHIN_R, side * HIP_X, KNEE_Y, 0);
    const toeOut = new THREE.Matrix4().makeRotationY(-side * 0.14);
    add(at(transformPart(foot, toeOut), side * HIP_X, ANKLE_Y, 0), L ? PART_FOOT_L : PART_FOOT_R, side * HIP_X, ANKLE_Y, 0);
  }
  add(buildBackpack(), PART_PACK, 0, 1.2, 0);
  add(buildBag(), PART_BAG, 0, 1.2, 0);
  add(buildCoat(), PART_COAT, 0, 1.2, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('partId', new THREE.Float32BufferAttribute(partId, 1));
  geometry.setAttribute('pivot', new THREE.Float32BufferAttribute(pivot, 3));
  geometry.setAttribute('colorSlot', new THREE.Float32BufferAttribute(slot, 1));
  geometry.setIndex(idx);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-0.7, 0, -0.9), new THREE.Vector3(0.7, 1.95, 0.9));
  humanGeometryCache = { geometry, triangles: idx.length / 3 };
  return humanGeometryCache;
}

/** Longueur de foulée (m, espace modèle 1,75 m) en fonction de la vitesse — DOIT rester identique au GLSL. */
function strideLength(v: number): number {
  const r = smoothstep(2.3, 3.1, v);
  return lerp(0.62 + 0.55 * v, 0.7 + 0.5 * v, r);
}

const g = (n: number): string => n.toFixed(5);

const PED_VERTEX_PARS = /* glsl */ `
#define PED_PI 3.14159265359
#define PED_HIP_Y ${g(HIP_Y)}
#define PED_ANKLE_Y ${g(ANKLE_Y)}
#define PED_L1 ${g(L_THIGH)}
#define PED_L2 ${g(L_SHIN)}
#define PED_REACH ${g((L_THIGH + L_SHIN) * 0.998)}
#define PED_WAIST_Y ${g(WAIST_Y)}
#define PED_CHEST_Y ${g(CHEST_Y)}
#define PED_SH_X ${g(SH_X)}
#define PED_SH_Y ${g(SH_Y)}
#define PED_SH_Z ${g(SH_Z)}
#define PED_EL_Y ${g(EL_Y)}
#define PED_NECK_Y ${g(NECK_Y)}
#define PED_NECK_Z ${g(NECK_Z)}

attribute float partId;
attribute vec3 pivot;
attribute vec4 aAnim; // x : cycle de marche [0,1[, y : vitesse (m/s, espace modèle), z : échelle, w : corpulence
attribute vec4 aLook; // x : drapeaux, y : largeur d'épaules, z : graine [0,1[, w : échelle de la tête
uniform float uPedTime;

mat3 pedRX( float a ) { float c = cos( a ), s = sin( a ); return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, - s, c ); }
mat3 pedRY( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, 0.0, - s, 0.0, 1.0, 0.0, s, 0.0, c ); }
mat3 pedRZ( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, s, 0.0, - s, c, 0.0, 0.0, 0.0, 1.0 ); }
bool pedFlag( float bit ) { return mod( floor( aLook.x / bit + 0.01 ), 2.0 ) > 0.5; }

struct PedBody {
	vec3 off;      // déplacement du bassin
	float yawP;    // rotation du bassin (axe vertical)
	float yawT;    // rotation des épaules
	float listP;   // inclinaison latérale du bassin
	float listT;
	float lean;    // inclinaison du buste vers l'avant
	float w;       // poids « marche » (0 = immobile)
	float r;       // poids « course »
	float a2;      // angle du cycle
	float S;       // longueur de foulée
	float d;       // fraction d'appui
	float idleT;   // temps décalé par instance
};

PedBody pedBody() {
	PedBody b;
	float v = aAnim.y;
	b.w = smoothstep( 0.03, 0.45, v );
	b.r = smoothstep( 2.3, 3.1, v );
	b.S = mix( 0.62 + 0.55 * v, 0.7 + 0.5 * v, b.r );
	b.d = min( 0.62, mix( 0.94, 0.80, b.r ) / b.S );
	b.a2 = 6.28318530718 * aAnim.x;
	b.idleT = uPedTime + aLook.z * 61.0;
	float idle = 1.0 - b.w;
	float breath = sin( b.idleT * 1.7 );
	float bobW = - 0.0225 - 0.0175 * cos( 2.0 * b.a2 - 0.38 );
	float bobR = - 0.035 - 0.030 * cos( 2.0 * b.a2 - 1.885 );
	float stance = ( fract( aLook.z * 13.7 ) - 0.5 ) * idle;
	float swayI = 0.011 * sin( b.idleT * 0.43 ) + 0.005 * sin( b.idleT * 0.9 + 1.3 );
	b.off = vec3(
		- mix( 0.018, 0.008, b.r ) * sin( b.a2 ) * b.w + swayI * idle,
		mix( bobW, bobR, b.r ) * b.w - 0.004 + ( 0.0015 * breath - 0.012 * abs( stance ) ) * idle,
		0.0 );
	float cy = cos( b.a2 + 0.2 );
	b.yawP = - mix( 0.09, 0.15, b.r ) * cy * b.w + 0.3 * stance;
	b.yawT = mix( 0.10, 0.22, b.r ) * cy * b.w;
	b.listP = - mix( 0.045, 0.03, b.r ) * sin( b.a2 ) * b.w + swayI * 1.5 * idle;
	b.listT = 0.02 * sin( b.a2 ) * b.w;
	b.lean = 0.012 + mix( 0.03, 0.15, b.r ) * b.w + 0.006 * breath * idle;
	return b;
}

// Transforme un point du tronc (pose de repos) ; tw = 0 au bassin, 1 aux épaules.
vec3 pedTrunk( vec3 p, float tw, PedBody b, out mat3 R ) {
	mat3 Rl = pedRX( - b.lean * tw );
	mat3 Rb = pedRY( mix( b.yawP, b.yawT, tw ) ) * pedRZ( mix( b.listP, b.listT, tw ) );
	R = Rb * Rl;
	vec3 q = Rl * ( p - vec3( 0.0, PED_WAIST_Y, 0.0 ) ) + vec3( 0.0, PED_WAIST_Y - PED_HIP_Y, 0.0 );
	return Rb * q + vec3( 0.0, PED_HIP_Y, 0.0 ) + b.off;
}

// Cible de la cheville dans le repère du corps : ( avance, hauteur, tangage du pied ).
vec3 pedAnkle( float u, PedBody b, float hipH, float hipF ) {
	const float aH = PED_ANKLE_Y;
	const float PV = 0.185; // distance cheville → point de pivot sous les orteils
	float heel = mix( 0.30, 0.10, b.r );
	float fFront = mix( 0.345 * b.S * b.d, 0.20, b.r );
	float us = min( u, b.d );
	float p = fFront - b.S * us; // cheville « pied à plat » : recule exactement à la vitesse du corps
	float beta = 0.0;
	if ( p < 0.0 ) {
		// déroulé du pied : lève le talon juste assez pour que la jambe atteigne encore le sol
		float Px = p + PV - hipF;
		float K = Px * Px + PV * PV + aH * aH + hipH * hipH;
		float A = - 2.0 * ( Px * PV + hipH * aH );
		float B = 2.0 * ( Px * aH - hipH * PV );
		float C = PED_REACH * PED_REACH - K;
		if ( C < A ) beta = atan( B, A ) + acos( clamp( C / sqrt( A * A + B * B ), - 1.0, 1.0 ) );
	}
	// fin d'appui : le talon se lève un peu plus que nécessaire → le genou fléchit avant le décollement des orteils
	float late = smoothstep( b.d - 0.26, b.d, us );
	float push = mix( 1.1, 1.0, b.r ) * pow( late, 1.6 );
	beta = clamp( max( beta + 0.34 * late, push ), 0.0, 1.4 );
	float cb = cos( beta ), sb = sin( beta );
	float f = p + PV - PV * cb + aH * sb;
	float h = PV * sb + aH * cb;
	float hs = heel * ( 1.0 - smoothstep( 0.0, 0.07, u ) );
	float pitch = beta - hs;
	h += 0.065 * sin( hs );
	if ( u > b.d ) {
		// phase d'oscillation
		float t = ( u - b.d ) / ( 1.0 - b.d );
		float t2 = t * t, t3 = t2 * t;
		float m = - b.S * ( 1.0 - b.d );
		f = ( 2.0 * t3 - 3.0 * t2 + 1.0 ) * f + ( t3 - 2.0 * t2 + t ) * ( m * 0.5 )
			+ ( - 2.0 * t3 + 3.0 * t2 ) * fFront + ( t3 - t2 ) * m;
		float hEnd = aH + 0.065 * sin( heel );
		h = mix( h, hEnd, smoothstep( 0.0, 0.85, t ) ) + mix( 0.05, 0.30, b.r ) * 6.75 * t * ( 1.0 - t ) * ( 1.0 - t );
		pitch = mix( beta, - heel, smoothstep( 0.0, 0.8, t ) );
	}
	return vec3( f, h, pitch );
}

struct PedLeg { vec3 hip; vec3 knee; vec3 ankle; mat3 Rt; mat3 Rs; float pitch; float thA; };

PedLeg pedLeg( float side, float hipX, PedBody b ) {
	PedLeg L;
	mat3 Rp;
	L.hip = pedTrunk( vec3( side * hipX, PED_HIP_Y, 0.0 ), 0.0, b, Rp );
	float u = fract( aAnim.x + ( side < 0.0 ? 0.0 : 0.5 ) );
	// à l'arrêt : appui légèrement décalé (un pied un peu en avant), propre à chaque piéton
	float stag = side * ( fract( aLook.z * 13.7 ) - 0.5 ) * 0.16;
	vec3 tg = mix( vec3( stag, PED_ANKLE_Y, 0.0 ), pedAnkle( u, b, L.hip.y, - L.hip.z ), b.w );
	float footX = side * hipX * mix( 1.0, 0.62, b.w );
	vec3 dv = vec3( footX, tg.y, - tg.x ) - L.hip;
	float D = clamp( length( dv ), 0.25, PED_REACH );
	float tilt = atan( dv.x, - dv.y );
	float gam = atan( - dv.z, length( dv.xy ) );
	float ca = ( PED_L1 * PED_L1 + D * D - PED_L2 * PED_L2 ) / ( 2.0 * PED_L1 * D );
	float thA = gam + acos( clamp( ca, - 1.0, 1.0 ) );
	float ck = ( PED_L1 * PED_L1 + PED_L2 * PED_L2 - D * D ) / ( 2.0 * PED_L1 * PED_L2 );
	float kn = PED_PI - acos( clamp( ck, - 1.0, 1.0 ) );
	mat3 Rz = pedRZ( tilt );
	L.Rt = Rz * pedRX( thA );
	L.Rs = Rz * pedRX( thA - kn );
	L.knee = L.hip + L.Rt * vec3( 0.0, - PED_L1, 0.0 );
	L.ankle = L.knee + L.Rs * vec3( 0.0, - PED_L2, 0.0 );
	L.pitch = tg.z;
	L.thA = thA;
	return L;
}

void pedAnimate( inout vec3 P, inout vec3 N ) {
	int part = int( partId + 0.5 );
	float bx = aAnim.w;
	float bz = mix( 1.0, bx, 0.85 );
	float bl = mix( 1.0, bx, 0.8 );
	float sr = aLook.y;
	float hr = 1.0 + ( 1.0 - sr ) * 0.5;
	PedBody b = pedBody();
	float idle = 1.0 - b.w;
	bool phone = pedFlag( ${g(FLAG_PHONE)} );
	mat3 R;

	if ( part == ${PART_TRUNK} ) {

		float tw = smoothstep( PED_HIP_Y - 0.03, PED_CHEST_Y, P.y );
		P.x *= bx * mix( hr, sr, smoothstep( PED_HIP_Y, PED_SH_Y, P.y ) );
		P.z *= bz;
		P = pedTrunk( P, tw, b, R );
		N = R * N;

	} else if ( part == ${PART_HEAD} || part == ${PART_HAIR_LONG} ) {

		if ( part == ${PART_HAIR_LONG} && ! pedFlag( ${g(FLAG_LONG_HAIR)} ) ) { P = vec3( 0.0, PED_NECK_Y + 0.12, 0.0 ); }
		vec3 neck = pedTrunk( vec3( 0.0, PED_NECK_Y, PED_NECK_Z * bz ), 1.0, b, R );
		float look = 0.5 * sin( b.idleT * 0.31 ) * sin( b.idleT * 0.117 + 2.0 ) * idle;
		float nod = - 0.09 - 0.3 * b.lean + ( phone ? - 0.36 * ( 1.0 - b.r ) : 0.0 );
		mat3 Rh = pedRY( b.yawT * 0.3 + look ) * pedRX( nod );
		P = neck + Rh * ( ( P - pivot ) * aLook.w );
		N = Rh * N;

	} else if ( part >= ${PART_UARM_L} && part <= ${PART_FARM_R} ) {

		float side = pivot.x < 0.0 ? - 1.0 : 1.0;
		vec3 lp = P - pivot;
		lp.xz *= bl;
		vec3 sh = pedTrunk( vec3( side * PED_SH_X * bx * sr, PED_SH_Y, PED_SH_Z ), 1.0, b, R );
		float vary = 0.75 + 0.5 * fract( aLook.z * 7.31 );
		float amp = mix( min( 0.5, 0.14 + 0.2 * aAnim.y ), 0.62, b.r ) * b.w * vary;
		float cs = side * cos( b.a2 + 0.3 );
		float sw = amp * cs + mix( 0.03, - 0.14, b.r ) * b.w;
		float f01 = 0.5 + 0.5 * cs;
		float elb = mix( 0.14, mix( 0.16 + 0.42 * f01, 1.3 + 0.4 * f01, b.r ), b.w );
		float abd = 0.07 + 0.03 * ( bx - 1.0 ) + 0.004 * sin( b.idleT * 1.7 ) * idle;
		float inw = 0.12 + 0.3 * b.r * b.w;
		if ( side > 0.0 && phone ) {
			float ph = 1.0 - b.r;
			sw = mix( sw, 0.28 + 0.1 * sw, ph ); elb = mix( elb, 1.95, ph ); abd = mix( abd, 0.02, ph ); inw = mix( inw, 0.55, ph );
		} else if ( side > 0.0 && pedFlag( ${g(FLAG_BAG)} ) ) { sw = 0.25 * sw - 0.05; abd += 0.1; elb = 0.3 + 0.3 * elb; }
		mat3 Ru = R * pedRZ( side * abd ) * pedRX( sw );
		if ( part == ${PART_UARM_L} || part == ${PART_UARM_R} ) {
			P = sh + Ru * lp;
			N = Ru * N;
		} else {
			mat3 Rf = Ru * pedRY( side * inw ) * pedRX( elb );
			P = sh + Ru * vec3( 0.0, PED_EL_Y - PED_SH_Y, 0.0 ) + Rf * lp;
			N = Rf * N;
		}

	} else if ( part <= ${PART_FOOT_R} ) {

		float side = pivot.x < 0.0 ? - 1.0 : 1.0;
		vec3 lp = P - pivot;
		PedLeg L = pedLeg( side, abs( pivot.x ) * bx * hr, b );
		if ( part == ${PART_THIGH_L} || part == ${PART_THIGH_R} ) {
			lp.xz *= bl;
			P = L.hip + L.Rt * lp;
			N = L.Rt * N;
		} else if ( part == ${PART_SHIN_L} || part == ${PART_SHIN_R} ) {
			lp.xz *= bl;
			P = L.knee + L.Rs * lp;
			N = L.Rs * N;
		} else {
			lp.x *= mix( 1.0, bx, 0.35 );
			mat3 Rf = pedRX( - L.pitch );
			P = L.ankle + Rf * lp;
			N = Rf * N;
		}

	} else if ( part == ${PART_PACK} ) {

		if ( ! pedFlag( ${g(FLAG_PACK)} ) ) { P = pivot; }
		P.x *= bx * sr;
		P.z *= bz;
		P = pedTrunk( P, 1.0, b, R );
		N = R * N;

	} else if ( part == ${PART_BAG} ) {

		if ( ! pedFlag( ${g(FLAG_BAG)} ) ) { P = pivot; }
		P.x *= bx * mix( hr, sr, 0.5 );
		P.z *= bz;
		P = pedTrunk( P, 0.75, b, R );
		N = R * N;

	} else {

		// pan de manteau : suit le bassin, repoussé par les cuisses
		if ( ! pedFlag( ${g(FLAG_COAT)} ) ) {
			P = pedTrunk( pivot, 0.0, b, R );
		} else {
			float hang = clamp( ( 0.985 - P.y ) / 0.375, 0.0, 1.0 );
			float drop = PED_HIP_Y + 0.03 - P.y;
			float frontness = clamp( - P.z * 15.0, - 1.0, 1.0 );
			float wL = smoothstep( 0.1, - 0.02, P.x ), wR = smoothstep( - 0.1, 0.02, P.x );
			P.x *= bx * hr;
			P.z *= bz;
			float hipX = ${g(HIP_X)} * bx * hr;
			PedLeg LL = pedLeg( - 1.0, hipX, b );
			PedLeg LR = pedLeg( 1.0, hipX, b );
			float tl = sin( LL.thA ), tr = sin( LR.thA );
			float pushF = max( 0.0, max( tl * wL, tr * wR ) );
			float pushB = max( 0.0, max( - tl * wL, - tr * wR ) );
			float tw = smoothstep( PED_HIP_Y - 0.03, PED_CHEST_Y, P.y );
			P = pedTrunk( P, tw, b, R );
			N = R * N;
			float dz = hang * drop * ( max( frontness, 0.0 ) * pushF * 1.12 - max( - frontness, 0.0 ) * pushB * 1.0 );
			P.z -= dz;
			P.y += hang * abs( dz ) * 0.25;
		}

	}
}
`;

const PED_COLOR_PARS = /* glsl */ `
attribute float colorSlot;
attribute vec4 aColA; // peau, haut, bas, chaussures (sRGB 8 bits compactés)
attribute vec4 aColB; // cheveux, accessoire, avant-bras, bas de jambe

vec3 pedUnpack( float p ) {
	float r = floor( p / 65536.0 );
	float g = floor( ( p - r * 65536.0 ) / 256.0 );
	float bl = p - r * 65536.0 - g * 256.0;
	vec3 c = vec3( r, g, bl ) / 255.0;
	return c * ( c * ( c * 0.305306011 + 0.682171111 ) + 0.012522878 );
}

// Décalage horizontal (≈ 0,5 m) vers la source d'une lumière directionnelle, déduit de sa matrice d'ombre.
vec3 pedTowardLight( mat4 m ) {
	vec3 l = cross( vec3( m[ 0 ][ 0 ], m[ 1 ][ 0 ], m[ 2 ][ 0 ] ), vec3( m[ 0 ][ 1 ], m[ 1 ][ 1 ], m[ 2 ][ 1 ] ) );
	vec2 h = l.xz / max( length( l ), 1e-9 );
	return vec3( h.x, 0.0, h.y ) * ( 0.5 / max( length( h ), 0.3 ) );
}

vec3 pedTint() {
	float s = colorSlot;
	float pk = s < 0.5 ? aColA.x : s < 1.5 ? aColA.y : s < 2.5 ? aColA.z : s < 3.5 ? aColA.w
		: s < 4.5 ? aColB.x : s < 5.5 ? aColB.y : s < 6.5 ? aColB.z : aColB.w;
	return pedUnpack( pk );
}
`;

function patchPedestrianMaterial(material: THREE.Material, timeUniform: { value: number }, withColor: boolean): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPedTime = timeUniform;
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>\n${PED_VERTEX_PARS}\n${withColor ? PED_COLOR_PARS : ''}`);
    if (withColor) {
      vs = vs.replace('#include <color_vertex>', `#include <color_vertex>\n\tvColor.rgb *= pedTint();`);
      vs = vs.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>\n\tvec3 pedP = vec3( position );\n\tpedAnimate( pedP, objectNormal );`,
      );
      vs = vs.replace('#include <begin_vertex>', `vec3 transformed = pedP;`);
      // Ombres reçues du soleil : échantillonnées sur l'axe vertical du piéton, décalé vers la lumière.
      // Le piéton passe bien à l'ombre des immeubles, sans auto-ombrage crénelé sur son maillage basse définition.
      vs = vs.replace(
        '#include <shadowmap_vertex>',
        `#include <shadowmap_vertex>
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	{
		vec4 pedAxis = modelMatrix * instanceMatrix * vec4( 0.0, transformed.y, 0.0, 1.0 );
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * ( pedAxis + vec4( pedTowardLight( directionalShadowMatrix[ i ] ), 0.0 ) );
		}
		#pragma unroll_loop_end
	}
	#endif`,
      );
    } else {
      vs = vs.replace(
        '#include <begin_vertex>',
        `vec3 pedP = vec3( position );\n\tvec3 pedN = vec3( 0.0, 1.0, 0.0 );\n\tpedAnimate( pedP, pedN );\n\tvec3 transformed = pedP;`,
      );
    }
    shader.vertexShader = vs;
  };
  material.customProgramCacheKey = () => (withColor ? 'pedestrian-crowd-color' : 'pedestrian-crowd-depth');
}

/** Tous les piétons dans UNE InstancedMesh (un seul draw call), animés dans le vertex shader. */
export class PedestrianCrowd {
  readonly mesh: THREE.InstancedMesh;
  /** Nombre de triangles du maillage humain (par instance). */
  readonly trianglesPerInstance: number;
  /** Décale le cycle de marche de chaque piéton (évite la marche au pas). Désactivable pour les tests. */
  phaseJitter = true;

  private readonly capacity: number;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly colA: THREE.InstancedBufferAttribute;
  private readonly colB: THREE.InstancedBufferAttribute;
  private readonly used: Uint8Array;
  private readonly fresh: Uint8Array;
  private readonly heights: Float32Array;
  private readonly scales: Float32Array;
  private readonly cycle: Float64Array;
  private readonly cycleOffset: Float32Array;
  private readonly lastPhase: Float64Array;
  private readonly targetSpeed: Float32Array;
  private readonly shownSpeed: Float32Array;
  private readonly free: number[] = [];
  private highWater = 0;
  private lookDirty = false;
  private lastTime = Number.NaN;
  private readonly timeUniform = { value: 0 };

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    const n = this.capacity;
    const base = buildHumanGeometry();
    this.trianglesPerInstance = base.triangles;

    // Géométrie propre à cette foule : attributs de sommet partagés, attributs d'instance dédiés.
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'partId', 'pivot', 'colorSlot']) {
      geometry.setAttribute(name, base.geometry.getAttribute(name));
    }
    geometry.setIndex(base.geometry.getIndex());
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1e6, -1e6, -1e6), new THREE.Vector3(1e6, 1e6, 1e6));

    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.colA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.colB = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    geometry.setAttribute('aAnim', this.anim);
    geometry.setAttribute('aLook', this.look);
    geometry.setAttribute('aColA', this.colA);
    geometry.setAttribute('aColB', this.colB);

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
    patchPedestrianMaterial(material, this.timeUniform, true);
    const depth = new THREE.MeshDepthMaterial();
    patchPedestrianMaterial(depth, this.timeUniform, false);
    const distance = new THREE.MeshDistanceMaterial();
    patchPedestrianMaterial(distance, this.timeUniform, false);

    this.mesh = new THREE.InstancedMesh(geometry, material, n);
    this.mesh.name = 'pedestrians';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.array.fill(0);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = depth;
    this.mesh.customDistanceMaterial = distance;

    this.used = new Uint8Array(n);
    this.fresh = new Uint8Array(n);
    this.heights = new Float32Array(n);
    this.scales = new Float32Array(n).fill(1);
    this.cycle = new Float64Array(n);
    this.cycleOffset = new Float32Array(n);
    this.lastPhase = new Float64Array(n);
    this.targetSpeed = new Float32Array(n);
    this.shownSpeed = new Float32Array(n);
  }

  /** Nombre de piétons actuellement alloués. */
  get size(): number {
    let c = 0;
    for (let i = 0; i < this.highWater; i++) c += this.used[i];
    return c;
  }

  /** Alloue une instance à l'apparence aléatoire mais déterministe ; renvoie son indice (−1 si la foule est pleine). */
  add(seed: number): number {
    let i: number;
    if (this.free.length > 0) i = this.free.pop()!;
    else if (this.highWater < this.capacity) i = this.highWater++;
    else return -1;
    const L = makeLook(seed);
    const rnd = makeRng(seed + 0.5);
    this.used[i] = 1;
    this.fresh[i] = 1;
    this.heights[i] = L.height;
    this.scales[i] = L.scale;
    this.cycle[i] = 0;
    this.cycleOffset[i] = rnd();
    this.lastPhase[i] = 0;
    this.targetSpeed[i] = 0;
    this.shownSpeed[i] = 0;

    const a = this.anim.array as Float32Array;
    a[i * 4] = 0;
    a[i * 4 + 1] = 0;
    a[i * 4 + 2] = L.scale;
    a[i * 4 + 3] = L.build;
    const lk = this.look.array as Float32Array;
    lk[i * 4] = L.flags;
    lk[i * 4 + 1] = L.shoulders;
    lk[i * 4 + 2] = rnd();
    lk[i * 4 + 3] = L.headScale;
    const ca = this.colA.array as Float32Array;
    ca[i * 4] = L.skin;
    ca[i * 4 + 1] = L.top;
    ca[i * 4 + 2] = L.bottom;
    ca[i * 4 + 3] = L.shoes;
    const cb = this.colB.array as Float32Array;
    cb[i * 4] = L.hair;
    cb[i * 4 + 1] = L.acc;
    cb[i * 4 + 2] = L.forearm;
    cb[i * 4 + 3] = L.shin;
    this.lookDirty = true;

    this.writeMatrix(i, 0, -1000, 0, 0, 0); // caché tant que set() n'a pas été appelé
    this.mesh.count = this.highWater;
    return i;
  }

  /** Libère l'emplacement (l'instance n'est plus affichée). */
  remove(index: number): void {
    if (index < 0 || index >= this.highWater || !this.used[index]) return;
    this.used[index] = 0;
    this.free.push(index);
    this.writeMatrix(index, 0, 0, 0, 0, 0);
    while (this.highWater > 0 && !this.used[this.highWater - 1]) {
      this.highWater--;
      const k = this.free.indexOf(this.highWater);
      if (k >= 0) this.free.splice(k, 1);
    }
    this.mesh.count = this.highWater;
  }

  /**
   * État par image. `phase` = distance parcourue (m) : elle pilote le cycle de marche, donc les
   * pieds ne glissent pas. `speed` en m/s (0 = immobile, ≈ 1,4 marche, > 2,5 course).
   */
  set(index: number, x: number, z: number, y: number, heading: number, phase: number, speed: number): void {
    if (index < 0 || index >= this.highWater || !this.used[index]) return;
    const s = this.scales[index];
    const sp = Math.max(0, speed);
    this.targetSpeed[index] = sp;
    if (this.fresh[index]) this.shownSpeed[index] = sp;
    const stride = strideLength(this.shownSpeed[index] / s) * s;
    const dPhase = phase - this.lastPhase[index];
    if (this.fresh[index] || Math.abs(dPhase) > 3) {
      this.cycle[index] = phase / stride + (this.phaseJitter ? this.cycleOffset[index] : 0);
      this.fresh[index] = 0;
    } else {
      this.cycle[index] += dPhase / stride;
    }
    this.cycle[index] -= Math.floor(this.cycle[index]);
    this.lastPhase[index] = phase;
    const a = this.anim.array as Float32Array;
    a[index * 4] = this.cycle[index];
    a[index * 4 + 1] = this.shownSpeed[index] / s;
    this.writeMatrix(index, x, y, z, heading, s);
  }

  /** À appeler une fois par image après tous les set() (envoie les tampons d'instance). `time` (s) pilote la pose d'attente. */
  commit(time?: number): void {
    const t = time ?? performance.now() / 1000;
    const dt = Number.isNaN(this.lastTime) ? 0 : clamp(t - this.lastTime, 0, 0.1);
    this.lastTime = t;
    this.timeUniform.value = t % 3600;
    // Lissage de la vitesse affichée : pas de saut de pose quand un piéton s'arrête net.
    const a = this.anim.array as Float32Array;
    const maxStep = 3.5 * dt;
    for (let i = 0; i < this.highWater; i++) {
      if (!this.used[i]) continue;
      const d = this.targetSpeed[i] - this.shownSpeed[i];
      if (d !== 0) {
        this.shownSpeed[i] += clamp(d, -maxStep, maxStep);
        a[i * 4 + 1] = this.shownSpeed[i] / this.scales[i];
      }
    }
    this.anim.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.lookDirty) {
      this.look.needsUpdate = true;
      this.colA.needsUpdate = true;
      this.colB.needsUpdate = true;
      this.lookDirty = false;
    }
  }

  /** Taille (m) de l'instance, pour la logique de jeu (rayon de collision ≈ PEDESTRIAN_RADIUS). */
  heightOf(index: number): number {
    return index >= 0 && index < this.capacity && this.used[index] ? this.heights[index] : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.customDistanceMaterial?.dispose();
    this.mesh.dispose();
  }

  private writeMatrix(i: number, x: number, y: number, z: number, heading: number, s: number): void {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    const c = Math.cos(heading) * s;
    const sn = Math.sin(heading) * s;
    // rotation d'angle −heading autour de Y : l'avant du modèle (−Z) pointe vers (sin h, 0, −cos h)
    m[o] = c;
    m[o + 1] = 0;
    m[o + 2] = sn;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = s;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = -sn;
    m[o + 9] = 0;
    m[o + 10] = c;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cyclistes et trottinettes : un SkinnedMesh à os rigides par usager
// ─────────────────────────────────────────────────────────────────────────────

export interface RiderVisual {
  group: THREE.Group;
  /** Animation : phase = distance parcourue (m), speed en m/s, lean = angle de roulis en rad (positif = penché à droite). */
  update(phase: number, speed: number, lean: number): void;
  length: number;
}

let riderMaterialCache: THREE.MeshStandardMaterial | null = null;
function riderMaterial(): THREE.MeshStandardMaterial {
  riderMaterialCache ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });
  return riderMaterialCache;
}

const B_ROOT = 0;
const B_BODY = 1;
const B_UARM = [2, 4];
const B_FARM = [3, 5];
const B_THIGH = [6, 9];
const B_SHIN = [7, 10];
const B_FOOT = [8, 11];

const L_GRIP = L_FOREARM + 0.07; // coude → centre du poing

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();

/** Articulation intermédiaire d'une chaîne à deux os (coude, genou). */
function solveMid(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const dir = _v1.subVectors(c, a);
  const dist = Math.max(1e-4, dir.length());
  dir.multiplyScalar(1 / dist);
  const D = clamp(dist, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-4);
  const along = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const m = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (m.lengthSq() < 1e-8) m.set(0, 0, -1);
  m.normalize();
  return out.copy(a).addScaledVector(dir, along).addScaledVector(m, h);
}

/** Oriente un os (membre canonique vers −Y) de `from` vers `to`. */
function aimBone(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, lateral: THREE.Vector3): void {
  limbFrame(from, to, lateral, _m1);
  bone.quaternion.setFromRotationMatrix(_m1);
  bone.position.copy(from);
}

class RigBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];
  private readonly skin: number[] = [];
  private readonly linear: THREE.Color[];

  constructor(palette: number[]) {
    this.linear = palette.map((hex) => new THREE.Color().setHex(hex));
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  add(part: Part, bone: number, m?: THREE.Matrix4): void {
    const p = m ? transformPart(part, m) : part;
    const base = this.pos.length / 3;
    for (let i = 0; i < p.pos.length; i += 3) {
      this.pos.push(p.pos[i], p.pos[i + 1], p.pos[i + 2]);
      this.nrm.push(p.nrm[i], p.nrm[i + 1], p.nrm[i + 2]);
      const c = this.linear[p.slot[i / 3]] ?? this.linear[0];
      const s = p.shade[i / 3];
      this.col.push(c.r * s, c.g * s, c.b * s);
      this.skin.push(bone, 0, 0, 0);
    }
    for (const i of p.idx) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin, 4));
    const w = new Float32Array(this.skin.length);
    for (let i = 0; i < w.length; i += 4) w[i] = 1;
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    geo.setIndex(this.idx);
    return geo;
  }
}

interface RiderSpec {
  seed: number;
  hipCentre: THREE.Vector3;
  trunkLean: number;
  trunkYaw: number;
  headPitch: number;
  footYaw: [number, number];
  helmetChance: number;
  vestChance: number;
  frameColors: number[];
}

/** Squelette commun aux usagers : corps, bras et jambes pilotés par IK, plus les os du véhicule. */
class RiderRig {
  readonly group = new THREE.Group();
  readonly inner = new THREE.Group();
  readonly bones: THREE.Bone[] = [];
  readonly rb: RigBuilder;
  readonly look: Look;
  readonly rnd: () => number;
  readonly hipCentre: THREE.Vector3;
  private readonly shoulderLocal: THREE.Vector3[] = [];
  private readonly hipLocal: THREE.Vector3[] = [];
  private readonly shoulderNow = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly hipNow = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly elbow = new THREE.Vector3();
  private readonly knee = new THREE.Vector3();
  private readonly ankle = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly lateral = new THREE.Vector3();

  constructor(spec: RiderSpec) {
    this.rnd = makeRng(spec.seed * 3 + 11);
    const rnd = this.rnd;
    const L = (this.look = makeLook(spec.seed, true));
    const helmet = rnd() < spec.helmetChance;
    const vest = rnd() < spec.vestChance;
    const pack = rnd() < 0.3;
    const palette: number[] = [];
    palette[SLOT_SKIN] = L.skin;
    palette[SLOT_TOP] = vest ? HIVIS : L.top;
    palette[SLOT_BOTTOM] = L.bottom;
    palette[SLOT_SHOES] = L.shoes;
    palette[SLOT_HAIR] = L.hair;
    palette[SLOT_ACC] = L.acc;
    palette[SLOT_FOREARM] = L.forearm;
    palette[SLOT_SHIN] = L.shin;
    palette[SLOT_UPPERARM] = L.top;
    palette[SLOT_HELMET] = HELMETS[Math.floor(rnd() * HELMETS.length) % HELMETS.length];
    palette[SLOT_FRAME] = spec.frameColors[Math.floor(rnd() * spec.frameColors.length) % spec.frameColors.length];
    palette[SLOT_TYRE] = 0x17171a;
    palette[SLOT_METAL] = 0x9a9ea4;
    palette[SLOT_DARK] = 0x232326;
    palette[SLOT_LIGHT_FRONT] = 0xf4f1e4;
    palette[SLOT_LIGHT_REAR] = 0xc0201c;
    palette[SLOT_ACCENT] = 0x3a3d42;
    this.rb = new RigBuilder(palette);

    // Os (pose de liaison = position de repos, orientation identité).
    this.hipCentre = spec.hipCentre.clone();
    const bw = clamp(L.build, 0.9, 1.14) * (0.94 + 0.06 * L.shoulders);
    const trunkRot = new THREE.Matrix4().makeRotationY(spec.trunkYaw).multiply(new THREE.Matrix4().makeRotationX(-spec.trunkLean));
    const trunkM = new THREE.Matrix4()
      .makeTranslation(this.hipCentre.x, this.hipCentre.y, this.hipCentre.z)
      .multiply(trunkRot)
      .multiply(new THREE.Matrix4().makeScale(bw, 1, lerp(1, bw, 0.7)))
      .multiply(new THREE.Matrix4().makeTranslation(0, -HIP_Y, 0));

    this.addBone(new THREE.Vector3()); // B_ROOT
    this.addBone(this.hipCentre); // B_BODY
    const shoulders: THREE.Vector3[] = [];
    const hips: THREE.Vector3[] = [];
    for (const side of [-1, 1]) {
      shoulders.push(new THREE.Vector3(side * SH_X, SH_Y, SH_Z).applyMatrix4(trunkM));
      hips.push(new THREE.Vector3(side * HIP_X, HIP_Y, 0).applyMatrix4(trunkM));
    }
    for (let k = 0; k < 2; k++) {
      this.addBone(shoulders[k]);
      this.addBone(shoulders[k].clone().add(new THREE.Vector3(0, -L_UARM, 0)));
      this.shoulderLocal.push(shoulders[k].clone().sub(this.hipCentre));
      this.hipLocal.push(hips[k].clone().sub(this.hipCentre));
    }
    for (let k = 0; k < 2; k++) {
      this.addBone(hips[k]);
      this.addBone(hips[k].clone().add(new THREE.Vector3(0, -L_THIGH, 0)));
      this.addBone(hips[k].clone().add(new THREE.Vector3(0, -L_THIGH - L_SHIN, 0)));
    }

    // Corps (lié à l'os B_BODY, déjà dans sa pose de conduite).
    const rb = this.rb;
    rb.add(buildTrunk(), B_BODY, trunkM);
    const neck = new THREE.Vector3(0, NECK_Y, NECK_Z).applyMatrix4(trunkM);
    const headM = new THREE.Matrix4()
      .makeTranslation(neck.x, neck.y, neck.z)
      .multiply(new THREE.Matrix4().makeRotationY(spec.trunkYaw * 0.2))
      .multiply(new THREE.Matrix4().makeRotationX(-spec.trunkLean + spec.headPitch));
    rb.add(buildHead(), B_BODY, headM);
    rb.add(buildHairCap(), B_BODY, headM);
    if (helmet) rb.add(buildHelmet(), B_BODY, headM);
    if (L.flags & FLAG_LONG_HAIR) rb.add(buildLongHair(), B_BODY, headM);
    if (pack) rb.add(buildBackpack(), B_BODY, trunkM);

    const upper = buildUpperArm();
    const fore = buildForearm(true);
    const shin = buildShin();
    const foot = buildFoot();
    for (let k = 0; k < 2; k++) {
      const thigh = buildThigh(k === 0 ? -1 : 1);
      const rest = (i: number): THREE.Matrix4 => {
        const p = this.bones[i].position;
        return new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
      };
      rb.add(upper, B_UARM[k], rest(B_UARM[k]));
      rb.add(fore, B_FARM[k], rest(B_FARM[k]));
      rb.add(thigh, B_THIGH[k], rest(B_THIGH[k]));
      rb.add(shin, B_SHIN[k], rest(B_SHIN[k]));
      rb.add(foot, B_FOOT[k], rest(B_FOOT[k]).multiply(new THREE.Matrix4().makeRotationY(spec.footYaw[k])));
    }
    this.poseBody(0, 0, 0, 0, 0);
  }

  addBone(rest: THREE.Vector3): number {
    const b = new THREE.Bone();
    b.position.copy(rest);
    this.bones.push(b);
    return this.bones.length - 1;
  }

  /** Crée le maillage (à appeler une fois toutes les pièces ajoutées). */
  finish(): THREE.SkinnedMesh {
    const mesh = new THREE.SkinnedMesh(this.rb.build(), riderMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (const b of this.bones) this.inner.add(b);
    this.inner.add(mesh);
    this.group.add(this.inner);
    // pose de liaison : tous les os sont encore au repos (aucune IK n'a été résolue)
    this.group.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, -0.05), 1.6);
    mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-0.9, -0.1, -1.2), new THREE.Vector3(0.9, 2.0, 1.1));
    return mesh;
  }

  /** Déplace / incline le buste par rapport à sa pose de conduite ; met à jour épaules et hanches. */
  poseBody(dx: number, dy: number, dz: number, roll: number, pitch: number): void {
    const b = this.bones[B_BODY];
    b.position.set(this.hipCentre.x + dx, this.hipCentre.y + dy, this.hipCentre.z + dz);
    b.quaternion.setFromEuler(_e1.set(pitch, 0, roll, 'ZXY'));
    for (let k = 0; k < 2; k++) {
      this.shoulderNow[k].copy(this.shoulderLocal[k]).applyQuaternion(b.quaternion).add(b.position);
      this.hipNow[k].copy(this.hipLocal[k]).applyQuaternion(b.quaternion).add(b.position);
    }
  }

  /** Bras k (0 = gauche, 1 = droit) : main sur la poignée `grip`. */
  solveArm(k: number, grip: THREE.Vector3): void {
    const side = k === 0 ? -1 : 1;
    const s = this.shoulderNow[k];
    const g = _v3.copy(grip);
    const d = _v4.subVectors(g, s);
    const reach = L_UARM + L_GRIP - 0.003;
    if (d.length() > reach) g.copy(s).addScaledVector(d.normalize(), reach);
    this.pole.set(side * 0.55, -1, 0.45);
    solveMid(s, g, L_UARM, L_GRIP, this.pole, this.elbow);
    this.lateral.set(1, 0, 0);
    aimBone(this.bones[B_UARM[k]], s, this.elbow, this.lateral);
    aimBone(this.bones[B_FARM[k]], this.elbow, g, this.lateral);
  }

  /** Jambe k : cheville vers `ankle`, pied incliné de `pitch` (pointe vers le bas) et tourné de `yaw`. */
  solveLeg(k: number, ankle: THREE.Vector3, pitch: number, yaw: number): void {
    const side = k === 0 ? -1 : 1;
    const h = this.hipNow[k];
    const a = this.ankle.copy(ankle);
    const d = _v4.subVectors(a, h);
    const reach = L_THIGH + L_SHIN - 0.003;
    if (d.length() > reach) a.copy(h).addScaledVector(d.normalize(), reach);
    this.pole.set(side * 0.16, 0.15, -1);
    solveMid(h, a, L_THIGH, L_SHIN, this.pole, this.knee);
    this.lateral.subVectors(a, h).cross(this.pole).normalize();
    aimBone(this.bones[B_THIGH[k]], h, this.knee, this.lateral);
    aimBone(this.bones[B_SHIN[k]], this.knee, a, this.lateral);
    const f = this.bones[B_FOOT[k]];
    f.position.copy(a);
    f.quaternion.setFromEuler(_e1.set(-pitch, yaw, 0, 'YXZ'));
  }
}

/** Hauteur de la cheville et avance par rapport au point d'appui sous l'avant-pied, pour un pied incliné de `pitch`. */
function ankleOverBall(pitch: number, ballDist: number, out: { y: number; z: number }): void {
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  out.y = ANKLE_Y * c + ballDist * s;
  out.z = -ANKLE_Y * s + ballDist * c;
}

// ── pièces de véhicule ──────────────────────────────────────────────────────

/** Bande en arc de cercle dans le plan YZ (garde-boue), double face. */
function arcStrip(cy: number, cz: number, R: number, halfW: number, a0: number, a1: number, n: number, slot: number): Part {
  const mk = (flip: boolean): Part => {
    const p = newPart();
    for (let i = 0; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      const y = cy + R * Math.cos(a);
      const z = cz + R * Math.sin(a);
      const yi = cy + (R - 0.012) * Math.cos(a);
      const zi = cz + (R - 0.012) * Math.sin(a);
      p.pos.push(-halfW, yi, zi, -halfW * 0.5, y, z, halfW * 0.5, y, z, halfW, yi, zi);
      p.slot.push(slot, slot, slot, slot);
      p.shade.push(1, 1, 1, 1);
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 3; j++) {
        const a = i * 4 + j;
        const b = a + 1;
        const c = a + 4;
        const d = a + 5;
        if (flip) p.idx.push(a, c, b, b, c, d);
        else p.idx.push(a, b, c, b, d, c);
      }
    }
    computeNormals(p, true);
    return p;
  };
  return mergeParts([mk(false), mk(true)]);
}

/** Quadrilatère plat double face. */
function plate(a: V3, b: V3, c: V3, d: V3, slot: number): Part {
  const p = newPart();
  for (let s = 0; s < 2; s++) {
    const base = p.pos.length / 3;
    for (const v of [a, b, c, d]) {
      p.pos.push(v[0], v[1], v[2]);
      p.slot.push(slot);
      p.shade.push(1);
    }
    if (s === 0) p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else p.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  computeNormals(p, false);
  return p;
}

/** Roue de vélo centrée à l'origine (axe X) : pneu + jante, rayons, moyeu. */
function buildBikeWheel(R: number): Part {
  const radial = 20;
  const rc = R - 0.026;
  const rings: RingPts[] = [];
  for (let i = 0; i <= radial; i++) {
    const th = (i / radial) * TAU;
    const cy = Math.cos(th);
    const cz = Math.sin(th);
    const pts: number[] = [];
    for (let k = 0; k < 6; k++) {
      const tau = (k / 6) * TAU;
      const rr = rc + 0.026 * Math.cos(tau);
      pts.push(0.019 * Math.sin(tau), rr * cy, rr * cz);
    }
    rings.push({ pts, slot: SLOT_TYRE, shade: 1 });
  }
  const tyre = skinRings(rings, null, null);
  // couleur par sommet : moitié extérieure de la section = pneu, moitié intérieure = jante
  const section = [SLOT_TYRE, SLOT_TYRE, SLOT_METAL, SLOT_METAL, SLOT_METAL, SLOT_TYRE];
  for (let v = 0; v < tyre.slot.length; v++) tyre.slot[v] = section[v % 6];
  const parts: Part[] = [tyre];
  const nSpokes = 12;
  const rimR = R - 0.05;
  for (let i = 0; i < nSpokes; i++) {
    const th = (i / nSpokes) * TAU;
    const th2 = th + (i % 2 === 0 ? 0.32 : -0.32);
    const hx = i % 2 === 0 ? 0.026 : -0.026;
    const w = 0.0035;
    const hy = 0.022 * Math.cos(th2), hz = 0.022 * Math.sin(th2);
    const ry = rimR * Math.cos(th), rz = rimR * Math.sin(th);
    const ty = -Math.sin(th) * w, tz = Math.cos(th) * w;
    parts.push(plate([hx, hy - ty, hz - tz], [hx, hy + ty, hz + tz], [0, ry + ty, rz + tz], [0, ry - ty, rz - tz], SLOT_METAL));
  }
  parts.push(tubePart(new THREE.Vector3(-0.045, 0, 0), new THREE.Vector3(0.045, 0, 0), 0.02, SLOT_METAL, 6, true));
  return mergeParts(parts);
}

/** Petite roue pleine (trottinette), axe X. */
function buildSmallWheel(R: number, halfW: number): Part {
  const p = loft(
    [
      { y: halfW, rx: R * 0.86, shade: 1 },
      { y: halfW * 0.5, rx: R },
      { y: -halfW * 0.5, rx: R },
      { y: -halfW, rx: R * 0.86 },
    ],
    12,
    SLOT_TYRE,
    { p: [0, halfW, 0], slot: SLOT_METAL },
    { p: [0, -halfW, 0], slot: SLOT_METAL },
  );
  return transformPart(p, new THREE.Matrix4().makeRotationZ(Math.PI / 2));
}

/** Section fermée le long de Z (selle, etc.) : [z, demi-largeur, haut, bas]. */
function sectionLoft(secs: [number, number, number, number][], slot: number, back: V3, front: V3): Part {
  const rings: RingPts[] = secs.map(([z, hw, top, bottom]) => {
    const mid = (top + bottom) / 2;
    return {
      pts: [-hw * 0.7, bottom, z, hw * 0.7, bottom, z, hw, mid, z, hw * 0.7, top, z, -hw * 0.7, top, z, -hw, mid, z],
      slot,
      shade: 1,
    };
  });
  return skinRings(rings, { p: back }, { p: front });
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

// ── vélo ────────────────────────────────────────────────────────────────────

const BIKE = {
  wheelR: 0.34,
  rearZ: 0.46,
  frontZ: -0.63,
  bbY: 0.28,
  crank: 0.17,
  pedalX: 0.115,
  development: 4.6, // mètres par tour de pédalier
  hip: V(0, 1.035, 0.205),
  gripY: 1.062,
  gripZ: -0.395,
  gripX: 0.265,
};

/** Vélo de ville avec cycliste (casque et gilet selon la graine). Espace modèle : −Z vers l'avant, origine au sol sous le pédalier. */
export function createCyclist(seed: number): RiderVisual {
  const rig = new RiderRig({
    seed,
    hipCentre: BIKE.hip,
    trunkLean: 0.4,
    trunkYaw: 0,
    headPitch: 0.3,
    footYaw: [0.06, -0.06],
    helmetChance: 0.5,
    vestChance: 0.24,
    frameColors: BIKE_FRAMES,
  });
  const rb = rig.rb;
  const rnd = rig.rnd;
  const F = SLOT_FRAME, M = SLOT_METAL, D = SLOT_DARK;
  const R = BIKE.wheelR;

  const bRear = rig.addBone(V(0, R, BIKE.rearZ));
  const bFront = rig.addBone(V(0, R, BIKE.frontZ));
  const bCrank = rig.addBone(V(0, BIKE.bbY, 0));
  const bPedal = [rig.addBone(V(-BIKE.pedalX, BIKE.bbY, BIKE.crank)), rig.addBone(V(BIKE.pedalX, BIKE.bbY, -BIKE.crank))];

  // cadre
  const bb = V(0, BIKE.bbY, 0);
  const seatTop = V(0, 0.82, 0.178);
  const headTop = V(0, 0.87, -0.465);
  const headBot = V(0, 0.72, -0.52);
  const steerTop = V(0, 1.04, -0.403);
  const tubes: [THREE.Vector3, THREE.Vector3, number, number][] = [
    [bb, seatTop, 0.017, F],
    [V(0, 0.8, 0.172), V(0, 0.852, -0.47), 0.016, F],
    [V(0, 0.735, -0.51), bb, 0.019, F],
    [headBot, headTop, 0.021, F],
    [seatTop, V(0, 0.94, 0.218), 0.013, M],
    [headTop, steerTop, 0.014, M],
    [steerTop, V(0, 1.05, -0.455), 0.013, M],
  ];
  for (const sx of [-1, 1]) {
    tubes.push([V(sx * 0.02, BIKE.bbY, 0.01), V(sx * 0.058, R, BIKE.rearZ), 0.011, F]);
    tubes.push([V(sx * 0.015, 0.775, 0.16), V(sx * 0.058, R, BIKE.rearZ), 0.009, F]);
    tubes.push([V(sx * 0.03, 0.715, -0.522), V(sx * 0.052, R, BIKE.frontZ), 0.012, F]);
    // guidon de ville, cintré vers l'arrière
    tubes.push([V(0, 1.05, -0.455), V(sx * 0.12, 1.058, -0.455), 0.011, M]);
    tubes.push([V(sx * 0.12, 1.058, -0.455), V(sx * 0.205, 1.064, -0.43), 0.011, M]);
    // porte-bagages
    tubes.push([V(sx * 0.058, R, BIKE.rearZ), V(sx * 0.06, 0.725, 0.6), 0.006, D]);
    tubes.push([V(sx * 0.06, 0.725, 0.3), V(sx * 0.06, 0.725, 0.68), 0.006, D]);
  }
  for (const [a, b, r, slot] of tubes) rb.add(tubePart(a, b, r, slot, 6), B_ROOT);
  for (const sx of [-1, 1]) {
    rb.add(tubePart(V(sx * 0.2, 1.064, -0.432), V(sx * 0.315, 1.06, -0.368), 0.016, D, 6, true), B_ROOT);
  }
  rb.add(tubePart(V(-0.06, 0.725, 0.3), V(0.06, 0.725, 0.3), 0.006, D, 4), B_ROOT);
  rb.add(tubePart(V(-0.06, 0.725, 0.68), V(0.06, 0.725, 0.68), 0.006, D, 4), B_ROOT);
  rb.add(tubePart(V(0, 0.76, 0.2), V(0, 0.725, 0.3), 0.006, D, 4), B_ROOT);
  // selle
  rb.add(
    sectionLoft(
      [
        [0.315, 0.07, 0.957, 0.925],
        [0.215, 0.066, 0.955, 0.92],
        [0.11, 0.026, 0.953, 0.925],
      ],
      D,
      [0, 0.945, 0.335],
      [0, 0.945, 0.065],
    ),
    B_ROOT,
  );
  // garde-boue, feux, chaîne
  rb.add(arcStrip(R, BIKE.rearZ, R + 0.024, 0.027, -0.7, 2.05, 9, SLOT_ACCENT), B_ROOT);
  rb.add(arcStrip(R, BIKE.frontZ, R + 0.024, 0.027, -0.5, 1.75, 8, SLOT_ACCENT), B_ROOT);
  rb.add(boxPart(0, 0.69, 0.705, 0.07, 0.035, 0.02, SLOT_LIGHT_REAR), B_ROOT);
  rb.add(boxPart(0, 0.865, -0.515, 0.05, 0.05, 0.045, SLOT_LIGHT_FRONT), B_ROOT);
  rb.add(tubePart(V(0.046, BIKE.bbY + 0.088, 0), V(0.046, R + 0.035, BIKE.rearZ), 0.006, D, 3), B_ROOT);
  rb.add(tubePart(V(0.046, BIKE.bbY - 0.088, 0), V(0.046, R - 0.035, BIKE.rearZ), 0.006, D, 3), B_ROOT);
  if (rnd() < 0.4) {
    // panier avant
    rb.add(boxPart(0, 0.99, -0.62, 0.3, 0.2, 0.22, D, 1.25), B_ROOT);
  }

  // roues
  const wheel = buildBikeWheel(R);
  rb.add(wheel, bRear, new THREE.Matrix4().makeTranslation(0, R, BIKE.rearZ));
  rb.add(wheel, bFront, new THREE.Matrix4().makeTranslation(0, R, BIKE.frontZ));

  // pédalier (os bCrank) : manivelle droite vers l'avant, gauche vers l'arrière
  rb.add(tubePart(V(-0.075, BIKE.bbY, 0), V(0.075, BIKE.bbY, 0), 0.02, M, 6, true), bCrank);
  rb.add(tubePart(V(0.066, BIKE.bbY, 0), V(0.07, BIKE.bbY, -BIKE.crank), 0.012, M, 4, true), bCrank);
  rb.add(tubePart(V(-0.066, BIKE.bbY, 0), V(-0.07, BIKE.bbY, BIKE.crank), 0.012, M, 4, true), bCrank);
  {
    const ring = newPart();
    const n = 12;
    for (let s = 0; s < 2; s++) {
      const base = ring.pos.length / 3;
      ring.pos.push(0.046, BIKE.bbY, 0);
      ring.slot.push(D);
      ring.shade.push(1.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        ring.pos.push(0.046, BIKE.bbY + 0.092 * Math.cos(a), 0.092 * Math.sin(a));
        ring.slot.push(D);
        ring.shade.push(1.5);
      }
      for (let i = 0; i < n; i++) {
        const a = base + 1 + i;
        const b = base + 1 + ((i + 1) % n);
        if (s === 0) ring.idx.push(base, a, b);
        else ring.idx.push(base, b, a);
      }
    }
    computeNormals(ring, false);
    rb.add(ring, bCrank);
  }
  for (let k = 0; k < 2; k++) {
    const p = rig.bones[bPedal[k]].position;
    rb.add(boxPart(p.x, p.y, p.z, 0.09, 0.02, 0.07, D), bPedal[k]);
  }

  rig.finish();

  const grip = [V(-BIKE.gripX, BIKE.gripY, BIKE.gripZ), V(BIKE.gripX, BIKE.gripY, BIKE.gripZ)];
  const ao = { y: 0, z: 0 };
  const target = new THREE.Vector3();
  const ground = new THREE.Vector3();
  const crankOffset = rnd() * TAU;
  const cadenceVar = 0.92 + rnd() * 0.2;
  const ROLL_AXIS = new THREE.Vector3(0, 0, 1);

  const update = (phase: number, speed: number, lean: number): void => {
    const stop = 1 - smoothstep(0.25, 1.5, Math.abs(speed));
    const wheelAngle = -phase / R;
    rig.bones[bRear].rotation.x = wheelAngle;
    rig.bones[bFront].rotation.x = wheelAngle;
    const ca = (phase / (BIKE.development * cadenceVar)) * TAU + crankOffset;
    rig.bones[bCrank].rotation.x = -ca;
    const roll = lean - 0.13 * stop; // à l'arrêt : vélo penché à gauche, pied gauche au sol
    rig.inner.rotation.z = -roll;
    const rock = 0.028 * Math.sin(ca) * (1 - stop);
    rig.poseBody(0.012 * Math.sin(ca) * (1 - stop), -0.045 * stop, -0.07 * stop, rock, 0);
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      rig.solveArm(k, grip[k]);
      const a = k === 1 ? ca : ca + Math.PI; // angle de la manivelle de ce côté (0 = vers l'avant, croît vers le bas)
      const px = side * BIKE.pedalX;
      const py = BIKE.bbY - BIKE.crank * Math.sin(a);
      const pz = -BIKE.crank * Math.cos(a);
      let pitch = 0.2 + 0.22 * Math.sin(a - 0.5);
      ankleOverBall(pitch, 0.12, ao);
      target.set(px, py + 0.012 + ao.y, pz + ao.z);
      let yaw = 0;
      let pedalPitch = pitch;
      if (k === 0 && stop > 0) {
        // pied gauche posé au sol (dans le repère incliné du vélo)
        const gp = 0.55;
        ankleOverBall(gp, 0.185, ao);
        ground.set(-0.34, ao.y, 0.02 + ao.z - 0.185).applyAxisAngle(ROLL_AXIS, roll);
        const e = stop * stop * (3 - 2 * stop);
        target.lerp(ground, e);
        target.y += 0.07 * Math.sin(Math.PI * e);
        pitch = lerp(pitch, gp, e);
        yaw = 0.25 * e;
        pedalPitch = lerp(pedalPitch, 0, e);
      }
      rig.solveLeg(k, target, pitch, yaw);
      const pb = rig.bones[bPedal[k]];
      pb.position.set(px, py, pz);
      pb.rotation.x = -pedalPitch;
    }
  };
  update(0, 4, 0);
  rig.group.userData.triangles = rb.triangles;
  return { group: rig.group, update, length: 1.78 };
}

// ── trottinette électrique ──────────────────────────────────────────────────

const SCOOT = {
  wheelR: 0.11,
  frontZ: -0.52,
  rearZ: 0.46,
  deckTop: 0.165,
  barY: 1.1,
  barZ: -0.385,
  gripX: 0.185,
};
const SCOOTER_COLORS = [0x1d1e21, 0xdadad6, 0x7fbf3f, 0xe0592a, 0x2c2f33, 0x2aa7a0, 0x1d1e21];

/** Trottinette électrique avec usager debout. Espace modèle : −Z vers l'avant, origine au sol sous le milieu du plateau. */
export function createScooterRider(seed: number): RiderVisual {
  const rig = new RiderRig({
    seed: seed + 1000.25,
    hipCentre: V(0.005, SCOOT.deckTop + 0.868, 0.1),
    trunkLean: 0.11,
    trunkYaw: -0.22,
    headPitch: 0.06,
    footYaw: [0.12, -0.75],
    helmetChance: 0.3,
    vestChance: 0.12,
    frameColors: SCOOTER_COLORS,
  });
  const rb = rig.rb;
  const F = SLOT_FRAME, M = SLOT_METAL, D = SLOT_DARK;
  const R = SCOOT.wheelR;

  const bFront = rig.addBone(V(0, R, SCOOT.frontZ));
  const bRear = rig.addBone(V(0, R, SCOOT.rearZ));

  const wheel = buildSmallWheel(R, 0.024);
  rb.add(wheel, bFront, new THREE.Matrix4().makeTranslation(0, R, SCOOT.frontZ));
  rb.add(wheel, bRear, new THREE.Matrix4().makeTranslation(0, R, SCOOT.rearZ));

  // plateau
  rb.add(boxPart(0, SCOOT.deckTop - 0.035, 0.035, 0.165, 0.062, 0.66, F), B_ROOT);
  rb.add(boxPart(0, SCOOT.deckTop - 0.001, 0.035, 0.15, 0.006, 0.6, D), B_ROOT);
  // col, potence, fourche
  rb.add(tubePart(V(0, 0.14, -0.28), V(0, 0.34, -0.468), 0.03, F, 6, true), B_ROOT);
  rb.add(tubePart(V(0, 0.28, -0.475), V(0, SCOOT.barY, SCOOT.barZ), 0.022, F, 6, true), B_ROOT);
  for (const sx of [-1, 1]) {
    rb.add(tubePart(V(sx * 0.036, 0.3, -0.474), V(sx * 0.036, R, SCOOT.frontZ), 0.011, D, 4), B_ROOT);
    rb.add(tubePart(V(sx * 0.05, SCOOT.deckTop - 0.03, 0.34), V(sx * 0.036, R, SCOOT.rearZ), 0.012, D, 4), B_ROOT);
    rb.add(tubePart(V(sx * 0.12, SCOOT.barY, SCOOT.barZ), V(sx * 0.24, SCOOT.barY, SCOOT.barZ), 0.019, D, 6, true), B_ROOT);
  }
  rb.add(tubePart(V(-0.13, SCOOT.barY, SCOOT.barZ), V(0.13, SCOOT.barY, SCOOT.barZ), 0.014, M, 6), B_ROOT);
  rb.add(boxPart(0, SCOOT.barY + 0.012, SCOOT.barZ + 0.004, 0.07, 0.03, 0.06, D), B_ROOT);
  // garde-boue et feux
  rb.add(arcStrip(R, SCOOT.frontZ, R + 0.02, 0.03, -1.0, 1.2, 5, F), B_ROOT);
  rb.add(arcStrip(R, SCOOT.rearZ, R + 0.02, 0.03, -0.6, 1.5, 5, F), B_ROOT);
  rb.add(boxPart(0, 0.93, -0.425, 0.045, 0.045, 0.03, SLOT_LIGHT_FRONT), B_ROOT);
  rb.add(boxPart(0, 0.2, 0.6, 0.05, 0.025, 0.02, SLOT_LIGHT_REAR), B_ROOT);

  rig.finish();

  const grip = [V(-SCOOT.gripX, SCOOT.barY + 0.004, SCOOT.barZ), V(SCOOT.gripX, SCOOT.barY + 0.004, SCOOT.barZ)];
  const aY = SCOOT.deckTop + ANKLE_Y;
  const footDeck = [V(-0.03, aY, -0.07), V(0.036, aY, 0.25)];
  const footGround = V(0.27, ANKLE_Y, 0.2);
  const target = new THREE.Vector3();

  const update = (phase: number, speed: number, lean: number): void => {
    const stop = 1 - smoothstep(0.2, 1.3, Math.abs(speed));
    const e = stop * stop * (3 - 2 * stop);
    rig.bones[bFront].rotation.x = -phase / R;
    rig.bones[bRear].rotation.x = -phase / R;
    rig.inner.rotation.z = -lean;
    // en roulant : genoux souples ; à l'arrêt : le buste descend et se décale vers le pied posé à terre
    const flex = 0.012 * Math.sin(phase * 0.9) * (1 - e);
    rig.poseBody(0.1 * e, -0.145 * e + flex, 0.02 * e, -0.05 * e, 0.05 * e);
    rig.solveArm(0, grip[0]);
    rig.solveArm(1, grip[1]);
    rig.solveLeg(0, footDeck[0], 0, 0);
    target.lerpVectors(footDeck[1], footGround, e);
    target.y += 0.08 * Math.sin(Math.PI * e);
    rig.solveLeg(1, target, 0, 0.45 * e);
  };
  update(0, 4, 0);
  rig.group.userData.triangles = rb.triangles;
  return { group: rig.group, update, length: 1.2 };
}
