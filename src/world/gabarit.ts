// Apparence d'un bâtiment déduite des données de la carte (BD TOPO de l'IGN reportée sur les
// emprises OpenStreetMap) : style de façade, teintes, découpe en étages, forme du toit.
// Tout est du calcul pur, sans three.js ni DOM, pour pouvoir être essayé hors navigateur.

import type { RawBuilding } from '../map/roadnet';
import type { FacadeStyle } from './facades';

/** Ce que l'on sait d'un voisin proche de même gabarit, quand le bâtiment lui-même n'a pas de donnée. */
export interface Voisin { m?: number; r?: number; y?: number }

export interface Apparence {
  style: FacadeStyle;
  /** teintes possibles des murs (multipliées par la tuile de façade) */
  murs: readonly number[];
  /** teintes possibles de la couverture */
  toit: readonly number[];
  /** pente du toit (hauteur / demi-largeur) ; 0 = toit-terrasse */
  pente: number;
  /** hauteur maximale du faîtage au-dessus de l'égout (m) */
  faitage: number;
  /** largeur d'emprise au-delà de laquelle le toit reste plat (m) */
  largeurMax: number;
  /** murs sans fenêtres (garage, remise) : seule la porte est dessinée */
  aveugle: boolean;
  /** hauteur d'étage visée (m) : 3 pour un logement, 4 pour un édifice public, une nef d'un seul jet */
  etage: number;
  /** édifice dont le toit suit l'enveloppe de l'emprise quelle que soit sa forme (nef, chevet, chapelles) */
  monument: boolean;
  /** volume qui signale l'édifice de loin : clocher à flèche d'une église, beffroi d'un hôtel de ville */
  tour?: 'clocher' | 'beffroi';
}

// Teintes de murs. Elles multiplient la tuile : le blanc laisse la matière telle qu'elle est peinte.
const MURS = {
  haussmann: [0xffffff, 0xf7f0e2, 0xf2ead8, 0xfffaf0],
  faubourg: [0xffffff, 0xf6efe0, 0xeeeae2, 0xf4e6c8, 0xe9ded0, 0xdfe3e2, 0xf1d9c0],
  // moellons enduits ou pierre apparente : enduits plus chauds, jamais de gris bleuté
  faubourgPierre: [0xf7f0e2, 0xeadfca, 0xf2e6cc, 0xe6dcc8],
  // brique rouge des HBM et pavillons d'avant-guerre
  brique: [0xffffff, 0xfbeadb, 0xf6e0cc, 0xf2d9c4],
  // brique claire, jaune ou rosée, d'après-guerre
  briqueClaire: [0xfff0d0, 0xffe6c4, 0xf8dcc0],
  // d'une maison à l'autre la meulière va du blond au brun : sans cet écart, une rue entière
  // semble taillée dans le même bloc
  meuliere: [0xffffff, 0xf2e6d2, 0xe2d6c4, 0xfff0d8, 0xd9cfc0, 0xeadcc0],
  // enduits de pavillon : blancs cassés, crèmes, gris clairs ; deux teintes un peu plus soutenues
  // (ocre pâle, rose pâle) pour qu'une rue ne soit pas uniformément blanche
  pavillon: [0xffffff, 0xfbf6ea, 0xf6efdc, 0xf2f1ec, 0xe9ebe8, 0xf7ead2, 0xf3e2d6, 0xeef0e6],
  pavillonPierre: [0xfbf6ea, 0xf6efdc, 0xf3e8d0, 0xf2ecde],
  bois: [0xd9b890, 0xc9a57c, 0xcfae88],
  moderne: [0xffffff, 0xe6e6e2, 0xd9dcdc, 0xf0e8d8],
  contemporain: [0xffffff, 0xf2f2f0, 0xe2e4e3],
  industriel: [0xffffff, 0xd8dcd9, 0xbfc7cf, 0xcfc4b0, 0x9fb0bf],
  public: [0xffffff, 0xf2e2cf, 0xe6d4c0],
  // pierre, béton bouchardé et enduits clairs des mairies, écoles et équipements sans brique connue
  civique: [0xffffff, 0xf7f2e6, 0xf0ece2, 0xf4ecda],
  // ateliers de brique rouge : la tuile « public » (brique claire à grandes baies) tirée vers le rouge
  atelier: [0xe8b8a0, 0xd9a58c, 0xf2ccb4],
  verre: [0xffffff, 0xe6eef2, 0xdde8e2, 0xf2ecde],
  // pierre calcaire grise des églises
  culte: [0xffffff, 0xf4eee0, 0xece6d8],
} as const;

