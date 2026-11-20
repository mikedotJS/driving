// Apparence des bâtiments déduite des données IGN : style, étages, toits.
import { describe, expect, it } from 'vitest';
import { apparence, etages, toitEnPente } from '../src/world/gabarit';
import type { RawBuilding } from '../src/map/roadnet';

const bat = (o: Partial<RawBuilding>): RawBuilding => ({ p: [0, 0, 10, 0, 10, 8, 0, 8], h: 6, l: 2, t: 'house', ...o });

describe('style des façades', () => {
  it('suit le matériau des murs', () => {
    expect(apparence(bat({ m: 2 }), 80, 0.5).style).toBe('meuliere');
    expect(apparence(bat({ m: 4, l: 6, h: 19, t: 'res', y: 1930 }), 400, 0.5).style).toBe('brique');
    expect(apparence(bat({ m: 3, l: 12, h: 36, t: 'res', y: 1970 }), 900, 0.5).style).toBe('moderne');
    expect(apparence(bat({ m: 3, l: 5, h: 16, t: 'res', y: 2010 }), 500, 0.5).style).toBe('contemporain');
  });
  it('habille de verre les tours de bureaux et de tôle les ateliers', () => {
    expect(apparence(bat({ t: 'com', l: 23, h: 69, u: 'c' }), 1500, 0.5).style).toBe('verre');
    expect(apparence(bat({ t: 'res', l: 19, h: 57, u: 'c', y: 1970 }), 1500, 0.5).style).toBe('verre');
    expect(apparence(bat({ t: 'indus', l: 1, h: 7 }), 900, 0.5).style).toBe('industriel');
    expect(apparence(bat({ t: 'res', l: 1, h: 7, u: 'i', m: 4 }), 900, 0.5).style).toBe('public');
  });
  it('reprend le matériau du voisin quand le bâtiment n\'en a pas', () => {
    expect(apparence(bat({}), 80, 0.9, { m: 2, r: 1 }).style).toBe('meuliere');
    // la donnée propre au bâtiment passe avant celle du voisin
    expect(apparence(bat({ m: 4 }), 80, 0.9, { m: 2 }).style).toBe('brique');
  });
  it('choisit la couverture : tuiles en pente, terrasse sur les barres', () => {
    const maison = apparence(bat({ m: 2, r: 1 }), 80, 0.5);
    expect(maison.pente).toBeGreaterThan(0.5);
    const barre = apparence(bat({ m: 3, l: 10, h: 30, t: 'res', y: 1970, r: 1 }), 900, 0.5);
    expect(barre.pente).toBe(0);
    expect(apparence(bat({ m: 1, r: 3, l: 4, h: 12, t: 'res' }), 200, 0.5).pente).toBeLessThan(0.5);
  });
  it('réserve la meulière apparente aux maisons : au-delà de trois niveaux, façade enduite', () => {
    expect(apparence(bat({ m: 2, l: 3, h: 9 }), 80, 0.5).style).toBe('meuliere');
    expect(apparence(bat({ m: 2, l: 5, h: 15, t: 'res' }), 300, 0.5).style).toBe('faubourg');
    expect(apparence(bat({ l: 5, h: 15, t: 'res' }), 300, 0.9, { m: 2 }).style).toBe('faubourg');
  });
  it('donne aux églises des baies, un comble sur toute l\'emprise et un clocher', () => {
    const eglise = apparence(bat({ t: 'church', h: 16, l: 5, n: 'Église Saint-Pierre-Saint-Paul' }), 900, 0.5);
    expect(eglise.style).toBe('culte');
    expect(eglise.aveugle).toBe(false);
    expect(eglise.monument).toBe(true);
    expect(eglise.pente).toBeGreaterThan(0.5);
    expect(eglise.tour).toBe('clocher');
    // un lieu de culte n'est pas forcément une église : pas de clocher sur une synagogue
    expect(apparence(bat({ t: 'church', h: 13, l: 4, n: 'Synagogue' }), 240, 0.5).tour).toBeUndefined();
  });
  it('habille de pierre claire les édifices publics sans matériau connu, de brique ceux qui en ont', () => {
    const mairie = apparence(bat({ t: 'pub', h: 19.7, l: 6, n: 'Hôtel de Ville', u: 'c' }), 1780, 0.5);
    expect(mairie.style).toBe('civique');
    expect(mairie.tour).toBe('beffroi');
    expect(mairie.etage).toBe(4);
    expect(apparence(bat({ t: 'pub', h: 12, l: 3, m: 4 }), 900, 0.5).style).toBe('public');
    expect(apparence(bat({ t: 'pub', h: 12, l: 3 }), 900, 0.5).tour).toBeUndefined();
  });
});

