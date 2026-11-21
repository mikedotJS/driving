// Habillage du sol hors chaussée et du petit mobilier : à quel lot de la dalle va chaque espace de la
// carte et avec quelle teinte, rubans des allées, massifs plantés, silhouette des arbres selon leur
// genre, orientation et formes du mobilier. Tout est versé dans les lots existants de la dalle (un
// maillage par matériau), pour ne pas ajouter d'appels de dessin.

import type { GeoBuilder } from './geo';

export type RGB = [number, number, number];
const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
/** Couleur sRGB → linéaire, comme three.js attend les couleurs par sommet. */
export const lin = (c: RGB): RGB => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as RGB;
const couleur = (h: number) => lin(hex(h));

/**
 * Lots de sol d'une dalle :
 *  mineral  texture du trottoir, teintée par sommet : trottoirs, cours, enrobé, béton, stabilisé
 *  vegetal  texture d'herbe, teintée : jardins, parcs, pelouses, bois, terrains en gazon
 *  pave     pavés : places et rues piétonnes
 *  uni      couleur par sommet sans texture : terre, sable, sol souple, massifs, haies, mobilier
 *  eau      bassins
 */
export type Lot = 'mineral' | 'vegetal' | 'pave' | 'uni' | 'eau';

/** Teintes (multiplicateurs linéaires de la texture, ou couleur pour le lot uni). */
export const TEINTE = {
  trottoir: [1, 1, 1] as RGB,
  cour: [0.9, 0.9, 0.89] as RGB,
  enrobe: [0.68, 0.68, 0.7] as RGB,
  beton: [1.22, 1.2, 1.15] as RGB,
  stabilise: [1.5, 1.34, 1.02] as RGB,
  herbe: [1, 1, 1] as RGB,
  // herbe plus terne des jardins privés : c'était le matériau « yard »
  jardin: [1, 0.78, 1] as RGB,
  bois: [0.72, 0.84, 0.78] as RGB,
  gazon: [0.9, 1.08, 0.9] as RGB,
  terre: couleur(0x8d7b62),
  sable: couleur(0xcdb98a),
  souple: couleur(0xa8553f),
  jeux: couleur(0xa89b80),
  // dessus d'un massif : couvre-sol sombre, sur la texture d'herbe
  massif: [0.6, 0.72, 0.62] as RGB,
  massifFlanc: couleur(0x4a6638),
  haie: couleur(0x55783f),
  // arbustes d'un massif : du plus sombre au plus clair
  arbuste: [couleur(0x3f6a34), couleur(0x4f7a3a), couleur(0x5d8a45), couleur(0x6b8f4e)] as RGB[],
};

/** Teintes des murets de clôture (multiplicateurs de la texture du trottoir) : enduit clair, pierre, brique, enduit ocre. */
export const TONS_MURET: RGB[] = [[1.25, 1.22, 1.14], [0.95, 0.9, 0.8], [1.4, 0.9, 0.72], [1.3, 1.12, 0.85]];

/** Lot et teinte d'un espace de la carte : `k` nature, `s` revêtement relevé (voir tools/lib/sol.mjs). */
export function habillage(k: string, s?: string): { lot: Lot; teinte: RGB } {
  if (k === 'water') return { lot: 'eau', teinte: [1, 1, 1] };
  if (k === 'massif') return { lot: 'vegetal', teinte: TEINTE.massif };
  // jardin de devant d'un pavillon (déduit) : même herbe que les jardins des cœurs d'îlot
  if (k === 'devant') return { lot: 'vegetal', teinte: TEINTE.jardin };
  switch (s) {
    case 'a': return { lot: 'mineral', teinte: TEINTE.enrobe };
    case 'b': return { lot: 'mineral', teinte: TEINTE.beton };
    case 'c': return { lot: 'mineral', teinte: TEINTE.stabilise };
    case 'p': return { lot: 'pave', teinte: [1, 1, 1] };
    case 't': return { lot: 'uni', teinte: TEINTE.souple };
    case 's': return { lot: 'uni', teinte: TEINTE.sable };
    case 'r': return { lot: 'uni', teinte: TEINTE.terre };
    case 'g': return { lot: 'vegetal', teinte: TEINTE.gazon };
  }
  switch (k) {
    case 'plaza': return { lot: 'pave', teinte: [1, 1, 1] };
    case 'parking': return { lot: 'mineral', teinte: TEINTE.enrobe };
    case 'quai': return { lot: 'mineral', teinte: TEINTE.beton };
    case 'dirt': return { lot: 'uni', teinte: TEINTE.terre };
    case 'jeux': return { lot: 'uni', teinte: TEINTE.jeux };
    case 'wood': return { lot: 'vegetal', teinte: TEINTE.bois };
    case 'pitch': return { lot: 'vegetal', teinte: TEINTE.gazon };
    default: return { lot: 'vegetal', teinte: TEINTE.herbe };
  }
}