// Teintes de couverture, par matériau (codes de la carte : 1 tuiles, 2 ardoises, 3 zinc, 4 béton).
const TOITS = {
  tuiles: [0xd98a5c, 0xcf7c52, 0xc47248, 0xb5836a, 0xe09464],
  ardoises: [0x5b646d, 0x66707a, 0x555d66],
  zinc: [0x9aa2a8, 0x8f979e, 0xa6aeb3],
  beton: [0xa8a59c, 0x9c9a94, 0xb0ada4],
  tole: [0x9aa0a3, 0x7f878c, 0xa69f93],
} as const;

/**
 * Choisit l'apparence d'un bâtiment. `r` est un tirage dans [0, 1) propre au bâtiment : il ne sert
 * que là où la donnée ne tranche pas (bâtiment sans matériau ni date connus).
 * `voisin` : matériau, toit et époque du bâtiment connu le plus proche de même gabarit ; dans une
 * rue de meulière, la maison non renseignée a toutes les chances d'être en meulière elle aussi.
 */
export function apparence(b: RawBuilding, aire: number, r: number, voisin?: Voisin): Apparence {
  const m = b.m ?? voisin?.m, y = b.y ?? voisin?.y;
  const bas = b.l <= 2, haut = b.l >= 6;
  let style: FacadeStyle;
  let murs: readonly number[] | undefined;
  let aveugle = false;

  const atelier = b.t === 'indus' || b.u === 'i' || (b.lg === 1 && aire > 150);
  // bureaux et commerces sans logement : c'est l'époque et la hauteur qui parlent, pas le matériau
  const tertiaire = b.t === 'com' || (b.u === 'c' && b.u2 !== 'h');
  // garages et remises : l'IGN les classe en « annexe »
  const annexe = b.u === 'a' && bas && aire < 80;

  if (b.t === 'church') {
    style = 'culte';
  } else if (atelier) {
    // tôle nervurée par défaut ; brique à grandes baies quand l'IGN voit de la maçonnerie
    if (b.m === 4 || b.m === 2 || b.m === 1) { style = 'public'; murs = MURS.atelier; } else style = 'industriel';
  } else if (b.t === 'pub') {
    // La tuile « public » est de la brique : on ne la prend que si le cadastre en voit. Sans matériau
    // connu (54 équipements sur 59, dont l'hôtel de ville), la pierre et le béton clairs des années
    // 1930 à 1970 sont le bon pari ; en brique, la mairie passait pour une filature.
    style = b.m === 4 ? 'public' : 'civique';
  } else if (tertiaire && b.h >= 28) {
    style = 'verre';
  } else if (tertiaire && b.t === 'com' && bas && aire > 1200) {
    style = 'industriel'; // grande surface : boîte en bardage
  } else if (tertiaire && ((y !== undefined && y >= 1990) || (y === undefined && m === undefined && b.t === 'com'))) {
    style = !bas && r < 0.4 ? 'verre' : 'contemporain';
  } else if (tertiaire && y !== undefined && y >= 1950 && !bas && (m === 3 || m === undefined)) {
    style = 'moderne';
  } else {
    // logements (et tertiaire logé dans du bâti ancien)
    aveugle = annexe;
    const recent = y !== undefined && y >= 1990, trente = y !== undefined && y >= 1950 && y < 1990;
    if (m === 4) {
      style = 'brique';
      murs = y !== undefined && y >= 1950 ? MURS.briqueClaire : MURS.brique;
    } else if (m === 2 && b.l <= 3) {
      style = 'meuliere';
    } else if (m === 2) {
      // Au-delà de trois niveaux, le cadastre dit « meulière » pour le gros œuvre d'immeubles de
      // rapport dont la façade sur rue est enduite : la meulière apparente est une affaire de pavillons.
      if (b.pa || b.l >= 6) style = 'haussmann';
      else { style = 'faubourg'; murs = MURS.faubourgPierre; }
    } else if (haut && (trente || recent) && m !== undefined) {
      // au cadastre, les tours et barres d'après-guerre sont en « béton », « aggloméré » ou « pierre » (parement)
      style = recent ? 'contemporain' : 'moderne';
    } else if (m === 1) {
      if (b.pa || b.l >= 5) style = 'haussmann';
      else if (bas) { style = 'pavillon'; murs = MURS.pavillonPierre; }
      else { style = 'faubourg'; murs = MURS.faubourgPierre; }
    } else if (m === 3) {
      if (recent) style = bas ? 'pavillon' : 'contemporain';
      else if (trente || b.h >= 22 || (y === undefined && !bas)) style = bas ? 'pavillon' : 'moderne';
      else style = bas ? 'pavillon' : 'faubourg';
    } else if (m === 6) {
      style = bas ? 'pavillon' : 'contemporain'; murs = MURS.bois;
    } else if (m === 5 || m === 9) {
      style = bas ? 'pavillon' : recent ? 'contemporain' : 'faubourg';
    } else if (recent) {
      style = bas ? 'pavillon' : 'contemporain';
    } else if (b.h >= 25) {
      style = 'moderne'; // tour ou barre sans donnée : presque toutes datent des années 1960-1970
    } else if (trente) {
      style = bas ? 'pavillon' : b.l >= 5 || r < 0.5 ? 'moderne' : 'faubourg';
    } else if (b.pa) {
      // Paris 20e sans donnée : le mélange d'avant
      if (b.l >= 5) style = r < 0.5 ? 'haussmann' : r < 0.75 ? 'faubourg' : r < 0.9 ? 'brique' : 'moderne';
      else style = r < 0.7 ? 'faubourg' : 'brique';
    } else if (bas) {
      style = b.t === 'house' || r < 0.7 ? 'pavillon' : 'faubourg';
    } else if (b.l <= 5) {
      style = r < 0.6 ? 'faubourg' : r < 0.75 ? 'brique' : r < 0.9 ? 'contemporain' : 'moderne';
    } else {
      style = r < 0.6 ? 'moderne' : 'contemporain';
    }
  }

  // ── couverture ──
  // matériau connu, sinon celui du voisin, sinon l'habitude du style
  let toit: readonly number[];
  let pente = 0, faitage = 0;
  let rt = b.r ?? voisin?.r;
  if (rt === undefined || rt === 9) {
    if (style === 'pavillon' || style === 'meuliere') rt = 1;
    else if (style === 'brique') rt = bas ? 1 : 3;
    else if (style === 'haussmann') rt = 3;
    else if (style === 'culte') rt = 1; // tuile plate des églises de village d'Île-de-France
    else if (style === 'faubourg') rt = r < 0.5 ? 3 : 1;
    else if (style === 'industriel') rt = 0;
    else rt = 4;
  }
  // les barres, tours, bureaux et ateliers ont des terrasses ou des bacs acier, quel que soit le code
  const terrasse = style === 'moderne' || style === 'contemporain' || style === 'verre' || style === 'industriel' || style === 'public' || style === 'civique';
  if (rt === 1) { toit = TOITS.tuiles; if (!terrasse) { pente = 0.7; faitage = 3.2; } }
  else if (rt === 2) { toit = TOITS.ardoises; if (!terrasse) { pente = 0.85; faitage = 3.6; } }
  else if (rt === 3) { toit = TOITS.zinc; if (!terrasse) { pente = 0.3; faitage = 1.6; } }
  else if (rt === 4) toit = TOITS.beton;
  else toit = TOITS.tole;
  // le comble d'une nef est raide et haut, quel que soit son matériau
  if (style === 'culte' && pente > 0) { pente = 0.85; faitage = 7; }
  // un toit en pente sur un grand immeuble ne se voit pas de la rue, et les auvents sont plats
  if ((b.h > 19 && b.t !== 'church') || b.lg === 1) pente = 0;

  const culte = style === 'culte';
  // Clocher : seulement là où le nom dit que c'en est une (une synagogue, une mosquée, un temple
  // sont aussi des « lieux de culte » pour la carte). Beffroi : les hôtels de ville.
  let tour: Apparence['tour'];
  if (culte && b.n && /^(église|chapelle|basilique|notre-dame|saint)/i.test(b.n)) tour = 'clocher';
  else if (b.t === 'pub' && b.n && /^(hôtel de ville|mairie)/i.test(b.n)) tour = 'beffroi';
  return {
    style, murs: murs ?? MURS[style], toit, pente, faitage,
    // une nef d'église est bien plus large qu'une maison, et son comble plus haut
    largeurMax: culte ? 32 : 16, aveugle,
    etage: culte ? 8 : style === 'civique' || style === 'public' ? 4 : 3,
    monument: culte, tour,
  };
}

