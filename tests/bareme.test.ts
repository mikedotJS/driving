// Barème vérifié le 20 novembre 2026 sur les fiches officielles de service-public (voir la section 7
// de docs/code-de-la-route-recherche.md). Ce test fige les montants et les points : toute modification
// du catalogue doit s'accompagner d'une nouvelle vérification des sources.
import { describe, it, expect } from 'vitest';
import { INFRACTIONS, speedingInfraction } from '../src/rules/infractions';

/** [identifiant, article, amende forfaitaire (€), points, source] */
const VERIFIE: [keyof typeof INFRACTIONS, string, number, number, string][] = [
  ['vitesse_5', 'R413-14', 135, 0, 'service-public F19460, F31551'],
  ['vitesse_20', 'R413-14', 135, 1, 'service-public F19460, F31551'],
  ['vitesse_30', 'R413-14', 135, 2, 'service-public F19460, F31551'],
  ['vitesse_40', 'R413-14', 135, 3, 'service-public F19460, F31551'],
  ['vitesse_50', 'R413-14', 135, 4, 'service-public F19460, F31551'],
  ['vitesse_delit', 'L413-1', 300, 6, 'service-public A18723 (délit depuis le 29 décembre 2025)'],
  ['vitesse_inadaptee', 'R413-17', 135, 0, 'service-public F19460'],
  ['trop_lent', 'R413-19', 35, 0, 'service-public F19460'],
  ['feu_rouge', 'R412-30', 135, 4, 'service-public F31551'],
  ['feu_orange', 'R412-31', 35, 0, 'extrait Légifrance'],
  ['stop', 'R415-6', 135, 4, 'service-public F31551'],
  ['cedez', 'R415-7', 135, 4, 'service-public F31551'],
  ['priorite_droite', 'R415-5', 135, 4, 'service-public F31551'],
  ['giratoire', 'R415-10', 135, 4, 'service-public F31551'],
  ['priorite_feu', 'R415-4', 135, 4, 'service-public F31551'],
  ['pieton', 'R415-11', 135, 6, 'service-public F31551 (6 points depuis 2018)'],
  ['carrefour_encombre', 'R415-2', 135, 0, 'extrait Légifrance'],
  ['sens_interdit', 'R412-28', 135, 4, 'service-public F31551'],
  ['circulation_gauche', 'R412-9', 135, 3, 'service-public F31551'],
  ['ligne_continue', 'R412-19', 135, 3, 'service-public F31551'],
  ['voie_bus', 'R412-7', 135, 0, 'service-public A18035'],
  ['bande_cyclable', 'R412-7', 135, 0, 'extrait Légifrance'],
  ['trottoir', 'R412-7', 135, 0, 'extrait Légifrance'],
  ['clignotant', 'R412-10', 35, 3, 'service-public F31551'],
  ['klaxon', 'R416-1', 35, 0, 'service-public F35343'],
  ['distance', 'R412-12', 135, 3, 'service-public F31551'],
  ['depassement_cycliste', 'R414-4', 135, 3, 'extrait Légifrance, service-public F31551'],
  ['arret_passage', 'R417-11', 135, 0, 'service-public F34212'],
  ['ceinture', 'R412-1', 135, 3, 'service-public F628, F31551'],
  ['feux', 'R416-11', 135, 4, 'extrait Légifrance'],
];

describe('barème des infractions (vérifié sur sources officielles)', () => {
  for (const [id, article, amende, points, source] of VERIFIE) {
    it(`${id} : ${article}, ${amende} €, ${points} point(s) — ${source}`, () => {
      const inf = INFRACTIONS[id];
      expect(inf.article).toBe(article);
      expect(inf.amende).toBe(amende);
      expect(inf.points).toBe(points);
    });
  }

  it('le barème des excès de vitesse suit les seuils officiels en agglomération', () => {
    expect(speedingInfraction(4)).toBe('vitesse_5');     // moins de 5 km/h : plus de retrait de point depuis le 1er janvier 2024
    expect(speedingInfraction(5)).toBe('vitesse_20');
    expect(speedingInfraction(19)).toBe('vitesse_20');
    expect(speedingInfraction(20)).toBe('vitesse_30');
    expect(speedingInfraction(35)).toBe('vitesse_40');
    expect(speedingInfraction(45)).toBe('vitesse_50');
    expect(speedingInfraction(50)).toBe('vitesse_delit'); // délit dès la première fois depuis le 29 décembre 2025
  });

  it('les points retirés ne dépassent jamais 6 et les amendes sont celles des classes 2 et 4', () => {
    for (const inf of Object.values(INFRACTIONS)) {
      expect(inf.points).toBeLessThanOrEqual(6);
      if (inf.classe === 2) expect(inf.amende).toBe(35);
      if (inf.classe === 4) expect(inf.amende).toBe(135);
    }
  });
});
