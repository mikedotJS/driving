// Moteur de règles : observe la conduite du joueur et relève les manquements au Code de la route.

import type { Car } from '../vehicle/car';
import type { Crossing, Edge, EdgeEnd, Located, RoadNet, SignalController, Strip, Vertex } from '../map/roadnet';
import type { Traffic, Vehicle, Pedestrian, PlayerInfo } from '../traffic/traffic';
import { INFRACTIONS, speedingInfraction, type Infraction, type InfractionId } from './infractions';
import { wrapAngle } from '../core/math';
import { solidLines } from '../world/markings';

export interface PlayerState {
  car: Car;
  indicator: -1 | 0 | 1;
  hazards: boolean;
  seatbelt: boolean;
  lights: boolean;
  handbrake: boolean;
  horn: boolean;
  /** instants (s) des derniers coups d'œil */
  lookLeftAt: number; lookRightAt: number; lookBackAt: number;
  night: boolean;
}

export interface FaultEvent {
  inf: Infraction;
  time: number;
  x: number; z: number;
  street: string;
  detail: string;
  speedKmh: number;
}

/** Situation courante du joueur sur le réseau (sert aussi au guidage et à l'affichage). */
export interface Situation {
  loc: Located | null;
  edge: Edge | null;
  /** sens de parcours de l'arête : +1 = a→b */
  dir: 1 | -1;
  /** abscisse de l'avant du véhicule dans le sens de parcours */
  sFront: number;
  /** décalage latéral dans le sens de parcours (positif = à droite de l'axe) */
  lateral: number;
  limit: number;
  junction: Vertex | null;
  approach: EdgeEnd | null;
  approachDist: number;
  strip: Strip | null;
  wrongWay: boolean;
  /** prochain point réglementé devant : type et distance */
  nextControl: { kind: 'signal' | 'stop' | 'yield' | 'crossing' | 'priorite'; dist: number; state?: string } | null;
  street: string;
}

interface StopRef {
  /** abscisse dans le sens de parcours */
  s: number;
  kind: 'signal' | 'stop' | 'yield' | 'crossing';
  controller?: SignalController; group?: number; crossing?: Crossing;
  atEnd: boolean;
}

const FRONT = 1.85; // distance centre de gravité → pare-chocs avant
const KMH = 3.6;

export class RulesEngine {
  faults: FaultEvent[] = [];
  onFault?: (f: FaultEvent) => void;
  onPraise?: (text: string) => void;
  situation: Situation = { loc: null, edge: null, dir: 1, sFront: 0, lateral: 0, limit: 30, junction: null, approach: null, approachDist: Infinity, strip: null, wrongWay: false, nextControl: null, street: '' };
  /** désactive le relevé (menus, replacement de la voiture) */
  enabled = true;
  time = 0;

  private last = new Map<string, number>();
  private prevEdge: Edge | null = null;
  private prevDir: 1 | -1 = 1;
  private prevSFront = 0;
  private stops: StopRef[] = [];
  // vitesse
  private overTime = 0; private overMax = 0; private overReported = -1;
  private slowTime = 0;
  // feux
  private yellowSeen = new Map<SignalController, { canStop: boolean; t: number }>();
  private sigPrev = new Map<SignalController, string>();
  // stop
  private stopMin = new Map<number, number>();
  // carrefours
  private entry: { vertex: Vertex; end: EdgeEnd; t: number; indL: boolean; indR: boolean; candidates: Vehicle[]; reported: boolean } | null = null;
  private indHist: { t: number; ind: number }[] = [];
  private indOnSince = -1; private indDist = 0;
  // voies
  private leftTime = 0; private busTime = 0; private cycTime = 0; private wrongTime = 0;
  private wrongEdge: Edge | null = null;
  private prevLaneIdx = -1; private prevStripKind = '';
  private prevSide = 0;
  // divers
  private beltTime = 0; private hbTime = 0; private followTime = 0; private hornTime = 0;
  private revTime = 0; private lugTime = 0; private stillOnCrossing = 0;
  private kerbWheels = 0; private kerbTime = 0;
  private pedSeen = new Map<number, { canStop: boolean }>();
  private pedPraised = new Set<number>();
  private pedFaulted = new Set<number>();
  private lightsTime = 0;

