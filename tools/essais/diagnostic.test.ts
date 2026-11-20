// Diagnostic du pilote automatique : THEME=pietons SEED=3 npx vitest run --config tools/vitest.config.ts tools/essais/diagnostic.test.ts
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNet, type MapFile } from '../../src/map/roadnet';
import { Ground } from '../../src/world/ground';
import { Traffic } from '../../src/traffic/traffic';
import { RulesEngine, type PlayerState } from '../../src/rules/engine';
import { Player } from '../../src/game/player';
import { Autopilot } from '../../src/game/autopilot';
import { START_STREETS, planRoute, startOnStreet, type Theme } from '../../src/game/lessons';
import type { InputState, Action } from '../../src/input/controls';

const map = JSON.parse(readFileSync(new URL('../../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);
const ground = new Ground(map);

it('diagnostic', () => {
  const theme: Theme = (process.env.THEME as Theme) ?? 'tournants';
  const seed = +(process.env.SEED ?? 7);
  const pose = START_STREETS[theme].map((n) => startOnStreet(net, n, 0.25)).find(Boolean)!;
  const route = planRoute(net, { edge: pose.edge, dir: pose.dir }, pose.s, theme, seed)!;
  const traffic = new Traffic(net, { vehicles: 28, pedestrians: 22, seed });
  const rules = new RulesEngine(net, traffic);
  const player = new Player(ground, net, traffic);
  const ap = new Autopilot(net, traffic, route);
  const l0 = ap.segs[0].lane!;
  const p = l0.line.at(l0.fromEdgeS(pose.s));
  player.car.mode = 'auto';
  player.spawn(p.x, p.z, Math.atan2(p.tx, -p.tz), { running: true, belt: true });
  player.handbrake = false; player.car.selector = 'D';
  const input: InputState = { steer: 0, throttle: 0, brake: 0, clutch: 0, pressed: new Set<Action>(), held: new Set<Action>(), hGear: null, device: 'keyboard', deviceName: '', hasClutchPedal: false, steerRate: 0 };
  const out: string[] = [];
  const A = ap as any;
  const ctx = () => {
    const seg = A.segs[A.k];
    const pr = seg.line.project(player.car.x, player.car.z);
    return `t=${t.toFixed(1)} v=${player.car.speedKmh.toFixed(0)}km/h seg=${A.k}${seg.link ? `(liaison ${seg.link.turn} ${seg.link.from.edge.name}→${seg.link.to.edge.name}, R≈${(1 / Math.max(1e-3, Math.abs(seg.line.curvatureAt(pr.s, 2)))).toFixed(1)}m, larg. sortie ${seg.link.to.edge.width})` : `(voie ${seg.lane.edge.name} larg ${seg.lane.width} off ${seg.lane.off.toFixed(1)} demi-chaussée ${seg.lane.edge.half.toFixed(1)})`} s=${pr.s.toFixed(1)}/${seg.line.length.toFixed(1)} écart=${pr.d.toFixed(2)} volant=${input.steer.toFixed(2)} gaz=${input.throttle.toFixed(2)} frein=${input.brake.toFixed(2)} rapport=${player.car.gear} rpm=${player.car.rpm.toFixed(0)} raison=${ap.debug}`;
  };
  let t = 0;
  player.events.collision = (kind, speed) => {
    if (kind === 'pieton') {
      const ped = traffic.pedestrians.find((q) => q.hit && Math.hypot(q.x - player.car.x, q.z - player.car.z) < 4);
      const c = ped?.crossing;
      const onLaneStops = A.segs.slice(A.k, A.k + 3).map((sg: any) => sg.lane ? sg.lane.stops.filter((s: any) => s.crossing === c).map((s: any) => `voie s=${s.s.toFixed(1)}`) : sg.link.exitCrossings.filter((x: any) => x.crossing === c).map((x: any) => `liaison s=${x.s.toFixed(1)}`)).flat();
      out.push(`PIÉTON ${ctx()} | piéton état=${ped?.state} progress=${ped?.progress.toFixed(2)} hasRight=${ped?.hasRight} attente=${ped?.waitTime.toFixed(1)} passage sur ${c?.edge.name} s=${c?.s.toFixed(1)}/${c?.edge.length.toFixed(1)} trimA=${c?.edge.endA.trim.toFixed(1)} trimB=${c?.edge.endB.trim.toFixed(1)} feux=${!!c?.controller} | connu du chemin : ${onLaneStops.join(', ') || 'NON'}`);
    } else out.push(`CHOC ${kind}@${(speed * 3.6).toFixed(0)} ${ctx()}`);
  };
  rules.onFault = (f) => { if (process.env.TOUT || f.inf.id === 'bordure' || f.inf.id === 'trottoir' || f.inf.id.startsWith('vitesse')) out.push(`${f.inf.id.toUpperCase()} ${f.detail} ${ctx()} roues=${Array.from(player.car.groundH).map((h) => (h > 0 ? 1 : 0)).join('')}`); };
  const dt = 1 / 60;
  let steer = 0;
  let trace = 0;
  let lastInd = 0, lastP = 0;
  let indOff = 0;
  while (t < 600 && !ap.done && out.length < +(process.env.MAX ?? 40)) {
    if (process.env.TRACE && t > +process.env.TRACE && t < +process.env.TRACE + +(process.env.DUR ?? 12) && trace++ % +(process.env.EVERY ?? 60) === 0) {
      out.push('TRACE ' + ctx());
      if (process.env.VOISINS) {
        const T = traffic as any;
        const pi = rules.playerInfo({ car: player.car, indicator: player.indicator, hazards: false, seatbelt: true, lights: false, handbrake: false, horn: false, lookLeftAt: -99, lookRightAt: -99, lookBackAt: -99, night: false });
        for (const o of traffic.vehicles) {
          const d = Math.hypot(o.x - player.car.x, o.z - player.car.z);
          if (d > +process.env.VOISINS && !(process.env.VEH ?? '').split(',').includes(String(o.id))) continue;
          if (o.link) {
            const why: string[] = [];
            for (const x of o.link.exitCrossings) why.push(`passage en sortie s=${x.s.toFixed(1)} piétonSur=${T.pedestrianOn(x.crossing, o)}`);
            for (const q of T.byLink.get(o.link) ?? []) if (q !== o && q.s > o.s) why.push(`devant sur la liaison : ${q.id} s=${q.s.toFixed(1)} v=${q.v.toFixed(1)}`);
            for (const q of T.byLane.get(o.link.to) ?? []) why.push(`sur la voie d'arrivée : ${q.id} s=${q.s.toFixed(1)} long=${q.length} v=${q.v.toFixed(1)}`);
            for (const c of o.link.conflicts) for (const q of T.byLink.get(c) ?? []) why.push(`conflit : ${q.id} ${c.from.edge.name}→${c.to.edge.name} s=${q.s.toFixed(1)}/${c.line.length.toFixed(1)} v=${q.v.toFixed(1)} dist=${Math.hypot(q.x - o.x, q.z - o.z).toFixed(1)}`);
            out.push('      ' + why.join(' | '));
          }
          const el = o.link ? `liaison ${o.link.turn} ${o.link.from.edge.name}→${o.link.to.edge.name}` : `voie ${o.lane!.edge.name}#${o.lane!.index}${o.next ? ` puis ${o.next.turn}→${o.next.to.edge.name}` : ''}`;
          if (o.lane && o.next) {
            const end = o.lane.endRef, link = o.next;
            const why: string[] = [`ctl=${end.control}${end.controller ? ':' + end.controller.state(end.group, traffic.time) : ''} sommet=${end.vertex.id} branches=${end.vertex.ends.length} ligne=${(o.lane.fromEdgeS(end.sAt(end.stopDist)) - o.s).toFixed(1)}`];
            for (const q of T.byLane.get(link.to) ?? []) if (q.s - q.length < o.length + 2 && q.v < 1.5) why.push(`sortie encombrée par ${q.id} (s=${q.s.toFixed(1)} v=${q.v.toFixed(1)})`);
            for (const c of link.conflicts) {
              for (const q of T.byLink.get(c) ?? []) why.push(`dans le carrefour : ${q.id} ${c.from.edge.name}→${c.to.edge.name} v=${q.v.toFixed(1)}`);
              for (const q of T.byLane.get(c.from) ?? []) if (q.next === c) why.push(`en approche : ${q.id} depuis ${c.from.edge.name} à ${(q.lane.line.length - q.s).toFixed(1)} m v=${q.v.toFixed(1)} attente=${q.waiting.toFixed(0)} prioritaire=${traffic.hasPriorityOver(c.from.endRef, c, end, link, -end.dx, -end.dz)}`);
            }
            why.push(`joueurPrioritaire=${T.playerPriority(pi, end, link, -end.dx, -end.dz)} approcheJoueur=${pi.approach ? pi.approach.vertex.id + '@' + pi.approachDist.toFixed(1) : '-'}`);
            for (const sp of o.lane.stops) why.push(`arrêt ${sp.kind} s=${sp.s.toFixed(1)}${sp.controller ? ':' + sp.controller.state(sp.group ?? 0, traffic.time) : ''}${sp.crossing ? ' piétonSur=' + T.pedestrianOn(sp.crossing, o) : ''}`);
            for (const x of link.exitCrossings) why.push(`passage en sortie s=${x.s.toFixed(1)} piétonSur=${T.pedestrianOn(x.crossing, o)}`);
            out.push('      ' + why.join(' | '));
          }
          out.push(`   véh ${o.id} à ${d.toFixed(1)} m ${el} s=${o.s.toFixed(1)}/${o.path.length.toFixed(1)} v=${o.v.toFixed(1)} a=${o.a.toFixed(1)} attente=${o.waiting.toFixed(0)} écartJoueur=${T.playerGap(o, pi).toFixed(1)} joueurDansCarrefour=${pi.inJunction ? pi.inJunction.id : '-'}`);
        }
        for (const q of traffic.pedestrians) {
          const d = Math.hypot(q.x - player.car.x, q.z - player.car.z);
          if (d < +(process.env.PIETONS ?? process.env.VOISINS)) out.push(`   piéton ${q.id} à ${d.toFixed(1)} m état=${q.state} hasRight=${q.hasRight} attente=${q.waitTime.toFixed(0)} passage=${q.crossing?.edge.name}@${q.crossing?.s.toFixed(0)} feu=${!!q.crossing?.controller} libre=${q.crossing ? T.crossingClear(q.crossing, q, pi) : '-'}`);
        }
      }
    }
    const cmd = ap.update(dt, player.car);
    if (process.env.CLIGNO && cmd.indicator !== lastInd) { out.push(`CLIGNO ${lastInd}→${cmd.indicator} (joueur ${player.indicator}) ${ctx()}`); lastInd = cmd.indicator; }
    if (process.env.CLIGNO && player.indicator !== lastP) { out.push(`CLIGNO-JOUEUR ${lastP}→${player.indicator} t=${t.toFixed(1)}`); lastP = player.indicator; }
    steer += Math.max(-2.2 * dt, Math.min(2.2 * dt, cmd.steer - steer));
    input.steer = steer; input.throttle = cmd.throttle; input.brake = cmd.brake;
    if (cmd.indicator !== player.indicator && cmd.indicator !== 0) player.setIndicator(cmd.indicator);
    // manœuvre terminée et rappel automatique non déclenché : on coupe le clignotant à la main
    indOff = cmd.indicator === 0 && player.indicator !== 0 ? indOff + dt : 0;
    if (indOff > 2.5) player.setIndicator(0);
    player.update(dt, input);
    const ps: PlayerState = { car: player.car, indicator: player.indicator, hazards: false, seatbelt: true, lights: false, handbrake: false, horn: false, lookLeftAt: -99, lookRightAt: -99, lookBackAt: -99, night: false };
    rules.update(dt, ps);
    traffic.update(dt, rules.playerInfo(ps));
    t += dt;
  }
  console.log(out.join('\n'));
});