describe('découpe en étages', () => {
  it('garde les niveaux de la carte quand ils tombent juste', () => {
    const e = etages(9.2, 3, 3.5);
    expect(e.n).toBe(2);
    expect(e.h).toBeGreaterThan(2.5);
    expect(e.h).toBeLessThanOrEqual(3.5);
    expect(e.n * e.h + e.bandeau).toBeCloseTo(9.2 - 3.5, 6);
  });
  it('se fie à la hauteur quand les niveaux donneraient des étages invraisemblables', () => {
    // 53 m annoncés sur 6 niveaux : il y a en réalité une quinzaine d'étages
    const e = etages(53.3, 6, 4);
    expect(e.n).toBeGreaterThanOrEqual(15);
    expect(e.h).toBeGreaterThanOrEqual(2.5);
    expect(e.h).toBeLessThanOrEqual(3.5);
    expect(e.n * e.h + e.bandeau).toBeCloseTo(53.3 - 4, 6);
  });
  it('vise des étages de 4 m sur un édifice public et une nef d\'un seul jet, quels que soient les niveaux de la carte', () => {
    // hôtel de ville : 19,7 m annoncés sur 6 niveaux de logement
    const m = etages(19.7, 6, 4.2, 4);
    expect(m.n).toBe(4);
    expect(m.h).toBeGreaterThan(3.5);
    expect(m.n * m.h + m.bandeau).toBeCloseTo(19.7 - 4.2, 6);
    const nef = etages(15.95, 5, 3.5, 8);
    expect(nef.n).toBe(1);
    expect(nef.h).toBeGreaterThan(8);
  });
  it('ne met pas d\'étage sur un bâtiment de plain-pied', () => {
    expect(etages(3.4, 1, 2.9).n).toBe(0);
    expect(etages(4.2, 2, 2.9).n).toBe(0);
  });
});

describe('toits en pente', () => {
  it('pose deux pans et deux pignons sur un rectangle', () => {
    const t = toitEnPente([0, 0, 10, 0, 10, 8, 0, 8], 0.7, 3.2)!;
    expect(t.versants.length).toBe(2);
    expect(t.pignons.length).toBe(2);
    // faîtage dans le sens de la longueur, à mi-largeur, à 0,7 × 4 m au-dessus de l'égout
    expect(Math.abs(t.axe[0])).toBeCloseTo(1, 6);
    const hauts = t.versants.flat().filter((q) => q[1] > 0);
    for (const q of hauts) { expect(q[1]).toBeCloseTo(2.8, 6); expect(q[2]).toBeCloseTo(4, 6); }
  });
  it('pose des croupes sur une emprise convexe quelconque, sans laisser de trou', () => {
    const t = toitEnPente([0, 0, 6, -1, 12, 0, 12, 8, 0, 8], 0.7, 3.2)!;
    expect(t.pignons.length).toBe(0);
    expect(t.versants.length).toBe(5);
    expect(t.versants.filter((f) => f.length === 4).length).toBe(2);
  });
  it('ne laisse pas un coin de toit suspendu au-dessus du vide', () => {
    // maison en L : l'angle rentrant fait 14 % de l'enveloppe, le toit resterait en porte-à-faux
    expect(toitEnPente([0, 0, 10, 0, 10, 4, 5, 4, 5, 8, 0, 8], 0.7, 3.2)).toBeNull();
    // petit décrochement de façade (3 %) : couvert par le débord, et fermé par une sous-face
    const t = toitEnPente([0, 0, 10, 0, 10, 6, 8, 6, 8, 8, 0, 8], 0.7, 3.2)!;
    expect(t.sousFace).not.toBeNull();
    expect(t.sousFace!.length).toBe(5);
    // emprise convexe : rien ne dépasse, rien à fermer
    expect(toitEnPente([0, 0, 10, 0, 10, 8, 0, 8], 0.7, 3.2)!.sousFace).toBeNull();
  });
  it('couvre une église malgré son plan découpé (nef, transept, chevet à pans)', () => {
    // croix latine de 30 m sur 22, chevet à trois pans : 14 sommets d'emprise, 10 d'enveloppe… et plus
    const plan = [0, 6, 12, 6, 12, 0, 20, 0, 20, 6, 26, 6, 29, 8, 30, 11, 29, 14, 26, 16, 20, 16, 20, 22, 12, 22, 12, 16, 0, 16];
    expect(toitEnPente(plan, 0.85, 7, 32)).toBeNull();
    const t = toitEnPente(plan, 0.85, 7, 32, true)!;
    expect(t.faite).toBeCloseTo(7, 6);
    expect(t.sousFace).not.toBeNull();
  });
  it('renonce sur une emprise en L marqué, trop large ou minuscule', () => {
    expect(toitEnPente([0, 0, 20, 0, 20, 6, 6, 6, 6, 20, 0, 20], 0.7, 3.2)).toBeNull();
    expect(toitEnPente([0, 0, 40, 0, 40, 30, 0, 30], 0.7, 3.2)).toBeNull();
    expect(toitEnPente([0, 0, 2, 0, 2, 2, 0, 2], 0.7, 3.2)).toBeNull();
  });
});
