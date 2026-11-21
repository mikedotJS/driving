// Sol hors chaussée et mobilier d'après OpenStreetMap : règles de la compilation (tools/lib/sol.mjs),
// habillage au rendu (src/world/sol.ts), et garde-fous sur la carte livrée.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import earcut from 'earcut';
import { PORTAIL, SEUIL_JARDIN, TONS_MURET as NB_TONS, assembler, casesJardin, choisirArbres, decouperCloture, ecarterArbre, estMaison, hauteurArbre, lireVegetation, nature, ordreDessus, rangerTrous, revetement, tissu, versTrottoir, type Point } from '../tools/lib/sol.mjs';
import { BLOC_ARBRES, MOBILIER, PANS_TRONC, TONS_MURET, blocEnVue, estMobilier, formeArbre, habillage, orienter, poserAllee, poserArbustes, poserMarches, poserMassif, poserMobilier, poserTronc, rangee, ruban, silhouette } from '../src/world/sol';
import { GeoBuilder } from '../src/world/geo';
import { Ground } from '../src/world/ground';
import type { MapFile, RawPoly } from '../src/map/roadnet';

const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;

describe('nature d’une surface OpenStreetMap', () => {
  it('reconnaît une place piétonne en multipolygone sans area=yes (place Jacques Duclos)', () => {
    const tags = { highway: 'pedestrian', surface: 'sett', type: 'multipolygon', name: 'Place Jacques Duclos' };
    expect(nature(tags, true)).toEqual({ k: 'plaza', s: 'p' });
  });
  it('ne prend pas pour une place un chemin piéton qui se referme sur lui-même', () => {
    expect(nature({ highway: 'footway' }, false)).toBeNull();
    expect(nature({ highway: 'pedestrian' }, false)).toBeNull();
    expect(nature({ highway: 'service' }, true)).toBeNull();
    expect(nature({ highway: 'footway', area: 'yes' }, false)).toEqual({ k: 'plaza' });
  });
  it('fait une place d’un marché, avec son revêtement', () => {
    expect(nature({ amenity: 'marketplace' })).toEqual({ k: 'plaza', s: 'a' });
    expect(nature({ amenity: 'marketplace', surface: 'sett' })).toEqual({ k: 'plaza', s: 'p' });
    expect(nature({ highway: 'pedestrian', area: 'yes', surface: 'concrete' })).toEqual({ k: 'plaza', s: 'b' });
  });
  it('fait un massif d’une haie surfacique, d’une plate-bande et d’un petit carré d’arbustes', () => {
    expect(nature({ barrier: 'hedge', area: 'yes' })).toMatchObject({ k: 'massif' });
    expect(nature({ landuse: 'flowerbed' })).toMatchObject({ k: 'massif' });
    expect(nature({ natural: 'scrub' }, false, 120)).toMatchObject({ k: 'massif' });
    // une friche de 2 000 m² reste un espace vert
    expect(nature({ natural: 'scrub' }, false, 2000)).toEqual({ k: 'grass' });
    // une haie en ligne n'est pas une surface
    expect(nature({ barrier: 'hedge' })).toBeNull();
  });
  it('garde la surface sous une clôture fermée qui porte une autre balise', () => {
    expect(nature({ barrier: 'fence', leisure: 'playground' })).toEqual({ k: 'jeux' });
    expect(nature({ barrier: 'fence' })).toBeNull();
  });
  it('lit le revêtement des terrains de sport au lieu de les mettre tous en herbe', () => {
    expect(nature({ leisure: 'pitch', surface: 'asphalt' })).toEqual({ k: 'pitch', s: 'a' });
    expect(nature({ leisure: 'pitch', surface: 'tartan' })).toEqual({ k: 'pitch', s: 't' });
    expect(nature({ leisure: 'pitch' })).toEqual({ k: 'pitch' });
    expect(habillage('pitch', 'a').lot).toBe('mineral');
    expect(habillage('pitch', 's').lot).toBe('uni');
    expect(habillage('pitch').lot).toBe('vegetal');
  });
  it('écarte le bâti, le souterrain et les parkings en ouvrage', () => {
    expect(nature({ building: 'yes', leisure: 'park' })).toBeNull();
    expect(nature({ highway: 'pedestrian', area: 'yes', tunnel: 'yes' })).toBeNull();
    expect(nature({ amenity: 'parking', parking: 'underground' })).toBeNull();
    expect(nature({ amenity: 'parking' })).toEqual({ k: 'parking' });
  });
  it('classe les revêtements', () => {
    expect([revetement('asphalt'), revetement('concrete:plates'), revetement('paving_stones'), revetement('unhewn_cobblestone'), revetement('fine_gravel'), revetement('sand'), revetement('artificial_turf'), revetement('dirt'), revetement('wood'), revetement(undefined)])
      .toEqual(['a', 'b', 'p', 'p', 'c', 's', 'g', 'r', '', '']);
  });
});

describe('habillage des espaces au rendu', () => {
  it('n’envoie en herbe que ce qu’OpenStreetMap dit être vert', () => {
    for (const k of ['park', 'grass', 'wood', 'cemetery']) expect(habillage(k).lot).toBe('vegetal');
    for (const k of ['plaza', 'parking', 'quai', 'dirt', 'jeux']) expect(habillage(k).lot).not.toBe('vegetal');
    expect(habillage('plaza').lot).toBe('pave');
    expect(habillage('plaza', 'b').lot).toBe('mineral');
    expect(habillage('plaza', 'a').lot).toBe('mineral');
    expect(habillage('parking').lot).toBe('mineral');
    expect(habillage('water').lot).toBe('eau');
  });
});

