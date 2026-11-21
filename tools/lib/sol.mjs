// Nature du sol hors chaussée, d'après les balises OpenStreetMap : quelles surfaces fermées deviennent
// un espace de la carte, avec quel revêtement, et dans quel ordre elles se recouvrent. Fonctions pures,
// sans accès aux données : tools/build-map.mjs les applique, tests/sol.test.ts les vérifie.

/**
 * Revêtement d'une surface (balise surface=*), en un caractère :
 *  a enrobé, b béton ou dalles, p pavés, t sol souple (tartan), s sable, g gazon (naturel ou synthétique),
 *  c stabilisé (sable compacté, gravillons), r terre. Chaîne vide si la balise manque ou est inconnue.
 */
export function revetement(surface) {
  if (!surface) return '';
  if (/^(asphalt|paved|chipseal)$/.test(surface)) return 'a';
  if (/^concrete/.test(surface)) return 'b';
  if (/sett|cobblestone|paving_stones|bricks?$/.test(surface)) return 'p';
  if (/^(tartan|acrylic|rubber)$/.test(surface)) return 't';
  if (surface === 'sand') return 's';
  if (/^(grass|artificial_turf|grass_paver)$/.test(surface)) return 'g';
  if (/^(compacted|fine_gravel|gravel|pebblestone|unpaved)$/.test(surface)) return 'c';
  if (/^(dirt|earth|ground|mud|woodchips)$/.test(surface)) return 'r';
  return '';
}

/** Massifs plantés : hauteur de la végétation (dm) selon ce qui est cartographié. */
const MASSIF_E = { hedge: 5, flowerbed: 2, scrub: 3, shrubbery: 4 };
/** Au-delà de cette surface, des broussailles sont un terrain en friche, pas un massif de place. */
export const MASSIF_MAX = 400;

/**
 * Espace que dessine la carte pour une surface OSM fermée, ou null.
 *  tags      balises du chemin ou de la relation
 *  relation  true pour une relation multipolygone : c'est une surface même sans area=yes
 *  aire      surface en m² (sert à distinguer le massif de la friche)
 * Renvoie { k, s?, e? } : k nature (water, park, grass, wood, pitch, cemetery, plaza, parking, dirt,
 * massif, jeux, quai), s revêtement (voir revetement), e hauteur d'un massif en dm.
 *
 * Une boucle fermée highway=footway ou pedestrian sans area=yes est un chemin qui fait le tour d'un
 * pâté de maisons, pas une place : seul un multipolygone ou area=yes en fait une surface.
 */