/** Teinte d'une allée dans le lot minéral : stabilisé clair si le revêtement n'est pas relevé. */
export function teinteAllee(s?: string): RGB {
  return s === 'a' ? TEINTE.enrobe : s === 'b' || s === 'p' ? TEINTE.beton : s === 'r' || s === 'g' ? [1.15, 1.0, 0.78] : TEINTE.stabilise;
}

/**
 * Bords d'un ruban de largeur `l` le long de la polyligne `p` (x0, z0, x1, z1…) : pour chaque sommet,
 * le point de gauche puis celui de droite (xg, zg, xd, zd). Les angles sont raccordés en onglet,
 * limité à deux fois la demi-largeur pour qu'un rebroussement ne projette pas une pointe au loin.
 */
export function ruban(p: ArrayLike<number>, l: number): number[] {
  const n = p.length / 2, h = l / 2, out: number[] = [];
  const dir = (i: number): [number, number] => {
    const dx = p[i * 2 + 2] - p[i * 2], dz = p[i * 2 + 3] - p[i * 2 + 1], d = Math.hypot(dx, dz) || 1;
    return [dx / d, dz / d];
  };
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? dir(i - 1) : dir(0), b = i < n - 1 ? dir(i) : dir(n - 2);
    // normale moyenne (à gauche du sens de parcours), allongée de 1 / cos(demi-angle)
    let nx = a[1] + b[1], nz = -(a[0] + b[0]);
    const d = Math.hypot(nx, nz);
    if (d < 1e-6) { nx = a[1]; nz = -a[0]; } else { nx /= d; nz /= d; }
    const cos = Math.max(0.5, nx * a[1] - nz * a[0]);
    const k = h / cos;
    out.push(p[i * 2] + nx * k, p[i * 2 + 1] + nz * k, p[i * 2] - nx * k, p[i * 2 + 1] - nz * k);
  }
  return out;
}

/** Verse une allée (ruban à plat, face vers le haut) dans un lot à couleurs par sommet. */
export function poserAllee(g: GeoBuilder, p: ArrayLike<number>, largeur: number, y: number, uv: number, c: RGB) {
  const b = ruban(p, largeur);
  let prev = -1;
  for (let i = 0; i < b.length / 4; i++) {
    const xg = b[i * 4], zg = b[i * 4 + 1], xd = b[i * 4 + 2], zd = b[i * 4 + 3];
    const v = g.vertex(xg, y, zg, 0, 1, 0, xg * uv, zg * uv, c[0], c[1], c[2]);
    g.vertex(xd, y, zd, 0, 1, 0, xd * uv, zd * uv, c[0], c[1], c[2]);
    if (prev >= 0) quadHaut(g, prev, prev + 1, v + 1, v);
    prev = v;
  }
}

/**
 * Escalier : le sol du jeu est plat, les marches sont suggérées par des bandes alternées claires et
 * sombres en travers du ruban, une tous les 40 cm.
 */
