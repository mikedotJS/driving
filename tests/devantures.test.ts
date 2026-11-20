// Devantures : couleurs, mise en forme des noms, partage d'un mur en travées (src/world/devantures.ts).

import { describe, it, expect } from 'vitest';
import { NOM_MAX, partager, teinteEnseigne, texteEnseigne, vitrine } from '../src/world/devantures';

describe('nom peint sur le bandeau', () => {
  it('garde tel quel un nom court, accents et apostrophes compris', () => {
    expect(texteEnseigne('Boulangerie de l’Église')).toBe('Boulangerie de l’Église');
    expect(texteEnseigne('  Café   de la  Place ')).toBe('Café de la Place');
    expect(texteEnseigne('Le Méliès')).toBe('Le Méliès');
  });

  it('coupe un nom trop long à sa première précision, sinon au dernier mot entier', () => {
    expect(texteEnseigne('Pharmacie centrale Davout-Saint-Blaise (ouverte le dimanche)')).toBe('Pharmacie centrale…');
    expect(texteEnseigne('Boulangerie Pâtisserie Artisanale - Maison Dupont')).toBe('Boulangerie Pâtisserie…');
    expect(texteEnseigne('La Ressourcerie du spectacle, antenne de Montreuil')).toBe('La Ressourcerie du…');
    for (const n of ['Anticonstitutionnellementissimement', 'Un nom de commerce vraiment beaucoup trop long pour une enseigne']) {
      expect(texteEnseigne(n).length).toBeLessThanOrEqual(NOM_MAX + 1);
    }
  });
});

describe('couleurs du bandeau', () => {
  it('reconnaît une chaîne avant le métier, par le nom ou par la marque', () => {
    expect(teinteEnseigne('supermarket', 'Franprix').fond).toBe(teinteEnseigne('convenience', 'franprix Montreuil').fond);
    expect(teinteEnseigne('supermarket', 'Franprix').fond).not.toBe(teinteEnseigne('supermarket', 'Chez Ali').fond);
    expect(teinteEnseigne('bank', 'Agence Robespierre', 'BNP Paribas').fond).toBe(teinteEnseigne('bank', 'BNP Paribas').fond);
  });

  it('donne une couleur par famille, et une couleur neutre aux types inconnus', () => {
    expect(teinteEnseigne('restaurant', 'Chez Léa').fond).toBe(teinteEnseigne('fast_food', 'Zam Zam').fond);
    expect(teinteEnseigne('cafe', 'Le Soleil').fond).not.toBe(teinteEnseigne('restaurant', 'Le Soleil').fond);
    expect(teinteEnseigne('pharmacy', 'Pharmacie du Square').texte).toBe('#12803c');
    expect(teinteEnseigne('inconnu', 'Truc').fond).toBe(teinteEnseigne(undefined, 'Truc').fond);
  });
});

describe('vitrine', () => {
  it('baisse le rideau d’un local vacant et reste dans les six tuiles', () => {
    expect(vitrine('vacant', 12345)).toBe(3);
    for (let g = 0; g < 12; g++) for (const t of ['restaurant', 'bakery', 'clothes', undefined]) {
      const v = vitrine(t, g);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(6);
      expect(v).not.toBe(3);
    }
  });
});

describe('partage d’un mur en travées', () => {
  it('cale un commerce seul sur des travées entières', () => {
    // mur de 16 m, 5 travées de 3,2 m ; devanture de 5 à 10 m
    const r = partager(16, 5, [{ f0: 5, f1: 10 }]);
    expect(r.bandeaux[0].a).toBeCloseTo(6.4);
    expect(r.bandeaux[0].b).toBeCloseTo(9.6);
    expect(r.travees).toEqual([-1, -1, 0, -1, -1]);
  });

  it('donne toujours au moins la travée du milieu', () => {
    const r = partager(16, 5, [{ f0: 7.6, f1: 8.4 }]);
    expect(r.travees).toEqual([-1, -1, 0, -1, -1]);
    expect(r.bandeaux[0].b - r.bandeaux[0].a).toBeCloseTo(3.2);
  });

  it('range les voisins côte à côte sans chevauchement, quel que soit l’ordre d’arrivée', () => {
    const r = partager(16, 5, [{ f0: 8, f1: 16 }, { f0: 0, f1: 8 }]);
    expect(r.bandeaux[1].b).toBeLessThanOrEqual(r.bandeaux[0].a + 1e-9);
    expect(r.travees.filter((t) => t === 1).length).toBeGreaterThanOrEqual(2);
    expect(r.travees.filter((t) => t === 0).length).toBeGreaterThanOrEqual(2);
    expect(r.travees.indexOf(1)).toBeLessThan(r.travees.indexOf(0));
  });

  it('fait partager une même travée à deux commerces serrés', () => {
    // mur d'une seule travée, deux boutiques
    const r = partager(3.2, 1, [{ f0: 0, f1: 1.6 }, { f0: 1.6, f1: 3.2 }]);
    expect(r.bandeaux[0]).toEqual({ a: 0, b: 1.6 });
    expect(r.bandeaux[1]).toEqual({ a: 1.6, b: 3.2 });
    expect(r.travees[0]).toBeGreaterThanOrEqual(0);
  });

  it('ne sort jamais du mur', () => {
    const r = partager(7, 2, [{ f0: -1, f1: 3 }, { f0: 5, f1: 9 }]);
    for (const b of r.bandeaux) { expect(b.a).toBeGreaterThanOrEqual(0); expect(b.b).toBeLessThanOrEqual(7 + 1e-9); }
  });
});