export function nature(tags, relation = false, aire = 0) {
  const t = tags;
  if (t.building) return null;
  if (t.location === 'underground' || t.indoor === 'yes' || +t.layer < 0 || +t.level < 0) return null;
  if (t.tunnel && t.tunnel !== 'no') return null;
  const s = revetement(t.surface);
  const avec = (k, extra) => ({ k, ...(s ? { s } : {}), ...extra });
  // massifs : haie cartographiée comme une surface, plate-bande, petit carré d'arbustes
  if (t.barrier === 'hedge' && (t.area === 'yes' || relation)) return { k: 'massif', e: MASSIF_E.hedge };
  if (t.landuse === 'flowerbed') return { k: 'massif', e: MASSIF_E.flowerbed };
  if (t.natural === 'shrubbery') return { k: 'massif', e: MASSIF_E.shrubbery };
  if (t.natural === 'scrub' && aire > 0 && aire < MASSIF_MAX) return { k: 'massif', e: MASSIF_E.scrub };
  if (t.leisure === 'playground') return avec('jeux');
  if (t.leisure && /^(park|garden|dog_park)$/.test(t.leisure)) return { k: 'park' };
  if (t.landuse && /^(grass|village_green|greenery|recreation_ground|meadow|allotments)$/.test(t.landuse)) return { k: 'grass' };
  if (t.natural && /^(scrub|grassland|heath)$/.test(t.natural)) return { k: 'grass' };
  if (t.landuse === 'forest' || t.natural === 'wood') return { k: 'wood' };
  if (t.leisure === 'pitch' || t.leisure === 'track') return avec('pitch');
  if (t.natural === 'water' || t.leisure === 'swimming_pool') return { k: 'water' };
  if (t.landuse === 'cemetery') return { k: 'cemetery' };
  if (t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey') return avec('parking');
  const surfacique = t.area === 'yes' || relation;
  if ((/^(pedestrian|footway)$/.test(t.highway ?? '') && surfacique) || t.place === 'square') return avec('plaza');
  // un marché de plein air se tient sur de l'enrobé, pas sur les pavés d'une place piétonne
  if (t.amenity === 'marketplace') return { k: 'plaza', s: s || 'a' };
  if (t.railway === 'platform' || t.public_transport === 'platform') return surfacique || !t.highway ? avec('quai') : null;
  if (t.landuse === 'construction' || t.landuse === 'brownfield') return { k: 'dirt' };
  return null;
}

/**
 * Rang de superposition : un espace de rang plus élevé recouvre les autres. Les grandes emprises
 * (parc, place, parking, chantier) sont le fond ; ce qu'on y a détaillé (pelouse, bois, terrain, jeux,
 * bassin, quai) passe dessus ; le massif planté est toujours visible. À rang égal, le plus petit
 * l'emporte : c'est le plus précis des deux.
 */
export function rang(k) {
  if (k === 'massif') return 2;
  return /^(park|plaza|parking|dirt|cemetery)$/.test(k) ? 0 : 1;
}

/** Ordre de dessin, du dessus vers le dessous. */
export function ordreDessus(a, b) {
  return rang(b.k) - rang(a.k) || a.aire - b.aire;
}

/** Les espaces dont le sol est végétal : c'est là que les allées se voient. */
export const VEGETAL = /^(park|grass|wood|cemetery)$/;

/** Un bâtiment est-il une maison (pavillon avec jardin) ? `t` type, `l` niveaux, `aire` emprise en m². */
export function estMaison(b) {
  return b.t === 'house' || (b.t === 'res' && b.l <= 2 && b.aire < 160);
}

/**
 * Sol par défaut d'un cœur d'îlot, d'après les bâtiments qui s'y trouvent : « jardin » (herbe) si les
 * maisons font au moins la moitié de la surface bâtie, « cour » (minéral) sinon. Un îlot presque vide
 * (moins de 150 m² bâtis) est une cour : OpenStreetMap y dessine les pelouses quand il y en a.
 */
export function tissu(batiments) {
  let bati = 0, maisons = 0;
  for (const b of batiments) {
    if (b.t === 'roof') continue;
    bati += b.aire;
    if (estMaison(b)) maisons += b.aire;
  }
  if (bati < 150) return 'cour';
  return maisons >= bati * 0.5 ? 'jardin' : 'cour';
}

/**
 * Écarte un arbre du bord de la chaussée. `bord` est le point du bord le plus proche, `dedans` dit si
 * l'arbre est saisi sur la chaussée. Renvoie la position corrigée, ou null si l'arbre est trop loin
 * dans la chaussée pour être une imprécision de saisie (plus de `tol` m).
 */
export function ecarterArbre(x, z, bord, dedans, marge = 0.8, tol = 1.2) {
  if (!bord) return dedans ? null : [x, z];
  const dx = x - bord.x, dz = z - bord.z, d = Math.hypot(dx, dz);
  if (dedans) {
    if (d > tol) return null;
    if (d < 1e-6) return null;
    // on traverse le bord : même direction, de l'autre côté
    return [bord.x - (dx / d) * marge, bord.z - (dz / d) * marge];
  }
  if (d >= marge) return [x, z];
  if (d < 1e-6) return null;
  return [bord.x + (dx / d) * marge, bord.z + (dz / d) * marge];
}

/**
 * Déplace un objet de mobilier saisi sur la chaussée vers le trottoir le plus proche. Cherche, par
 * cercles croissants, un point hors chaussée dont le voisinage (`garde` m) l'est aussi. Renvoie la
 * position, inchangée si elle convenait, ou null si aucun trottoir à moins de `max` m.
 */
export function versTrottoir(x, z, surChaussee, max = 2.5, garde = 0.3) {
  const libre = (px, pz) => {
    if (surChaussee(px, pz)) return false;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      if (surChaussee(px + Math.cos(a) * garde, pz + Math.sin(a) * garde)) return false;
    }
    return true;
  };
  if (libre(x, z)) return [x, z];
  for (let r = 0.25; r <= max + 1e-9; r += 0.25) {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (libre(px, pz)) return [px, pz];
    }
  }
  return null;
}