export function poserMarches(g: GeoBuilder, p: ArrayLike<number>, largeur: number, y: number, uv: number) {
  const PAS = 0.4, clair = TEINTE.beton, sombre: RGB = [0.8, 0.79, 0.76];
  let k = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const x0 = p[i], z0 = p[i + 1], dx = p[i + 2] - x0, dz = p[i + 3] - z0, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const tx = dx / len, tz = dz / len, nx = (tz * largeur) / 2, nz = (-tx * largeur) / 2;
    const n = Math.max(1, Math.round(len / PAS));
    for (let j = 0; j < n; j++, k++) {
      const a = (j / n) * len, b = ((j + 1) / n) * len, c = k % 2 ? sombre : clair;
      const q = [[x0 + tx * a + nx, z0 + tz * a + nz], [x0 + tx * a - nx, z0 + tz * a - nz], [x0 + tx * b - nx, z0 + tz * b - nz], [x0 + tx * b + nx, z0 + tz * b + nz]];
      const ids = q.map(([x, z]) => g.vertex(x, y, z, 0, 1, 0, x * uv, z * uv, c[0], c[1], c[2]));
      quadHaut(g, ids[0], ids[1], ids[2], ids[3]);
    }
  }
}

/** Indexe le quadrilatère a,b,c,d (à plat) face vers le haut, quel que soit son sens de parcours. */
function quadHaut(g: GeoBuilder, a: number, b: number, c: number, d: number) {
  const P = g.pos;
  const ny = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[d * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[d * 3 + 2] - P[a * 3 + 2]);
  if (ny >= 0) g.quadIdx(a, b, c, d); else g.quadIdx(a, d, c, b);
}

/**
 * Massif planté : le polygone (coordonnées de dalle, voir GeoBuilder.polygon) est extrudé de `h` m
 * au-dessus de `y0` : dessus plein dans le lot végétal `g`, flancs dans le lot uni `gf`. Les arêtes posées sur le bord de la dalle (coupe
 * artificielle d'un massif à cheval sur deux dalles) n'ont pas de flanc. Renvoie le nombre de flancs.
 */
export function poserMassif(g: GeoBuilder, gf: GeoBuilder, o: ArrayLike<number>, trous: ArrayLike<number>[], y0: number, h: number, ox: number, oz: number, scale: number, lim: number): number {
  const c = TEINTE.massif, f = TEINTE.massifFlanc;
  g.polygon(o, trous, y0 + h, 1 / 4, ox, oz, scale, c[0], c[1], c[2]);
  let flancs = 0;
  for (const r of [o, ...trous]) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
      if ((ax <= 1 && bx <= 1) || (ax >= lim - 1 && bx >= lim - 1) || (az <= 1 && bz <= 1) || (az >= lim - 1 && bz >= lim - 1)) continue;
      const x0 = ox + ax * scale, z0 = oz + az * scale, x1 = ox + bx * scale, z1 = oz + bz * scale;
      const l = Math.hypot(x1 - x0, z1 - z0);
      if (l < 0.01) continue;
      const nx = (z1 - z0) / l, nz = -(x1 - x0) / l;
      // les deux sens d'indexation : le flanc se voit de l'extérieur quel que soit le sens de l'anneau
      const ids = [[x0, y0, z0], [x1, y0, z1], [x1, y0 + h, z1], [x0, y0 + h, z0]].map(([x, y, z]) => gf.vertex(x, y, z, nx, 0, nz, 0, 0, f[0], f[1], f[2]));
      gf.quadIdx(ids[0], ids[1], ids[2], ids[3]);
      const ids2 = [[x0, y0, z0], [x1, y0, z1], [x1, y0 + h, z1], [x0, y0 + h, z0]].map(([x, y, z]) => gf.vertex(x, y, z, -nx, 0, -nz, 0, 0, f[0], f[1], f[2]));
      gf.quadIdx(ids2[0], ids2[3], ids2[2], ids2[1]);
      flancs++;
    }
  }
  poserArbustes(gf, o, trous, y0 + h, ox, oz, scale);
  return flancs;
}

/** Surface de massif (m²) par arbuste, et nombre maximal d'arbustes d'un massif. */
const ARBUSTE_M2 = 3.5, ARBUSTES_MAX = 40;

/**
 * Arbustes d'un massif : des touffes basses (boîtes vertes de tailles et de teintes variées) semées sur
 * son dessus, pour qu'il ne se lise pas comme une estrade de gazon. Le semis ne dépend que du contour :
 * il est le même à chaque chargement. Renvoie le nombre de touffes posées.
 */
