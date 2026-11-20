import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNet, type MapFile, type Edge, type EdgeEnd } from '../src/map/roadnet';
import { RulesEngine, type PlayerState, type FaultEvent } from '../src/rules/engine';
import { Car } from '../src/vehicle/car';
import { Traffic } from '../src/traffic/traffic';

const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);
const DT = 1 / 60;

/** Fait rouler une voiture « sur rails » le long d'une voie, à une vitesse donnée par une fonction. */
function drive(opts: {
  edge: Edge; dir: 1 | -1; from: number; to: number;
  speed: (sTravel: number, t: number, rules: RulesEngine) => number;
  indicator?: -1 | 0 | 1; belt?: boolean; traffic?: Traffic | null; startTime?: number; lateral?: number;
}): { faults: FaultEvent[]; rules: RulesEngine } {
  const { edge, dir } = opts;
  const rules = new RulesEngine(net, opts.traffic ?? null);
  if (opts.startTime) rules.time = opts.startTime;
  const car = new Car();
  const lanes = dir > 0 ? edge.lanesF : edge.lanesB;
  const lane = lanes[lanes.length - 1];
  const off = opts.lateral ?? (lane ? lane.off : 0);
  const ps: PlayerState = { car, indicator: opts.indicator ?? 0, hazards: false, seatbelt: opts.belt ?? true, lights: true, handbrake: false, horn: false, lookLeftAt: -99, lookRightAt: -99, lookBackAt: -99, night: false };
  let sT = opts.from, t = 0;
  car.engineRunning = true; car.gear = 2;
  while (sT < opts.to && t < 120) {
    const v = opts.speed(sT, t, rules);
    sT += v * DT; t += DT;
    const es = dir > 0 ? sT : edge.length - sT;
    const p = edge.line.atOffset(es, off);
    // centre de gravité : 1,85 m derrière le pare-chocs avant
    car.x = p.x - p.tx * dir * 1.85; car.z = p.z - p.tz * dir * 1.85;
    car.heading = Math.atan2(p.tx * dir, -p.tz * dir);
    car.vx = v; car.engineOmega = 2000 * Math.PI / 30;
    rules.update(DT, ps);
  }
  return { faults: rules.faults, rules };
}
const ids = (f: FaultEvent[]) => f.map((x) => x.inf.id);

function findEnd(pred: (end: EdgeEnd) => boolean): EdgeEnd {
  for (const e of net.edges) for (const end of [e.endA, e.endB]) if (end.canArrive && e.length > 70 && !e.roundabout && pred(end)) return end;
  throw new Error('aucune branche ne convient');
}
const travel = (end: EdgeEnd) => ({ edge: end.edge, dir: (end.atA ? -1 : 1) as 1 | -1, stopS: end.edge.length - end.stopDist });

