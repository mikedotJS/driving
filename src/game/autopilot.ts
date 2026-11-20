// Conducteur automatique respectueux du Code de la route : suit un itinéraire avec la vraie
// physique de la voiture (boîte automatique). Sert aux essais d'endurance — il ne doit commettre
// aucune faute — et à la démonstration par le moniteur.

import type { Car } from '../vehicle/car';
import type { Lane, LaneLink, RoadNet } from '../map/roadnet';
import type { Polyline } from '../map/polyline';
import type { Route } from '../map/route';
import type { Traffic } from '../traffic/traffic';
import { clamp, wrapAngle } from '../core/math';

interface Seg { line: Polyline; lane: Lane | null; link: LaneLink | null; step: number }
export interface AutoCommand { steer: number; throttle: number; brake: number; indicator: -1 | 0 | 1; done: boolean }

const FRONT = 1.85;

export class Autopilot {
  readonly segs: Seg[] = [];
  private k = 0;
  private s = 0;
  private stoppedAt = new Map<Lane, number>();
  private waitTime = 0;
  private yellow = new Map<object, boolean>();
  done = false;
  /** vitesse de croisière en dessous de la limite (km/h) */
  margin = 3;
  debug = '';

  constructor(private net: RoadNet, private traffic: Traffic | null, readonly route: Route) {
    const steps = route.steps;
    let forced: Lane | null = null;
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const lanes = st.dir > 0 ? st.edge.lanesF : st.edge.lanesB;
      if (!lanes.length) break;
      const next = steps[i + 1];
      const links = (l: Lane) => (next ? l.links.filter((x) => x.to.edge === next.edge && x.to.dir === next.dir) : []);
      // voie : celle imposée par la liaison précédente si elle mène à la suite, sinon la plus à droite qui convient
      let lane = forced && (!next || links(forced).length) ? forced : null;
      if (!lane) {
        const order = lanes.slice().reverse();
        lane = (next ? order.find((l) => links(l).length) : order[0]) ?? order[0];
      }
      this.segs.push({ line: lane.line, lane, link: null, step: i });
      forced = null;
      if (next) {
        const ls = links(lane);
        if (!ls.length) break;
        // on vise la voie de droite à l'arrivée
        const link = ls.sort((a, b) => b.to.index - a.to.index)[0];
        this.segs.push({ line: link.line, lane: null, link, step: i });
        forced = link.to;
      }
    }
  }

  /** Abscisse de fin sur le dernier segment. */
  private get endS(): number {
    const last = this.segs[this.segs.length - 1];
    return last && last.lane ? clamp(last.lane.fromEdgeS(last.lane.dir > 0 ? this.route.endS : last.lane.edge.length - this.route.endS), 5, last.line.length - 2) : 0;
  }

  /** Point situé à la distance d devant la position suivie. */
  private ahead(d: number): { x: number; z: number; tx: number; tz: number } {
    let k = this.k, s = this.s + d;
    while (k < this.segs.length - 1 && s > this.segs[k].line.length) { s -= this.segs[k].line.length; k++; }
    return this.segs[k].line.at(Math.min(s, this.segs[k].line.length + 6));
  }

  update(dt: number, car: Car): AutoCommand {
    const cmd: AutoCommand = { steer: 0, throttle: 0, brake: 0, indicator: 0, done: this.done };
    if (!this.segs.length) { this.done = true; cmd.done = true; cmd.brake = 0.5; return cmd; }
    // ── suivi de la position sur le chemin ──
    for (let guard = 0; guard < 4; guard++) {
      const seg = this.segs[this.k];
      const pr = seg.line.project(car.x, car.z);
      this.s = pr.s;
      if (this.k < this.segs.length - 1) {
        const nx = this.segs[this.k + 1].line.project(car.x, car.z);
        const closer = Math.hypot(nx.x - car.x, nx.z - car.z) < Math.hypot(pr.x - car.x, pr.z - car.z) + 0.3;
        const atEnd = pr.s >= seg.line.length - 0.05;
        // segment minuscule (raccord entre deux tronçons) : on passe dès que la suite est entamée
        if ((atEnd && (nx.s > 0.02 || closer)) || (seg.line.length < 2 && nx.s > 0.02 && closer)) { this.k++; continue; }
      }
      break;
    }
    const seg = this.segs[this.k];
    const v = Math.max(0, car.vx);
    const time = this.traffic?.time ?? 0;

    // ── direction : poursuite d'un point visé ──
    // poursuite géométrique depuis l'essieu arrière : il suit le chemin, les roues ne coupent pas les bordures
    const rearB = car.spec.wheelbase - car.spec.cgToFront;
    const rx = car.x - car.forwardX * rearB, rz = car.z - car.forwardZ * rearB;
    const Ld = clamp(3.4 + v * 0.5, 3.6, 11);
    const tgt = this.ahead(Ld - rearB);
    const dx = tgt.x - rx, dz = tgt.z - rz;
    const alpha = wrapAngle(Math.atan2(dx, -dz) - car.heading);
    const delta = Math.atan2(2 * car.spec.wheelbase * Math.sin(alpha), Math.hypot(dx, dz));
    cmd.steer = clamp(delta / ((car.spec.maxSteerDeg * Math.PI) / 180), -1, 1);

    // ── vitesse cible ──
    const edge = seg.lane ? seg.lane.edge : seg.link!.to.edge;
    let vt = Math.max(8, edge.limit - this.margin) / 3.6;
    // virages à venir
    for (let d = -3; d < 34; d += 2.5) {
      const a = this.ahead(d), b = this.ahead(d + 4);
      const kappa = Math.abs(wrapAngle(Math.atan2(b.tx, -b.tz) - Math.atan2(a.tx, -a.tz))) / 4;
      if (kappa > 0.004) {
        const vc = Math.sqrt(1.25 / kappa);
        vt = Math.min(vt, Math.sqrt(vc * vc + 2 * 1.3 * Math.max(0, d - 2)));
      }
    }
    // volant très braqué : on reste au pas (manœuvre)
    if (Math.abs(cmd.steer) > 0.4) vt = Math.min(vt, 3.4 - 1.2 * Math.min(1, (Math.abs(cmd.steer) - 0.4) / 0.5));

    // ── points d'arrêt devant ──
    let stopDist = Infinity;
    let reason = '';
    const stopAt = (d: number, why: string) => { if (d < stopDist) { stopDist = d; reason = why; } };
    let acc = -this.s - FRONT; // distance cumulée jusqu'au début du segment i, depuis l'avant du véhicule
    for (let i = this.k; i < this.segs.length && acc < 75; i++) {
      const sg = this.segs[i];
      if (sg.lane) {
        const lane = sg.lane;
        for (const sp of lane.stops) {
          const d = acc + sp.s;
          if (d < -1.5 || d > 75) continue;
          if (sp.kind === 'signal' && sp.controller) {
            const st = sp.controller.state(sp.group ?? 0, time);
            if (st !== 'yellow') this.yellow.delete(sp);
            if (st === 'red' && d > -0.6) stopAt(d - 0.4, 'feu rouge');
            else if (st === 'yellow') {
              // décision prise une fois pour toutes au passage à l'orange (R412-31) : on s'arrête si c'est
              // possible sans freinage brutal, sinon on passe — et on ne change plus d'avis
              let stop = this.yellow.get(sp);
              if (stop === undefined) { stop = d > v * 1.0 + (v * v) / (2 * 3.2) + 1; this.yellow.set(sp, stop); }
              if (stop && d > -0.6) stopAt(d - 0.4, 'feu orange');
            }
            else if (st === 'green' && d > 0 && d < 45 && sp.controller.timeToChange(sp.group ?? 0, time) < d / Math.max(2, v) - 1.5) vt = Math.min(vt, 6.5); // feu « mûr » : on lève le pied
          } else if (sp.kind === 'stop' && sp.atEnd) {
            const done = this.stoppedAt.get(lane) ?? 0;
            if (done < 1.2) {
              if (d > -0.5) stopAt(Math.max(0, d - 0.5), 'stop');
              if (d < 2.2 && v < 0.15) this.stoppedAt.set(lane, done + dt);
            }
          } else if (sp.kind === 'crossing' && sp.crossing && this.traffic && d > -0.8) {
            const c = sp.crossing;
            let busy = false, near = false;
            for (const p of this.traffic.pedestrians) {
              if (p.crossing !== c) continue;
              if (p.state === 'cross') busy = true;
              // piéton qui attend : on s'arrête ; s'il ne s'engage toujours pas, on repart prudemment
              else if (p.state === 'wait' && p.hasRight && this.waitTime < 7) busy = true;
              else if (p.state === 'approach' || p.state === 'wait') near = true;
            }
            if (busy) stopAt(d - 1.0, 'piéton');
            else if (near && d < 30) vt = Math.min(vt, 5.5);
          }
        }
        // entrée de carrefour
        const nextSeg = this.segs[i + 1];
        if (nextSeg && nextSeg.link) {
          const end = lane.endRef;
          const dLine = acc + lane.fromEdgeS(end.sAt(end.stopDist));
          const dEnd = acc + lane.line.length;
          if (dEnd < 60 && end.vertex.ends.length >= 3) {
            const link = nextSeg.link;
            // on aborde tout carrefour à allure modérée quand on n'a pas un feu vert
            const green = end.control === 'signal' && end.controller && end.controller.state(end.group, time) === 'green';
            if (!green && dLine > -1) vt = Math.min(vt, Math.sqrt(3.3 * 3.3 + 2 * 1.3 * Math.max(0, dLine - 2)));
            if (this.mustYield(lane, link, dLine, v) && dLine > -1.2) stopAt(Math.max(0, dLine - 0.5), 'priorité');
          }
        }
      }
      else if (sg.link && this.traffic) {
        // passages piétons en sortie de carrefour
        for (const x of sg.link.exitCrossings) {
          const d = acc + x.s;
          if (d < -0.8) continue;
          let busy = false;
          for (const p of this.traffic.pedestrians) if (p.crossing === x.crossing && (p.state === 'cross' || (p.state === 'wait' && p.hasRight && this.waitTime < 7))) busy = true;
          if (busy) stopAt(d - 0.6, 'piéton (sortie)');
        }
      }
      // limitation plus basse à venir : on arrive déjà à la bonne vitesse
      if (i > this.k) {
        const lim = Math.max(8, (sg.lane ? sg.lane.edge : sg.link!.to.edge).limit - this.margin) / 3.6;
        if (lim < vt) vt = Math.min(vt, Math.sqrt(lim * lim + 2 * 1.2 * Math.max(0, acc - 4)));
      }
      acc += sg.line.length;
    }
    // fin de l'itinéraire
    if (this.k === this.segs.length - 1) {
      const d = this.endS - this.s;
      stopAt(Math.max(0, d), 'arrivée');
      if (d < 0.8 && v < 0.2) this.done = true;
    }
    // véhicule qui précède, usagers devant
    const gap = this.gapAhead(car);
    if (gap < Infinity) stopAt(Math.max(0, gap - 2.2 - v * 0.9), this.gapWhat);

    if (stopDist < Infinity) vt = Math.min(vt, Math.sqrt(2 * 1.9 * Math.max(0, stopDist - 0.3)));
    if (stopDist < 0.6) vt = 0;
    this.debug = `${reason} vt=${(vt * 3.6).toFixed(0)} stop=${stopDist === Infinity ? '-' : stopDist.toFixed(1)} lim=${edge.limit}`;

    // ── pédales ──
    const err = vt - v;
    let a = clamp(err * 0.9, -6, 1.6);
    if (stopDist < Infinity && v > 0.3) {
      // décélération nécessaire pour s'arrêter au point voulu
      const need = (v * v) / (2 * Math.max(0.4, stopDist));
      if (need > 1.2) a = Math.min(a, -need);
    }
    if (vt === 0 && v < 0.4) { cmd.brake = 0.45; cmd.throttle = 0; }
    else if (a >= 0) { cmd.throttle = clamp(0.1 + a * 0.32 + v * 0.008, 0, 0.8); cmd.brake = 0; }
    else if (a > -0.35) { cmd.throttle = 0; cmd.brake = 0; }
    else { cmd.throttle = 0; cmd.brake = clamp(-a / 9, 0.03, 1); }
    // patience : le compteur ne retombe qu'une fois réellement reparti (sinon la décision de repartir s'annule aussitôt)
    if (v > 1.5 || reason === 'feu rouge' || reason === 'feu orange' || reason === 'stop') this.waitTime = 0; else if (v < 0.3) this.waitTime += dt;

    // ── clignotant ──
    let dist = -this.s;
    for (let i = this.k; i < Math.min(this.segs.length, this.k + 5) && dist < 32; i++) {
      const sg = this.segs[i];
      if (sg.link && sg.link.vertex.ends.length >= 3) {
        // manœuvre presque terminée : on annonce déjà la suivante (carrefours enchaînés)
        const finishing = i === this.k && this.s > sg.line.length * 0.6;
        if (!finishing) {
          const want = this.indicatorFor(sg.link);
          if (want !== 0) { cmd.indicator = want; break; }
          if (i !== this.k) break;
        }
      }
      dist += sg.line.length;
    }
    cmd.done = this.done;
    return cmd;
  }

  /** Clignotant attendu pour une liaison — même mesure que le moniteur : déviation entre la rue quittée et la rue prise. */
  private indicatorFor(link: LaneLink): -1 | 0 | 1 {
    const from = link.from.edge, to = link.to.edge;
    if (from.roundabout && !to.roundabout) return 1;
    if (to.roundabout && !from.roundabout) return 0;
    const inEnd = link.from.endRef, outEnd = link.to.startRef;
    const turn = wrapAngle(outEnd.heading - Math.atan2(-inEnd.dx, inEnd.dz));
    return turn > 0.45 ? 1 : turn < -0.45 ? -1 : 0;
  }

  /** Faut-il céder le passage avant d'emprunter la liaison ? */
  private mustYield(lane: Lane, link: LaneLink, dLine: number, v: number): boolean {
    const tr = this.traffic;
    if (!tr) return false;
    const end = lane.endRef;
    if (end.control === 'signal' && end.controller && end.controller.state(end.group, tr.time) !== 'green') return false;
    const inX = -end.dx, inZ = -end.dz;
    const myEta = Math.max(0, dLine) / Math.max(1.5, v);
    if (myEta > 6) return false;
    for (const o of tr.vehicles) {
      if (o.link) {
        if (o.link.vertex === link.vertex && (link.conflicts.includes(o.link) || o.link.to === link.to)) {
          if (this.waitTime > 20 && o.v < 0.2) continue;
          return true;
        }
        continue;
      }
      if (!o.lane || !o.next || o.lane.to !== link.vertex || o.lane === lane) continue;
      if (!link.conflicts.includes(o.next) && o.next.to !== link.to) continue;
      const oEnd = o.lane.endRef;
      if (oEnd.control === 'signal' && oEnd.controller && oEnd.controller.state(oEnd.group, tr.time) !== 'green') continue;
      if (!tr.hasPriorityOver(oEnd, o.next, end, link, inX, inZ)) continue;
      const od = o.lane.line.length - o.s;
      const eta = od / Math.max(2, o.v);
      if (od < 10 || eta < 4.5) {
        if (this.waitTime > 20 && o.v < 0.2) continue;
        return true;
      }
    }
    return false;
  }

  /** Distance libre devant, le long du chemin (véhicules et piétons sur la chaussée). */
  private gapWhat = '';
  private gapAhead(car: Car): number {
    const tr = this.traffic;
    if (!tr) return Infinity;
    let best = Infinity;
    let what = '';
    const test = (x: number, z: number, radius: number) => {
      const dx = x - car.x, dz = z - car.z;
      if (dx * dx + dz * dz > 45 * 45) return;
      let acc = -this.s - FRONT;
      for (let i = this.k; i < Math.min(this.segs.length, this.k + 3); i++) {
        const L = this.segs[i].line;
        if (x > L.minX - 4 && x < L.maxX + 4 && z > L.minZ - 4 && z < L.maxZ + 4) {
          const pr = L.project(x, z);
          const d = acc + pr.s;
          if (Math.abs(pr.d) < 1.05 + radius && d > -0.5 && pr.s > 0.01 && pr.s < L.length - 0.01 && d - radius < best) { best = d - radius; this.gapWhat = what; }
        }
        acc += L.length;
      }
    };
    what = 'véhicule devant';
    // chaque véhicule est approché par trois disques le long de sa carrosserie
    for (const o of tr.vehicles) {
      const fx = Math.sin(o.heading), fz = -Math.cos(o.heading), r = o.width / 2 + 0.1;
      for (const k of [-0.32, 0, 0.32]) test(o.x + fx * o.length * k, o.z + fz * o.length * k, r);
    }
    what = 'piéton sur la chaussée';
    // piétons : large marge pour ceux qui traversent ; ceux qui attendent sur le trottoir ne comptent que s'ils sont vraiment sur la trajectoire
    for (const p of tr.pedestrians) if (!p.hit) test(p.x, p.z, p.state === 'cross' ? 0.9 : 0.02);
    return best;
  }
}