  constructor(private net: RoadNet, private traffic: Traffic | null) {
    if (traffic) {
      traffic.onForcedBrake = (v) => this.onForcedBrake(v);
    }
  }

  reset() {
    this.faults = []; this.last.clear(); this.entry = null; this.prevEdge = null;
    this.overTime = 0; this.overMax = 0; this.overReported = -1;
    this.pedSeen.clear(); this.pedPraised.clear(); this.pedFaulted.clear(); this.stopMin.clear();
    this.leftTime = this.busTime = this.cycTime = this.wrongTime = 0;
  }

  /** Relève une faute (avec anti-répétition). */
  report(id: InfractionId, car: Car, detail = ''): boolean {
    if (!this.enabled) return false;
    const inf = INFRACTIONS[id] as Infraction;
    const t = this.time;
    const lastT = this.last.get(id);
    if (lastT !== undefined && t - lastT < inf.cooldown) return false;
    this.last.set(id, t);
    const f: FaultEvent = { inf, time: t, x: car.x, z: car.z, street: this.situation.street, detail, speedKmh: car.speedKmh };
    this.faults.push(f);
    this.onFault?.(f);
    return true;
  }

  /** Informations transmises à la circulation. */
  playerInfo(p: PlayerState): PlayerInfo {
    const c = p.car, s = this.situation;
    return {
      x: c.x, z: c.z, heading: c.heading, speed: c.vx, length: c.spec.length, width: c.spec.width,
      approach: s.approach, approachDist: s.approachDist, inJunction: s.junction,
      left: p.indicator < 0, right: p.indicator > 0,
    };
  }

  // ───────────────────────── mise à jour ─────────────────────────
  update(dt: number, p: PlayerState): Situation {
    this.time += dt;
    const car = p.car;
    const sit = this.locate(car);
    const v = car.vx;            // vitesse longitudinale signée
    const speed = Math.abs(v);
    const kmh = speed * KMH;
    const e = sit.edge;

    this.indHist.push({ t: this.time, ind: p.hazards ? 0 : p.indicator });
    while (this.indHist.length && this.time - this.indHist[0].t > 8) this.indHist.shift();

    // événements moteur
    if (car.stalledFlag) { car.stalledFlag = false; this.report('calage', car); }

    if (e) {
      this.checkSpeed(dt, car, sit, kmh);
      this.checkStops(dt, car, sit, v);
      this.checkLanes(dt, car, sit, p, speed);
      this.checkJunction(dt, car, sit, p);
      this.checkPedestrians(dt, car, sit, speed);
      this.checkFollowing(dt, car, speed);
    }
    this.checkMisc(dt, car, p, speed, kmh, sit);

    this.prevEdge = e; this.prevDir = sit.dir; this.prevSFront = sit.sFront;
    return sit;
  }

  // ───────────────────────── localisation ─────────────────────────
  private locate(car: Car): Situation {
    const s = this.situation;
    const fx = car.forwardX, fz = car.forwardZ;
    const loc = this.net.locate(car.x, car.z, car.heading, s.edge);
    s.loc = loc;
    if (!loc || loc.dist > 6) {
      s.edge = null; s.junction = null; s.approach = null; s.approachDist = Infinity; s.strip = null; s.wrongWay = false; s.nextControl = null;
      return s;
    }
    const e = loc.edge;
    const dir: 1 | -1 = fx * loc.tx + fz * loc.tz >= 0 ? 1 : -1;
    const len = e.length;
    // avant du véhicule
    const pf = e.line.project(car.x + fx * FRONT, car.z + fz * FRONT);
    const sFront = dir > 0 ? pf.s : len - pf.s;
    if (e !== s.edge || dir !== s.dir) this.buildStops(e, dir);
    s.edge = e; s.dir = dir; s.sFront = sFront;
    s.lateral = loc.d * dir;
    s.limit = e.limit;
    s.street = e.name || s.street;
    s.strip = e.stripAt(loc.d);
    s.junction = this.net.junctionAt(loc);
    const end = dir > 0 ? e.endB : e.endA;
    s.approach = end.vertex.ends.length >= 3 ? end : null;
    s.approachDist = Math.max(0, len - end.trim - sFront);
    s.wrongWay = e.oneway && dir < 0;
    // prochain point réglementé
    s.nextControl = null;
    for (const st of this.stops) {
      const d = st.s - sFront;
      if (d < -1) continue;
      if (d > 90) break;
      s.nextControl = { kind: st.kind, dist: d, state: st.controller ? st.controller.state(st.group ?? 0, this.time) : undefined };
      break;
    }
    if (!s.nextControl && s.approach && s.approach.control === 'none' && !end.vertex.roundabout && s.approachDist < 60 && !end.internal) {
      s.nextControl = { kind: 'priorite', dist: s.approachDist };
    }
    return s;
  }

