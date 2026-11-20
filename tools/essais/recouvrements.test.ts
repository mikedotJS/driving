// Où les véhicules IA se chevauchent-ils ? npx vitest run --config tools/vitest.config.ts tools/essais/recouvrements.test.ts
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNet, type MapFile } from '../../src/map/roadnet';
import { Traffic, type PlayerInfo, type Vehicle } from '../../src/traffic/traffic';

const map = JSON.parse(readFileSync(new URL('../../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);

it('recouvrements', () => {
  const e = net.edges.find((x) => x.name === 'Place Jacques Duclos')!;
  const p0 = e.line.at(0);
  const player: PlayerInfo = { x: p0.x + 40, z: p0.z + 40, heading: 0, speed: 0, length: 4.05, width: 1.8, approach: null, approachDist: Infinity, inJunction: null, left: false, right: false };
  const tr = new Traffic(net, { vehicles: 45, pedestrians: 30, seed: +(process.env.SEED ?? 3) });
  const dt = 1 / 30;
  const el = (o: Vehicle) => (o.link ? `L[${o.link.turn} ${o.link.from.edge.name}#${o.link.from.index}→${o.link.to.edge.name}#${o.link.to.index} s=${o.s.toFixed(1)}/${o.link.line.length.toFixed(1)} sommet=${o.link.vertex.id}/${o.link.vertex.ends.length}]` : `V[${o.lane!.edge.name}#${o.lane!.index} s=${o.s.toFixed(1)}/${o.lane!.line.length.toFixed(1)}]`);
  const seen = new Map<string, number>();
  const kinds = new Map<string, number>();
  let n = 0;
  for (let t = 0; t < 360; t += dt) {
    tr.update(dt, player);
    if (Math.round(t / dt) % 15 !== 0) continue;
    for (let i = 0; i < tr.vehicles.length; i++) for (let j = i + 1; j < tr.vehicles.length; j++) {
      const a = tr.vehicles[i], b = tr.vehicles[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) >= 1.6) continue;
      n++;
      const key = a.id + ':' + b.id;
      if (!seen.has(key)) {
        const rel = a.link && b.link ? (a.link === b.link ? 'même liaison' : a.link.conflicts.includes(b.link) ? 'liaisons en conflit' : a.link.to === b.link.to ? 'liaisons convergentes' : a.link.from === b.link.from ? 'liaisons divergentes' : 'liaisons sans relation') : a.lane && b.lane ? (a.lane === b.lane ? 'même voie' : a.lane.edge === b.lane.edge ? 'voies voisines' : 'voies différentes') : 'voie/liaison';
        kinds.set(rel, (kinds.get(rel) ?? 0) + 1);
        console.log(`t=${t.toFixed(0)} ${rel} : ${a.id} ${el(a)} v=${a.v.toFixed(1)} | ${b.id} ${el(b)} v=${b.v.toFixed(1)}`);
      }
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  console.log('échantillons', n, 'incidents', seen.size, Object.fromEntries(kinds));
});