export function poserArbustes(g: GeoBuilder, o: ArrayLike<number>, trous: ArrayLike<number>[], y: number, ox: number, oz: number, scale: number): number {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, aire = 0;
  const n = o.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    x0 = Math.min(x0, o[i * 2]); x1 = Math.max(x1, o[i * 2]); z0 = Math.min(z0, o[i * 2 + 1]); z1 = Math.max(z1, o[i * 2 + 1]);
    aire += o[i * 2] * o[j * 2 + 1] - o[j * 2] * o[i * 2 + 1];
  }
  aire = (Math.abs(aire) / 2) * scale * scale;
  const voulu = Math.min(ARBUSTES_MAX, Math.round(aire / ARBUSTE_M2));
  if (voulu < 1) return 0;
  const dans = (r: ArrayLike<number>, x: number, z: number) => {
    let c = false;
    for (let i = 0, m = r.length / 2, j = m - 1; i < m; j = i++) {
      const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  let etat = (Math.round(o[0]) * 73856093) ^ (Math.round(o[1]) * 19349663) ^ (n * 83492791) ^ Math.round(ox * 7 + oz * 13);
  const alea = () => { etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0; return etat / 4294967296; };
  let poses = 0;
  for (let essai = 0; essai < voulu * 6 && poses < voulu; essai++) {
    const x = x0 + alea() * (x1 - x0), z = z0 + alea() * (z1 - z0);
    const cote = 0.5 + alea() * 0.7, haut = 0.2 + alea() * 0.4, cap = alea() * Math.PI, c = TEINTE.arbuste[Math.floor(alea() * TEINTE.arbuste.length)];
    // la touffe entière dans le massif : son centre et quatre points de son tour
    const m = (cote * 0.6) / scale;
    if (![[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([dx, dz]) => dans(o, x + dx, z + dz) && !trous.some((t) => dans(t, x + dx, z + dz)))) continue;
    const tx = Math.cos(cap), tz = Math.sin(cap);
    boite(g, { tx, tz, fx: -tz, fz: tx }, ox + x * scale, y + haut / 2, oz + z * scale, cote, haut, cote * (0.7 + alea() * 0.5), c);
    poses++;
  }
  return poses;
}

// ───────────────────────── arbres ─────────────────────────
/**
 * Silhouette d'un arbre d'après son genre botanique (balise genus ou species d'OpenStreetMap) :
 *  haut    hauteur adulte courante, mini et maxi (m), quand la carte ne la donne pas
 *  large   largeur du houppier par rapport à l'arbre « moyen »
 *  elance  allongement vertical du houppier (1 = boule, 1,7 = colonne)
 *  teinte  [teinte, saturation, clarté] du feuillage ; la clarté varie ensuite d'un arbre à l'autre
 */
export interface Silhouette { haut: [number, number]; large: number; elance: number; teinte: [number, number, number] }
const MOYEN: Silhouette = { haut: [7.5, 13.5], large: 1, elance: 1, teinte: [0.27, 0.3, 0.5] };
const FORMES: [RegExp, Silhouette][] = [
  // colonnes : peupliers d'Italie, charmes fastigiés des rues
  [/^(populus)$/, { haut: [14, 20], large: 0.55, elance: 1.8, teinte: [0.26, 0.32, 0.5] }],
  [/^(carpinus|ginkgo|liquidambar|pyrus)$/, { haut: [8, 12], large: 0.7, elance: 1.5, teinte: [0.27, 0.32, 0.5] }],
  // résineux : étroits et sombres
  [/^(pinus|cedrus|picea|abies|cupressus|thuja|taxus|sequoiadendron|metasequoia)$/, { haut: [8, 15], large: 0.75, elance: 1.5, teinte: [0.36, 0.3, 0.33] }],
  // grands arbres d'alignement à houppier large
  [/^(platanus|tilia|aesculus|quercus|fagus|celtis|pterocarya|ailanthus|paulownia|catalpa|zelkova|fraxinus)$/, { haut: [11, 16], large: 1.15, elance: 1, teinte: [0.26, 0.3, 0.5] }],
  // petits arbres à fleurs des squares et des rues étroites
  [/^(prunus|malus|cercis|magnolia|crataegus|amelanchier|corylus|koelreuteria|morus|lagerstroemia|parrotia|cercidiphyllum)$/, { haut: [4.5, 7], large: 1.15, elance: 0.9, teinte: [0.24, 0.32, 0.52] }],
];
export function silhouette(genre: string): Silhouette {
  for (const [re, s] of FORMES) if (re.test(genre)) return s;
  return MOYEN;
}

/**
 * Proportions d'un arbre de hauteur `h` : rayon et demi-hauteur du houppier, hauteur du tronc (qui prend
 * ce qui reste sous le houppier). `rnd` (0 à 1) varie d'un arbre à l'autre, `large` et `elance` viennent
 * de la silhouette du genre.
 */
export function formeArbre(h: number, rnd: number, large: number, elance: number): { rayon: number; demiHaut: number; tronc: number } {
  const rayon = h * (0.3 + rnd * 0.08) * large;
  const demiHaut = Math.min(h * 0.62, h * (0.3 + rnd * 0.08) * 1.05 * elance);
  return { rayon, demiHaut, tronc: Math.max(h * 0.14, Math.min(h * 0.45, h - demiHaut * 1.5)) };
}

/** Les houppiers sont regroupés par blocs de BLOC_ARBRES × BLOC_ARBRES dalles (un appel de dessin par bloc). */
export const BLOC_ARBRES = 2;
/**
 * Un bloc d'arbres dont le centre est à (dx, dz) de l'œil est-il à afficher ? Oui dès qu'une de ses
 * dalles (côté `dalle`) peut l'être : une dalle se voit quand son centre est à moins de rayon + dalle.
 */
export function blocEnVue(dx: number, dz: number, rayon: number, dalle: number): boolean {
  // centre de la dalle du bloc la plus proche de l'œil : à (BLOC_ARBRES − 1) / 2 dalles du centre du bloc au plus, sur chaque axe
  const k = ((BLOC_ARBRES - 1) / 2) * dalle;
  const px = Math.max(0, Math.abs(dx) - k), pz = Math.max(0, Math.abs(dz) - k);
  return px * px + pz * pz < (rayon + dalle) * (rayon + dalle);
}

/** Couleur de l'écorce (linéaire) : celle du matériau des troncs. */
const ECORCE = couleur(0x6b5d4f);
/** Nombre de pans d'un tronc. */
export const PANS_TRONC = 6;

/**
 * Verse un tronc dans un lot à couleurs par sommet : un fût à PANS_TRONC pans, de rayon `r` au pied et
 * 0,75 r en haut, de `y` à `y + h`, sans fond ni dessus (le houppier le coiffe).
 */
export function poserTronc(g: GeoBuilder, x: number, z: number, y: number, h: number, r: number) {
  const ids: number[] = [];
  for (let i = 0; i <= PANS_TRONC; i++) {
    const a = (i / PANS_TRONC) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
    // un côté un peu plus sombre que l'autre : le fût garde du volume sans ombre propre
    const k = 0.82 + 0.18 * nx;
    ids.push(g.vertex(x + nx * r, y, z + nz * r, nx, 0, nz, 0, 0, ECORCE[0] * k, ECORCE[1] * k, ECORCE[2] * k));
    g.vertex(x + nx * r * 0.75, y + h, z + nz * r * 0.75, nx, 0, nz, 0, 0, ECORCE[0] * k, ECORCE[1] * k, ECORCE[2] * k);
  }
  // face vers l'extérieur : sens inverse des aiguilles vu de dehors (x vers z tourne à droite vu de dessus)
  for (let i = 0; i < PANS_TRONC; i++) g.quadIdx(ids[i], ids[i] + 1, ids[i + 1] + 1, ids[i + 1]);
}

// ───────────────────────── mobilier ─────────────────────────
/** Repère d'un objet posé : `t` son grand axe, `f` la direction vers laquelle il fait face. */
export interface Pose { tx: number; tz: number; fx: number; fz: number }

/**
 * Oriente un objet de mobilier. Si la carte donne la direction vers laquelle il regarde (`cap`, en
 * degrés depuis le nord, sens horaire), on la suit. Sinon il est parallèle à la rue la plus proche
 * (`rue` : point de l'axe et tangente) et regarde la chaussée, comme un banc de trottoir.
 */
export function orienter(x: number, z: number, rue: { x: number; z: number; tx: number; tz: number } | null, cap?: number): Pose {
  if (cap !== undefined && Number.isFinite(cap)) {
    const a = (cap * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a);
    return { tx: -fz, tz: fx, fx, fz };
  }
  if (!rue) return { tx: 1, tz: 0, fx: 0, fz: 1 };
  // côté de la rue où se trouve l'objet : la face regarde l'axe
  const cote = (x - rue.x) * -rue.tz + (z - rue.z) * rue.tx >= 0 ? 1 : -1;
  return { tx: rue.tx, tz: rue.tz, fx: rue.tz * cote, fz: -rue.tx * cote };
}

/** Boîte pleine colorée, centrée en (cx, cy, cz) : `lt` selon t, `h` en hauteur, `lf` selon f. Sans fond. */
function boite(g: GeoBuilder, o: Pose, cx: number, cy: number, cz: number, lt: number, h: number, lf: number, c: RGB) {
  const P = (u: number, v: number, w: number): [number, number, number] => [cx + (o.tx * u * lt) / 2 + (o.fx * w * lf) / 2, cy + (v * h) / 2, cz + (o.tz * u * lt) / 2 + (o.fz * w * lf) / 2];
  const faces: [[number, number, number][], [number, number, number], number][] = [
    [[P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [o.fx, 0, o.fz], 1],
    [[P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)], [-o.fx, 0, -o.fz], 0.8],
    [[P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)], [o.tx, 0, o.tz], 0.9],
    [[P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)], [-o.tx, 0, -o.tz], 0.9],
    [[P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)], [0, 1, 0], 1],
  ];
  for (const [q, n, k] of faces) {
    const ids = q.map((p) => g.vertex(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0, c[0] * k, c[1] * k, c[2] * k));
    const ux = q[1][0] - q[0][0], uy = q[1][1] - q[0][1], uz = q[1][2] - q[0][2];
    const vx = q[3][0] - q[0][0], vy = q[3][1] - q[0][1], vz = q[3][2] - q[0][2];
    const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (d >= 0) g.quadIdx(ids[0], ids[1], ids[2], ids[3]); else g.quadIdx(ids[0], ids[3], ids[2], ids[1]);
  }
}