export interface Etages { n: number; h: number; bandeau: number }

/**
 * Découpe la hauteur au-dessus du rez-de-chaussée en étages : n étages de hauteur h, puis un
 * bandeau de couronnement. On part du nombre de niveaux de la carte ; s'il donnerait des étages
 * invraisemblables (à plus de 0,5 m de la hauteur visée), c'est la hauteur mesurée qui décide.
 * `cible` : hauteur d'étage visée, 3 m pour un logement. Les niveaux de la carte sont comptés pour
 * du logement : pour une autre cible (édifice public, nef), seule la hauteur mesurée compte.
 */
export function etages(hautTotal: number, niveaux: number, rdc: number, cible = 3): Etages {
  const dispo = hautTotal - rdc;
  if (niveaux <= 1 || dispo < 2.2) return { n: 0, h: 0, bandeau: Math.max(0, dispo) };
  const corniche = Math.min(0.6, dispo * 0.08);
  let n = niveaux - 1;
  let h = (dispo - corniche) / n;
  if (cible !== 3 || h < 2.5 || h > 3.5) {
    n = Math.max(1, Math.round((dispo - corniche) / cible));
    h = Math.min(cible * 1.5, (dispo - corniche) / n);
    if (cible === 3) h = Math.min(3.5, h);
  }
  return { n, h, bandeau: dispo - n * h };
}

