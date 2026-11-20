// Rattachement des commerces aux façades et noms des stations de métro : tools/lib/enseignes.mjs.

import { describe, it, expect } from 'vitest';
import { rattacher, stationsDeMetro, DEVANTURE_MAX } from '../tools/lib/enseignes.mjs';

type P = [number, number];
const rect = (x0: number, z0: number, x1: number, z1: number): P[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const bat = (pts: P[], type = 'res') => ({ pts, type });
// une rue le long de z = −6 : elle passe devant le mur z = 0 des bâtiments ci-dessous
const rue = [{ pts: [[-50, -6], [80, -6]] as P[], half: 3 }];

describe('rattachement d’un commerce à sa façade', () => {
  it('choisit le mur sur rue, même si le mur du fond est plus près du point', () => {
    const [r] = rattacher([{ x: 5, z: 6 }], [bat(rect(0, 0, 10, 8))], rue);
    expect(r).not.toBeNull();
    expect(r!.b).toBe(0);
    expect(r!.i).toBe(0); // du sommet (0,0) au sommet (10,0)
    expect(r!.s).toBeCloseTo(5);
  });

  it('borne la devanture d’un commerce isolé sur un long mur', () => {
    const [r] = rattacher([{ x: 20, z: 2 }], [bat(rect(0, 0, 40, 8))], rue);
    expect(r!.f1 - r!.f0).toBeCloseTo(DEVANTURE_MAX);
    expect((r!.f0 + r!.f1) / 2).toBeCloseTo(20);
  });

  it('partage le mur entre voisins, à mi-chemin, sans chevauchement', () => {
    const res = rattacher([{ x: 3, z: 2 }, { x: 7, z: 2 }, { x: 5, z: 3 }], [bat(rect(0, 0, 10, 8))], rue);
    const [a, b, c] = res.map((r) => r!);
    expect(a.f0).toBeCloseTo(0); expect(a.f1).toBeCloseTo(4);
    expect(c.f0).toBeCloseTo(4); expect(c.f1).toBeCloseTo(6);
    expect(b.f0).toBeCloseTo(6); expect(b.f1).toBeCloseTo(10);
  });

  it('ne pose rien sur un mur mitoyen ni sur un auvent', () => {
    // deux immeubles accolés par le mur x = 10 ; le point est tout contre ce mur
    const bats = [bat(rect(0, 0, 10, 8)), bat(rect(10, 0, 20, 8)), bat(rect(30, 0, 40, 8), 'roof')];
    const [r, sousAuvent] = rattacher([{ x: 9.5, z: 4 }, { x: 35, z: 4 }], bats, rue);
    expect(r!.b).toBe(0);
    expect(r!.i).toBe(0);
    expect(sousAuvent).toBeNull();
  });

  it('reste sur le bâtiment où le point est saisi, même si la façade du voisin est plus proche', () => {
    // le voisin avance sur la rue : son mur latéral libre (x = 10, z de −3 à 0) est à 1 m du point
    const bats = [bat(rect(0, 0, 10, 8)), bat(rect(10, -3, 20, 8))];
    const [r] = rattacher([{ x: 9.5, z: 0.5 }], bats, [{ pts: [[-50, -9], [80, -9]], half: 3 }]);
    expect(r!.b).toBe(0);
  });

  it('depuis le trottoir, prend le mur devant lequel le point est posé', () => {
    const [r] = rattacher([{ x: 5, z: -1.5 }], [bat(rect(0, 0, 10, 8))], rue);
    expect(r).toMatchObject({ b: 0, i: 0 });
  });

  it('sans rue devant, se rabat sur le mur libre tout proche, mais pas sur un mur lointain', () => {
    const b = [bat(rect(0, 0, 10, 30))];
    const [pres, loin] = rattacher([{ x: 5, z: 27 }, { x: 5, z: 15 }], b, []);
    expect(pres).toMatchObject({ b: 0, i: 2 });
    expect(loin).toMatchObject({ b: 0 }); // à 5 m des murs latéraux : encore assez près
    const [trop] = rattacher([{ x: 15, z: 15 }], [bat(rect(0, 0, 30, 30))], []);
    expect(trop).toBeNull();
  });

  it('laisse sans façade un point loin de tout bâtiment', () => {
    expect(rattacher([{ x: 200, z: 200 }], [bat(rect(0, 0, 10, 8))], rue)).toEqual([null]);
  });
});

describe('stations de métro', () => {
  const rel = (id: string, tags: Record<string, string>, refs: string[]) =>
    [id, { tags, members: refs.map((ref) => ({ type: 'node', ref })) }] as const;

  it('donne à chaque bouche le nom de sa station et la ligne, pas le nom de la sortie', () => {
    const relations = new Map([
      rel('1', { type: 'route', route: 'subway', ref: '9' }, ['quai']),
      rel('2', { public_transport: 'stop_area', name: 'Croix de Chavaux' }, ['quai', 'bouche1']),
      // seconde aire de la même station, sans quai : elle hérite de la ligne par le nom
      rel('3', { public_transport: 'stop_area', name: 'Croix de Chavaux' }, ['bouche2']),
      rel('4', { public_transport: 'stop_area', name: 'Sans ligne' }, ['bouche3']),
    ]);
    const s = stationsDeMetro(relations);
    expect(s.get('bouche1')).toEqual({ station: 'Croix de Chavaux', ligne: '9' });
    expect(s.get('bouche2')).toEqual({ station: 'Croix de Chavaux', ligne: '9' });
    expect(s.get('bouche3')).toEqual({ station: 'Sans ligne' });
    expect(s.has('ailleurs')).toBe(false);
  });
});