const C = {
  bois: couleur(0x7a5a3c), fonte: couleur(0x2c3330), vert: couleur(0x2d5a3f), gris: couleur(0x8a8f93), acier: couleur(0xa9adb0),
  jaune: couleur(0xf0c010), rouge: couleur(0xb5281e), verre: couleur(0x3f7f52), velib: couleur(0x6f7f78), beige: couleur(0xb9b3a4),
};

/** Types de mobilier dessinés (clé `k` des points de la carte). Le potelet a son propre lot instancié. */
export const MOBILIER = ['bench', 'bin', 'recycling', 'postbox', 'hydrant', 'bikepark', 'velib', 'eau', 'table', 'wc'] as const;
export type Mobilier = (typeof MOBILIER)[number];
export const estMobilier = (k: string): k is Mobilier => (MOBILIER as readonly string[]).includes(k);

/** Nombre d'éléments répétés (arceaux, bornes) d'après la capacité relevée. */
export function rangee(k: Mobilier, cap?: number): number {
  if (k === 'bikepark') return Math.max(1, Math.min(6, Math.round((cap ?? 6) / 2)));
  if (k === 'velib') return Math.max(3, Math.min(10, Math.round((cap ?? 20) / 3)));
  return 1;
}

/**
 * Verse un objet de mobilier dans le lot uni de la dalle. Renvoie les cercles (x, z, rayon) qui
 * servent d'obstacles aux collisions : ce qu'on voit est ce qu'on heurte.
 */
