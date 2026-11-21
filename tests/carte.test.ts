// Garde-fous sur la carte livrée (public/maps/montreuil.json).
//
// 1. Le réseau routier ne doit pas bouger quand on enrichit le décor : 1 008 trajets d'essai
//    (tools/essais) ont été validés sur cette chaussée. Les empreintes ci-dessous sont celles de la
//    carte d'avant l'ajout des données IGN et des enseignes. Si l'on modifie VOLONTAIREMENT la
//    voirie, il faut rejouer ces trajets, puis mettre les empreintes à jour.
//    Le sol hors chaussée (cœurs d'îlot, espaces), les allées, les arbres, les haies et le mobilier
//    ne sont pas figés ici : ils suivent OpenStreetMap et la photo aérienne (tests/sol.test.ts les
//    vérifie). Dans les dalles, seuls la chaussée (r) et le trottoir (w) sont du réseau. Les rues
//    piétonnes, les voies de tram, les murs et clôtures relevés et les points fixes (arrêts, bouches de
//    métro, commerces) sont figés aussi : leurs empreintes sont celles de la carte de référence.
// 2. Les commerces rattachés à une façade doivent désigner un mur qui existe.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { MapFile } from '../src/map/roadnet';

const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const EMPREINTES: Record<string, string> = {
  version: '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b',
  name: 'dd0041440d8314d2404460e75109c1cf6bd1f96a85c0f7c1f01c8a3a22da74ec',
  origin: 'a1c3ec589d05346b677708b5cefe194b2ad125073a4090e67c697bc100c54799',
  rect: 'c3279441746c35ef5a74c632e45f1c790d7813c8ae540bf3422259206eb76b67',
  chunk: 'ad57366865126e55649ecb23ae1d48887544976efea46a48eb5d85a6eeb4d306',
  vertices: '13345fefead8031193fadb0336fd2bbb874d2de044d73b7d206742f69e4122e2',
  edges: 'b5187e6b348368e0d553adbf4492b579c4b1888009d5213fbed3c3c743f709e9',
  restrictions: 'c8e45076ad69ed01c094f7d2c5c7ca0bcbd320b080d7590954df7195502e5343',
  lamps: 'ba45afae1d2b67e0d5bd9dcf03d6738110a8c4b18b7f2187c82521536c0c7b76',
};
// chaussée et trottoir de chaque dalle, dans l'ordre des dalles : empreinte calculée sur la carte de
// référence (celle dont l'empreinte de « chunks » entier était 60787b9e…)
const EMPREINTE_VOIRIE = 'edfba77e89ee48c700b59624d660e43532a4a358e32e932f5ffb4ef9dad9ec52';

describe('carte : réseau routier inchangé', () => {
  for (const [cle, attendu] of Object.entries(EMPREINTES)) {
    it(`« ${cle} » est identique à la carte de référence`, () => {
      expect(sha((map as unknown as Record<string, unknown>)[cle])).toBe(attendu);
    });
  }

  it('garde la chaussée et le trottoir de chaque dalle identiques à la carte de référence', () => {
    expect(Object.keys(map.chunks).length).toBe(640);
    expect(sha(Object.keys(map.chunks).map((k) => [k, map.chunks[k].r, map.chunks[k].w]))).toBe(EMPREINTE_VOIRIE);
  });

  it('garde les arrêts de bus, les bouches de métro et les commerces à leur place', () => {
    const fixes = map.pois.filter((p) => /^(bus|metro|shop|pharmacy)$/.test(p.k));
    expect(fixes.length).toBe(1152);
    expect(sha(fixes)).toBe('193c69c4111c5211b925cc6777a3d91ad9b166fe244f1436e34316a1debf0042');
  });

  it('garde les rues piétonnes et les voies de tram (elles portent des devantures)', () => {
    expect(sha(map.lines.filter((l) => l.k === 'ped' || l.k === 'tram'))).toBe('e3c21d36574e7f79f8c4da2d756d7131147cd4988a259ed4b593341e136f4aa1');
  });

  it('garde les murs, clôtures et glissières relevés (obstacles des collisions) ; les barrières déduites portent d: 1', () => {
    const releves = map.barriers.filter((b) => !b.d && /^(wall|fence|rail)$/.test(b.k));
    expect(releves.length).toBe(1193);
    expect(sha(releves)).toBe('1eb669de9475fd4f5dd2d7bed6c09b49c87aa01f5a52471c37a3056cf34b3d13');
    // tout ce qui est déduit est une clôture de jardin : muret ou haie
    for (const b of map.barriers.filter((q) => q.d)) expect(b.k === 'muret' || b.k === 'hedge').toBe(true);
    expect(map.barriers.filter((q) => q.k === 'muret').every((q) => q.d === 1)).toBe(true);
  });

  it('garde le même nombre de bâtiments (leurs murs servent aux collisions)', () => {
    expect(map.buildings.length).toBe(12266);
  });
});

describe('carte : commerces rattachés aux façades', () => {
  const vitrines = map.pois.filter((p) => p.k === 'shop' || p.k === 'pharmacy');
  const lies = vitrines.filter((p) => p.fb !== undefined);

  it('rattache la grande majorité des commerces', () => {
    expect(vitrines.length).toBeGreaterThan(900);
    expect(lies.length / vitrines.length).toBeGreaterThan(0.9);
  });

  it('désigne pour chacun un mur existant, assez long, d’un bâtiment qui n’est pas un auvent', () => {
    for (const p of lies) {
      const b = map.buildings[p.fb!];
      expect(b, `bâtiment ${p.fb} de « ${p.n} »`).toBeDefined();
      expect(b.t).not.toBe('roof');
      const n = b.p.length / 2, i = p.fi!, j = (i + 1) % n;
      expect(i).toBeLessThan(n);
      const len = Math.hypot(b.p[j * 2] - b.p[i * 2], b.p[j * 2 + 1] - b.p[i * 2 + 1]);
      expect(p.f0!).toBeGreaterThanOrEqual(0);
      expect(p.f1!).toBeGreaterThanOrEqual(p.f0!);
      expect(p.f1!).toBeLessThanOrEqual(len + 0.06);
    }
  });

  it('nomme les bouches de métro d’après leur station', () => {
    const stations = new Set(map.pois.filter((p) => p.k === 'metro').map((p) => p.n));
    for (const s of ['Croix de Chavaux', 'Mairie de Montreuil', 'Robespierre', 'Porte de Montreuil', 'Gallieni']) expect(stations).toContain(s);
    expect(stations).not.toContain('Rue de Paris');
  });
});