  /** Points d'arrêt de l'arête dans le sens de parcours. */
  private buildStops(e: Edge, dir: 1 | -1) {
    const len = e.length;
    const T = (es: number) => (dir > 0 ? es : len - es);
    const out: StopRef[] = [];
    const end = dir > 0 ? e.endB : e.endA;
    if (end.control !== 'none') out.push({ s: len - end.stopDist, kind: end.control, controller: end.controller ?? undefined, group: end.group, atEnd: true });
    const lanes = dir > 0 ? e.lanesF : e.lanesB;
    const lane = lanes[lanes.length - 1];
    if (lane) {
      for (const st of lane.stops) {
        if (st.atEnd) continue;
        if (st.kind === 'signal') out.push({ s: T(lane.toEdgeS(st.s)), kind: 'signal', controller: st.controller, group: st.group, atEnd: false });
      }
    }
    for (const c of e.crossings) out.push({ s: T(c.s) - c.halfLen, kind: 'crossing', crossing: c, atEnd: false });
    out.sort((a, b) => a.s - b.s);
    this.stops = out;
  }

  // ───────────────────────── vitesse ─────────────────────────
  private checkSpeed(dt: number, car: Car, sit: Situation, kmh: number) {
    const excess = kmh - sit.limit;
    if (excess > 1.5) {
      this.overTime += dt;
      this.overMax = Math.max(this.overMax, excess);
      if (this.overTime > 1.3) {
        const id = speedingInfraction(this.overMax);
        const rank = ['vitesse_5', 'vitesse_20', 'vitesse_30', 'vitesse_40', 'vitesse_50', 'vitesse_delit'].indexOf(id);
        if (rank > this.overReported) {
          this.last.delete(id);
          if (this.report(id, car, `${Math.round(sit.limit + this.overMax)} km/h pour une limite de ${sit.limit} km/h`)) this.overReported = rank;
        }
      }
    } else if (excess < -1) {
      this.overTime = 0; this.overMax = 0; this.overReported = -1;
    }
    // allure anormalement réduite : route dégagée, rien devant
    const free = !sit.nextControl || sit.nextControl.dist > 45;
    if (free && !sit.junction && kmh > 1 && kmh < sit.limit * 0.42 && car.gear > 0 && this.leadGap(car) > 40) {
      this.slowTime += dt;
      if (this.slowTime > 14) { this.report('trop_lent', car, `${Math.round(kmh)} km/h pour une limite de ${sit.limit} km/h`); this.slowTime = 0; }
    } else this.slowTime = Math.max(0, this.slowTime - dt * 2);
  }