type Pt = [number, number];
type P3 = [number, number, number];
export interface Toit {
  /** versants : triangles ou quadrilatères, sommets (x, hauteur au-dessus de l'égout, z) */
  versants: P3[][];
  /** pignons : triangles verticaux qui prolongent les murs sous un toit à deux pans */
  pignons: P3[][];
  /** direction du faîtage (unitaire), pour orienter la texture */
  axe: Pt;
  /** hauteur du faîtage au-dessus de l'égout (m) */
  faite: number;
  /**
   * Enveloppe à fermer par une sous-face quand le toit déborde de l'emprise (décrochement, angle
   * rentrant) : sans elle on verrait le ciel sous les tuiles depuis la rue. null si rien ne dépasse.
   */
  sousFace: Pt[] | null;
}

function aireSignee(q: Pt[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const j = (i + 1) % q.length; a += q[i][0] * q[j][1] - q[j][0] * q[i][1]; }
  return a / 2;
}

/** enveloppe convexe (chaîne monotone d'Andrew), sans les points presque alignés */
function enveloppe(pts: Pt[]): Pt[] {
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]) => {
    const h: Pt[] = [];
    // 0,05 m² de tolérance : un sommet posé au milieu d'un mur droit n'est pas un angle
    for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0.05) h.pop(); h.push(p); }
    h.pop();
    return h;
  };
  return half(s).concat(half(s.reverse()));
}

