// Bâtiments de la BD TOPO de l'IGN (data/ign-raw/bat_*.json, téléchargés par tools/fetch-ign.sh)
// et appariement avec les emprises OpenStreetMap.
//
// On ne remplace PAS les emprises : celles d'OSM alimentent la grille d'obstacles qui dimensionne
// les profils de rue, donc y toucher déplacerait la chaussée. L'IGN n'apporte que des attributs
// (hauteur mesurée, étages, matériaux du fichier foncier, date, usage) reportés sur l'emprise OSM.
//
// Données IGN – BD TOPO, Licence Ouverte Etalab 2.0.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('clipper-lib');

const SCALE = 100; // clipper travaille en cm entiers
const toPath = (pts) => pts.map((q) => ({ X: Math.round(q[0] * SCALE), Y: Math.round(q[1] * SCALE) }));

/** Usage IGN → une lettre (le libellé complet pèserait 200 ko sur la carte). */
export const USAGES = {
  'Résidentiel': 'h', 'Commercial et services': 'c', 'Industriel': 'i', 'Sportif': 's',
  'Annexe': 'a', 'Religieux': 'r', 'Agricole': 'g',
};

/**
 * Code de matériaux du fichier foncier (MAJIC) : deux chiffres = deux matériaux, 0 = indéterminé.
 * « 40 » = brique seule, « 24 » = meulière puis brique, « 04 » = brique seule aussi. Il ne faut
 * donc surtout pas le lire comme un nombre. Absent, vide et « 00 » sont trois façons de dire inconnu.
 * Renvoie [principal, secondaire] (0 = aucun).
 */
export function codeMateriaux(code) {
  if (typeof code !== 'string') return [0, 0];
  const d = [...code].map((ch) => (ch >= '1' && ch <= '9' ? +ch : 0)).filter((v) => v > 0);
  if (!d.length) return [0, 0];
  return [d[0], d.length > 1 && d[1] !== d[0] ? d[1] : 0];
}

/** Médiane pondérée d'une liste [valeur, poids]. */
export function medianePonderee(list) {
  const s = list.slice().sort((a, b) => a[0] - b[0]);
  const total = s.reduce((t, e) => t + e[1], 0);
  let acc = 0;
  for (const e of s) { acc += e[1]; if (acc >= total / 2) return e[0]; }
  return s.length ? s[s.length - 1][0] : NaN;
}

/** Valeur qui cumule le plus grand poids dans une liste [valeur, poids] ; [valeur, poids cumulé]. */
function dominante(list) {
  const sum = new Map();
  for (const [v, w] of list) sum.set(v, (sum.get(v) ?? 0) + w);
  let best = null, bw = 0;
  for (const [v, w] of sum) if (w > bw) { best = v; bw = w; }
  return [best, bw];
}

/**
 * Lit les GeoJSON IGN (lecture seule, JSON.parse : ce sont des données téléchargées) et projette
 * les emprises avec la même projection que la carte. Renvoie null si le dossier est absent ou vide.
 */
export function loadIgn(dir, proj) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^bat_\d+\.json$/.test(f)).sort();
  if (!files.length) return null;
  const seen = new Set();
  const list = [];
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const ft of doc.features ?? []) {
      const p = ft.properties ?? {};
      const g = ft.geometry;
      if (!g || !p.cleabs || seen.has(p.cleabs)) continue;
      seen.add(p.cleabs);
      // bâtiments en projet ou en construction : pas encore dans la rue
      if (p.etat_de_l_objet !== 'En service') continue;
      const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
      // anneaux extérieurs et trous dans une seule liste : en remplissage pair-impair, les cours
      // intérieures sont retranchées sans avoir à orienter les anneaux
      const paths = [];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const poly of polys) for (const ring of poly) {
        const pts = ring.map((c) => proj(c[1], c[0]));
        if (pts.length < 4) continue;
        for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
        paths.push(toPath(pts));
      }
      if (!paths.length) continue;
      const area = aire(paths, null);
      if (!(area > 1)) continue;
      const [mur, mur2] = codeMateriaux(p.materiaux_des_murs);
      const [toit] = codeMateriaux(p.materiaux_de_la_toiture);
      const an = typeof p.date_d_apparition === 'string' ? parseInt(p.date_d_apparition.slice(0, 4), 10) : NaN;
      list.push({
        id: p.cleabs, paths, area, box: [x0, z0, x1, z1],
        h: typeof p.hauteur === 'number' && p.hauteur > 0 ? p.hauteur : 0,
        etages: typeof p.nombre_d_etages === 'number' && p.nombre_d_etages > 0 ? p.nombre_d_etages : 0,
        mur, mur2, toit,
        an: an > 1000 && an < 2100 ? an : 0,
        u1: USAGES[p.usage_1] ?? '', u2: USAGES[p.usage_2] ?? '',
        leger: p.construction_legere === true,
      });
    }
  }
  return { files: files.length, list };
}