  // ───────────────────────── feux, stops ─────────────────────────
  private checkStops(dt: number, car: Car, sit: Situation, v: number) {
    const sameEdge = sit.edge === this.prevEdge && sit.dir === this.prevDir;
    const s0 = this.prevSFront, s1 = sit.sFront;
    const speed = Math.abs(v);
    for (const st of this.stops) {
      const d = st.s - s1;
      if (st.kind === 'signal' && st.controller) {
        const ctl = st.controller;
        const state = ctl.state(st.group ?? 0, this.time);
        // passage au jaune : le conducteur pouvait-il s'arrêter ?
        if (d > 0 && d < 110) {
          const prev = this.sigPrev.get(ctl);
          if (prev === 'green' && state === 'yellow') this.yellowSeen.set(ctl, { canStop: d > speed * 1.0 + (speed * speed) / (2 * 3.4) + 1, t: this.time });
          this.sigPrev.set(ctl, state);
        }
        // franchissement de la ligne (tolérance de 80 cm)
        const line = st.s + 0.8;
        if (sameEdge && v > 0.3 && s0 < line && s1 >= line) {
          if (state === 'red') this.report('feu_rouge', car);
          else if (state === 'yellow') {
            const y = this.yellowSeen.get(ctl);
            if (y && y.canStop) this.report('feu_orange', car);
          }
        }
      } else if (st.kind === 'stop') {
        // vitesse minimale atteinte dans les 9 derniers mètres avant la ligne
        const key = Math.round(st.s * 10) + (sit.edge!.id << 12) * (sit.dir > 0 ? 1 : -1);
        if (d < 9 && d > -1.2) this.stopMin.set(key, Math.min(this.stopMin.get(key) ?? Infinity, speed));
        const line = st.s + 1.2;
        if (sameEdge && v > 0.2 && s0 < line && s1 >= line) {
          const min = this.stopMin.get(key) ?? speed;
          if (min > 0.45) this.report('stop', car, `vitesse minimale ${(min * KMH).toFixed(0)} km/h`);
          this.stopMin.delete(key);
        }
      }
    }
  }

  // ───────────────────────── voies, sens, trottoir ─────────────────────────
  private checkLanes(dt: number, car: Car, sit: Situation, p: PlayerState, speed: number) {
    const e = sit.edge!;
    const loc = sit.loc!;
    const inSection = !sit.junction && loc.s > e.endA.trim + 2 && loc.s < e.length - e.endB.trim - 2;
    const fwd = car.vx > 1.2;

    // sens interdit
    if (sit.wrongWay && fwd && inSection) {
      this.wrongTime += dt;
      if (this.wrongTime > 1.0 && this.wrongEdge !== e) { this.wrongEdge = e; this.report('sens_interdit', car, e.name); this.last.delete('sens_interdit'); }
    } else { this.wrongTime = 0; if (!sit.wrongWay) this.wrongEdge = null; }

    // circulation à gauche / ligne continue (rue à double sens)
    if (!e.oneway && inSection) {
      const axis = e.axisOffset;            // repère de l'arête
      const side = Math.sign((loc.d - axis) * sit.dir); // +1 = côté droit (correct)
      const beyond = (axis - loc.d) * sit.dir;          // > 0 : centre du véhicule au-delà de l'axe
      if (this.prevSide > 0 && side < 0 && fwd) {
        const solids = solidLines.get(e);
        if (solids && solids.some((r) => loc.s >= r.s0 && loc.s <= r.s1) && !this.overtakingSlowUser(car)) this.report('ligne_continue', car);
      }
      this.prevSide = side || this.prevSide;
      if (beyond > 0.35 && fwd) {
        this.leftTime += dt;
        const obstacle = this.obstacleAhead(car);
        if (this.leftTime > (obstacle ? 9 : 2.6)) { this.report('circulation_gauche', car); this.leftTime = 0; }
      } else this.leftTime = Math.max(0, this.leftTime - dt * 2);
    } else { this.leftTime = 0; this.prevSide = 0; }

    // couloir de bus, bande cyclable
    const strip = sit.strip;
    const nearJunction = sit.approachDist < 22;
    if (strip && strip.kind === 'B' && speed > 1 && inSection && !nearJunction) {
      this.busTime += dt;
      if (this.busTime > 1.6) { this.report('voie_bus', car); this.busTime = 0; }
    } else this.busTime = Math.max(0, this.busTime - dt);
    const rightSide = e.stripAt(loc.d + 0.75 * sit.dir);
    if (rightSide && rightSide.kind === 'C' && strip && strip.kind !== 'P' && speed > 2 && inSection && !nearJunction) {
      this.cycTime += dt;
      if (this.cycTime > 2.4) { this.report('bande_cyclable', car); this.cycTime = 0; }
    } else this.cycTime = Math.max(0, this.cycTime - dt);

    // changement de voie / sortie de stationnement sans clignotant
    if (inSection && strip) {
      const lanes = sit.dir > 0 ? e.lanesF : e.lanesB;
      let idx = -1;
      lanes.forEach((l, i) => { if (Math.abs(loc.d - l.off) < l.width / 2 - 0.25) idx = i; });
      if (idx >= 0 && this.prevLaneIdx >= 0 && idx !== this.prevLaneIdx && lanes.length > 1 && speed > 2) {
        const toRight = idx > this.prevLaneIdx;
        if (!this.indicatorWas(toRight ? 1 : -1, 2.5)) this.report('clignotant', car, 'changement de voie');
        else if (!this.looked(p, toRight ? 1 : -1, 5)) this.report('controle', car);
      }
      if (idx >= 0) this.prevLaneIdx = idx;
      if (this.prevStripKind === 'P' && strip.kind === 'L' && speed > 0.8) {
        const toLeft = (strip.off - loc.d) * sit.dir < 0 || true;
        // on quitte le stationnement : clignotant côté chaussée
        const side = e.strips.indexOf(strip) > e.strips.findIndex((s) => s.kind === 'P' && Math.abs(s.off - loc.d) < 4) ? 1 : -1;
        const want = (side * sit.dir) as 1 | -1;
        void toLeft;
        if (!this.indicatorWas(want, 3)) this.report('clignotant', car, 'départ du stationnement');
        else if (!this.looked(p, want, 6)) this.report('controle', car);
      }
      this.prevStripKind = strip.kind;
    } else { this.prevLaneIdx = -1; if (!strip) this.prevStripKind = ''; }

    // trottoir
    let up = 0;
    for (let i = 0; i < 4; i++) if (car.groundH[i] > 0.05) up++;
    if (up > 0 && speed > 0.4) {
      this.kerbTime += dt;
      if (up >= 2 || this.kerbTime > 0.6) this.report('trottoir', car);
      else if (this.kerbWheels === 0) this.report('bordure', car);
    } else this.kerbTime = 0;
    this.kerbWheels = up;
  }

