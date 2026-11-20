import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNet, type MapFile } from '../src/map/roadnet';

const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);

describe('réseau routier Montreuil / Paris 20e', () => {
  it('charge les rues, voies et liaisons', () => {
    expect(net.edges.length).toBeGreaterThan(800);
    expect(net.lanes.length).toBeGreaterThan(1000);
    expect(net.links.length).toBeGreaterThan(1500);
    const stats = {
      sommets: net.vertices.length, arêtes: net.edges.length, voies: net.lanes.length, liaisons: net.links.length,
      passages: net.crossings.length, contrôleursFeux: net.controllers.length,
      branchesFeux: net.controllers.reduce((s, c) => s + c.ends.length, 0),
      stops: net.edges.reduce((s, e) => s + [e.endA, e.endB].filter((x) => x.control === 'stop').length, 0),
      cédez: net.edges.reduce((s, e) => s + [e.endA, e.endB].filter((x) => x.control === 'yield').length, 0),
      carrefoursPrioritéDroite: net.vertices.filter((v) => v.junction && !v.roundabout && v.ends.every((e) => e.control === 'none')).length,
      carrefours: net.vertices.filter((v) => v.junction).length,
      conflits: net.links.reduce((s, l) => s + l.conflicts.length, 0) / 2,
      voiesSansSortie: net.lanes.filter((l) => l.kind === 'L' && !l.links.length && !l.to.exit && !l.to.dead).length,
      voiesLongueurNulle: net.lanes.filter((l) => l.line.length < 0.5).length,
    };
    console.log(stats);
    expect(stats.voiesSansSortie).toBeLessThan(25);
  });

  it('toute voie générale a une vitesse limite plausible', () => {
    for (const e of net.edges) expect([10, 15, 20, 30, 50, 70]).toContain(e.limit);
  });

  it('les feux alternent correctement', () => {
    for (const c of net.controllers) {
      expect(c.cycle).toBeGreaterThan(20);
      // jamais deux groupes au vert/jaune en même temps
      for (let t = 0; t < c.cycle; t += 0.5) {
        const open = [];
        for (let g = 0; g < c.groups; g++) if (c.state(g, t) !== 'red') open.push(g);
        expect(open.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('localise un point sur la rue de Paris', () => {
    const e = net.edges.find((x) => x.name === 'Rue de Paris')!;
    const p = e.line.at(e.length / 2);
    const loc = net.locate(p.x, p.z)!;
    expect(loc.edge.name).toBe('Rue de Paris');
    expect(Math.abs(loc.d)).toBeLessThan(0.5);
  });
});
