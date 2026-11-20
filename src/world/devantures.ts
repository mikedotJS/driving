// Devantures de commerce : choix des couleurs d'enseigne, mise en forme du nom et partage d'un mur
// entre les boutiques qui s'y succèdent. Calcul pur (ni three.js ni DOM), testé par
// tests/devantures.test.ts ; le dessin est dans enseignes.ts et la pose dans city.ts.

export interface Teinte { fond: string; texte: string }

// Une couleur par famille de commerce, comme on les lit dans la rue : le rouge des restaurants,
// le vert des cafés et des pharmacies, l'ocre des boulangeries, le noir et or des coiffeurs.
const FAMILLES: [RegExp, Teinte][] = [
  [/^(restaurant|fast_food|kebab|pizza)$/, { fond: '#8a2a1e', texte: '#fff3df' }],
  [/^(cafe|bar|pub|wine|alcohol|tobacco)$/, { fond: '#1f4a37', texte: '#f3e6c4' }],
  [/^(bakery|pastry|confectionery|chocolate)$/, { fond: '#b9862f', texte: '#fffaf0' }],
  [/^(convenience|supermarket|greengrocer|butcher|seafood|deli|cheese|frozen_food|farm)$/, { fond: '#2f7d32', texte: '#ffffff' }],
  [/^(hairdresser|beauty|cosmetics|perfumery|massage|tattoo)$/, { fond: '#17171a', texte: '#e2c275' }],
  [/^(bank|money_lender|bureau_de_change|money_transfer|insurance|estate_agent)$/, { fond: '#1b2f5e', texte: '#ffffff' }],
  [/^(pharmacy|chemist|medical_supply)$/, { fond: '#f4f6f2', texte: '#12803c' }],
  [/^(laundry|dry_cleaning)$/, { fond: '#2c7fa8', texte: '#ffffff' }],
  [/^(car_repair|car|car_parts|motorcycle|bicycle|tyres|driving_school)$/, { fond: '#e9e6dc', texte: '#1d1d1f' }],
  [/^(florist|garden_centre)$/, { fond: '#3d6b45', texte: '#fbe9ef' }],
  [/^(books|stationery|newsagent|copyshop|art|music|musical_instrument)$/, { fond: '#5a2333', texte: '#f6ecd9' }],
  [/^(mobile_phone|electronics|computer|telecommunication)$/, { fond: '#20242c', texte: '#7fd3ff' }],
];
const DEFAUT: Teinte = { fond: '#2e3138', texte: '#f2f0ea' };