  private indicatorWas(side: 1 | -1, within: number): boolean {
    for (let i = this.indHist.length - 1; i >= 0; i--) {
      const h = this.indHist[i];
      if (this.time - h.t > within) break;
      if (h.ind === side) return true;
    }
    return false;
  }
  private looked(p: PlayerState, side: 1 | -1, within: number): boolean {
    const t = side < 0 ? p.lookLeftAt : p.lookRightAt;
    return this.time - t < within || this.time - p.lookBackAt < within;
  }

  // ───────────────────────── carrefours : clignotant et priorités ─────────────────────────
  private checkJunction(dt: number, car: Car, sit: Situation, p: PlayerState) {
    const e = sit.edge!;
    // entrée dans un carrefour : l'avant franchit l'embouchure
    if (sit.approach && !this.entry && sit.approachDist <= 0.5 && car.vx > 0.3 && sit.edge === this.prevEdge) {
      const end = sit.approach;
      const V = end.vertex;
      const candidates: Vehicle[] = [];
      if (this.traffic) {
        for (const o of this.traffic.vehicles) {
          if (o.link && o.link.vertex === V) { if (this.priorityOverPlayer(o, end)) candidates.push(o); continue; }
          if (!o.lane || o.lane.to !== V || o.lane.endRef === end || !o.next) continue;
          const od = o.lane.line.length - o.s;
          const eta = od / Math.max(1.5, o.v);
          if (o.v > 1.5 && (eta < 2.8 || od < 7) && this.priorityOverPlayer(o, end)) candidates.push(o);
        }
      }
      this.entry = { vertex: V, end, t: this.time, indL: this.indicatorWas(-1, 3.5), indR: this.indicatorWas(1, 3.5), candidates, reported: false };
    }
    const en = this.entry;
    if (!en) return;
    // refus de priorité : un usager prioritaire doit freiner ou passe au ras du pare-chocs
    if (!en.reported && en.candidates.length) {
      for (const o of en.candidates) {
        if (!o.alive) continue;
        const d = Math.hypot(o.x - car.x, o.z - car.z);
        if (o.forcedByPlayer > 0.2 || (d < 5.5 && o.v > 1 && this.closing(car, o))) {
          en.reported = true;
          this.reportPriority(car, en.end);
          break;
        }
      }
    }
    // sortie du carrefour : on est sur une autre arête, au-delà de l'embouchure
    const leftJunction = e !== en.end.edge && !sit.junction;
    const backOut = e === en.end.edge && sit.approachDist > 6 && !sit.junction;
    if (leftJunction) {
      const V = en.vertex;
      const outEnd = e.a === V ? e.endA : e.b === V ? e.endB : null;
      if (outEnd && V.ends.length >= 3) {
        const inHeading = Math.atan2(-en.end.dx, en.end.dz);
        const turn = wrapAngle(outEnd.heading - inHeading); // > 0 : à droite
        const exitRing = en.end.edge.roundabout && !e.roundabout;
        const enterRing = !en.end.edge.roundabout && e.roundabout;
        // suit-on simplement la rue principale (même nom, déviation modérée) ?
        const sameStreet = e.name && e.name === en.end.edge.name && Math.abs(turn) < 0.9;
        if (exitRing) {
          if (!en.indR && !this.indicatorWas(1, 4)) this.report('clignotant', car, 'sortie du giratoire');
        } else if (!enterRing && Math.abs(turn) > 0.6 && !sameStreet) {
          const want = turn > 0 ? 1 : -1;
          const ok = want > 0 ? en.indR : en.indL;
          if (!ok) this.report('clignotant', car, turn > 0 ? 'en tournant à droite' : 'en tournant à gauche');
        }
      }
      this.entry = null;
    } else if (backOut || this.time - en.t > 40) this.entry = null;
  }