describe('moteur de règles', () => {
  it('ne relève rien quand on roule à 28 km/h dans une zone 30', () => {
    const e = net.edges.find((x) => x.limit === 30 && x.length > 150 && !x.oneway && x.crossings.length === 0 && x.endB.control === 'none')!;
    const r = drive({ edge: e, dir: 1, from: e.endA.trim + 5, to: e.length - e.endB.trim - 10, speed: () => 28 / 3.6 });
    expect(ids(r.faults)).toEqual([]);
  });

  it('relève l’excès de vitesse avec le bon barème', () => {
    const e = net.edges.find((x) => x.limit === 30 && x.length > 180 && x.crossings.length === 0)!;
    const dir: 1 | -1 = e.lanesF.length ? 1 : -1;
    const run = (kmh: number) => ids(drive({ edge: e, dir, from: e.endA.trim + 5, to: e.length - 40, speed: () => kmh / 3.6 }).faults);
    expect(run(33)).toContain('vitesse_5');     // < 5 km/h : amende sans retrait de point
    expect(run(44)).toContain('vitesse_20');    // 5 à 19 km/h : 1 point
    expect(run(55)).toContain('vitesse_30');    // 20 à 29 km/h : 2 points
    expect(run(85)).toContain('vitesse_delit'); // 50 km/h et plus : délit
  });

  it('feu rouge : faute si on franchit la ligne au rouge, rien au vert', () => {
    const end = findEnd((x) => x.control === 'signal' && !!x.controller);
    const { edge, dir, stopS } = travel(end);
    const ctl = end.controller!;
    // instants où le feu de cette branche est rouge / vert pendant toute la traversée
    const when = (state: string) => { for (let t = 0; t < ctl.cycle; t += 0.5) { if (ctl.state(end.group, t) === state && ctl.state(end.group, t + 6) === state) return t; } throw new Error('état introuvable'); };
    const from = Math.max(2, stopS - 30), to = stopS + 3;
    const v = (stopS + 3 - from) / 5; // traversée en 5 secondes
    const red = drive({ edge, dir, from, to, speed: () => v, startTime: when('red') });
    expect(ids(red.faults)).toContain('feu_rouge');
    const green = drive({ edge, dir, from, to, speed: () => v, startTime: when('green') });
    expect(ids(green.faults)).not.toContain('feu_rouge');
  });

  it('stop : faute si on ne marque pas l’arrêt, rien si on s’arrête à la ligne', () => {
    const end = findEnd((x) => x.control === 'stop');
    const { edge, dir, stopS } = travel(end);
    const from = Math.max(2, stopS - 30);
    const rolling = drive({ edge, dir, from, to: stopS + 3, speed: () => 4 });
    expect(ids(rolling.faults)).toContain('stop');
    // arrêt complet 1 m avant la ligne pendant 1,5 s, puis redémarrage
    let stopped = 0;
    const proper = drive({ edge, dir, from, to: stopS + 3, speed: (s) => {
      if (s < stopS - 1.2) return Math.max(0.6, Math.min(5, (stopS - 1 - s) * 1.2));
      if (stopped < 1.5) { stopped += DT; return 0; }
      return 2.5;
    } });
    expect(ids(proper.faults)).not.toContain('stop');
  });

  it('sens interdit : faute en remontant une rue à sens unique', () => {
    const e = net.edges.find((x) => x.oneway && x.length > 120 && !x.roundabout && x.lanesF.length === 1 && x.crossings.length === 0)!;
    const r = drive({ edge: e, dir: -1, from: 20, to: 80, speed: () => 5, lateral: 0 });
    expect(ids(r.faults)).toContain('sens_interdit');
  });

  it('ceinture : faute si on roule sans être attaché', () => {
    const e = net.edges.find((x) => x.limit === 30 && x.length > 120 && x.crossings.length === 0)!;
    const dir: 1 | -1 = e.lanesF.length ? 1 : -1;
    const r = drive({ edge: e, dir, from: e.endA.trim + 5, to: e.endA.trim + 45, speed: () => 5, belt: false });
    expect(ids(r.faults)).toContain('ceinture');
  });

  it('piéton : faute si on passe devant un piéton engagé, rien si on s’arrête', () => {
    const e = net.edges.find((x) => !x.oneway && x.limit <= 30 && x.crossings.some((c) => !c.controller && c.s > 45 && c.s < x.length - 25) && x.lanesF.length === 1)!;
    const c = e.crossings.find((k) => !k.controller && k.s > 45 && k.s < e.length - 25)!;
    const mk = () => {
      const tr = new Traffic(net, { vehicles: 0, pedestrians: 0, seed: 1 });
      // piéton qui s'engage depuis le trottoir de droite quand la voiture est encore loin
      const ped = tr.spawnPedestrian(c, 1, true);
      ped.assertive = 1;
      return { tr, ped };
    };
    // 1) on passe sans ralentir
    let a = mk();
    const pass = drive({ edge: e, dir: 1, from: c.s - 40, to: c.s + 6, traffic: a.tr, speed: () => { a.tr.update(DT, null); return 7; } });
    expect(ids(pass.faults)).toContain('pieton');
    // 2) on s'arrête avant le passage tant qu'un piéton traverse
    a = mk();
    const stop = drive({ edge: e, dir: 1, from: c.s - 40, to: c.s + 6, traffic: a.tr, speed: (s) => {
      a.tr.update(DT, null);
      const crossing = a.tr.pedestrians.some((p) => p.crossing === c && (p.state === 'cross' || p.state === 'wait' || p.state === 'approach'));
      const d = c.s - c.halfLen - 1.5 - s;
      if (crossing && d > -0.5) return Math.max(0, Math.min(7, d * 1.5));
      return 5;
    } });
    expect(ids(stop.faults)).not.toContain('pieton');
  });
});