describe('superposition des espaces', () => {
  it('met le détail au-dessus de l’emprise, le massif au-dessus de tout, le plus petit devant à rang égal', () => {
    const l = [{ k: 'park', aire: 5000 }, { k: 'massif', aire: 40 }, { k: 'plaza', aire: 900 }, { k: 'grass', aire: 300 }, { k: 'jeux', aire: 80 }];
    expect(l.sort(ordreDessus).map((a) => a.k)).toEqual(['massif', 'jeux', 'grass', 'plaza', 'park']);
  });
});

describe('multipolygones', () => {
  it('assemble des chemins bout à bout, dans un sens ou dans l’autre', () => {
    const a = assembler([[1, 2, 3], [5, 4, 3], [5, 6, 1], [7, 8, 9, 7], [10, 11]]);
    expect(a.map((r) => r.length).sort()).toEqual([3, 6]);
  });
  it('range chaque trou dans son anneau extérieur', () => {
    const carre = (x: number, z: number, c: number): Point[] => [[x, z], [x + c, z], [x + c, z + c], [x, z + c]];
    const polys = rangerTrous([carre(0, 0, 100), carre(200, 0, 50)], [carre(10, 10, 5), carre(30, 30, 5), carre(40, 60, 5), carre(60, 10, 5), carre(70, 70, 5), carre(210, 10, 5)]);
    expect(polys.map((p) => p.h.length)).toEqual([5, 1]);
  });
  it('triangule une place à cinq trous sans recouvrir les trous', () => {
    // comme la place Jean Jaurès : un rectangle de 100 × 60 m percé de cinq massifs de 6 × 6 m
    const o = [0, 0, 100, 0, 100, 60, 0, 60];
    const trous = [[10, 10], [30, 40], [50, 12], [70, 40], [88, 20]].map(([x, z]) => [x, z, x, z + 6, x + 6, z + 6, x + 6, z]);
    const g = new GeoBuilder();
    g.polygon(o, trous, 0, 1);
    let aire = 0;
    for (let i = 0; i < g.idx.length; i += 3) {
      const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]].map((k) => [g.pos[k * 3], g.pos[k * 3 + 2]]);
      aire += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      // aucun triangle n'a son centre dans un massif
      const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[1] + b[1] + c[1]) / 3;
      for (const [x, z] of [[10, 10], [30, 40], [50, 12], [70, 40], [88, 20]]) expect(cx > x && cx < x + 6 && cz > z && cz < z + 6).toBe(false);
    }
    expect(aire).toBeCloseTo(100 * 60 - 5 * 36, 6);
  });
});

describe('sol par défaut d’un cœur d’îlot', () => {
  const maison = { t: 'house', l: 2, aire: 90 }, petit = { t: 'res', l: 2, aire: 110 }, immeuble = { t: 'res', l: 6, aire: 420 }, atelier = { t: 'indus', l: 1, aire: 800 };
  it('reconnaît une maison', () => {
    expect([maison, petit, immeuble, atelier, { t: 'res', l: 2, aire: 300 }].map(estMaison)).toEqual([true, true, false, false, false]);
  });
  it('met un îlot de pavillons en jardin', () => {
    expect(tissu([maison, maison, petit, maison, { t: 'roof', l: 1, aire: 2000 }])).toBe('jardin');
  });
  it('met en cour un îlot d’immeubles ou d’ateliers, même avec quelques maisons', () => {
    expect(tissu([immeuble, immeuble, maison])).toBe('cour');
    expect(tissu([atelier, maison, maison])).toBe('cour');
  });
  it('met en cour un terrain presque nu : le minéral est le défaut, pas l’herbe', () => {
    expect(tissu([])).toBe('cour');
    expect(tissu([maison])).toBe('cour');
  });
});

