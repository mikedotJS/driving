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
  const tr = new Traffic(net, { vehicles: +(process.env.DENSITE ?? 45), pedestrians: 30, seed: +(process.env.SEED ?? 3) });
  const dt = 1 / 30;
  const el = (o: Vehicle) => (o.link ? `L[${o.link.turn} ${o.link.from.edge.name}#${o.link.from.index}→${o.link.to.edge.name}#${o.link.to.index} s=${o.s.toFixed(1)}/${o.link.line.length.toFixed(1)} sommet=${o.link.vertex.id}/${o.link.vertex.ends.length}]` : `V[${o.lane!.edge.name}#${o.lane!.index} s=${o.s.toFixed(1)}/${o.lane!.line.length.toFixed(1)}]`);
  const jour = new Map<number, { g: number; e: number; sans: boolean; was: number; onLink: boolean; int: boolean }>();
  const seen = new Map<string, number>();
  const kinds = new Map<string, number>();
  let n = 0;
  const stuck = new Map<number, number>();
  for (let t = 0; t < 360; t += dt) {
    tr.update(dt, player);
    // journal des réservations : quand chaque véhicule a obtenu le passage, et quand il est entré
    for (const o of tr.vehicles) {
      const J = (jour.get(o.id) ?? jour.set(o.id, { g: -1, e: -1, sans: false, was: -1, onLink: false, int: false }).get(o.id))!;
      const C = (tr as any).clusterOf, I = (tr as any).internalLanes;
      if (o.grant >= 0 && J.was < 0) J.g = t;
      const entering = !!o.link && C.has(o.link.vertex) && !J.onLink && !J.int;
      if (entering) { J.e = t; J.sans = J.was < 0; }
      J.was = o.grant; J.onLink = !!o.link; J.int = !!o.lane && I.has(o.lane);
    }
    if (Math.round(t / dt) % 15 !== 0) continue;
    for (const v of tr.vehicles) stuck.set(v.id, v.v < 0.1 ? (stuck.get(v.id) ?? 0) + 0.5 : 0);
    for (let i = 0; i < tr.vehicles.length; i++) for (let j = i + 1; j < tr.vehicles.length; j++) {
      const a = tr.vehicles[i], b = tr.vehicles[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) >= 1.6) continue;
      n++;
      const key = a.id + ':' + b.id;
      if (!seen.has(key)) {
        const rel = a.link && b.link ? (a.link === b.link ? 'même liaison' : a.link.conflicts.includes(b.link) ? 'liaisons en conflit' : a.link.to === b.link.to ? 'liaisons convergentes' : a.link.from === b.link.from ? 'liaisons divergentes' : 'liaisons sans relation') : a.lane && b.lane ? (a.lane === b.lane ? 'même voie' : a.lane.edge === b.lane.edge ? 'voies voisines' : 'voies différentes') : 'voie/liaison';
        kinds.set(rel, (kinds.get(rel) ?? 0) + 1);
        const R = tr as any;
        const gêne = a.link && b.link ? (R.clash.get(a.link)?.has(b.link) ? 'trajectoires incompatibles' : 'trajectoires jugées compatibles') : '';
        const pos = (o: Vehicle) => `(${o.x.toFixed(1)};${o.z.toFixed(1)}) long=${o.length} attente=${o.waiting.toFixed(0)} rés=${o.grant} obtenue t=${jour.get(o.id)?.g.toFixed(1)} entrée t=${jour.get(o.id)?.e.toFixed(1)}${jour.get(o.id)?.sans ? ' SANS RÉSERVATION' : ''} trajet=${o.plan.length} queue=${o.tail ? o.tailLeft.toFixed(1) : '-'}`;
        console.log(`t=${t.toFixed(0)} ${rel} ${gêne} : ${a.id} ${el(a)} v=${a.v.toFixed(1)} ${pos(a)} | ${b.id} ${el(b)} v=${b.v.toFixed(1)} ${pos(b)}`);
      }
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  console.log('échantillons', n, 'incidents', seen.size, Object.fromEntries(kinds));
  // véhicules immobilisés depuis longtemps en fin d'essai, et ce qui les retient
  const T = tr as any;
  const watch = (process.env.VEH ?? '').split(',');
  for (const o of tr.vehicles) {
    if ((stuck.get(o.id) ?? 0) < 40 && !watch.includes(String(o.id))) continue;
    const why: string[] = [];
    if (o.lane && o.next) {
      const end = o.lane.endRef, link = o.next;
      for (const q of T.byLink.get(link) ?? []) why.push(`sur ma liaison : ${q.id} s=${q.s.toFixed(1)} v=${q.v.toFixed(1)}`);
      for (const q of T.byLane.get(link.to) ?? []) why.push(`voie d'arrivée ${link.to.edge.name} (liaison ${link.line.length.toFixed(1)} m) : ${q.id} s=${q.s.toFixed(1)} v=${q.v.toFixed(1)}`);
      why.push(...tr.explain(o));
      why.push(`ctl=${end.control}${end.controller ? ':' + end.controller.state(end.group, tr.time) : ''} attente=${o.waiting.toFixed(0)} filet=${o.netWait.toFixed(0)}`);
      for (const q of T.byLane.get(link.to) ?? []) if (q.s - q.length < o.length + 2 && q.v < 1.5) why.push(`sortie encombrée par ${q.id}`);
      for (const c of link.conflicts) for (const q of T.byLink.get(c) ?? []) why.push(`dans le carrefour : ${q.id} v=${q.v.toFixed(1)}`);
      for (const sp of o.lane.stops) if (sp.crossing && T.pedestrianOn(sp.crossing, o)) why.push(`piéton au passage s=${sp.s.toFixed(1)}`);
      why.push(`a=${o.a.toFixed(2)} arrêts=[${o.lane.stops.map((sp: any) => `${sp.kind}@${sp.s.toFixed(1)}${sp.controller ? ':' + sp.controller.state(sp.group ?? 0, tr.time) : ''}`).join(' ')}] liaison=${link.turn}→${link.to.edge.name} long=${link.line.length.toFixed(1)} sortiesPiétons=${link.exitCrossings.length} cédez=${T.mustYield(o, link, end, 0, null)}`);
      for (const x of link.exitCrossings) if (T.pedestrianOn(x.crossing, o)) why.push('piéton en sortie');
      for (const c of link.conflicts) for (const q of T.byLane.get(c.from) ?? []) if (q.next === c) {
        const od = q.lane.line.length - q.s;
        if ((od < 9 || od / Math.max(2, q.v) < 3.6) && tr.hasPriorityOver(c.from.endRef, c, end, link, -end.dx, -end.dz)) why.push(`prioritaire en approche : ${q.id} depuis ${c.from.edge.name} à ${od.toFixed(1)} m v=${q.v.toFixed(1)} attente=${q.waiting.toFixed(0)} ctl=${c.from.endRef.control}${c.from.endRef.controller ? ':' + c.from.endRef.controller.state(c.from.endRef.group, tr.time) : ''}`);
      }
    } else if (o.link) {
      why.push(`filet=${o.netWait.toFixed(0)}`);
      for (const x of o.link.exitCrossings) if (T.pedestrianOn(x.crossing, o)) why.push('piéton en sortie');
      for (const q of T.byLink.get(o.link) ?? []) if (q !== o && q.s > o.s) why.push(`devant sur la liaison : ${q.id} s=${q.s.toFixed(1)} v=${q.v.toFixed(1)}`);
      for (const c of o.link.conflicts) for (const q of T.byLink.get(c) ?? []) {
        const mine = o.s / Math.max(1, o.link.line.length), theirs = q.s / Math.max(1, c.line.length);
        const d = Math.hypot(q.x - o.x, q.z - o.z);
        why.push(`conflit ${q.id} (${c.from.edge.name}→${c.to.edge.name}) avancement ${theirs.toFixed(2)} contre ${mine.toFixed(2)} dist=${d.toFixed(1)} v=${q.v.toFixed(1)}`);
      }
      why.push(`joueur=${T.playerGap(o, player).toFixed(1)} a=${o.a.toFixed(2)} attenteJoueur=${o.playerWait.toFixed(0)}`);
      for (const q of T.byLane.get(o.link.to) ?? []) why.push(`voie d'arrivée : ${q.id} s=${q.s.toFixed(1)} v=${q.v.toFixed(1)}`);
    } else why.push('sans suite (impasse)');
    for (const q of tr.vehicles) if (q !== o && Math.hypot(q.x - o.x, q.z - o.z) < 14 && T.bodyGap(o, q) < Infinity) why.push(`carrosserie de ${q.id} à ${T.bodyGap(o, q).toFixed(1)} m`);
    const pg = T.playerGap(o, player);
    if (pg < Infinity) why.push(`JOUEUR sur la trajectoire à ${pg.toFixed(1)} m`);
    console.log(`BLOQUÉ ${(stuck.get(o.id) ?? 0).toFixed(0)} s : ${o.id} ${el(o)} | ${why.join(' | ')}`);
  }
});
