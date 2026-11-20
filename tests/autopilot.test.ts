import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNet, type MapFile } from '../src/map/roadnet';
import { Ground } from '../src/world/ground';
import { Traffic } from '../src/traffic/traffic';
import { RulesEngine, type PlayerState } from '../src/rules/engine';
import { Player } from '../src/game/player';
import { Autopilot } from '../src/game/autopilot';
import { planLesson, type Theme } from '../src/game/lessons';
import type { InputState, Action } from '../src/input/controls';

const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);
const ground = new Ground(map);

/** Fait conduire le pilote automatique sur un itinéraire de leçon, avec circulation et piétons. */
export function autoDrive(theme: Theme, seed: number, vehicles = 28, maxTime = 600, verbose = false) {
  // même choix que le jeu : la rue de départ du thème dont le parcours se prend le plus proprement
  const { pose, route: planned } = planLesson(net, theme, seed, (r) => { const a = new Autopilot(net, null, r); a.fitToRoad((x, z) => ground.isRoad(x, z)); return a.pathIssues((x, z) => ground.isRoad(x, z), (x, z, fx, fz) => ground.bodyHits(x, z, fx, fz)); })!;
  const route = planned!;
  const traffic = new Traffic(net, { vehicles, pedestrians: 22, seed });
  const rules = new RulesEngine(net, traffic);
  const player = new Player(ground, net, traffic);
  const ap = new Autopilot(net, traffic, route);
  if (!process.env.SANS_AJUSTEMENT) ap.fitToRoad((x, z) => ground.isRoad(x, z));
  // départ sur la voie
  const l0 = ap.segs[0].lane!;
  const s0 = l0.fromEdgeS(pose.s);
  const p = l0.line.at(s0);
  player.car.mode = 'auto';
  player.spawn(p.x, p.z, Math.atan2(p.tx, -p.tz), { running: true, belt: true });
  player.handbrake = false;
  player.car.selector = 'D';
  const input: InputState = { steer: 0, throttle: 0, brake: 0, clutch: 0, pressed: new Set<Action>(), held: new Set<Action>(), hGear: null, device: 'keyboard', deviceName: '', hasClutchPedal: false, steerRate: 0 };
  const collisions: string[] = [];
  player.events.collision = (kind, speed) => { collisions.push(`${kind}@${(speed * 3.6).toFixed(0)}`); rules.report(kind === 'pieton' ? 'collision_pieton' : kind === 'vehicule' ? 'collision_vehicule' : 'collision', player.car); };
  const dt = 1 / 60;
  let t = 0, stuck = 0, maxStuck = 0, lastReason = '';
  const log: string[] = [];
  let steer = 0;
  let indOff = 0;
  while (t < maxTime && !ap.done) {
    const cmd = ap.update(dt, player.car);
    // volant tourné à vitesse humaine
    steer += Math.max(-2.2 * dt, Math.min(2.2 * dt, cmd.steer - steer));
    input.steer = steer; input.throttle = cmd.throttle; input.brake = cmd.brake;
    // marche arrière (ou retour en marche avant) : à l'arrêt seulement
    const want = cmd.reverse ? 'R' : 'D';
    if (player.car.selector !== want) { if (Math.abs(player.car.vx) < 0.25) player.car.selector = want; else { input.throttle = 0; input.brake = 0.6; } }
    if (cmd.indicator !== player.indicator && cmd.indicator !== 0) player.setIndicator(cmd.indicator);
    // manœuvre terminée et rappel automatique non déclenché : on coupe le clignotant à la main
    indOff = cmd.indicator === 0 && player.indicator !== 0 ? indOff + dt : 0;
    if (indOff > 2.5) player.setIndicator(0);
    player.update(dt, input);
    const ps: PlayerState = { car: player.car, indicator: player.indicator, hazards: false, seatbelt: true, lights: false, handbrake: false, horn: false, lookLeftAt: -99, lookRightAt: -99, lookBackAt: -99, night: false };
    rules.update(dt, ps);
    traffic.update(dt, rules.playerInfo(ps));
    t += dt;
    if (player.car.speed < 0.2) { stuck += dt; if (stuck > maxStuck) { maxStuck = stuck; lastReason = ap.debug; } } else stuck = 0;
    if (verbose && Math.round(t / dt) % 600 === 0) log.push(`t=${t.toFixed(0)} v=${player.car.speedKmh.toFixed(0)} ${rules.situation.street} ${ap.debug}`);
  }
  return { done: ap.done, time: t, distance: player.car.odometer, routeLength: route.length, faults: rules.faults.map((f) => `${f.inf.id}${f.detail ? '(' + f.detail + ')' : ''}@${f.street}`), graves: rules.faults.filter((f) => f.inf.severity === 'grave').length, collisions, maxStuck, lastReason, log };
}

describe('pilote automatique : un conducteur respectueux ne commet pas de faute', () => {
  for (const [theme, seed] of [['feux', 42], ['priorite', 42], ['tournants', 7], ['giratoire', 5], ['circulation', 9]] as [Theme, number][]) {
    it(`leçon « ${theme} »`, () => {
      const r = autoDrive(theme, seed);
      console.log(theme, { done: r.done, temps: Math.round(r.time), km: +(r.distance / 1000).toFixed(2), itinéraire: Math.round(r.routeLength), arrêtMax: Math.round(r.maxStuck), raison: r.lastReason, fautes: r.faults, collisions: r.collisions });
      expect(r.done).toBe(true);
      expect(r.graves).toBe(0);
    }, 120000);
  }
});
