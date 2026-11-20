// Conducteur automatique respectueux du Code de la route : suit un itinéraire avec la vraie
// physique de la voiture (boîte automatique). Sert aux essais d'endurance — il ne doit commettre
// aucune faute — et à la démonstration par le moniteur.

import type { Car } from '../vehicle/car';
import type { Edge, EdgeEnd, Lane, LaneLink, RoadNet } from '../map/roadnet';
import { Polyline, bezierLink } from '../map/polyline';
import type { Route } from '../map/route';
import type { Traffic } from '../traffic/traffic';
import { clamp, wrapAngle } from '../core/math';

/** `offset` : abscisse du début du segment sur la voie quand il n'en couvre que la fin (après un changement de file) */
interface Seg { line: Polyline; lane: Lane | null; link: LaneLink | null; step: number; offset?: number; change?: { edge: Edge; side: -1 | 1 } }
export interface AutoCommand { steer: number; throttle: number; brake: number; indicator: -1 | 0 | 1; done: boolean; /** marche arrière demandée (pour dégager un carrefour) */ reverse: boolean }

const FRONT = 1.85;

export class Autopilot {
  readonly segs: Seg[] = [];
  private k = 0;
  private s = 0;
  private stoppedAt = new Map<Lane, number>();
  private waitTime = 0;
  /** recul en cours pour dégager un carrefour : distance restante (m) */
  private backing = 0;
  private backCooldown = 0;
  private lastSteer = 0;
  private yellow = new Map<object, boolean>();
  done = false;
  /** changements de file en section courante prévus sur l'itinéraire */
  laneChanges = 0;
  /** vitesse de croisière en dessous de la limite (km/h) */
  margin = 3;
  debug = '';

  constructor(private net: RoadNet, private traffic: Traffic | null, readonly route: Route) {
    const steps = route.steps;
    let forced: Lane | null = null;
    const lanesOf = (i: number) => (steps[i].dir > 0 ? steps[i].edge.lanesF : steps[i].edge.lanesB);
    /** liaisons de la voie `l` (étape i) vers l'étape i+1 */
    const linksAt = (l: Lane, i: number) => (steps[i + 1] ? l.links.filter((x) => x.to.edge === steps[i + 1].edge && x.to.dir === steps[i + 1].dir) : []);
    /** la voie d'arrivée permet-elle de poursuivre vers l'étape suivante sans changer de file ? */
    const continues = (k: LaneLink, i: number) => !steps[i + 2] || linksAt(k.to, i + 1).length > 0;
    for (let i = 0; i < steps.length; i++) {
      const lanes = lanesOf(i);
      if (!lanes.length) break;
      const next = steps[i + 1];
      // voie : celle imposée par la liaison précédente si elle mène à la suite ; sinon la plus à droite
      // qui convient, de préférence une file qui évite un changement de voie au tronçon suivant
      let lane = forced && (!next || linksAt(forced, i).length) ? forced : null;
      if (!lane) {
        const order = lanes.slice().reverse();
        lane = (next ? order.find((l) => linksAt(l, i).some((k) => continues(k, i))) ?? order.find((l) => linksAt(l, i).length) : order[0]) ?? order[0];
        // changement de file en section courante : raccord progressif plutôt qu'un saut latéral
        if (forced && forced !== lane && forced.edge === lane.edge) {
          const L = forced.line.length, s0 = Math.min(6, L * 0.2), s1 = Math.min(L * 0.75, s0 + 32);
          const a = forced.line.at(s0), bEnd = lane.line.at(Math.min(lane.line.length, s1));
          const pts: number[] = [];
          for (let q = 0; q <= s0; q += 2) { const p = forced.line.at(q); pts.push(p.x, p.z); }
          const bz = bezierLink(a.x, a.z, a.tx, a.tz, bEnd.x, bEnd.z, bEnd.tx, bEnd.tz, 1.5);
          for (let q = 0; q < bz.n; q++) pts.push(bz.pts[q * 2], bz.pts[q * 2 + 1]);
          this.segs.push({ line: new Polyline(pts), lane: null, link: null, step: i, change: { edge: lane.edge, side: lane.index > forced.index ? 1 : -1 } });
          this.segs.push({ line: lane.line.slice(Math.min(lane.line.length, s1), lane.line.length), lane, link: null, step: i, offset: Math.min(lane.line.length, s1) });
          this.laneChanges++;
          forced = null;
          if (next) {
            const ls = linksAt(lane, i);
            if (!ls.length) break;
            const link = ls.sort((p, q) => +continues(q, i) - +continues(p, i) || q.to.index - p.to.index)[0];
            this.segs.push({ line: link.line, lane: null, link, step: i });
            forced = link.to;
          }
          continue;
        }
      }
      this.segs.push({ line: lane.line, lane, link: null, step: i });
      forced = null;
      if (next) {
        const ls = linksAt(lane, i);
        if (!ls.length) break;
        // on vise une voie d'arrivée d'où l'on pourra poursuivre, la plus à droite possible
        const link = ls.sort((p, q) => +continues(q, i) - +continues(p, i) || q.to.index - p.to.index)[0];
        this.segs.push({ line: link.line, lane: null, link, step: i });
        forced = link.to;
      }
    }
  }