// Les chaînes se reconnaissent à leur couleur avant même d'être lues. Aucun logo : le nom seul, en
// texte, sur la couleur dominante de l'enseigne.
const CHAINES: [RegExp, Teinte][] = [
  [/franprix/i, { fond: '#e8661a', texte: '#ffffff' }],
  [/carrefour/i, { fond: '#16643a', texte: '#ffffff' }],
  [/\bg20\b/i, { fond: '#c8102e', texte: '#ffffff' }],
  [/naturalia/i, { fond: '#33572b', texte: '#f2ecd8' }],
  [/monoprix|monop'/i, { fond: '#c31b24', texte: '#ffffff' }],
  [/picard/i, { fond: '#2a6ebb', texte: '#ffffff' }],
  [/lidl/i, { fond: '#0050aa', texte: '#fff000' }],
  [/aldi/i, { fond: '#1b2f6b', texte: '#ffffff' }],
  [/auchan/i, { fond: '#d6181f', texte: '#ffffff' }],
  [/mcdonald/i, { fond: '#24482f', texte: '#ffc72c' }],
  [/\bquick\b/i, { fond: '#d2232a', texte: '#ffffff' }],
  [/bnp paribas/i, { fond: '#00915a', texte: '#ffffff' }],
  [/\blcl\b/i, { fond: '#1c3f94', texte: '#ffd200' }],
  [/^sg$|société générale/i, { fond: '#1a1a1a', texte: '#e9041e' }],
  [/caisse d'[ée]pargne/i, { fond: '#c8102e', texte: '#ffffff' }],
  [/cr[ée]dit mutuel/i, { fond: '#0a4b9a', texte: '#ffffff' }],
  [/la poste|banque postale/i, { fond: '#ffcb05', texte: '#1c3f94' }],
  [/emma[uü]s/i, { fond: '#1f5f9e', texte: '#ffffff' }],
  [/yves rocher/i, { fond: '#1f6b45', texte: '#ffffff' }],
  [/nicolas/i, { fond: '#7a1626', texte: '#f3e3b8' }],
  [/biocoop/i, { fond: '#2d5a2a', texte: '#f5c400' }],
];

/** Couleurs du bandeau d'un commerce : celles de sa chaîne si on la connaît, sinon celles de son métier. */
export function teinteEnseigne(type: string | undefined, nom: string, marque?: string): Teinte {
  const qui = marque ? `${marque} ${nom}` : nom;
  for (const [re, t] of CHAINES) if (re.test(qui)) return t;
  if (type) for (const [re, t] of FAMILLES) if (re.test(type)) return t;
  return DEFAUT;
}

/** Longueur au-delà de laquelle un nom ne tient plus lisiblement sur un bandeau. */
export const NOM_MAX = 26;

/**
 * Nom tel qu'il est peint sur le bandeau : espaces normalisées, et, s'il est trop long, coupé à la
 * première précision (« – », « ( », « , », « : », « | »), sinon au dernier mot entier. Les accents
 * et la casse saisis dans OpenStreetMap sont conservés tels quels. `max` : longueur admise (une
 * plaque d'édifice, posée sur un long mur, en accepte davantage qu'un bandeau de boutique).
 */
export function texteEnseigne(nom: string, max = NOM_MAX): string {
  let t = nom.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const m = /\s[-–—|]\s|\s?\(|,\s|\s?:\s|\s\/\s/.exec(t);
  if (m && m.index >= 3) t = t.slice(0, m.index).trim();
  if (t.length <= max) return t;
  const court = t.slice(0, max + 1);
  const esp = court.lastIndexOf(' ');
  return (esp >= 8 ? court.slice(0, esp) : t.slice(0, max - 1)).replace(/[\s,;:'’-]+$/, '') + '…';
}

/**
 * Vitrine (0 à 5, voir drawShop dans facades.ts) qui convient au commerce : rideau baissé pour un
 * local vacant, store banne pour qui sert à manger ou à boire, vitrine simple pour les autres.
 */
export function vitrine(type: string | undefined, graine: number): number {
  if (type === 'vacant') return 3;
  if (type && /^(restaurant|cafe|bar|pub|fast_food|bakery|pastry|florist|greengrocer)$/.test(type)) return graine % 2 ? 1 : 4;
  return [0, 2, 5][graine % 3];
}

export interface Portion { f0: number; f1: number }
export interface Partage {
  /** par travée : indice du commerce qui l'occupe, ou −1 */
  travees: number[];
  /** par commerce : étendue de son bandeau le long du mur (m) */
  bandeaux: { a: number; b: number }[];
}

/**
 * Cale les devantures d'un mur sur ses travées : un bandeau qui s'arrête au milieu d'une fenêtre se
 * remarque tout de suite. Chaque commerce prend les travées entières les plus proches de sa portion
 * de mur (au moins celle de son milieu) ; ceux qui tombent dans la même travée se la partagent.
 * @param len      longueur du mur (m)
 * @param nb       nombre de travées
 * @param portions portions [f0, f1] attribuées par la carte, dans un ordre quelconque
 */
export function partager(len: number, nb: number, portions: Portion[]): Partage {
  const bw = len / nb;
  const ordre = portions.map((_, k) => k).sort((p, q) => portions[p].f0 + portions[p].f1 - portions[q].f0 - portions[q].f1 || p - q);
  const bandeaux: { a: number; b: number }[] = portions.map(() => ({ a: 0, b: 0 }));
  const milieu = (k: number) => Math.min(len, Math.max(0, (portions[k].f0 + portions[k].f1) / 2));
  for (const k of ordre) {
    let a = Math.round(portions[k].f0 / bw), b = Math.round(portions[k].f1 / bw);
    const c = Math.min(nb - 1, Math.floor(milieu(k) / bw));
    a = Math.max(0, Math.min(a, c)); b = Math.min(nb, Math.max(b, c + 1));
    bandeaux[k] = { a: a * bw, b: b * bw };
  }
  // voisins qui se chevauchent après le calage : la limite passe à mi-chemin de leurs milieux
  for (let j = 0; j + 1 < ordre.length; j++) {
    const g = ordre[j], d = ordre[j + 1];
    if (bandeaux[d].a < bandeaux[g].b) {
      const lim = (milieu(g) + milieu(d)) / 2;
      bandeaux[g].b = lim; bandeaux[d].a = lim;
    }
  }
  const travees: number[] = [];
  for (let t = 0; t < nb; t++) {
    const m = (t + 0.5) * bw;
    let qui = -1;
    for (const k of ordre) if (m >= bandeaux[k].a && m < bandeaux[k].b) { qui = k; break; }
    // travée partagée dont le milieu tombe pile sur une limite : au premier qui la touche
    if (qui < 0) for (const k of ordre) if (bandeaux[k].a < (t + 1) * bw && bandeaux[k].b > t * bw && bandeaux[k].b - bandeaux[k].a < bw) { qui = k; break; }
    travees.push(qui);
  }
  return { travees, bandeaux };
}