  private closing(car: Car, o: Vehicle): boolean {
    const rx = car.x - o.x, rz = car.z - o.z;
    return rx * Math.sin(o.heading) - rz * Math.cos(o.heading) > 0; // le joueur est devant lui
  }

  /** Le véhicule `o` est-il prioritaire sur le joueur arrivant par `end` ? */
  private priorityOverPlayer(o: Vehicle, end: EdgeEnd): boolean {
    const oEnd = o.link ? o.link.from.endRef : o.lane!.endRef;
    if (oEnd === end) return false;
    const rank = { none: 2, signal: 2, yield: 1, stop: 0 } as const;
    const mine = rank[end.control], theirs = rank[oEnd.control];
    if (oEnd.control === 'signal' && oEnd.controller && !o.link && oEnd.controller.state(oEnd.group, this.time) !== 'green') return false;
    if (theirs > mine) return true;
    if (theirs < mine) return false;
    if (end.control === 'signal') {
      // au vert : le joueur qui tourne à gauche doit céder à ceux d'en face
      const facing = -end.dx * -oEnd.dx + -end.dz * -oEnd.dz < -0.6;
      const link = o.link ?? o.next;
      return facing && !!link && link.turn !== 'left';
    }
    if (oEnd.edge.roundabout && !end.edge.roundabout) return true;
    if (end.edge.roundabout && !oEnd.edge.roundabout) return false;
    const cross = -end.dx * -oEnd.dz - -end.dz * -oEnd.dx;
    return cross < -0.35;
  }

  private reportPriority(car: Car, end: EdgeEnd) {
    if (end.vertex.roundabout && !end.edge.roundabout) this.report('giratoire', car);
    else if (end.control === 'stop' || end.control === 'yield') this.report('cedez', car);
    else if (end.control === 'signal') this.report('priorite_feu', car);
    else this.report('priorite_droite', car);
  }

  private onForcedBrake(o: Vehicle) {
    const s = this.situation;
    const end = this.entry?.end ?? (s.approachDist < 4 ? s.approach : null);
    if (!end || !this.enabled) return;
    if (this.entry && this.entry.reported) return;
    const here = o.link ? o.link.vertex === end.vertex : o.lane?.to === end.vertex;
    if (!here || !this.priorityOverPlayer(o, end)) return;
    if (this.entry) this.entry.reported = true;
    // la voiture du joueur n'est pas connue ici : on la retrouve via la dernière situation
    if (this.lastCar) this.reportPriority(this.lastCar, end);
  }
  private lastCar: Car | null = null;