describe('végétation relevée sur la photo aérienne', () => {
  /** relevé de l × h cases de 4 m, à partir d'une fonction (i, j) → part de végétation */
  const releve = (l: number, h: number, f: (i: number, j: number) => number, arbres: [number, number, number][] = []) => {
    const o = new Uint8Array(l * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < l; i++) o[j * l + i] = Math.round(f(i, j) * 255);
    return { x0: -100, z0: 50, case: 4, l, h, part: Buffer.from(o).toString('base64'), arbres };
  };

  it('lit le relevé et refuse un fichier abîmé', () => {
    const v = lireVegetation(releve(10, 5, (i) => (i < 5 ? 1 : 0), [[1, 2, 3]]))!;
    expect(v.cote).toBe(4);
    expect(v.part(0, 0)).toBe(1);
    expect(v.part(9, 4)).toBe(0);
    expect(v.part(-1, 0)).toBe(0);
    expect(v.part(10, 0)).toBe(0);
    expect(v.arbres).toEqual([[1, 2, 3]]);
    expect(lireVegetation(null)).toBeNull();
    expect(lireVegetation({ ...releve(10, 5, () => 0), l: 11 })).toBeNull();
    expect(lireVegetation({ ...releve(10, 5, () => 0), part: 7 })).toBeNull();
  });

  it('fait un jardin des cases vertes, par suites de cases, dans le repère de la carte', () => {
    // moitié ouest toute verte : la moyenne avec les voisines laisse la colonne de bord hors du jardin
    const v = lireVegetation(releve(10, 6, (i) => (i < 5 ? 1 : 0)))!;
    const cases = casesJardin(v);
    // lignes intérieures : colonnes 0 à 4 (la colonne 4 a pour moyenne 6/9 ; la 5, 3/9, au-dessus du seuil aussi)
    expect(SEUIL_JARDIN).toBeLessThan(3 / 9);
    const milieu = cases.find((c) => c[1] === 50 + 2 * 4)!;
    expect(milieu).toEqual([-100, 58, -100 + 6 * 4, 62]);
    // rien à l'est
    expect(cases.every((c) => c[2] <= -100 + 6 * 4)).toBe(true);
    // un rectangle par ligne, pas un par case
    expect(cases).toHaveLength(6);
  });

  it('une allée ne troue pas un jardin, un arbre isolé dans une cour n’en fait pas un', () => {
    const allee = lireVegetation(releve(9, 9, (i) => (i === 4 ? 0 : 1)))!;
    expect(casesJardin(allee).filter((c) => c[1] === 50 + 4 * 4)).toEqual([[-100, 66, -100 + 9 * 4, 70]]);
    const arbre = lireVegetation(releve(9, 9, (i, j) => (i === 4 && j === 4 ? 1 : 0)))!;
    expect(casesJardin(arbre)).toEqual([]);
  });

  it('donne à l’arbre la hauteur que demande son houppier, bornée', () => {
    expect(hauteurArbre(1.8)).toBe(5);
    expect(hauteurArbre(3.4)).toBe(10);
    expect(hauteurArbre(6.5)).toBe(19);
    expect(hauteurArbre(20)).toBe(19);
    // le houppier dessiné a bien le rayon relevé, à la variation d'un arbre à l'autre près
    const f = formeArbre(hauteurArbre(4), 0.5, 1, 1);
    expect(f.rayon).toBeGreaterThan(3.4);
    expect(f.rayon).toBeLessThan(4.6);
    expect(f.tronc).toBeGreaterThan(1);
  });

  it('choisit les arbres d’une dalle : quota, grands houppiers et bords de rue d’abord, écart minimal', () => {
    const c = [
      { x: 0, z: 0, r: 3, route: 60 }, { x: 20, z: 0, r: 5, route: 60 }, { x: 40, z: 0, r: 3, route: 5 },
      { x: 42, z: 0, r: 2.9, route: 5 }, { x: 60, z: 0, r: 2, route: 60 },
    ];
    // le petit arbre du bord de rue (poids 6) passe avant le grand du fond (poids 5)
    expect(choisirArbres(c, 2).map((a) => a.x)).toEqual([40, 20]);
    // trop près d'un arbre déjà retenu : écarté même s'il reste de la place
    expect(choisirArbres(c, 10).map((a) => a.x).sort((a, b) => a - b)).toEqual([0, 20, 40, 60]);
    expect(choisirArbres(c, 0)).toEqual([]);
    // reproductible : l'ordre d'entrée ne change pas le choix
    expect(choisirArbres(c.slice().reverse(), 2).map((a) => a.x)).toEqual([40, 20]);
    // un bois qui couvre la dalle : à houppiers égaux, les arbres retenus se répartissent sur toute la dalle
    const bois = [];
    for (let x = 5; x < 100; x += 10) for (let z = 5; z < 100; z += 10) bois.push({ x, z, r: 6.5, route: 80 });
    const choix = choisirArbres(bois, 10);
    expect(choix).toHaveLength(10);
    for (const [x0, z0] of [[0, 0], [50, 0], [0, 50], [50, 50]]) expect(choix.filter((a) => a.x >= x0 && a.x < x0 + 50 && a.z >= z0 && a.z < z0 + 50).length).toBeGreaterThanOrEqual(2);
    let proche = Infinity;
    for (const a of choix) for (const b of choix) if (a !== b) proche = Math.min(proche, Math.hypot(a.x - b.x, a.z - b.z));
    expect(proche).toBeGreaterThanOrEqual(20);
  });
});

