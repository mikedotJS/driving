// Appariement des bâtiments IGN (BD TOPO) aux emprises OpenStreetMap : tools/lib/ign.mjs.
// Les cas reprennent les pièges relevés sur les données réelles de Montreuil.

import { describe, it, expect } from 'vitest';
import { apparier, codeMateriaux, medianePonderee, type IgnBatiment } from '../tools/lib/ign.mjs';

type P = [number, number];
const rect = (x0: number, z0: number, x1: number, z1: number): P[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const osm = (pts: P[], type = 'res') => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i][0] * q[1] - q[0] * pts[i][1]; }
  return { pts, area: Math.abs(a) / 2, type };
};
const ign = (pts: P[], props: Partial<IgnBatiment> = {}): IgnBatiment => {
  const o = osm(pts);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  return {
    id: 'x', paths: [pts.map((p) => ({ X: Math.round(p[0] * 100), Y: Math.round(p[1] * 100) }))], area: o.area,
    box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)],
    h: 0, etages: 0, mur: 0, mur2: 0, toit: 0, an: 0, u1: '', u2: '', leger: false, ...props,
  };
};

describe('codes de matériaux du fichier foncier', () => {
  it('lit deux chiffres comme deux matériaux, jamais comme un nombre', () => {
    expect(codeMateriaux('40')).toEqual([4, 0]); // brique seule
    expect(codeMateriaux('24')).toEqual([2, 4]); // meulière puis brique
    expect(codeMateriaux('04')).toEqual([4, 0]);
    expect(codeMateriaux('44')).toEqual([4, 0]);
  });
  it('tient absent, vide et « 00 » pour inconnus', () => {
    for (const v of [null, undefined, '', '00', 40]) expect(codeMateriaux(v)).toEqual([0, 0]);
  });
});

describe('appariement IGN → OSM', () => {
  it('médiane pondérée par la surface', () => {
    expect(medianePonderee([[50, 10], [12, 60], [15, 30]])).toBe(12);
    expect(medianePonderee([[50, 80], [12, 20]])).toBe(50);
  });

  it('reporte hauteur, étages, matériaux, date et usage d’un bâtiment qui se superpose', () => {
    const [r] = apparier([osm(rect(0, 0, 10, 10))], [ign(rect(0.2, 0, 10.2, 10), { h: 9.4, etages: 3, mur: 2, mur2: 4, toit: 1, an: 1925, u1: 'h', u2: 'c' })]);
    expect(r).toMatchObject({ h: 9.4, etages: 3, mur: 2, mur2: 4, toit: 1, an: 1925, u: 'h', u2: 'c', n: 1 });
  });

  it('ne reporte rien si l’IGN couvre moins de la moitié de l’emprise', () => {
    const [r] = apparier([osm(rect(0, 0, 10, 10))], [ign(rect(6, 0, 16, 10), { h: 20 })]);
    expect(r).toBeNull();
  });

  it('écarte un nombre d’étages incohérent avec la hauteur (tour de 85 m à « 1 étage »)', () => {
    const [r] = apparier([osm(rect(0, 0, 30, 30))], [ign(rect(0, 0, 30, 30), { h: 85, etages: 1 })]);
    expect(r?.h).toBe(85);
    expect(r?.etages).toBeUndefined();
  });

  it('ne donne pas à un auvent la hauteur de la tour dans laquelle il est logé', () => {
    const tour = ign(rect(0, 0, 40, 40), { h: 53, mur: 3 });
    const [auvent, immeuble] = apparier([osm(rect(0, 0, 8, 5), 'roof'), osm(rect(0, 0, 20, 20))], [tour]);
    expect(auvent?.h).toBeUndefined();
    expect(immeuble?.h).toBe(53);
  });
  it('ne dresse pas une remise de 20 m² à la hauteur de l’immeuble qui l’englobe dans l’IGN', () => {
    const ilot = ign(rect(0, 0, 40, 40), { h: 25.8, mur: 3 });
    const cage = ign(rect(50, 0, 53, 3), { h: 31.7 });
    const [remise, ascenseur] = apparier([osm(rect(30, 30, 35, 34)), osm(rect(50, 0, 53, 3))], [ilot, cage]);
    // la hauteur n'est pas reportée (l'estimation est gardée), le matériau si
    expect(remise?.h).toBeUndefined();
    expect(remise?.mur).toBe(3);
    // une petite emprise qui a son propre bâtiment IGN garde sa hauteur, même élancée
    expect(ascenseur?.h).toBe(31.7);
  });

  it('résidence d’un seul tenant dans OSM : hauteur du corps de bâtiment majoritaire, pas du plus haut', () => {
    const [r] = apparier([osm(rect(0, 0, 100, 20))], [
      ign(rect(0, 0, 60, 20), { h: 12, mur: 4 }), ign(rect(60, 0, 85, 20), { h: 15, mur: 3 }), ign(rect(85, 0, 100, 20), { h: 55, mur: 3 }),
    ]);
    expect(r).toMatchObject({ h: 12, mur: 4, n: 3 });
  });

  it('retranche les cours intérieures (anneau intérieur) de la surface couverte', () => {
    const creux = ign(rect(0, 0, 10, 10), { h: 9 });
    creux.paths.push(rect(1, 1, 9, 9).map((p) => ({ X: p[0] * 100, Y: p[1] * 100 })));
    const [r] = apparier([osm(rect(0, 0, 10, 10))], [creux]);
    expect(r).toBeNull(); // 36 m² couverts sur 100
  });
});