export function poserMobilier(g: GeoBuilder, k: Mobilier, x: number, z: number, y: number, o: Pose, cap?: number): { x: number; z: number; r: number }[] {
  const le = (u: number, w = 0): [number, number] => [x + o.tx * u + o.fx * w, z + o.tz * u + o.fz * w];
  const B = (u: number, cy: number, w: number, lt: number, h: number, lf: number, c: RGB) => { const [px, pz] = le(u, w); boite(g, o, px, y + cy, pz, lt, h, lf, c); };
  switch (k) {
    case 'bench':
      // banc public : assise et dossier en lattes de bois, piétement en fonte
      B(0, 0.44, 0, 1.8, 0.06, 0.42, C.bois); B(0, 0.7, -0.2, 1.8, 0.34, 0.05, C.bois);
      B(-0.75, 0.21, 0, 0.06, 0.42, 0.4, C.fonte); B(0.75, 0.21, 0, 0.06, 0.42, 0.4, C.fonte);
      return [-0.65, 0, 0.65].map((u) => { const [px, pz] = le(u); return { x: px, z: pz, r: 0.28 }; });
    case 'bin':
      B(0, 0.5, 0, 0.06, 1.0, 0.06, C.fonte); B(0, 0.62, 0.2, 0.38, 0.62, 0.34, C.vert);
      return [{ x, z, r: 0.25 }];
    case 'recycling':
      // colonne à verre
      B(0, 0.8, 0, 1.3, 1.6, 1.3, C.verre); B(0, 1.66, 0, 0.9, 0.12, 0.9, C.fonte);
      return [{ x, z, r: 0.8 }];
    case 'postbox':
      B(0, 0.5, 0, 0.12, 1.0, 0.12, C.gris); B(0, 1.25, 0, 0.52, 0.62, 0.36, C.jaune);
      return [{ x, z, r: 0.3 }];
    case 'hydrant':
      B(0, 0.4, 0, 0.2, 0.8, 0.2, C.rouge); B(0, 0.58, 0, 0.36, 0.12, 0.12, C.rouge);
      return [{ x, z, r: 0.16 }];
    case 'eau':
      // fontaine à boire : borne en fonte verte
      B(0, 0.55, 0, 0.3, 1.1, 0.3, C.vert); B(0, 1.14, 0, 0.4, 0.08, 0.4, C.vert);
      return [{ x, z, r: 0.22 }];
    case 'table':
      B(0, 0.74, 0, 1.8, 0.06, 0.8, C.bois); B(0, 0.44, 0.7, 1.8, 0.05, 0.28, C.bois); B(0, 0.44, -0.7, 1.8, 0.05, 0.28, C.bois);
      B(-0.7, 0.36, 0, 0.08, 0.72, 1.5, C.bois); B(0.7, 0.36, 0, 0.08, 0.72, 1.5, C.bois);
      return [-0.6, 0.6].map((u) => { const [px, pz] = le(u); return { x: px, z: pz, r: 0.75 }; });
    case 'wc':
      // sanisette
      B(0, 1.3, 0, 2.6, 2.6, 1.7, C.beige); B(0, 2.66, 0, 2.8, 0.12, 1.9, C.fonte);
      return [-0.7, 0.7].map((u) => { const [px, pz] = le(u); return { x: px, z: pz, r: 0.95 }; });
    case 'bikepark': {
      // arceaux : deux montants et une traverse, en travers du trottoir
      const n = rangee(k, cap), out = [];
      for (let i = 0; i < n; i++) {
        const u = (i - (n - 1) / 2) * 0.9;
        B(u, 0.4, 0.35, 0.05, 0.8, 0.05, C.acier); B(u, 0.4, -0.35, 0.05, 0.8, 0.05, C.acier); B(u, 0.8, 0, 0.05, 0.05, 0.75, C.acier);
        const [px, pz] = le(u);
        out.push({ x: px, z: pz, r: 0.38 });
      }
      return out;
    }
    case 'velib': {
      // station : une rangée de bornes d'accroche et le totem
      const n = rangee(k, cap), out = [];
      for (let i = 0; i < n; i++) {
        const u = (i - (n - 1) / 2) * 0.75;
        B(u, 0.4, 0, 0.18, 0.8, 0.26, C.velib);
        const [px, pz] = le(u);
        out.push({ x: px, z: pz, r: 0.18 });
      }
      const u = (n / 2) * 0.75 + 0.5;
      B(u, 1.05, 0, 0.4, 2.1, 0.22, C.velib);
      const [px, pz] = le(u);
      out.push({ x: px, z: pz, r: 0.25 });
      return out;
    }
  }
}