  // ───────────────────────── piétons ─────────────────────────
  private checkPedestrians(dt: number, car: Car, sit: Situation, speed: number) {
    this.lastCar = car;
    if (!this.traffic) return;
    const sameEdge = sit.edge === this.prevEdge && sit.dir === this.prevDir;
    const s0 = this.prevSFront, s1 = sit.sFront;
    const e = sit.edge!;
    for (const st of this.stops) {
      if (st.kind !== 'crossing' || !st.crossing) continue;
      const c = st.crossing;
      const d = st.s - s1;
      if (d > 70 || d < -c.halfLen * 2 - 6) continue;
      for (const ped of this.traffic.pedestrians) {
        if (ped.crossing !== c || !ped.hasRight) continue;
        if (ped.state === 'wait' && ped.waitTime > 0.6 && !this.pedSeen.has(ped.id)) {
          // le piéton manifeste son intention : le conducteur avait-il la distance pour s'arrêter ?
          this.pedSeen.set(ped.id, { canStop: d > speed * 1.2 + (speed * speed) / (2 * 3.2) + 2 });
        }
        if (ped.state === 'cross' && !this.pedSeen.has(ped.id)) {
          this.pedSeen.set(ped.id, { canStop: d > speed * 1.0 + (speed * speed) / (2 * 4.5) + 1 });
        }
        // félicitations : arrêt pour laisser traverser
        if (ped.state === 'cross' && d > 0.2 && d < 14 && speed < 0.6 && !this.pedPraised.has(ped.id)) {
          this.pedPraised.add(ped.id);
          this.onPraise?.('Bien : vous laissez traverser le piéton.');
        }
      }
      // le véhicule s'engage sur le passage
      const line = st.s + 0.3;
      if (sameEdge && car.vx > 0.8 && s0 < line && s1 >= line) {
        for (const ped of this.traffic.pedestrians) {
          if (ped.crossing !== c || !ped.hasRight || this.pedFaulted.has(ped.id)) continue;
          const seen = this.pedSeen.get(ped.id);
          if (!seen || !seen.canStop) continue;
          let refuse = false;
          if (ped.state === 'cross') {
            // le piéton est-il encore devant notre trajectoire (pas déjà passé) ?
            const lat = this.lateralOf(e, ped, sit.dir); // position latérale du piéton, sens de parcours
            const mine = sit.lateral;
            const heading = Math.sin(ped.heading) * -sit.loc!.tz * sit.dir + -Math.cos(ped.heading) * sit.loc!.tx * sit.dir; // > 0 : marche vers la droite
            const ahead = heading > 0 ? lat < mine + 1.6 : lat > mine - 1.6;
            refuse = ahead && Math.abs(lat - mine) < 5.5;
          } else if (ped.state === 'wait') {
            refuse = ped.waitTime > 1.0 && speed > 2.2;
          }
          if (refuse) { this.pedFaulted.add(ped.id); this.report('pieton', car); break; }
        }
      }
      // arrêt prolongé sur le passage
      if (d < -0.5 && d > -(c.halfLen * 2 + 3.3) && speed < 0.2) {
        this.stillOnCrossing += dt;
        if (this.stillOnCrossing > 3.5) { this.report('arret_passage', car); this.stillOnCrossing = 0; }
      }
    }
    if (speed > 0.5) this.stillOnCrossing = 0;
  }

  private lateralOf(e: Edge, ped: Pedestrian, dir: number): number {
    return e.line.project(ped.x, ped.z).d * dir;
  }