const EO = C.PolyFillType.pftEvenOdd;
/** Aire (m²) de `a`, ou de l'intersection de `a` et `b` si `b` est donné. */
function aire(a, b) {
  const c = new C.Clipper();
  c.AddPaths(a, C.PolyType.ptSubject, true);
  if (b) c.AddPaths(b, C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(b ? C.ClipType.ctIntersection : C.ClipType.ctUnion, out, EO, EO);
  return out.reduce((s, p) => s + C.Clipper.Area(p), 0) / (SCALE * SCALE);
}

const CELL = 40; // m
// Seuils de l'appariement. Prendre « le meilleur IGN » ne marche pas : un auvent au pied d'une tour
// hériterait de ses 53 m, et une résidence saisie d'un seul trait dans OSM de la hauteur d'un seul
// de ses bâtiments. On raisonne donc en surface recoupée.
const PART_MIN = 0.10;     // un IGN compte s'il couvre au moins 10 % de l'emprise OSM…
const INCLUS_MIN = 0.60;   // …ou s'il y tombe lui-même à 60 % (petit corps de bâtiment)
const INCLUS_M2 = 6;
const COUVERTURE_MIN = 0.5; // en dessous, on ne reporte rien : ce n'est pas le même bâtiment
const ATTRIBUT_MIN = 0.3;   // part de l'emprise sur laquelle un matériau, une date… doit être connu
const AUVENT_RATIO = 2.5;   // auvent OSM logé dans un IGN bien plus grand : sa hauteur n'est pas celle de l'IGN
// Même piège pour une petite emprise en dur (remise, garage, appentis détaillés dans OSM) logée dans
// un IGN qui fond tout l'îlot en un seul bâtiment : lui donner les 25 m de l'immeuble voisin dresse
// une aiguille de 20 m² au fond de la cour. Une petite emprise qui a SON bâtiment IGN (cage
// d'ascenseur, cheminée : IGN de 9 m² à 31 m) n'est pas concernée, le rapport de surface reste proche de 1.
const ANNEXE_RATIO = 5, ANNEXE_M2 = 60;
const ETAGE_MIN = 2.4, ETAGE_MAX = 4.5; // hauteur d'étage plausible (m)

/**
 * Apparie chaque bâtiment OSM ({ pts, area, type }) aux bâtiments IGN qui le recouvrent.
 * Ne modifie rien : renvoie, dans le même ordre, un objet d'attributs ou null (non apparié).
 *   h      hauteur IGN (m, à l'égout du toit), absente si elle n'est pas connue sur la moitié de l'emprise,
 *          ou si l'emprise n'est qu'un auvent ou une annexe au pied d'un IGN bien plus grand
 *   etages nombre d'étages IGN, seulement s'il est cohérent avec la hauteur
 *   mur, mur2, toit   chiffres MAJIC (voir codeMateriaux)
 *   an     année d'apparition ; u, u2 usages (lettres de USAGES) ; leger construction légère
 *   couv   part de l'emprise OSM couverte par l'IGN ; n nombre d'IGN retenus
 */
export function apparier(osm, ign) {
  const grid = new Map();
  ign.forEach((g, k) => {
    const [x0, z0, x1, z1] = g.box;
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const key = `${i},${j}`;
        let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(k);
      }
    }
  });
  return osm.map((b) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of b.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    const cand = new Set();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        for (const k of grid.get(`${i},${j}`) ?? []) cand.add(k);
      }
    }
    const path = [toPath(b.pts)];
    const kept = []; // [ign, aire recoupée]
    // ordre des identifiants de la grille = ordre de lecture des fichiers : résultat reproductible
    for (const k of [...cand].sort((u, v) => u - v)) {
      const g = ign[k];
      if (g.box[0] > x1 || g.box[2] < x0 || g.box[1] > z1 || g.box[3] < z0) continue;
      const a = aire(path, g.paths);
      if (a >= PART_MIN * b.area || (a >= INCLUS_MIN * g.area && a >= INCLUS_M2)) kept.push([g, a]);
    }
    const couv = kept.reduce((s, e) => s + e[1], 0) / b.area;
    if (couv < COUVERTURE_MIN) return null;
    const o = { couv: Math.min(1, couv), n: kept.length };

    // hauteur : médiane pondérée par la surface, connue sur au moins la moitié de l'emprise
    const hs = kept.filter((e) => e[0].h > 0).map((e) => [e[0].h, e[1]]);
    const hCouv = hs.reduce((s, e) => s + e[1], 0);
    const principal = kept.reduce((m, e) => (e[1] > m[1] ? e : m), kept[0])[0];
    const auvent = b.type === 'roof' && principal.area > AUVENT_RATIO * b.area;
    const annexe = b.area < ANNEXE_M2 && principal.area > ANNEXE_RATIO * b.area;
    if (hCouv >= COUVERTURE_MIN * b.area && !auvent && !annexe) {
      o.h = medianePonderee(hs);
      // le nombre d'étages du fichier foncier est faux hors logement (1 étage pour une tour de 85 m) :
      // on ne le garde que s'il donne une hauteur d'étage plausible
      const es = kept.filter((e) => e[0].etages > 0).map((e) => [e[0].etages, e[1]]);
      if (es.reduce((s, e) => s + e[1], 0) >= COUVERTURE_MIN * b.area) {
        const et = medianePonderee(es);
        if (o.h / et >= ETAGE_MIN && o.h / et <= ETAGE_MAX) o.etages = et;
      }
    }
    const dom = (f) => {
      const [v, w] = dominante(kept.filter((e) => f(e[0])).map((e) => [f(e[0]), e[1]]));
      return w >= ATTRIBUT_MIN * b.area ? v : 0;
    };
    const murs = dom((g) => (g.mur ? g.mur * 10 + g.mur2 : 0));
    if (murs) { o.mur = Math.floor(murs / 10); o.mur2 = murs % 10; }
    const toit = dom((g) => g.toit); if (toit) o.toit = toit;
    const an = dom((g) => g.an); if (an) o.an = an;
    const usages = dom((g) => (g.u1 ? g.u1 + g.u2 : 0));
    if (usages) { o.u = usages[0]; if (usages[1]) o.u2 = usages[1]; }
    // construction légère (hangar, auvent, abri) : si elle fait plus de la moitié de ce qui recouvre l'emprise
    const aLeger = kept.filter((e) => e[0].leger).reduce((s, e) => s + e[1], 0);
    if (aLeger > 0.5 * couv * b.area) o.leger = true;
    return o;
  });
}