/** Point dans un anneau [[x,z],…] (règle pair-impair). */
export function dansAnneau(pts, x, z) {
  let c = false;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    const a = pts[i], b = pts[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * Assemble des chemins (listes d'identifiants de nœuds) bout à bout en anneaux fermés. Les chemins
 * qui ne se referment pas sont abandonnés. Renvoie des listes d'identifiants sans répétition du premier.
 */
export function assembler(chemins) {
  const segs = chemins.map((s) => s.slice());
  const anneaux = [];
  while (segs.length) {
    let cur = segs.pop();
    let garde = 0;
    while (cur[0] !== cur[cur.length - 1] && garde++ < 1000) {
      const fin = cur[cur.length - 1];
      const k = segs.findIndex((s) => s[0] === fin || s[s.length - 1] === fin);
      if (k < 0) break;
      const s = segs.splice(k, 1)[0];
      if (s[0] !== fin) s.reverse();
      cur = cur.concat(s.slice(1));
    }
    if (cur[0] === cur[cur.length - 1] && cur.length >= 4) anneaux.push(cur.slice(0, -1));
  }
  return anneaux;
}

/**
 * Range les trous d'un multipolygone dans leur anneau extérieur.
 * `exterieurs` et `trous` : anneaux [[x,z],…]. Renvoie [{ o, h: [...] }].
 */
export function rangerTrous(exterieurs, trous) {
  const polys = exterieurs.map((o) => ({ o, h: [] }));
  for (const t of trous) {
    const p = polys.find((q) => dansAnneau(q.o, t[0][0], t[0][1]) || dansAnneau(q.o, t[1][0], t[1][1]));
    if (p) p.h.push(t);
  }
  return polys;
}

// ───────────────────────── végétation relevée sur la photo aérienne ─────────────────────────
/**
 * Relevé de tools/prepare-ortho.py (data/ortho-raw/vegetation.json) : part de végétation du sol non
 * bâti par cases carrées, et houppiers des arbres. Renvoie null si le relevé est absent ou abîmé.
 *  part(i, j)  part de végétation de la case (0 à 1), 0 hors de la grille
 */
export function lireVegetation(v) {
  if (!v || typeof v !== 'object' || !(v.case > 0) || !(v.l > 0) || !(v.h > 0) || typeof v.part !== 'string') return null;
  const octets = Buffer.from(v.part, 'base64');
  if (octets.length !== v.l * v.h) return null;
  const part = (i, j) => (i < 0 || j < 0 || i >= v.l || j >= v.h ? 0 : octets[j * v.l + i] / 255);
  return { x0: v.x0, z0: v.z0, cote: v.case, l: v.l, h: v.h, part, arbres: Array.isArray(v.arbres) ? v.arbres : [] };
}

/** Part de végétation au-dessus de laquelle le sol d'un cœur d'îlot est un jardin. */
export const SEUIL_JARDIN = 0.28;

/**
 * Cases de jardin du relevé : celles dont la part de végétation, moyennée avec ses 8 voisines (une
 * allée ou une terrasse ne trouent pas un jardin, un arbre isolé n'en fait pas un), atteint `seuil`.
 * Renvoie des rectangles [x0, z0, x1, z1] en mètres, un par suite de cases d'une même ligne.
 */
export function casesJardin(veg, seuil = SEUIL_JARDIN) {
  const out = [];
  const lisse = (i, j) => {
    let s = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) s += veg.part(i + a, j + b);
    return s / 9;
  };
  for (let j = 0; j < veg.h; j++) {
    let debut = -1;
    for (let i = 0; i <= veg.l; i++) {
      const oui = i < veg.l && lisse(i, j) >= seuil;
      if (oui && debut < 0) debut = i;
      if (!oui && debut >= 0) {
        out.push([veg.x0 + debut * veg.cote, veg.z0 + j * veg.cote, veg.x0 + i * veg.cote, veg.z0 + (j + 1) * veg.cote]);
        debut = -1;
      }
    }
  }
  return out;
}

/**
 * Hauteur (m) d'un arbre dont la photo montre un houppier de rayon `r` : le jeu dessine un houppier
 * d'un rayon d'environ un tiers de la hauteur. Bornée : ni arbuste, ni géant.
 */
export function hauteurArbre(r) {
  return Math.max(5, Math.min(19, Math.round(r / 0.34)));
}

/**
 * Choisit au plus `quota` arbres parmi les candidats d'une dalle [{ x, z, r, route }] (`route` :
 * distance à la chaussée, m). Les grands houppiers et ceux qui bordent une rue passent d'abord (ce
 * sont eux qu'on voit du volant) ; deux arbres retenus sont distants d'au moins `ecart` m, et à poids
 * voisins le plus éloigné des arbres déjà retenus l'emporte : un bois qui couvre la dalle reçoit ses
 * arbres répartis sur toute sa surface, pas tassés dans un coin.
 */
export function choisirArbres(candidats, quota, ecart = 7, portee = 35) {
  const poids = (c) => c.r * (c.route < 15 ? 2 : c.route < 35 ? 1.4 : 1);
  const reste = candidats.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  const out = [];
  while (out.length < quota && reste.length) {
    let meilleur = -1, note = -1;
    for (let i = 0; i < reste.length; i++) {
      const c = reste[i];
      let d = Infinity;
      for (const o of out) d = Math.min(d, Math.hypot(o.x - c.x, o.z - c.z));
      if (d < ecart) { reste.splice(i--, 1); continue; }
      const n = poids(c) * (0.4 + 0.6 * Math.min(1, d / portee));
      if (n > note) { note = n; meilleur = i; }
    }
    if (meilleur < 0) break;
    out.push(reste.splice(meilleur, 1)[0]);
  }
  return out;
}

/** Clôtures de jardin : largeur d'un portail (m) et longueurs extrêmes d'une parcelle sur rue (m). */
export const PORTAIL = 2.8;
const PARCELLE = [9, 17];
/**
 * Genres de clôture sur rue d'un pavillon : muret bas, muret surmonté d'une haie, haie seule, mur plein.
 *  muret  hauteur du mur (m), 0 s'il n'y en a pas ; haie  hauteur de la haie (m), 0 s'il n'y en a pas ;
 *  ton    indice de la teinte du mur (enduits clairs, brique, meulière)
 */
const GENRES = [
  { muret: 0.9, haie: 0 }, { muret: 0.5, haie: 1.5 }, { muret: 0, haie: 1.4 }, { muret: 1.6, haie: 0 },
  { muret: 0.6, haie: 1.3 }, { muret: 1.1, haie: 0 },
];
export const TONS_MURET = 4;

/**
 * Découpe la limite sur rue d'un rang de jardins (polyligne [[x, z], …]) en parcelles : chacune a sa
 * clôture, et un portail (une ouverture de PORTAIL m) la sépare de la suivante. `graine` rend le
 * découpage reproductible. Renvoie [{ pts, muret, haie, ton }] ; les bouts de moins de 2 m sont laissés ouverts.
 */
export function decouperCloture(pts, graine) {
  let etat = graine >>> 0 || 1;
  const alea = () => { etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0; return etat / 4294967296; };
  const cumul = [0];
  for (let i = 1; i < pts.length; i++) cumul.push(cumul[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cumul[cumul.length - 1];
  const point = (s) => {
    let i = 1;
    while (i < cumul.length - 1 && cumul[i] < s) i++;
    const t = cumul[i] > cumul[i - 1] ? (s - cumul[i - 1]) / (cumul[i] - cumul[i - 1]) : 0;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const out = [];
  let s = 0;
  while (s < total - 2) {
    const fin = Math.min(total, s + PARCELLE[0] + alea() * (PARCELLE[1] - PARCELLE[0]));
    const g = GENRES[Math.floor(alea() * GENRES.length)], ton = Math.floor(alea() * TONS_MURET);
    const a = s, b = fin - (fin < total ? PORTAIL : 0);
    if (b - a >= 2) {
      const p = [point(a)];
      for (let i = 0; i < pts.length; i++) if (cumul[i] > a + 0.05 && cumul[i] < b - 0.05) p.push(pts[i]);
      p.push(point(b));
      out.push({ pts: p, muret: g.muret, haie: g.haie, ton });
    }
    s = fin;
  }
  return out;
}