  // ───────────────────────── distances ─────────────────────────
  /** Écart (m) avec le véhicule qui précède dans le couloir du joueur, sinon ∞. */
  leadGap(car: Car): number {
    if (!this.traffic) return Infinity;
    const fx = car.forwardX, fz = car.forwardZ;
    let best = Infinity;
    for (const o of this.traffic.vehicles) {
      const rx = o.x - car.x, rz = o.z - car.z;
      const ahead = rx * fx + rz * fz;
      if (ahead < 1 || ahead > 60) continue;
      const lat = Math.abs(rx * -fz + rz * fx);
      if (lat > 1.5) continue;
      // même sens seulement
      if (Math.sin(o.heading) * fx - Math.cos(o.heading) * fz < 0.5) continue;
      best = Math.min(best, ahead - o.length / 2 - FRONT);
    }
    return best;
  }
  private obstacleAhead(car: Car): boolean {
    if (!this.traffic) return false;
    const fx = car.forwardX, fz = car.forwardZ;
    for (const o of this.traffic.vehicles) {
      const rx = o.x - car.x, rz = o.z - car.z;
      const ahead = rx * fx + rz * fz;
      if (ahead < -6 || ahead > 22) continue;
      const lat = rx * -fz + rz * fx;
      if (lat > 0.5 && lat < 4.5 && o.v < 3) return true;
    }
    return false;
  }
  private overtakingSlowUser(car: Car): boolean { return this.obstacleAhead(car); }

  private checkFollowing(dt: number, car: Car, speed: number) {
    if (speed < 6) { this.followTime = 0; return; }
    const gap = this.leadGap(car);
    if (gap / speed < 1.0) {
      this.followTime += dt;
      if (this.followTime > 2.2) { this.report('distance', car, `${(gap / speed).toFixed(1)} s d’intervalle`); this.followTime = 0; }
    } else this.followTime = Math.max(0, this.followTime - dt);
  }

  // ───────────────────────── divers ─────────────────────────
  private checkMisc(dt: number, car: Car, p: PlayerState, speed: number, kmh: number, sit: Situation) {
    if (!p.seatbelt && kmh > 4) { this.beltTime += dt; if (this.beltTime > 1.2) { this.report('ceinture', car); this.beltTime = 0; } } else this.beltTime = 0;
    if (p.handbrake && kmh > 6 && car.throttleEff > 0.15) { this.hbTime += dt; if (this.hbTime > 1.5) { this.report('frein_main', car); this.hbTime = 0; } } else this.hbTime = 0;
    if (p.night && !p.lights && kmh > 5) { this.lightsTime += dt; if (this.lightsTime > 3) { this.report('feux', car); this.lightsTime = 0; } } else this.lightsTime = 0;
    if (p.horn) { this.hornTime += dt; if (this.hornTime > 0.05 && this.hornTime - dt <= 0.05 && !this.danger(car)) this.report('klaxon', car); } else this.hornTime = 0;
    // régime moteur
    if (car.engineRunning && car.gear > 0 && car.clutchPedal < 0.3) {
      const top = car.gear >= car.spec.gears.length;
      if (car.rpm > 3600 && !top && car.throttleEff > 0.12 && kmh < 70) { this.revTime += dt; if (this.revTime > 4.5) { this.report('surregime', car, `${Math.round(car.rpm / 100) * 100} tr/min en ${car.gear}${car.gear === 1 ? 're' : 'e'}`); this.revTime = 0; } }
      else this.revTime = Math.max(0, this.revTime - dt);
      if (car.rpm < 1050 && car.gear > 1 && car.throttleEff > 0.35 && car.mode === 'manual') { this.lugTime += dt; if (this.lugTime > 2) { this.report('sousregime', car); this.lugTime = 0; } }
      else this.lugTime = Math.max(0, this.lugTime - dt);
    }
    // clignotant oublié
    const ind = p.hazards ? 0 : p.indicator;
    if (ind !== 0 && !sit.junction) {
      if (this.indOnSince < 0) { this.indOnSince = this.time; this.indDist = 0; }
      this.indDist += speed * dt;
      const approaching = sit.approachDist < 60;
      if (this.indDist > 130 && this.time - this.indOnSince > 10 && !approaching) { this.report('clignotant_oublie', car); this.indOnSince = this.time; this.indDist = 0; }
    } else this.indOnSince = -1;
  }

  private danger(car: Car): boolean {
    if (!this.traffic) return false;
    for (const o of this.traffic.vehicles) if (Math.hypot(o.x - car.x, o.z - car.z) < 9) return true;
    for (const o of this.traffic.pedestrians) if (Math.hypot(o.x - car.x, o.z - car.z) < 8 && o.state === 'cross') return true;
    return false;
  }
}
