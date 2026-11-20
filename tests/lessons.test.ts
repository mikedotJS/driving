import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNet, type MapFile } from '../src/map/roadnet';
import { LESSONS, START_STREETS, planExam, planRoute, quietStreet, startOnStreet, type Theme } from '../src/game/lessons';
import { instruction } from '../src/map/route';

const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);

describe('leçons', () => {
  it('trouve une rue calme pour les premières leçons', () => {
    const p = quietStreet(net, 1080, -480)!;
    expect(p).toBeTruthy();
    console.log('rue calme :', p.edge.name, Math.round(p.edge.length), 'm, limite', p.edge.limit);
    expect(p.edge.length).toBeGreaterThan(170);
  });

  it('chaque thème a un départ et un itinéraire adapté', () => {
    const themes: Theme[] = ['tournants', 'priorite', 'feux', 'pietons', 'giratoire', 'circulation', 'autonomie'];
    for (const th of themes) {
      const found = START_STREETS[th].map((n) => [n, startOnStreet(net, n, 0.25)] as const);
      const ok = found.filter(([, p]) => p);
      expect(ok.length, `départ pour ${th} : ${found.map(([n, p]) => `${n}=${p ? 'ok' : 'absent'}`).join(', ')}`).toBeGreaterThan(0);
      const pose = ok[0][1]!;
      const r = planRoute(net, { edge: pose.edge, dir: pose.dir }, pose.s, th, 42)!;
      expect(r, `itinéraire pour ${th}`).toBeTruthy();
      const turns = r.maneuvers.filter((m) => m.kind === 'gauche' || m.kind === 'droite').length;
      const rb = r.maneuvers.filter((m) => m.kind === 'giratoire').length;
      let sig = 0, stops = 0, free = 0, cross = 0;
      r.steps.forEach((st, i) => {
        cross += st.edge.crossings.length;
        if (i === r.steps.length - 1) return;
        const end = st.dir > 0 ? st.edge.endB : st.edge.endA;
        if (end.vertex.ends.length < 3) return;
        if (end.control === 'signal') sig++; else if (end.control === 'stop' || end.control === 'yield') stops++; else free++;
      });
      console.log(`${th.padEnd(12)} départ ${ok[0][0].padEnd(34)} ${Math.round(r.length)} m · ${turns} virages · ${rb} giratoires · ${sig} feux · ${stops} stops/cédez · ${free} priorités à droite · ${cross} passages`);
      console.log('   ', r.maneuvers.slice(0, 4).map((m) => instruction(m, true).text).join(' | '));
      if (th === 'giratoire') expect(rb).toBeGreaterThan(0);
      if (th === 'feux') expect(sig + stops).toBeGreaterThan(1);
      if (th === 'priorite') expect(free).toBeGreaterThan(2);
    }
  });

  it('prépare un parcours d’examen de plusieurs kilomètres', () => {
    const pose = START_STREETS.examen.map((n) => startOnStreet(net, n, 0.25)).find(Boolean)!;
    const r = planExam(net, { edge: pose.edge, dir: pose.dir }, pose.s, 7)!;
    expect(r).toBeTruthy();
    console.log(`examen : ${Math.round(r.length)} m, ${r.maneuvers.length} consignes`);
    expect(r.length).toBeGreaterThan(1500);
    // continuité : chaque étape part du sommet où arrive la précédente
    for (let i = 1; i < r.steps.length; i++) {
      const a = r.steps[i - 1], b = r.steps[i];
      const va = a.dir > 0 ? a.edge.b : a.edge.a, vb = b.dir > 0 ? b.edge.a : b.edge.b;
      expect(va).toBe(vb);
    }
  });

  it('toutes les leçons ont des étapes', () => {
    for (const l of LESSONS) expect(l.steps.length).toBeGreaterThan(0);
  });
});