describe('clôtures des jardins sur rue', () => {
  const droite: Point[] = [[0, 0], [30, 0], [60, 0], [100, 0]];
  const longueur = (p: Point[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

  it('découpe la limite en parcelles séparées par un portail', () => {
    const m = decouperCloture(droite, 12345);
    expect(m.length).toBeGreaterThanOrEqual(5);
    expect(m.length).toBeLessThanOrEqual(12);
    for (let i = 0; i < m.length; i++) {
      const a = m[i].pts[0][0], b = m[i].pts[m[i].pts.length - 1][0];
      expect(b - a).toBeGreaterThanOrEqual(2);
      expect(b - a).toBeLessThanOrEqual(17);
      // sur la ligne, dans l'ordre
      for (const p of m[i].pts) expect(p[1]).toBe(0);
      expect(longueur(m[i].pts)).toBeCloseTo(b - a, 6);
      // portail entre deux parcelles
      if (i > 0) expect(a - m[i - 1].pts[m[i - 1].pts.length - 1][0]).toBeCloseTo(PORTAIL, 6);
      // une clôture, c'est un muret, une haie ou les deux
      expect(m[i].muret > 0 || m[i].haie > 0).toBe(true);
      expect(m[i].ton).toBeGreaterThanOrEqual(0);
      expect(m[i].ton).toBeLessThan(NB_TONS);
    }
    expect(m[0].pts[0]).toEqual([0, 0]);
    expect(NB_TONS).toBe(TONS_MURET.length);
  });

  it('est reproductible, et varie d’une rue à l’autre', () => {
    expect(decouperCloture(droite, 7)).toEqual(decouperCloture(droite, 7));
    expect(decouperCloture(droite, 7)).not.toEqual(decouperCloture(droite, 8));
    const genres = new Set(decouperCloture([[0, 0], [2000, 0]], 3).map((m) => `${m.muret}|${m.haie}`));
    expect(genres.size).toBeGreaterThanOrEqual(4);
  });

  it('garde les sommets d’une limite courbe et laisse ouvert un bout trop court', () => {
    const coude: Point[] = [[0, 0], [6, 0], [6, 6]];
    const m = decouperCloture(coude, 1);
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m[0].pts).toContainEqual([6, 0]);
    expect(decouperCloture([[0, 0], [1.5, 0]], 1)).toEqual([]);
  });
});

describe('arbres et mobilier hors de la chaussée', () => {
  // chaussée : la bande z < 0 ; le bord est la droite z = 0
  const bord = (x: number) => ({ x, z: 0 });
  it('laisse en place un arbre assez loin du bord', () => {
    expect(ecarterArbre(5, 1.5, bord(5), false)).toEqual([5, 1.5]);
  });
  it('repousse à 0,8 m un arbre qui frôle la bordure', () => {
    const p = ecarterArbre(5, 0.2, bord(5), false)!;
    expect(p[0]).toBeCloseTo(5); expect(p[1]).toBeCloseTo(0.8);
  });
  it('reporte sur le trottoir un arbre saisi juste dans la chaussée', () => {
    const p = ecarterArbre(5, -0.6, bord(5), true)!;
    expect(p[1]).toBeCloseTo(0.8);
  });
  it('retire un arbre saisi au milieu de la chaussée', () => {
    expect(ecarterArbre(5, -3, bord(5), true)).toBeNull();
    expect(ecarterArbre(5, -3, null, true)).toBeNull();
  });
  const chaussee = (_x: number, z: number) => z < 0;
  it('ne déplace pas le mobilier déjà sur le trottoir', () => {
    expect(versTrottoir(3, 1, chaussee)).toEqual([3, 1]);
  });
  it('reporte sur le trottoir un arceau saisi sur la bande de stationnement', () => {
    const p = versTrottoir(3, -1.2, chaussee)!;
    expect(chaussee(p[0], p[1])).toBe(false);
    expect(p[1]).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(Math.hypot(p[0] - 3, p[1] + 1.2)).toBeLessThanOrEqual(2.5 + 1e-9);
  });
  it('écarte le mobilier saisi au milieu de la chaussée', () => {
    expect(versTrottoir(3, -4, chaussee)).toBeNull();
  });
});

describe('rubans, massifs, mobilier (géométrie)', () => {
  it('borde une allée droite à demi-largeur de chaque côté', () => {
    expect(ruban([0, 0, 10, 0], 2).map((v) => Math.round(v * 100) / 100)).toEqual([0, -1, 0, 1, 10, -1, 10, 1]);
  });
  it('raccorde un angle droit en onglet sans changer la largeur', () => {
    const b = ruban([0, 0, 10, 0, 10, 10], 2);
    // au coude, les deux bords sont à √2 de l'axe, sur la bissectrice
    expect(Math.hypot(b[4] - 10, b[5] - 0)).toBeCloseTo(Math.SQRT2, 6);
    expect(Math.hypot(b[6] - 10, b[7] - 0)).toBeCloseTo(Math.SQRT2, 6);
  });
  it('borne l’onglet d’un rebroussement', () => {
    const b = ruban([0, 0, 10, 0, 0, 0.5], 2);
    for (let i = 0; i < b.length; i += 2) expect(Math.hypot(b[i] - 10, b[i + 1])).toBeLessThan(11.5);
  });
  const versLeHaut = (g: GeoBuilder) => {
    for (let i = 0; i < g.idx.length; i += 3) {
      const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
      const ux = g.pos[b * 3] - g.pos[a * 3], uz = g.pos[b * 3 + 2] - g.pos[a * 3 + 2], vx = g.pos[c * 3] - g.pos[a * 3], vz = g.pos[c * 3 + 2] - g.pos[a * 3 + 2];
      if (uz * vx - ux * vz < 0) return false;
    }
    return true;
  };
  it('pose allées et marches face vers le haut, dans les deux sens de parcours', () => {
    for (const p of [[0, 0, 10, 0, 14, 6], [14, 6, 10, 0, 0, 0]]) {
      const g = new GeoBuilder(true);
      poserAllee(g, p, 2, 0.1, 1, [1, 1, 1]);
      expect(g.idx.length).toBe(12);
      expect(versLeHaut(g)).toBe(true);
      const m = new GeoBuilder(true);
      poserMarches(m, p, 2, 0.1, 1);
      expect(m.idx.length).toBeGreaterThan(12 * 6);
      expect(versLeHaut(m)).toBe(true);
    }
  });
  it('sème des arbustes dans le massif, jamais dehors ni dans un trou, toujours les mêmes', () => {
    const carre = [0, 0, 1000, 0, 1000, 1000, 0, 1000], trou = [400, 400, 600, 400, 600, 600, 400, 600];
    const g = new GeoBuilder(true);
    const n = poserArbustes(g, carre, [trou], 0.5, 200, 300, 0.01);
    // 100 m² − 4 m² de trou : un arbuste pour 3,5 m², au plus (le semis écarte ceux qui dépassent)
    expect(n).toBeGreaterThan(12);
    expect(n).toBeLessThanOrEqual(29);
    expect(g.idx.length).toBe(n * 5 * 6);
    for (let i = 0; i < g.pos.length; i += 3) {
      const x = g.pos[i] - 200, y = g.pos[i + 1], z = g.pos[i + 2] - 300;
      expect(x).toBeGreaterThan(-0.3); expect(x).toBeLessThan(10.3);
      expect(z).toBeGreaterThan(-0.3); expect(z).toBeLessThan(10.3);
      expect(y).toBeGreaterThanOrEqual(0.5 - 1e-6); expect(y).toBeLessThanOrEqual(0.5 + 0.6 + 1e-6);
    }
    const g2 = new GeoBuilder(true);
    poserArbustes(g2, carre, [trou], 0.5, 200, 300, 0.01);
    expect(g2.pos).toEqual(g.pos);
    // trop petit pour un arbuste
    expect(poserArbustes(new GeoBuilder(true), [0, 0, 100, 0, 100, 100, 0, 100], [], 0.5, 0, 0, 0.01)).toBe(0);
  });

  it('dresse un tronc à pans, face vers l’extérieur, du sol au houppier', () => {
    const g = new GeoBuilder(true, 1, 'photo');
    poserTronc(g, 10, 20, 0.14, 3, 0.2);
    expect(g.idx.length).toBe(PANS_TRONC * 6);
    const ys = new Set(g.pos.filter((_, i) => i % 3 === 1).map((y) => +y.toFixed(2)));
    expect([...ys].sort()).toEqual([0.14, 3.14]);
    // chaque triangle regarde dehors : sa normale géométrique s'éloigne de l'axe du tronc
    for (let i = 0; i < g.idx.length; i += 3) {
      const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]].map((k) => [g.pos[k * 3], g.pos[k * 3 + 1], g.pos[k * 3 + 2]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = u[1] * v[2] - u[2] * v[1], nz = u[0] * v[1] - u[1] * v[0];
      const mx = (a[0] + b[0] + c[0]) / 3 - 10, mz = (a[2] + b[2] + c[2]) / 3 - 20;
      expect(nx * mx + nz * mz).toBeGreaterThan(0);
    }
    // pas de photo sur l'écorce : poids nul
    expect(g.extra.every((e) => e === 0)).toBe(true);
  });

  it('affiche un bloc d’arbres dès qu’une de ses dalles peut être en vue, pas avant', () => {
    expect(BLOC_ARBRES).toBe(2);
    // une dalle se voit quand son centre est à moins de rayon + 100 m ; le centre de dalle le plus proche est à 50 m du centre du bloc
    expect(blocEnVue(0, 0, 300, 100)).toBe(true);
    expect(blocEnVue(449, 0, 300, 100)).toBe(true);
    expect(blocEnVue(451, 0, 300, 100)).toBe(false);
    expect(blocEnVue(0, -449, 300, 100)).toBe(true);
    expect(blocEnVue(340, 340, 300, 100)).toBe(false);
    expect(blocEnVue(330, 330, 300, 100)).toBe(true);
  });

  it('extrude un massif plein : un dessus, un flanc par arête, aucun sur le bord de la dalle', () => {
    const g = new GeoBuilder(true), gf = new GeoBuilder(true);
    // carré de 4 m dont un côté est sur le bord gauche de la dalle (x = 0)
    const flancs = poserMassif(g, gf, [0, 100, 400, 100, 400, 500, 0, 500], [], 0.14, 0.7, 0, 0, 0.01, 10000);
    expect(flancs).toBe(3);
    // trois flancs à deux faces, puis les arbustes : cinq faces par touffe
    const touffes = (gf.idx.length - 3 * 2 * 6) / (5 * 6);
    expect(Number.isInteger(touffes)).toBe(true);
    expect(touffes).toBeGreaterThanOrEqual(2);
    const ys = new Set(g.pos.filter((_, i) => i % 3 === 1).map((y) => Math.round(y * 100)));
    expect([...ys]).toEqual([84]);
    // flancs du sol au dessus du massif, arbustes posés dessus et pas plus hauts que 0,6 m
    const yf = gf.pos.filter((_, i) => i % 3 === 1);
    expect(Math.min(...yf)).toBeCloseTo(0.14, 5);
    expect(Math.max(...yf)).toBeGreaterThan(0.84 + 0.2);
    expect(Math.max(...yf)).toBeLessThanOrEqual(0.84 + 0.6 + 1e-6);
    // le dessus couvre tout le carré : ce n'est pas un enclos creux
    let aire = 0;
    for (let i = 0; i < g.idx.length; i += 3) {
      const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
      if (g.nor[a * 3 + 1] !== 1) continue;
      aire += Math.abs((g.pos[b * 3] - g.pos[a * 3]) * (g.pos[c * 3 + 2] - g.pos[a * 3 + 2]) - (g.pos[c * 3] - g.pos[a * 3]) * (g.pos[b * 3 + 2] - g.pos[a * 3 + 2])) / 2;
    }
    expect(aire).toBeCloseTo(16, 6);
  });
  it('oriente un banc parallèlement à la rue, face à la chaussée', () => {
    // rue d'axe z = 0 parcourue vers +x ; banc sur le trottoir côté z > 0
    const o = orienter(5, 6, { x: 5, z: 0, tx: 1, tz: 0 });
    expect([o.tx, o.tz]).toEqual([1, 0]);
    expect(o.fz).toBeLessThan(0);
    const o2 = orienter(5, -6, { x: 5, z: 0, tx: 1, tz: 0 });
    expect(o2.fz).toBeGreaterThan(0);
  });
  it('suit la direction relevée quand la carte la donne (90 = est)', () => {
    const o = orienter(0, 0, { x: 0, z: 5, tx: 1, tz: 0 }, 90);
    expect(o.fx).toBeCloseTo(1); expect(o.fz).toBeCloseTo(0);
    expect(Math.abs(o.tx * o.fx + o.tz * o.fz)).toBeLessThan(1e-9);
  });
  it('dessine chaque type de mobilier en peu de triangles, avec des obstacles à l’endroit dessiné', () => {
    for (const k of MOBILIER) {
      const g = new GeoBuilder(true);
      const o = orienter(100, 50, { x: 100, z: 45, tx: 0.6, tz: 0.8 });
      const obstacles = poserMobilier(g, k, 100, 50, 0.14, o, 12);
      const tri = g.idx.length / 3;
      expect(tri, k).toBeGreaterThan(0);
      expect(tri, k).toBeLessThanOrEqual(200);
      expect(g.col.length, k).toBe(g.pos.length);
      expect(obstacles.length, k).toBeGreaterThan(0);
      // tout tient dans 5 m autour du point, au-dessus du trottoir
      for (let i = 0; i < g.pos.length; i += 3) {
        expect(Math.hypot(g.pos[i] - 100, g.pos[i + 2] - 50), k).toBeLessThan(5);
        expect(g.pos[i + 1], k).toBeGreaterThanOrEqual(0.14 - 1e-9);
      }
      for (const c of obstacles) expect(Math.hypot(c.x - 100, c.z - 50), k).toBeLessThan(5);
    }
    expect(estMobilier('bench')).toBe(true);
    expect(estMobilier('shop')).toBe(false);
    expect(rangee('bikepark', 24)).toBe(6);
    expect(rangee('bikepark', 2)).toBe(1);
  });
  it('donne aux arbres la silhouette de leur genre', () => {
    expect(silhouette('populus').elance).toBeGreaterThan(1.5);
    expect(silhouette('populus').large).toBeLessThan(0.7);
    expect(silhouette('platanus').large).toBeGreaterThan(1);
    expect(silhouette('pinus').teinte[2]).toBeLessThan(silhouette('tilia').teinte[2]);
    expect(silhouette('prunus').haut[1]).toBeLessThan(silhouette('platanus').haut[0]);
    expect(silhouette('')).toEqual(silhouette('genre-inconnu'));
  });
});

// ───────────────────────── carte livrée ─────────────────────────
const CM = 0.01;
const dansAnneauPlat = (r: number[], x: number, z: number) => {
  let c = false;
  for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const dansPoly = (p: RawPoly, x: number, z: number) => dansAnneauPlat(p.o, x, z) && !p.h.some((h) => dansAnneauPlat(h, x, z));
const airePoly = (p: RawPoly) => {
  const a = (r: number[]) => { let s = 0; for (let i = 0, n = r.length / 2; i < n; i++) { const j = (i + 1) % n; s += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; } return Math.abs(s) / 2; };
  return (a(p.o) - p.h.reduce((t, h) => t + a(h), 0)) * CM * CM;
};
/** Nature du sol hors chaussée en un point : liste des couches qui le couvrent. */
function couches(x: number, z: number): string[] {
  const C = map.chunk, ci = Math.floor(x / C), cj = Math.floor(z / C);
  const ck = map.chunks[`${ci},${cj}`];
  if (!ck) return [];
  const lx = (x - ci * C) / CM, lz = (z - cj * C) / CM;
  const out: string[] = [];
  if (ck.r.some((p) => dansPoly(p, lx, lz))) out.push('chaussée');
  if (ck.w.some((p) => dansPoly(p, lx, lz))) out.push('trottoir');
  if (ck.g?.some((p) => dansPoly(p, lx, lz))) out.push('jardin');
  if (ck.c?.some((p) => dansPoly(p, lx, lz))) out.push('cour');
  for (const a of ck.a ?? []) if (dansPoly(a, lx, lz)) out.push('espace:' + a.k + (a.s ? '/' + a.s : ''));
  return out;
}

describe('carte : sol hors chaussée', () => {
  const ground = new Ground(map);

  it('ne laisse aucun recouvrement entre espaces, jardins et cours d’une dalle, ni de trou dans le pavage', () => {
    // sondage sur une grille de 7 m décalée (hors des bords de dalle) : chaque point hors chaussée et
    // hors trottoir est couvert par une couche et une seule
    let n = 0, doubles = 0, vides = 0;
    const { x0, x1, z0, z1 } = map.rect;
    for (let x = x0 + 3.37; x < x1; x += 7) for (let z = z0 + 2.91; z < z1; z += 7) {
      const l = couches(x, z);
      if (!l.length || l.includes('chaussée')) continue;
      const hors = l.filter((k) => k !== 'trottoir');
      n++;
      if (hors.length > 1) doubles++;
      if (!hors.length && !l.includes('trottoir')) vides++;
    }
    expect(n).toBeGreaterThan(100000);
    expect(doubles).toBe(0);
    expect(vides).toBe(0);
  });

  it('couvre la place Jacques Duclos (Croix de Chavaux) de pavés et la place du Marché de minéral, plus d’herbe', () => {
    // centre de la place Jacques Duclos et de la place du Marché, relevés sur OpenStreetMap
    let pave = 0, herbe = 0, n = 0;
    for (let x = 560; x <= 720; x += 4) for (let z = -80; z <= 80; z += 4) {
      const l = couches(x, z);
      if (!l.length || l.includes('chaussée')) continue;
      n++;
      if (l.some((k) => k.startsWith('espace:plaza'))) pave++;
      if (l.includes('jardin') || l.some((k) => /^espace:(park|grass|wood)/.test(k))) herbe++;
    }
    // la place Jacques Duclos fait 3 236 m², dont une partie est chaussée dans le jeu
    expect(pave * 16).toBeGreaterThan(1000);
    expect(herbe / n).toBeLessThan(0.05);
  });

  it('ne dresse plus de haie en mur autour des massifs : contour gardé pour les collisions, surface pleine dessinée', () => {
    const massifs = map.barriers.filter((b) => b.k === 'massif');
    // les neuf haies surfaciques de la Croix de Chavaux, plus les plates-bandes et carrés d'arbustes
    expect(massifs.length).toBeGreaterThanOrEqual(9);
    expect(massifs.filter((b) => Math.hypot(b.p[0] - 640, b.p[1]) < 150).length).toBe(9);
    for (const b of massifs) {
      // contour fermé
      expect(Math.hypot(b.p[0] - b.p[b.p.length - 2], b.p[1] - b.p[b.p.length - 1])).toBeLessThan(0.01);
      // de part et d'autre de chaque arête du contour, l'un des deux côtés est le massif dessiné
      // (ou la chaussée, qui l'a rogné) : ce qu'on heurte est ce qu'on voit
      let vus = 0, aretes = 0;
      for (let i = 0; i + 3 < b.p.length; i += 2) {
        const dx = b.p[i + 2] - b.p[i], dz = b.p[i + 3] - b.p[i + 1], l = Math.hypot(dx, dz);
        if (l < 1) continue;
        aretes++;
        const mx = (b.p[i] + b.p[i + 2]) / 2, mz = (b.p[i + 1] + b.p[i + 3]) / 2;
        const cotes = [1, -1].map((s) => couches(mx - (dz / l) * 0.3 * s, mz + (dx / l) * 0.3 * s));
        if (cotes.some((c) => c.includes('chaussée') || c.some((q) => q.startsWith('espace:massif')))) vus++;
        expect(ground.bodyHits(mx, mz, 1, 0)).toBe(true);
      }
      expect(vus / aretes, `massif en ${b.p[0]}, ${b.p[1]}`).toBeGreaterThan(0.9);
    }
    // aucun contour de massif ou de haie ne dresse d'obstacle invisible sur la chaussée
    for (const b of map.barriers.filter((q) => q.k === 'massif' || q.k === 'hedge')) {
      for (let i = 0; i + 3 < b.p.length; i += 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(b.p[i + 2] - b.p[i], b.p[i + 3] - b.p[i + 1]) / 0.5));
        for (let k = 0; k <= n; k++) expect(ground.isRoad(b.p[i] + ((b.p[i + 2] - b.p[i]) * k) / n, b.p[i + 1] + ((b.p[i + 3] - b.p[i + 1]) * k) / n)).toBe(false);
      }
    }
    // les haies qui restent sont des lignes ouvertes
    for (const b of map.barriers.filter((q) => q.k === 'hedge')) expect(b.p.length).toBeGreaterThanOrEqual(4);
  });

  it('garde les trous des multipolygones (place Jean Jaurès : les massifs se voient)', () => {
    const avecTrous = Object.values(map.chunks).flatMap((c) => c.a ?? []).filter((a) => a.k === 'plaza' && a.h.length > 0);
    expect(avecTrous.length).toBeGreaterThan(0);
    // devant la mairie : de la place, des massifs ou de l'herbe, et pas de massif caché sous la place
    let place = 0, vert = 0;
    for (let x = 1100; x <= 1220; x += 3) for (let z = -530; z <= -410; z += 3) {
      const l = couches(x, z).filter((k) => k.startsWith('espace:'));
      expect(l.length).toBeLessThanOrEqual(1);
      if (l[0]?.startsWith('espace:plaza')) place++;
      if (l[0] && /^espace:(massif|grass|park)/.test(l[0])) vert++;
    }
    expect(place).toBeGreaterThan(300);
    expect(vert).toBeGreaterThan(20);
  });

  it('plante les arbres de la photo aérienne sans dépasser le quota par dalle, à l’écart de la chaussée et des arbres cartographiés', () => {
    const photo = map.trees.filter((t) => t[5] === 1), osm = map.trees.filter((t) => !t[5]);
    expect(photo.length).toBeGreaterThan(3000);
    expect(osm.length).toBe(2824);
    const parDalle = new Map<string, number>();
    for (const [x, z, h] of photo) {
      const k = `${Math.floor(x / map.chunk)},${Math.floor(z / map.chunk)}`;
      parDalle.set(k, (parDalle.get(k) ?? 0) + 1);
      expect(h).toBeGreaterThanOrEqual(5);
      expect(h).toBeLessThanOrEqual(19);
      // tronc à 1,5 m au moins de la bordure (sondé à 1,4 m)
      for (let a = 0; a < 8; a++) expect(ground.isRoad(x + Math.cos((a * Math.PI) / 4) * 1.4, z + Math.sin((a * Math.PI) / 4) * 1.4), `arbre de la photo en ${x}, ${z}`).toBe(false);
    }
    expect(Math.max(...parDalle.values())).toBeLessThanOrEqual(10);
    // pas de doublon avec un arbre d'OpenStreetMap
    const cases = new Map<string, number[][]>();
    for (const t of osm) { const k = `${Math.floor(t[0] / 10)},${Math.floor(t[1] / 10)}`; cases.set(k, [...(cases.get(k) ?? []), [t[0], t[1]]]); }
    let doublons = 0;
    for (const [x, z] of photo) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of cases.get(`${Math.floor(x / 10) + i},${Math.floor(z / 10) + j}`) ?? []) if (Math.hypot(q[0] - x, q[1] - z) < 4) doublons++;
    expect(doublons).toBe(0);
    // la Croix de Chavaux n'est plus une esplanade nue : la carte n'y comptait que 2 arbres à 110 m à la ronde
    expect(map.trees.filter(([x, z]) => Math.hypot(x - 700, z - 10) < 110).length).toBeGreaterThan(15);
  });

  it('ferme les jardins sur rue par des clôtures déduites : hors chaussée, hors bâtiments, à 3 m de la bordure', () => {
    const clotures = map.barriers.filter((b) => b.d === 1);
    expect(clotures.length).toBeGreaterThan(800);
    const dansBati = (x: number, z: number) => map.buildings.some((b) => Math.abs(b.p[0] - x) < 150 && Math.abs(b.p[1] - z) < 150 && dansAnneauPlat(b.p, x, z));
    let loin = 0, n = 0;
    for (const b of clotures) {
      expect(b.p.length).toBeGreaterThanOrEqual(4);
      expect(b.h).toBeGreaterThan(0.3);
      expect(b.h).toBeLessThanOrEqual(1.6);
      for (let i = 0; i + 3 < b.p.length; i += 2) {
        const mx = (b.p[i] + b.p[i + 2]) / 2, mz = (b.p[i + 1] + b.p[i + 3]) / 2;
        expect(ground.isRoad(mx, mz)).toBe(false);
        n++;
        // jamais à moins de 2,4 m de la chaussée : les piétons marchent entre la bordure et la clôture
        for (let a = 0; a < 8; a++) if (ground.isRoad(mx + Math.cos((a * Math.PI) / 4) * 2.4, mz + Math.sin((a * Math.PI) / 4) * 2.4)) { loin++; break; }
      }
    }
    expect(loin / n).toBeLessThan(0.01);
    // sondage : un muret sur dix, aucun point dans un bâtiment
    const murets = clotures.filter((b) => b.k === 'muret');
    for (let k = 0; k < murets.length; k += 10) expect(dansBati(murets[k].p[0], murets[k].p[1])).toBe(false);
    // un muret arrête une voiture
    const m = murets[0];
    expect(ground.bodyHits((m.p[0] + m.p[2]) / 2, (m.p[1] + m.p[3]) / 2, 1, 0)).toBe(true);
  });

  it('met un jardin de devant entre la clôture et la maison, sans toucher au trottoir de la carte', () => {
    const devants = Object.values(map.chunks).flatMap((c) => c.a ?? []).filter((a) => a.k === 'devant');
    expect(devants.length).toBeGreaterThan(300);
    expect(habillage('devant').lot).toBe('vegetal');
    // un jardin de devant recouvre du trottoir (il est posé dessus), jamais la chaussée ni un autre espace
    let sur = 0, n = 0;
    const { x0, x1, z0, z1 } = map.rect;
    for (let x = x0 + 1.13; x < x1; x += 3) for (let z = z0 + 0.77; z < z1; z += 3) {
      const l = couches(x, z);
      if (!l.includes('espace:devant')) continue;
      n++;
      expect(l).not.toContain('chaussée');
      expect(l.filter((k) => k.startsWith('espace:'))).toHaveLength(1);
      if (l.includes('trottoir')) sur++;
    }
    expect(n).toBeGreaterThan(3000);
    expect(sur / n).toBeGreaterThan(0.95);
  });

  it('met les quartiers denses en cour et les quartiers de pavillons en jardin', () => {
    const part = (cx: number, cz: number) => {
      let j = 0, c = 0;
      for (let x = cx - 150; x <= cx + 150; x += 5) for (let z = cz - 150; z <= cz + 150; z += 5) {
        const l = couches(x, z);
        if (l.includes('jardin')) j++; else if (l.includes('cour')) c++;
      }
      return j / Math.max(1, j + c);
    };
    // la part de jardin vient de la végétation relevée sur la photo aérienne
    const chavaux = part(640, 0), mairie = part(1159, -471), pavillons = part(450, -450);
    expect(chavaux).toBeLessThan(0.2); // Croix de Chavaux
    expect(mairie).toBeLessThan(0.25); // mairie
    expect(pavillons).toBeGreaterThan(0.45); // pavillons en lisière des Guilands
    expect(pavillons).toBeGreaterThan(2 * Math.max(chavaux, mairie));
  });

  it('ne plante aucun arbre sur la chaussée, ni à moins de 0,7 m de son bord, ni dans un bâtiment', () => {
    expect(map.trees.length).toBeGreaterThan(2500);
    let pres = 0;
    for (const [x, z] of map.trees) {
      expect(ground.isRoad(x, z), `arbre sur la chaussée en ${x}, ${z}`).toBe(false);
      for (let k = 0; k < 8; k++) if (ground.isRoad(x + Math.cos((k * Math.PI) / 4) * 0.65, z + Math.sin((k * Math.PI) / 4) * 0.65)) { pres++; break; }
    }
    expect(pres).toBe(0);
    const dansBati = (x: number, z: number) => map.buildings.some((b) => Math.abs(b.p[0] - x) < 150 && Math.abs(b.p[1] - z) < 150 && dansAnneauPlat(b.p, x, z));
    expect(map.trees.filter(([x, z]) => dansBati(x, z)).length).toBe(0);
  });

  it('ne pose aucun mobilier sur la chaussée ni dans un bâtiment, et ses obstacles restent hors des voies', () => {
    const mobilier = map.pois.filter((p) => estMobilier(p.k) || p.k === 'bollard');
    expect(mobilier.length).toBeGreaterThan(800);
    const dansBati = (x: number, z: number) => map.buildings.some((b) => Math.abs(b.p[0] - x) < 150 && Math.abs(b.p[1] - z) < 150 && dansAnneauPlat(b.p, x, z));
    for (const p of mobilier) {
      expect(ground.isRoad(p.x, p.z), `${p.k} sur la chaussée en ${p.x}, ${p.z}`).toBe(false);
      expect(dansBati(p.x, p.z), `${p.k} dans un bâtiment en ${p.x}, ${p.z}`).toBe(false);
    }
  });

  it('ne garde que des allées hors chaussée, de largeur plausible', () => {
    const allees = map.lines.filter((l) => l.k === 'allee' || l.k === 'marches');
    expect(allees.length).toBeGreaterThan(200);
    let surChaussee = 0, n = 0;
    for (const l of allees) {
      expect(l.w).toBeGreaterThanOrEqual(8);
      expect(l.w).toBeLessThanOrEqual(60);
      for (let i = 0; i + 3 < l.p.length; i += 2) { n++; if (ground.isRoad((l.p[i] + l.p[i + 2]) / 2, (l.p[i + 1] + l.p[i + 3]) / 2)) surChaussee++; }
    }
    expect(surChaussee / n).toBeLessThan(0.002);
  });

  it('triangule tous les polygones du sol sans perte de surface', () => {
    let pire = 0;
    for (const ck of Object.values(map.chunks)) {
      for (const p of [...(ck.g ?? []), ...(ck.c ?? []), ...(ck.a ?? [])]) {
        const flat = [...p.o]; const trous: number[] = [];
        for (const h of p.h) { trous.push(flat.length / 2); flat.push(...h); }
        const t = earcut(flat, trous.length ? trous : undefined, 2);
        let a = 0;
        for (let i = 0; i < t.length; i += 3) a += Math.abs((flat[t[i + 1] * 2] - flat[t[i] * 2]) * (flat[t[i + 2] * 2 + 1] - flat[t[i] * 2 + 1]) - (flat[t[i + 2] * 2] - flat[t[i] * 2]) * (flat[t[i + 1] * 2 + 1] - flat[t[i] * 2 + 1])) / 2;
        const attendu = airePoly(p);
        pire = Math.max(pire, Math.abs(a * CM * CM - attendu) / Math.max(1, attendu));
      }
    }
    expect(pire).toBeLessThan(0.01);
  });
});
