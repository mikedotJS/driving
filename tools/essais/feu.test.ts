import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNet, type MapFile } from '../../src/map/roadnet';
const map = JSON.parse(readFileSync(new URL('../../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);
it('feux suspects', () => {
  // voies très courtes portant un feu, et contrôleurs dont un groupe n'a jamais le vert
  let bad = 0;
  for (const c of net.controllers) {
    for (let g = 0; g < 2; g++) {
      const used = c.ends.some((e) => e.group === g) || c.crossings.some((x) => x.group === g);
      if (!used) continue;
      let green = 0;
      for (let t = 0; t < c.cycle; t += 0.5) if (c.state(g, t) === 'green') green++;
      if (!green) { bad++; console.log(`contrôleur ${c.id} groupes=${c.groups} : le groupe ${g} n'a jamais le vert ; branches ${c.ends.map((e) => `${e.edge.name}:g${e.group}`).join(', ')}`); }
    }
  }
  const e = net.edges.filter((x) => x.name === 'Rue Étienne Marcel');
  for (const x of e) for (const l of x.allLanes) for (const s of l.stops) if (s.kind === 'signal') console.log(`Rue Étienne Marcel arête ${x.id} long ${x.length.toFixed(1)} voie ${l.id} long ${l.line.length.toFixed(1)} : feu à s=${s.s.toFixed(1)} ctl=${s.controller?.id} groupes=${s.controller?.groups} groupe=${s.group} atEnd=${s.atEnd} cycle=${s.controller?.cycle}`);
  console.log('contrôleurs sans vert :', bad);
});