// Part de l'enveloppe convexe que l'emprise doit remplir pour recevoir un toit en pente. À 85 %, une
// maison en L gardait un coin de toit de 15 m² suspendu au-dessus du vide ; à 88 % le débord reste
// celui d'un porche ou d'un décrochement de façade, et une sous-face le ferme (voir Toit.sousFace).
const PLEIN_MIN = 0.88;
// Un édifice (église) est couvert d'un seul comble sur sa nef, son chevet et ses chapelles : son
// emprise est bien plus découpée que celle d'une maison, et le toit plat y est la pire des réponses.
const PLEIN_MIN_MONUMENT = 0.6;

/**
 * Toit en pente posé sur une emprise simple : deux pans avec pignons sur un rectangle, quatre pans
 * (croupes) sur les autres formes convexes. Rend null si l'emprise ne s'y prête pas (trop large,
 * en L, en U…) : le toit reste alors plat.
 * Le toit suit l'enveloppe convexe de l'emprise : un petit décrochement de façade est simplement
 * couvert par le débord, comme en vrai, et `sousFace` dit quoi fermer par-dessous.
 * `monument` : pas de limite au nombre d'angles de l'enveloppe ni, ou presque, à ses décrochements.
 */
export function toitEnPente(p: ArrayLike<number>, pente: number, faitageMax: number, largeurMax = 16, monument = false): Toit | null {
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  if (pts.length < 3 || pente <= 0) return null;
  const hull = enveloppe(pts);
  if (hull.length < 3 || (hull.length > 10 && !monument)) return null;
  const aHull = Math.abs(aireSignee(hull)), aire = Math.abs(aireSignee(pts));
  if (aHull < 12 || aire < (monument ? PLEIN_MIN_MONUMENT : PLEIN_MIN) * aHull) return null;

  // axe du faîtage : le plus long côté, ou sa perpendiculaire si l'emprise est plus longue dans ce sens
  let ax = 1, az = 0, best = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > best) { best = l; ax = (b[0] - a[0]) / l; az = (b[1] - a[1]) / l; }
  }
  const ext = (dx: number, dz: number) => {
    let lo = Infinity, hi = -Infinity;
    for (const q of hull) { const v = q[0] * dx + q[1] * dz; if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
  };
  let [s0, s1] = ext(ax, az), [t0, t1] = ext(-az, ax);
  if (s1 - s0 < t1 - t0) { [ax, az] = [-az, ax]; [s0, s1] = ext(ax, az); [t0, t1] = ext(-az, ax); }
  const L = s1 - s0, W = t1 - t0;
  if (W < 2.5 || W > largeurMax) return null;
  const rise = Math.min(faitageMax, (W / 2) * pente);
  // deux pans si l'emprise est un rectangle ; sinon des croupes, qui tolèrent les angles quelconques
  const pignon = hull.length === 4 && aHull > 0.93 * L * W;
  const retrait = pignon ? 0 : Math.min(W / 2, L / 2);
  const tm = (t0 + t1) / 2, sm = (s0 + s1) / 2;
  const at = (s: number): P3 => [ax * s - az * tm, rise, az * s + ax * tm];
  const A = at(s0 + retrait), B = at(s1 - retrait);
  const pointe = L - 2 * retrait < 0.05;
  const cote = hull.map((q) => (q[0] * ax + q[1] * az < sm ? A : B));
  const versants: P3[][] = [], pignons: P3[][] = [];
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    const a: P3 = [hull[i][0], 0, hull[i][1]], b: P3 = [hull[j][0], 0, hull[j][1]];
    if (cote[i] === cote[j] || pointe) (pignon ? pignons : versants).push([a, b, cote[i]]);
    else versants.push([a, b, cote[j], cote[i]]);
  }
  // moins d'un demi-mètre carré de débord : rien à fermer (sommets alignés écartés de l'enveloppe)
  return { versants, pignons, axe: [ax, az], faite: rise, sousFace: aHull - aire > 0.5 ? hull : null };
}