  /**
   * Ajuste la trajectoire à l'emprise réelle de la chaussée : aux abords des carrefours, le chemin est
   * décalé latéralement jusqu'à ce que les quatre roues (essieu arrière sur le chemin, avant déporté
   * par l'empattement) restent sur la chaussée avec une marge — comme un conducteur qui élargit
   * son virage. `isRoad` vient du terrain (Ground).
   */
  fitToRoad(isRoad: (x: number, z: number) => boolean, wheelbase = 2.583, halfTrack = 0.75) {
    const STEP = 1, ZONE = 14, MARGIN = 0.32, SIDE = halfTrack + 0.11 + MARGIN;
    interface Sample { x: number; z: number; nx: number; nz: number; o: number; active: boolean; seg: number }
    const P: Sample[] = [];
    const bounds: [number, number][] = [];
    for (let k = 0; k < this.segs.length; k++) {
      const sg = this.segs[k], L = sg.line.length;
      const n = Math.max(1, Math.round(L / STEP));
      const nearStart = k > 0 && !this.segs[k - 1].lane, nearEnd = k < this.segs.length - 1 && !this.segs[k + 1].lane;
      const i0 = P.length;
      for (let q = 0; q <= n; q++) {
        const sAt = (L * q) / n, p = sg.line.at(sAt);
        const active = !sg.lane || (nearStart && sAt < ZONE) || (nearEnd && sAt > L - ZONE);
        P.push({ x: p.x, z: p.z, nx: -p.tz, nz: p.tx, o: 0, active, seg: k });
      }
      bounds.push([i0, P.length - 1]);
    }
    const N = P.length;
    const qx = new Float64Array(N), qz = new Float64Array(N), hx = new Float64Array(N), hz = new Float64Array(N);
    let changed = false;
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < N; i++) { qx[i] = P[i].x + P[i].nx * P[i].o; qz[i] = P[i].z + P[i].nz * P[i].o; }
      for (let i = 0; i < N; i++) {
        const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
        const dx = qx[b] - qx[a], dz = qz[b] - qz[a], l = Math.hypot(dx, dz) || 1;
        hx[i] = dx / l; hz[i] = dz / l;
      }
      const push = new Float64Array(N);
      let bad = 0;
      for (let i = 0; i < N; i++) {
        if (!P[i].active) continue;
        const rx = -hz[i], rz = hx[i]; // droite du véhicule
        for (const [ahead, weight] of [[0, 1], [wheelbase, 1]] as const) {
          const cx = qx[i] + hx[i] * ahead, cz = qz[i] + hz[i] * ahead;
          const right = !isRoad(cx + rx * SIDE, cz + rz * SIDE), left = !isRoad(cx - rx * SIDE, cz - rz * SIDE);
          if (right === left) continue; // tout va bien, ou rue trop étroite pour décider
          bad++;
          const dir = right ? -1 : 1; // roue droite dehors : on se décale à gauche
          // l'essieu avant se trouve en avance sur le chemin : on agit aussi un peu plus loin
          const centre = i + Math.round(ahead * 0.6 / STEP);
          for (let j = centre - 4; j <= centre + 4; j++) if (j >= 0 && j < N && P[j].active) push[j] += dir * weight * (1 - Math.abs(j - centre) / 5);
        }
      }
      if (!bad) break;
      changed = true;
      for (let i = 0; i < N; i++) if (push[i]) P[i].o = clamp(P[i].o + clamp(push[i], -1, 1) * 0.1, -1.5, 1.5);
      // lissage (les décalages restent nuls hors des zones actives)
      const o2 = new Float64Array(N);
      for (let i = 0; i < N; i++) o2[i] = P[i].active ? ((P[i - 1]?.o ?? P[i].o) + 2 * P[i].o + (P[i + 1]?.o ?? P[i].o)) / 4 : 0;
      for (let i = 0; i < N; i++) P[i].o = o2[i];
    }
    if (!changed) return;
    for (let k = 0; k < this.segs.length; k++) {
      const [i0, i1] = bounds[k];
      let moved = false;
      for (let i = i0; i <= i1; i++) if (Math.abs(P[i].o) > 0.02) { moved = true; break; }
      if (!moved) continue;
      const pts: number[] = [];
      for (let i = i0; i <= i1; i++) pts.push(P[i].x + P[i].nx * P[i].o, P[i].z + P[i].nz * P[i].o);
      this.segs[k].line = new Polyline(pts);
      this.fitted++;
    }
  }
  /** nombre de segments dont la trajectoire a été ajustée à la chaussée */
  fitted = 0;

  /** Abscisse de fin sur le dernier segment. */
  private get endS(): number {
    const last = this.segs[this.segs.length - 1];
    return last && last.lane ? clamp(last.lane.fromEdgeS(last.lane.dir > 0 ? this.route.endS : last.lane.edge.length - this.route.endS) - (last.offset ?? 0), 5, last.line.length - 2) : 0;
  }

  /** Point situé à la distance d devant la position suivie. */
  private ahead(d: number): { x: number; z: number; tx: number; tz: number } {
    let k = this.k, s = this.s + d;
    while (k < this.segs.length - 1 && s > this.segs[k].line.length) { s -= this.segs[k].line.length; k++; }
    return this.segs[k].line.at(Math.min(s, this.segs[k].line.length + 6));
  }

  update(dt: number, car: Car): AutoCommand {
    const cmd: AutoCommand = { steer: 0, throttle: 0, brake: 0, indicator: 0, done: this.done, reverse: false };
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
    const edgeOf = (g: Seg): Edge => (g.lane ? g.lane.edge : g.link ? g.link.to.edge : g.change!.edge);
    const edge = edgeOf(seg);
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
    const gap = this.gapAhead(car);
    let acc = -this.s - FRONT; // distance cumulée jusqu'au début du segment i, depuis l'avant du véhicule
    for (let i = this.k; i < this.segs.length && acc < 75; i++) {
      const sg = this.segs[i];
      if (sg.lane) {
        const lane = sg.lane;
        const off = sg.offset ?? 0;
        for (const sp of lane.stops) {
          const d = acc + sp.s - off;
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
          const dLine = acc + lane.fromEdgeS(end.sAt(end.stopDist)) - off;
          const dEnd = acc + sg.line.length;
          if (dEnd < 60 && end.vertex.ends.length >= 3) {
            const link = nextSeg.link;
            // on aborde tout carrefour à allure modérée quand on n'a pas un feu vert
            const green = end.control === 'signal' && end.controller && end.controller.state(end.group, time) === 'green';
            if (!green && dLine > -1) vt = Math.min(vt, Math.sqrt(3.3 * 3.3 + 2 * 1.3 * Math.max(0, dLine - 2)));
            // ligne déjà franchie (ligne reculée) : on peut encore s'arrêter à l'embouchure du carrefour
            const dHold = dLine > -1.2 ? dLine - 0.5 : dEnd - 0.8;
            if (dHold > -1.0 && this.mustYield(lane, link, Math.max(0, dHold), v)) stopAt(Math.max(0, dHold), 'priorité');
            // R415-2 : on ne s'engage pas si l'on risque de rester immobilisé dans le carrefour
            else if (dHold > -1.0 && this.gapSlow && this.waitTime < 45 && gap < dEnd + link.line.length + 5.5) stopAt(Math.max(0, dHold), 'carrefour encombré');
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
        const lim = Math.max(8, edgeOf(sg).limit - this.margin) / 3.6;
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
    if (gap < Infinity) stopAt(Math.max(0, gap - 2.2 - v * 0.9), this.gapWhat);
    // anticipation : un véhicule en mouvement dont la trajectoire va couper la nôtre au moment où nous
    // y serons (carrefours complexes, où les priorités par branche ne suffisent pas)
    const cross = this.crossingAhead(car, v);
    if (cross < Infinity) stopAt(Math.max(0, cross - 3.5), 'trajectoire croisée');

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

    // ── face-à-face dans un carrefour : on recule de quelques mètres pour libérer le passage ──
    this.backCooldown = Math.max(0, this.backCooldown - dt);
    if (this.backing <= 0 && this.backCooldown <= 0 && this.waitTime > 12 && reason === 'véhicule devant' && stopDist < 1.5 && seg.link && this.s < 7 && this.k > 0 && this.rearClear(car)) {
      this.backing = Math.min(3.4, this.s + 2.4);
    }
    if (this.backing > 0) {
      cmd.reverse = true;
      cmd.steer = this.lastSteer; // même braquage : on revient sur ses traces
      if (car.vx > 0.2 || !this.rearClear(car)) { cmd.throttle = 0; cmd.brake = 0.5; if (!this.rearClear(car)) this.backing = 0; }
      else { cmd.throttle = car.vx > -1.2 ? 0.22 : 0; cmd.brake = 0; this.backing -= Math.abs(Math.min(0, car.vx)) * dt; }
      if (this.backing <= 0) { this.backing = 0; this.backCooldown = 25; this.waitTime = 0; cmd.reverse = false; cmd.throttle = 0; cmd.brake = 0.6; }
      cmd.indicator = 0;
      this.debug = `recul vt=0 stop=- lim=${edge.limit}`;
      cmd.done = this.done;
      return cmd;
    }
    this.lastSteer = cmd.steer;

    // ── clignotant ──
    let dist = -this.s;
    for (let i = this.k; i < Math.min(this.segs.length, this.k + 5) && dist < 32; i++) {
      const sg = this.segs[i];
      if (sg.change) { cmd.indicator = sg.change.side; break; }
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
    // cyclistes qui vont traverser notre trajectoire dans ce carrefour : on les laisse toujours passer
    for (const b of tr.cyclists) {
      if (b.hit || this.waitTime > 25) continue;
      let ax: number, az: number, bx: number, bz: number;
      if (b.conn) { const p0 = b.conn.at(b.s), p1 = b.conn.at(b.conn.length); ax = p0.x; az = p0.z; bx = p1.x; bz = p1.z; }
      else {
        if (!b.nextLane || b.lane.endRef.vertex !== link.vertex || b.lane.line.length - b.s > 22 || b.v < 0.3) continue;
        const p0 = b.lane.line.at(b.s), p1 = b.nextLane.line.at(0);
        ax = p0.x; az = p0.z; bx = p1.x; bz = p1.z;
      }
      if (Math.hypot(ax - link.line.pts[0], az - link.line.pts[1]) > 45) continue;
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len));
      for (let q = 0; q <= n; q++) {
        const pr = link.line.project(ax + ((bx - ax) * q) / n, az + ((bz - az) * q) / n);
        if (Math.abs(pr.d) < 1.8 && pr.s > 0.1 && pr.s < link.line.length - 0.1) return true;
      }
    }
    // créneau nécessaire : le temps de dégager le carrefour (plus long pour un tourne-à-gauche)
    const need = clamp(link.line.length / 3.2 + 2.5, 4.5, 8.5);
    // Vue d'ensemble, comme un conducteur qui regarde au loin : tout véhicule qui fonce vers le carrefour
    // par une branche prioritaire et peut l'atteindre avant que nous l'ayons dégagé nous fait attendre,
    // même s'il est encore deux tronçons plus haut.
    const V = link.vertex;
    for (const o of tr.vehicles) {
      if (o.v < 2.5) continue;
      const dx = V.x - o.x, dz = V.z - o.z, dist = Math.hypot(dx, dz);
      if (dist < 6 || dist > o.v * (need + 1.5) + 8) continue;
      const hx = Math.sin(o.heading), hz = -Math.cos(o.heading);
      if ((dx * hx + dz * hz) / dist < 0.8) continue; // ne se dirige pas vers le carrefour
      // branche par laquelle il arrivera : celle dont le sens d'arrivée correspond à son cap
      let oEnd: EdgeEnd | null = null, best = 0.8;
      for (const e of V.ends) { const d = -e.dx * hx + -e.dz * hz; if (d > best && e.canArrive) { best = d; oEnd = e; } }
      if (!oEnd || oEnd === end) continue;
      // il doit vraiment être dans l'axe de cette branche (et non dans une rue parallèle)
      const lat = Math.abs((o.x - V.x) * -oEnd.dz + (o.z - V.z) * oEnd.dx);
      if (lat > oEnd.edge.half + 2) continue;
      if (oEnd.control === 'signal' && oEnd.controller && oEnd.controller.state(oEnd.group, tr.time) !== 'green') continue;
      if (tr.hasPriorityOver(oEnd, null, end, link, inX, inZ)) return true;
    }
    for (const o of tr.vehicles) {
      if (o.link) {
        if (o.link.vertex === link.vertex && (this.inConflict(link, o.link))) {
          if (this.waitTime > 20 && o.v < 0.2) continue;
          return true;
        }
        // véhicule encore dans le carrefour précédent, qui débouche sur le nôtre par un tronçon court
        const via = o.link.to;
        if (via.to === link.vertex && via !== lane && via.line.length < 40 && via.links.some((l) => this.inConflict(link, l))) {
          const oEnd = via.endRef;
          if (oEnd.control === 'signal' && oEnd.controller && oEnd.controller.state(oEnd.group, tr.time) !== 'green') continue;
          if (!tr.hasPriorityOver(oEnd, null, end, link, inX, inZ)) continue;
          const od = o.link.line.length - o.s + via.line.length;
          if (od / Math.max(2, o.v) < need && !(this.waitTime > 20 && o.v < 0.2)) return true;
        }
        continue;
      }
      if (!o.lane || !o.next || o.lane.to !== link.vertex || o.lane === lane) continue;
      if (!this.inConflict(link, o.next)) continue;
      const oEnd = o.lane.endRef;
      if (oEnd.control === 'signal' && oEnd.controller && oEnd.controller.state(oEnd.group, tr.time) !== 'green') continue;
      if (!tr.hasPriorityOver(oEnd, o.next, end, link, inX, inZ)) continue;
      const od = o.lane.line.length - o.s;
      const eta = od / Math.max(2, o.v);
      if (od < 10 || eta < need) {
        if (this.waitTime > 20 && o.v < 0.2) continue;
        return true;
      }
    }
    return false;
  }

  /** Distance libre devant, le long du chemin (véhicules et piétons sur la chaussée). */
  private nearCache = new Map<LaneLink, Map<LaneLink, boolean>>();
  /** Deux liaisons se gênent-elles ? Croisement, convergence, ou trajectoires qui se frôlent à moins d'une largeur de voiture. */
  private inConflict(a: LaneLink, b: LaneLink): boolean {
    if (a === b || a.from === b.from) return false;
    if (a.conflicts.includes(b) || a.to === b.to) return true;
    let m = this.nearCache.get(a);
    if (!m) this.nearCache.set(a, (m = new Map()));
    let r = m.get(b);
    if (r === undefined) {
      r = false;
      for (let q = 1; q < b.line.length - 1 && !r; q += 1) {
        const p = b.line.at(q), pr = a.line.project(p.x, p.z);
        if (pr.s > 1 && pr.s < a.line.length - 1 && Math.hypot(p.x - pr.x, p.z - pr.z) < 2.1) r = true;
      }
      m.set(b, r);
    }
    return r;
  }

  /** Distance (depuis l'avant) du point où un véhicule en mouvement va couper notre chemin en même temps que nous ; ∞ sinon. */
  private crossingAhead(car: Car, v: number): number {
    const tr = this.traffic;
    if (!tr) return Infinity;
    let best = Infinity;
    // instant où notre avant atteindra un point situé à la distance d (au démarrage : accélération douce)
    const arrival = (d: number) => (v > 1.2 ? d / v : Math.sqrt((2 * d) / 1.6) + 0.4);
    for (const o of tr.vehicles) {
      if (o.v < 1.5) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      if (dx * dx + dz * dz > 40 * 40) continue;
      // ne concerne que ceux qui roulent en travers de notre route (pas ceux qui nous précèdent ou nous croisent en face)
      const cosang = Math.sin(o.heading) * car.forwardX - Math.cos(o.heading) * car.forwardZ;
      if (Math.abs(cosang) > 0.8) continue;
      const P = o.path;
      for (let t = 0.4; t <= 3.01; t += 0.4) {
        const q = P.at(o.s - o.length / 2 + o.v * t);
        let acc = -this.s - FRONT;
        for (let i = this.k; i < Math.min(this.segs.length, this.k + 3); i++) {
          const L = this.segs[i].line;
          if (q.x > L.minX - 3 && q.x < L.maxX + 3 && q.z > L.minZ - 3 && q.z < L.maxZ + 3) {
            const pr = L.project(q.x, q.z);
            const d = acc + pr.s;
            // même endroit, au même moment (à une longueur de voiture près)
            if (Math.abs(pr.d) < 1.9 && pr.s > 0.01 && pr.s < L.length - 0.01 && d > 1 && d < 30 && Math.abs(arrival(d) - t) < 1.7 && d < best) best = d;
          }
          acc += L.length;
        }
      }
    }
    return best;
  }

  /** Rien derrière la voiture sur 6 m (véhicules, piétons, cyclistes) ? */
  private rearClear(car: Car): boolean {
    const tr = this.traffic;
    if (!tr) return true;
    const fx = car.forwardX, fz = car.forwardZ;
    const test = (x: number, z: number, r: number) => {
      const dx = x - car.x, dz = z - car.z;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * -fz + dz * fx);
      return along < -1.5 && along > -8.5 - r && lat < 1.3 + r;
    };
    for (const o of tr.vehicles) if (test(o.x, o.z, o.length / 2)) return false;
    for (const p of tr.pedestrians) if (test(p.x, p.z, 0.4)) return false;
    for (const b of tr.cyclists) if (test(b.x, b.z, 0.9)) return false;
    return true;
  }

  private gapWhat = '';
  /** l'obstacle le plus proche est-il lent ou arrêté ? */
  private gapSlow = false;
  private gapAhead(car: Car): number {
    const tr = this.traffic;
    if (!tr) return Infinity;
    let best = Infinity;
    let what = '';
    // marge latérale ; après une longue attente derrière un véhicule arrêté, on se faufile s'il y a la place
    let slack = 1.05;
    this.gapSlow = false;
    let speed = 0; // vitesse de l'obstacle en cours d'examen
    const test = (x: number, z: number, radius: number) => {
      const dx = x - car.x, dz = z - car.z;
      if (dx * dx + dz * dz > 45 * 45) return;
      let acc = -this.s - FRONT;
      for (let i = this.k; i < Math.min(this.segs.length, this.k + 3); i++) {
        const L = this.segs[i].line;
        if (x > L.minX - 4 && x < L.maxX + 4 && z > L.minZ - 4 && z < L.maxZ + 4) {
          const pr = L.project(x, z);
          const d = acc + pr.s;
          if (Math.abs(pr.d) < slack + radius && d > -0.5 && pr.s > 0.01 && pr.s < L.length - 0.01 && d - radius < best) { best = d - radius; this.gapWhat = what; this.gapSlow = speed < 2; }
        }
        acc += L.length;
      }
    };
    what = 'véhicule devant';
    // chaque véhicule est approché par trois disques le long de sa carrosserie
    for (const o of tr.vehicles) {
      const fx = Math.sin(o.heading), fz = -Math.cos(o.heading), r = o.width / 2 + 0.1;
      slack = this.waitTime > 10 && o.v < 0.2 ? 0.93 : 1.05;
      speed = o.v;
      for (const k of [-0.32, 0, 0.32]) test(o.x + fx * o.length * k, o.z + fz * o.length * k, r);
    }
    slack = 1.05; speed = 0;
    // cyclistes : on ne dépasse que si l'on peut laisser un mètre, sinon on reste derrière (R414-4)
    what = 'cycliste';
    for (const b of tr.cyclists) if (!b.hit) test(b.x, b.z, 1.25);
    what = 'piéton sur la chaussée';
    // piétons : large marge pour ceux qui traversent ; ceux qui attendent sur le trottoir ne comptent que s'ils sont vraiment sur la trajectoire
    for (const p of tr.pedestrians) if (!p.hit) test(p.x, p.z, p.state === 'cross' ? 0.9 : 0.02);
    return best;
  }
}
