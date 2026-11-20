// Circulation : véhicules pilotés par l'ordinateur et piétons.
//
// Les véhicules suivent les voies du réseau avec un modèle de poursuite (IDM), s'arrêtent aux feux
// et aux stops, appliquent la priorité à droite, cèdent aux piétons engagés et tiennent compte de
// la voiture du joueur. Les piétons traversent aux passages (au vert piéton quand il y a des feux).
// Logique pure (pas de rendu) : utilisable en test.

import type { Crossing, EdgeEnd, Lane, LaneLink, RoadNet, Vertex } from '../map/roadnet';
import { clamp, Rng } from '../core/math';
import { Polyline } from '../map/polyline';

export type VehicleKind = 'citadine' | 'berline' | 'suv' | 'utilitaire' | 'bus';
const KIND_LEN: Record<VehicleKind, number> = { citadine: 4.05, berline: 4.6, suv: 4.4, utilitaire: 4.9, bus: 12 };
const KIND_WID: Record<VehicleKind, number> = { citadine: 1.8, berline: 1.82, suv: 1.84, utilitaire: 1.9, bus: 2.55 };

/** Ce que la circulation a besoin de savoir sur la voiture du joueur. */
export interface PlayerInfo {
  x: number; z: number; heading: number;
  /** vitesse longitudinale (m/s) */
  speed: number;
  length: number; width: number;
  /** branche par laquelle le joueur arrive au prochain carrefour (ou null) */
  approach: EdgeEnd | null;
  /** distance du joueur à l'entrée de ce carrefour (m) */
  approachDist: number;
  /** carrefour dans lequel le joueur se trouve */
  inJunction: Vertex | null;
  left: boolean; right: boolean;
}

export class Vehicle {
  id = 0;
  kind: VehicleKind = 'citadine';
  color = 0xffffff;
  length = 4.05; width = 1.8;
  lane: Lane | null = null;
  link: LaneLink | null = null;
  /** prochaine liaison choisie (quand le véhicule est sur une voie) */
  next: LaneLink | null = null;
  /** abscisse de l'avant du véhicule sur l'élément courant */
  s = 0;
  v = 0;
  a = 0;
  x = 0; z = 0; heading = 0;
  /** vitesse de croisière propre au conducteur (facteur de la limite) */
  temper = 1;
  indicator: -1 | 0 | 1 = 0;
  braking = false;
  stoppedAtStop = 0;
  waiting = 0;
  /** le véhicule a dû freiner fort à cause du joueur alors qu'il était prioritaire */
  forcedByPlayer = 0;
  /** temps passé arrêté derrière une carrosserie détectée par le filet géométrique */
  netWait = 0;
  crashed = 0;
  /** temps d'arrêt derrière un joueur lui-même immobile */
  playerWait = 0;
  /** écart latéral pris pour contourner le joueur arrêté qui empiète un peu sur la trajectoire (m, + à droite) */
  dodge = 0;
  /** recul en cours pour libérer le passage du joueur (m restants) et délai avant un nouveau recul (s) */
  backing = 0;
  backCooldown = 0;
  reversing = false;
  wasHit = false;
  hitTime = 0;
  alive = true;
  /** phase de roue pour le rendu */
  wheelPhase = 0;
  get path() { return this.link ? this.link.line : this.lane!.line; }
  /** branche par laquelle le véhicule arrive au prochain carrefour */
  get approach(): EdgeEnd | null { return this.lane ? this.lane.endRef : null; }
}

export type PedState = 'approach' | 'wait' | 'cross' | 'leave' | 'stroll';
export class Pedestrian {
  id = 0;
  seed = 0;
  x = 0; z = 0; heading = 0;
  speed = 0;
  walkSpeed = 1.35;
  phase = 0;
  state: PedState = 'approach';
  crossing: Crossing | null = null;
  /** côté de départ : -1 = à gauche de l'axe, +1 = à droite */
  side: 1 | -1 = 1;
  tx = 0; tz = 0;
  waitTime = 0;
  assertive = 0.5;
  alive = true;
  /** le piéton a la priorité (passage sans feu, ou feu piéton vert) */
  hasRight = true;
  /** progression de la traversée 0..1 */
  progress = 0;
  hit = false;
}

const IDM = { a: 1.7, b: 2.4, T: 1.25, s0: 2.2 };

/** Cycliste sur bande cyclable : avance à son allure, s'arrête aux feux et laisse passer les piétons. */
export class Cyclist {
  id = 0;
  seed = 0;
  lane!: Lane;
  /** raccord en ligne droite à travers un carrefour, vers la bande cyclable d'en face */
  conn: Polyline | null = null;
  nextLane: Lane | null = null;
  /** abscisse de la roue avant sur l'élément courant */
  s = 0;
  v = 0;
  cruise = 5;
  x = 0; z = 0; heading = 0;
  phase = 0;
  lean = 0;
  wait = 0;
  hit = false;
  alive = true;
  readonly length = 1.8;
}

export interface TrafficOptions { vehicles: number; pedestrians: number; cyclists: number; seed: number }

export class Traffic {
  vehicles: Vehicle[] = [];
  pedestrians: Pedestrian[] = [];
  cyclists: Cyclist[] = [];
  time = 0;
  private rng: Rng;
  private byLane = new Map<Lane, Vehicle[]>();
  private byLink = new Map<LaneLink, Vehicle[]>();
  private nextId = 1;
  private spawnTimer = 0;
  private pedTimer = 0;
  private cycTimer = 0;
  private cycleLanes: Lane[] = [];
  private drivable: Lane[];
  opts: TrafficOptions;
  /** événements à destination des règles */
  onForcedBrake?: (v: Vehicle) => void;

  constructor(readonly net: RoadNet, opts: Partial<TrafficOptions> = {}) {
    this.opts = { vehicles: 34, pedestrians: 26, cyclists: 5, seed: 7, ...opts };
    this.rng = new Rng(this.opts.seed);
    this.drivable = net.lanes.filter((l) => l.kind === 'L' && l.line.length > 12 && l.links.length > 0);
    this.cycleLanes = net.lanes.filter((l) => l.kind === 'C' && l.line.length > 35);
  }

  // ───────────── boucle ─────────────
  update(dt: number, player: PlayerInfo | null) {
    this.time += dt;
    this.index();
    for (const v of this.vehicles) this.stepVehicle(v, dt, player);
    for (const p of this.pedestrians) this.stepPedestrian(p, dt, player);
    for (const c of this.cyclists) this.stepCyclist(c, dt, player);
    this.cyclists = this.cyclists.filter((c) => c.alive);
    this.vehicles = this.vehicles.filter((v) => v.alive);
    this.pedestrians = this.pedestrians.filter((p) => p.alive);
    if (player) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnTimer = 0.25; this.populate(player); }
      this.pedTimer -= dt;
      if (this.pedTimer <= 0) { this.pedTimer = 0.5; this.populatePedestrians(player); }
      this.cycTimer -= dt;
      if (this.cycTimer <= 0) { this.cycTimer = 1.2; this.populateCyclists(player); }
    }
  }

  private index() {
    this.byLane.clear(); this.byLink.clear();
    for (const v of this.vehicles) {
      if (v.link) { let a = this.byLink.get(v.link); if (!a) this.byLink.set(v.link, (a = [])); a.push(v); }
      else if (v.lane) { let a = this.byLane.get(v.lane); if (!a) this.byLane.set(v.lane, (a = [])); a.push(v); }
    }
  }

  // ───────────── apparition ─────────────
  private populate(player: PlayerInfo) {
    const R0 = 95, R1 = 230, RD = 290;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.x - player.x, v.z - player.z);
      if (d > RD) v.alive = false;
    }
    let tries = 0;
    while (this.vehicles.filter((v) => v.alive).length < this.opts.vehicles && tries++ < 12) {
      const lane = this.rng.pick(this.drivable);
      const s = this.rng.range(4, lane.line.length - 2);
      const p = lane.line.at(s);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < R0 || d > R1) continue;
      // pas dans le champ de vision direct proche : on évite l'axe devant le joueur à moins de 140 m
      const fx = Math.sin(player.heading), fz = -Math.cos(player.heading);
      const ahead = (p.x - player.x) * fx + (p.z - player.z) * fz;
      if (ahead > 0 && d < 140 && Math.abs((p.x - player.x) * -fz + (p.z - player.z) * fx) < 12) continue;
      const others = this.byLane.get(lane) ?? [];
      if (others.some((o) => Math.abs(o.s - s) < 14)) continue;
      // les grands axes sont plus fréquentés
      const w = lane.edge.cls === 'primary' || lane.edge.cls === 'secondary' ? 1 : lane.edge.cls === 'tertiary' ? 0.75 : 0.4;
      if (this.rng.next() > w) continue;
      this.spawnVehicle(lane, s);
    }
  }

  spawnVehicle(lane: Lane, s: number, kind?: VehicleKind): Vehicle {
    const v = new Vehicle();
    v.id = this.nextId++;
    const r = this.rng.next();
    v.kind = kind ?? (r < 0.46 ? 'citadine' : r < 0.66 ? 'berline' : r < 0.84 ? 'suv' : r < 0.965 ? 'utilitaire' : 'bus');
    if (v.kind === 'bus' && (lane.edge.cls === 'residential' || lane.edge.living)) v.kind = 'citadine';
    v.length = KIND_LEN[v.kind]; v.width = KIND_WID[v.kind];
    v.color = this.rng.int(0, 1000);
    v.temper = this.rng.range(0.86, 1.02);
    v.lane = lane; v.s = s;
    v.v = Math.min(lane.edge.limit / 3.6, 8) * v.temper * 0.8;
    this.chooseNext(v);
    this.place(v);
    this.vehicles.push(v);
    let a = this.byLane.get(lane); if (!a) this.byLane.set(lane, (a = [])); a.push(v);
    return v;
  }

  private chooseNext(v: Vehicle) {
    const lane = v.lane!;
    if (!lane.links.length) { v.next = null; return; }
    // on évite les impasses et on favorise la continuité de la rue
    const scored = lane.links.map((l) => {
      let w = l.turn === 'straight' ? 3 : 1;
      if (l.to.to.dead) w *= 0.05;
      if (l.to.edge.cls === 'service' || l.to.edge.living) w *= 0.4;
      if (!l.to.links.length && !l.to.to.exit) w *= 0.05;
      return { l, w };
    });
    const tot = scored.reduce((s, x) => s + x.w, 0);
    let r = this.rng.next() * tot;
    v.next = scored[scored.length - 1].l;
    for (const x of scored) { r -= x.w; if (r <= 0) { v.next = x.l; break; } }
  }

  private place(v: Vehicle) {
    const L = v.path;
    // l'abscisse s est celle de l'avant. La caisse est posée sur la corde entre un point proche de l'avant
    // et un point proche de l'arrière, tous deux sur la trajectoire : dans un virage, un véhicule long
    // (autobus) garde ainsi ses extrémités sur sa voie au lieu de balayer la voie voisine avec son avant.
    const a = L.at(v.s - v.length * 0.12), b = L.at(v.s - v.length * 0.88);
    const dx = a.x - b.x, dz = a.z - b.z;
    v.heading = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, -dz) : Math.atan2(a.tx, -a.tz);
    // (écart de contournement : perpendiculaire à la caisse, positif vers la droite)
    v.x = (a.x + b.x) / 2 + Math.cos(v.heading) * v.dodge; v.z = (a.z + b.z) / 2 + Math.sin(v.heading) * v.dodge;
  }

  // ───────────── conduite ─────────────
  private stepVehicle(v: Vehicle, dt: number, player: PlayerInfo | null) {
    if (v.crashed > 0) { v.crashed -= dt; v.v = 0; v.a = 0; v.braking = true; v.wasHit = true; return; }
    // après un accrochage avec le joueur : si les deux restent imbriqués, le véhicule finit par être évacué
    if (v.wasHit && player) {
      const near = Math.hypot(player.x - v.x, player.z - v.z) < (v.length + player.length) / 2 + 1.5;
      v.hitTime = near && v.v < 0.3 ? v.hitTime + dt : 0;
      if (!near && v.v > 2) v.wasHit = false;
      if (v.hitTime > 12) { v.alive = false; return; }
    }
    const L = v.path;
    const remaining = L.length - v.s;
    const limit = (v.lane ?? v.link!.to).edge.limit / 3.6;
    let v0 = limit * v.temper;
    // vitesse en courbe : dans les liaisons de carrefour et les virages serrés
    const curveSpeed = (kappa: number) => Math.sqrt(1.9 / Math.max(1e-3, Math.abs(kappa)));
    if (v.link) v0 = Math.min(v0, Math.max(2.8, curveSpeed(v.link.line.curvatureAt(v.s, 3))));
    else {
      v0 = Math.min(v0, Math.max(3.5, curveSpeed(L.curvatureAt(v.s + 6, 5))));
      if (v.next && remaining < 30 && v.next.turn !== 'straight') {
        const vt = Math.max(2.8, curveSpeed(v.next.line.curvatureAt(v.next.line.length / 2, 3)));
        v0 = Math.min(v0, Math.sqrt(vt * vt + 2 * 1.6 * Math.max(0, remaining)));
      }
    }
    // clignotant avant de tourner
    v.indicator = v.lane && v.next && remaining < 32 ? (v.next.turn === 'left' ? -1 : v.next.turn === 'right' ? 1 : 0) : v.link ? (v.link.turn === 'left' ? -1 : v.link.turn === 'right' ? 1 : 0) : 0;

    // ── obstacles : on cherche l'écart libre devant (gap) et la vitesse de l'obstacle ──
    let gap = Infinity, dv = 0;
    const consider = (g: number, vObst: number) => { if (g < gap) { gap = g; dv = v.v - vObst; } };

    // véhicule qui précède sur le même élément
    const same = (v.link ? this.byLink.get(v.link) : this.byLane.get(v.lane!)) ?? [];
    for (const o of same) if (o !== v && o.s > v.s) consider(o.s - o.length - v.s, o.v);
    // …puis sur l'élément suivant
    if (v.lane && v.next) {
      for (const o of this.byLink.get(v.next) ?? []) consider(remaining + o.s - o.length, o.v);
      for (const o of this.byLane.get(v.next.to) ?? []) consider(remaining + v.next.line.length + o.s - o.length, o.v);
    } else if (v.link) {
      for (const o of this.byLane.get(v.link.to) ?? []) consider(remaining + o.s - o.length, o.v);
    }

    // dans le carrefour : on laisse dégager le véhicule plus engagé sur une trajectoire qui coupe la nôtre
    if (v.link) {
      const fxv = Math.sin(v.heading), fzv = -Math.cos(v.heading);
      const mine = v.s / Math.max(1, v.link.line.length);
      for (const c of v.link.conflicts) {
        for (const o of this.byLink.get(c) ?? []) {
          const theirs = o.s / Math.max(1, c.line.length);
          if (theirs < mine || (theirs === mine && o.id > v.id)) continue;
          const rx = o.x - v.x, rz = o.z - v.z;
          const ahead = rx * fxv + rz * fzv;
          const d = Math.hypot(rx, rz);
          if (ahead > 0 && d < (v.length + o.length) / 2 + 6) consider(Math.max(0.2, d - (v.length + o.length) / 2 - 0.8), Math.max(0, o.v * (Math.sin(o.heading) * fxv - Math.cos(o.heading) * fzv)));
        }
      }
    }

    // filet géométrique : carrosserie lente ou arrêtée en travers de notre couloir, que le suivi par
    // élément ne voit pas (queue d'un véhicule qui dépasse sur l'élément précédent, liaisons voisines…)
    // (patience limitée : au-delà, on se faufile comme le ferait un conducteur pour dégager le carrefour,
    // ce qui évite les embouteillages circulaires)
    let netGap = Infinity;
    if (v.netWait < 7 + (v.id % 6)) {
      for (const o of this.vehicles) {
        if (o === v || o.v > 1.5) continue;
        const ox = o.x - v.x, oz = o.z - v.z;
        if (ox * ox + oz * oz > 16 * 16) continue;
        const g = this.bodyGap(v, o);
        if (g === Infinity) continue;
        // face-à-face immobile : le plus petit identifiant se dégage
        if (o.v < 0.3 && v.v < 0.3 && v.id < o.id && this.bodyGap(o, v) < Infinity) continue;
        if (g < netGap) netGap = g;
      }
    }
    // le filet ne compte que s'il est plus contraignant que le suivi normal
    if (netGap < gap - 0.5) {
      consider(netGap, 0);
      if (v.v < 0.3) v.netWait += dt;
    } else if (v.v > 2) v.netWait = 0;

    // voiture du joueur sur la trajectoire
    let playerAhead = Infinity;
    if (player) {
      playerAhead = this.playerGap(v, player);
      // immobilisé par un joueur lui-même à l'arrêt, qui n'empiète qu'en partie sur la trajectoire :
      // on patiente quelques secondes, puis on s'écarte pour le contourner au pas
      const still = Math.abs(player.speed) < 0.3;
      if (playerAhead < 8 && v.v < 0.6 && still) v.playerWait += dt;
      else if (playerAhead === Infinity || !still) v.playerWait = 0;
      let target = 0;
      if (still && v.playerWait > 5 && playerAhead < 12) {
        const need = this.playerOverlap(v, player);
        if (need !== 0 && Math.abs(need) <= 0.85) target = need;
      }
      v.dodge += clamp(target - v.dodge, -0.5 * dt, 0.5 * dt);
      // face-à-face : le joueur est à l'arrêt en travers de notre route, et nous sommes en travers de la
      // sienne. Comme le ferait un conducteur courtois, on recule de quelques mètres pour le laisser passer.
      v.backCooldown = Math.max(0, v.backCooldown - dt);
      if (v.backing <= 0 && v.backCooldown <= 0 && still && v.playerWait > 12 && target === 0 && this.blocksPlayer(v, player) && this.rearFree(v)) {
        v.backing = Math.min(4, Math.max(0, v.s - 0.3));
      }
      if (v.backing > 0) {
        if (!still || !this.rearFree(v)) v.backing = 0;
        else {
          const ds = Math.min(v.backing, 0.9 * dt);
          v.s -= ds; v.backing -= ds; v.wheelPhase -= ds;
          v.v = 0; v.a = 0; v.braking = false; v.reversing = true;
          if (v.backing <= 0) { v.backCooldown = 25; v.playerWait = 0; }
          this.place(v);
          return;
        }
      }
      v.reversing = false;
      // dernier recours : blocage complet depuis une demi-minute, personne ne peut reculer — le véhicule
      // qui barre la route du joueur est retiré de la circulation, pour que la leçon ne reste pas figée
      if (still && v.playerWait > 30 && target === 0 && this.blocksPlayer(v, player)) { v.alive = false; return; }
      if (target !== 0 && Math.abs(v.dodge - target) < 0.04) { playerAhead = Infinity; v0 = Math.min(v0, 1.8); }
      if (playerAhead < gap) {
        // composante de la vitesse du joueur le long de notre trajectoire
        const fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
        const pv = player.speed * (Math.sin(player.heading) * fx - Math.cos(player.heading) * fz);
        consider(playerAhead, Math.max(0, pv));
      }
    }

    // ── points d'arrêt sur la voie : feux, stop, cédez, passages piétons ──
    let mustStopAt = Infinity;
    // passages piétons en sortie de carrefour
    const exits = v.link ? v.link.exitCrossings : v.next ? v.next.exitCrossings : null;
    if (exits) {
      for (const x of exits) {
        const d = (v.link ? 0 : remaining) + x.s - v.s * (v.link ? 1 : 0);
        if (d > -0.5 && d < 60 && this.pedestrianOn(x.crossing, v)) mustStopAt = Math.min(mustStopAt, d);
      }
    }
    if (v.lane) {
      for (const sp of v.lane.stops) {
        const d = sp.s - v.s;
        if (sp.kind === 'stop' && sp.atEnd) {
          // l'arrêt compte même si la ligne a été un peu dépassée : sinon le véhicule attendrait indéfiniment
          if (v.stoppedAtStop < 0.8 && d < 70) {
            mustStopAt = Math.min(mustStopAt, Math.max(0, d));
            if (d < 1.2 && v.v < 0.25) v.stoppedAtStop += dt;
          }
          continue;
        }
        if (d < -1.5 || d > 70) continue;
        if (sp.kind === 'signal' && sp.controller) {
          const st = sp.controller.state(sp.group ?? 0, this.time);
          if (st === 'red' && d > -0.5) mustStopAt = Math.min(mustStopAt, d);
          else if (st === 'yellow' && d > 0 && d > (v.v * v.v) / (2 * 3.2) + 1) mustStopAt = Math.min(mustStopAt, d);
        } else if (sp.kind === 'crossing' && sp.crossing) {
          if (d > -0.5 && this.pedestrianOn(sp.crossing, v)) mustStopAt = Math.min(mustStopAt, d);
        }
      }
      // entrée de carrefour : priorités
      if (v.next) {
        const end = v.lane.endRef;
        const dEnd = remaining;
        if (dEnd < 45) {
          const stopLine = Math.max(0, v.lane.fromEdgeS(end.sAt(end.stopDist)) - v.s);
          const blocked = this.mustYield(v, v.next, end, stopLine, player);
          if (blocked) { mustStopAt = Math.min(mustStopAt, stopLine); v.waiting += dt; }
          else v.waiting = 0;
        }
      } else if (remaining < 40 && !v.lane.to.exit) {
        // impasse : on s'arrête au bout
        mustStopAt = Math.min(mustStopAt, Math.max(0, remaining - 1));
      }
    }
    if (mustStopAt < Infinity) consider(mustStopAt + IDM.s0 - 0.6, 0);

    // ── modèle de poursuite (IDM) ──
    const sStar = IDM.s0 + Math.max(0, v.v * IDM.T + (v.v * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
    let acc = IDM.a * (1 - Math.pow(v.v / Math.max(0.5, v0), 4) - (gap < 1e6 ? (sStar / Math.max(0.3, gap)) ** 2 : 0));
    acc = clamp(acc, -8, IDM.a);
    // freinage d'urgence provoqué par le joueur alors que le véhicule était prioritaire
    if (player && playerAhead < 25 && acc < -3.6 && v.v > 2.5) {
      v.forcedByPlayer += dt;
      if (v.forcedByPlayer > 0.25 && v.forcedByPlayer - dt <= 0.25) this.onForcedBrake?.(v);
    } else v.forcedByPlayer = Math.max(0, v.forcedByPlayer - dt * 0.5);

    v.a = acc;
    v.braking = acc < -0.6 || (v.v < 0.3 && gap < 8);
    v.v = Math.max(0, v.v + acc * dt);
    if (v.v < 0.05 && acc <= 0) v.v = 0;
    const ds = v.v * dt;
    v.s += ds;
    v.wheelPhase += ds;

    // ── passage à l'élément suivant ──
    if (v.s >= L.length) {
      const over = v.s - L.length;
      if (v.link) {
        v.lane = v.link.to; v.link = null; v.s = over;
        v.stoppedAtStop = 0; v.waiting = 0;
        this.chooseNext(v);
      } else if (v.next) {
        v.link = v.next; v.lane = null; v.next = null; v.s = over;
      } else {
        // sortie de carte ou impasse
        if (v.lane!.to.exit) v.alive = false;
        v.s = L.length; v.v = 0;
      }
    }
    this.place(v);
  }

  /** Distance libre jusqu'à la carrosserie de `o` si elle empiète sur le couloir de `v` dans les 14 m (sinon ∞). */
  private bodyGap(v: Vehicle, o: Vehicle): number {
    const fx = Math.sin(o.heading), fz = -Math.cos(o.heading);
    const r = o.width / 2;
    const lim = v.width / 2 + r - 0.25;
    let best = Infinity;
    const test = (line: import('../map/polyline').Polyline, sFrom: number, offset: number) => {
      if (offset > 14) return;
      if (o.x < line.minX - 5 || o.x > line.maxX + 5 || o.z < line.minZ - 5 || o.z > line.maxZ + 5) return;
      for (let k = -1; k <= 1; k++) {
        const x = o.x + fx * o.length * 0.32 * k, z = o.z + fz * o.length * 0.32 * k;
        const pr = line.project(x, z);
        if (pr.s <= sFrom + 0.2 || pr.s >= line.length - 0.01 || Math.abs(pr.d) > lim) continue;
        const g = offset + pr.s - sFrom - r;
        if (g < 14 && g < best) best = g;
      }
    };
    const L = v.path;
    test(L, v.s, 0);
    const rem = L.length - v.s;
    if (v.lane && v.next) { test(v.next.line, 0, rem); test(v.next.to.line, 0, rem + v.next.line.length); }
    else if (v.link) test(v.link.to.line, 0, rem);
    return Math.max(0.1, best);
  }

  /** La carrosserie de `v` se trouve-t-elle juste devant le joueur, dans son couloir ? */
  private blocksPlayer(v: Vehicle, p: PlayerInfo): boolean {
    const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    const hx = Math.sin(v.heading), hz = -Math.cos(v.heading);
    const r = v.width / 2;
    for (let k = -1; k <= 1; k++) {
      const dx = v.x + hx * v.length * 0.32 * k - p.x, dz = v.z + hz * v.length * 0.32 * k - p.z;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * -fz + dz * fx);
      if (along - r > p.length / 2 - 0.5 && along - r < p.length / 2 + 7 && lat < p.width / 2 + r + 0.15) return true;
    }
    return false;
  }

  /** Personne juste derrière `v` (pour reculer de quelques mètres) ? */
  private rearFree(v: Vehicle): boolean {
    const hx = Math.sin(v.heading), hz = -Math.cos(v.heading);
    for (const o of this.vehicles) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      const along = dx * hx + dz * hz, lat = Math.abs(dx * -hz + dz * hx);
      if (along < 0 && along > -(v.length / 2 + o.length / 2 + 5) && lat < 2.2) return false;
    }
    for (const q of this.pedestrians) {
      const dx = q.x - v.x, dz = q.z - v.z;
      const along = dx * hx + dz * hz, lat = Math.abs(dx * -hz + dz * hx);
      if (along < 0 && along > -(v.length / 2 + 5) && lat < 1.6) return false;
    }
    return true;
  }

  /** Écart latéral (m, signé : + vers la droite) qui permettrait de passer à côté du joueur ; 0 s'il n'est pas sur la trajectoire. */
  private playerOverlap(v: Vehicle, p: PlayerInfo): number {
    let best = 0, bestS = Infinity;
    const test = (line: Polyline, sFrom: number, offset: number) => {
      if (p.x < line.minX - 6 || p.x > line.maxX + 6 || p.z < line.minZ - 6 || p.z > line.maxZ + 6) return;
      const pr = line.project(p.x, p.z);
      if (pr.s <= sFrom - 0.5 || pr.s >= line.length - 0.01) return;
      const ca = Math.abs(Math.sin(p.heading) * pr.tx - Math.cos(p.heading) * pr.tz);
      const ext = p.width / 2 + (p.length / 2 - p.width / 2) * (1 - ca);
      const need = v.width / 2 + ext + 0.3 - Math.abs(pr.d);
      const along = offset + pr.s - sFrom;
      if (need > 0 && along < bestS) { bestS = along; best = pr.d > 0 ? -need : need; }
    };
    const L = v.path;
    test(L, v.s, 0);
    const rem = L.length - v.s;
    if (v.lane && v.next) test(v.next.line, 0, rem);
    else if (v.link) test(v.link.to.line, 0, rem);
    return best;
  }

  /** Distance libre jusqu'au joueur s'il se trouve sur la trajectoire (sinon ∞). */
  private playerGap(v: Vehicle, p: PlayerInfo): number {
    const dx = p.x - v.x, dz = p.z - v.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 60 * 60) return Infinity;
    const halfW = v.width / 2 + p.width / 2 + 0.35;
    const reach = (p.length + p.width) / 2; // rayon englobant approximatif
    let best = Infinity;
    const test = (line: import('../map/polyline').Polyline, sFrom: number, offset: number) => {
      if (p.x < line.minX - 6 || p.x > line.maxX + 6 || p.z < line.minZ - 6 || p.z > line.maxZ + 6) return;
      const pr = line.project(p.x, p.z);
      if (pr.s <= sFrom - 0.5) return;
      // largeur occupée par le joueur perpendiculairement à la trajectoire
      const ca = Math.abs(Math.sin(p.heading) * pr.tx - Math.cos(p.heading) * pr.tz);
      const ext = p.width / 2 + (p.length / 2 - p.width / 2) * (1 - ca);
      if (Math.abs(pr.d) > halfW - p.width / 2 + ext) return;
      if (pr.s >= line.length - 0.01 && Math.hypot(p.x - pr.x, p.z - pr.z) > reach + 1) return;
      const along = p.length / 2 * ca + (p.width / 2) * (1 - ca);
      best = Math.min(best, offset + pr.s - sFrom - along);
    };
    const L = v.path;
    test(L, v.s, 0);
    const rem = L.length - v.s;
    if (v.lane && v.next) { test(v.next.line, 0, rem); test(v.next.to.line, 0, rem + v.next.line.length); }
    else if (v.link) test(v.link.to.line, 0, rem);
    return best;
  }

  /** Un piéton est-il engagé (ou sur le point de l'être) sur ce passage, devant ce véhicule ? */
  private pedestrianOn(c: Crossing, v: Vehicle): boolean {
    for (const p of this.pedestrians) {
      if (p.crossing !== c) continue;
      if (p.state === 'cross') return true;
      if (p.state === 'wait' && p.hasRight && p.waitTime > 0.4 && v.v < 12) return true;
    }
    return false;
  }

  /** Le véhicule doit-il céder le passage avant d'emprunter la liaison `link` ? */
  private mustYield(v: Vehicle, link: LaneLink, end: EdgeEnd, distToLine: number, player: PlayerInfo | null): boolean {
    const ctl = end.control;
    if (ctl === 'signal' && end.controller) {
      const st = end.controller.state(end.group, this.time);
      if (st !== 'green') return false; // l'arrêt au feu est géré par les points d'arrêt
    }
    if (ctl === 'stop' && v.stoppedAtStop < 0.8) return true;
    // ne pas s'engager si la sortie est encombrée
    const outQ = this.byLane.get(link.to) ?? [];
    for (const o of outQ) if (o.s - o.length < v.length + 2 && o.v < 1.5) return true;
    const myEta = distToLine / Math.max(1.5, v.v);
    if (myEta > 5) return false;
    const inX = -end.dx, inZ = -end.dz;

    for (const c of link.conflicts) {
      // véhicules déjà dans le carrefour sur une trajectoire en conflit
      const inside = this.byLink.get(c);
      if (inside && inside.length) {
        if (!(v.waiting > 14 && inside.every((o) => o.v < 0.3 && o.id > v.id))) return true;
      }
      // véhicules en approche prioritaires
      const oEnd = c.from.endRef;
      if (!this.hasPriorityOver(oEnd, c, end, link, inX, inZ)) continue;
      for (const o of this.byLane.get(c.from) ?? []) {
        if (o.next !== c) continue;
        const od = o.lane!.line.length - o.s;
        if (oEnd.control === 'signal' && oEnd.controller && oEnd.controller.state(oEnd.group, this.time) !== 'green') continue;
        const eta = od / Math.max(2, o.v);
        if (od < 9 || eta < 3.6) {
          // blocage mutuel : le plus petit identifiant passe après une longue attente
          if (v.waiting > 12 && o.v < 0.3 && o.waiting > 6 && v.id < o.id) continue;
          return true;
        }
      }
    }
    // le joueur
    if (player) {
      const pv = this.playerPriority(player, end, link, inX, inZ);
      if (pv) return true;
    }
    return false;
  }

  /** L'usager venant par `oEnd` (liaison `oLink`) est-il prioritaire sur moi (`end`, `link`) ? */
  hasPriorityOver(oEnd: EdgeEnd, oLink: LaneLink | null, end: EdgeEnd, link: LaneLink, inX: number, inZ: number): boolean {
    const rank = { none: 2, signal: 2, yield: 1, stop: 0 } as const;
    const mine = rank[end.control], theirs = rank[oEnd.control];
    if (theirs > mine) return true;
    if (theirs < mine) return false;
    // même régime
    if (end.control === 'signal') {
      // au vert : celui qui tourne à gauche cède à ceux d'en face qui vont tout droit ou à droite
      // (direction de l'autre inconnue — le joueur, un véhicule encore loin : on suppose qu'il va tout droit)
      if (link.turn === 'left' && (!oLink || oLink.turn !== 'left')) return true;
      return false;
    }
    // l'anneau d'un giratoire est prioritaire
    if (oEnd.edge.roundabout && !end.edge.roundabout) return true;
    if (end.edge.roundabout && !oEnd.edge.roundabout) return false;
    // priorité à droite : l'autre vient-il de ma droite ?
    const ox = -oEnd.dx, oz = -oEnd.dz;
    const cross = inX * oz - inZ * ox;
    if (cross < -0.35) return true;
    if (cross > 0.35) return false;
    // face à face : celui qui tourne à gauche cède
    return link.turn === 'left' && (!oLink || oLink.turn !== 'left');
  }

  /** Le joueur est-il un usager prioritaire à laisser passer ? */
  private playerPriority(p: PlayerInfo, end: EdgeEnd, link: LaneLink, inX: number, inZ: number): boolean {
    const V = end.vertex;
    if (p.inJunction === V) {
      // déjà engagé : on le laisse dégager s'il coupe notre trajectoire (géré aussi par l'évitement)
      const pr = link.line.project(p.x, p.z);
      return Math.abs(pr.d) < 4.5;
    }
    const pe = p.approach;
    if (!pe || pe.vertex !== V || pe === end) return false;
    if (pe.control === 'signal' && pe.controller && pe.controller.state(pe.group, this.time) !== 'green') return false;
    const eta = p.approachDist / Math.max(2, Math.abs(p.speed));
    if (!(p.approachDist < 8 || eta < 3.2)) return false;
    if (Math.abs(p.speed) < 0.4 && p.approachDist > 1.5) {
      // joueur arrêté à distance de la ligne : il attend, on ne se bloque pas indéfiniment
      return this.hasPriorityOver(pe, null, end, link, inX, inZ) && p.approachDist < 6;
    }
    return this.hasPriorityOver(pe, null, end, link, inX, inZ);
  }

  // ───────────── cyclistes ─────────────
  private populateCyclists(player: PlayerInfo) {
    for (const c of this.cyclists) if (Math.hypot(c.x - player.x, c.z - player.z) > 200) c.alive = false;
    if (this.cyclists.length >= this.opts.cyclists || !this.cycleLanes.length) return;
    const near: Lane[] = [];
    for (const l of this.cycleLanes) {
      const p = l.line.at(2);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d > 50 && d < 170) near.push(l);
    }
    if (!near.length) return;
    const lane = this.rng.pick(near);
    if (this.cyclists.some((c) => c.lane === lane && c.s < 25)) return;
    const c = new Cyclist();
    c.id = this.nextId++;
    c.seed = (this.rng.next() * 1e9) | 0;
    c.lane = lane; c.s = 2;
    c.cruise = this.rng.range(3.9, 5.8); // 14 à 21 km/h
    c.v = c.cruise;
    c.nextLane = this.nextCycleLane(lane);
    this.placeCyclist(c);
    this.cyclists.push(c);
  }

  /** Bande cyclable qui prolonge celle-ci, en face, de l'autre côté du carrefour. */
  private nextCycleLane(lane: Lane): Lane | null {
    const V = lane.endRef.vertex;
    const a = lane.line.at(lane.line.length);
    let best: Lane | null = null, bd = 0.6;
    for (const o of this.cycleLanes) {
      if (o === lane || o.startRef.vertex !== V || o.edge === lane.edge) continue;
      const b = o.line.at(0);
      const dev = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
      // en face : dans l'axe, et pas trop décalé latéralement
      const lat = Math.abs((b.x - a.x) * -a.tz + (b.z - a.z) * a.tx);
      if (dev < bd && lat < 4 && Math.hypot(b.x - a.x, b.z - a.z) < 60) { bd = dev; best = o; }
    }
    return best;
  }

  private placeCyclist(c: Cyclist) {
    const L = c.conn ?? c.lane.line;
    const p = L.at(c.s - c.length / 2);
    c.x = p.x; c.z = p.z;
    c.heading = Math.atan2(p.tx, -p.tz);
  }

  private stepCyclist(c: Cyclist, dt: number, player: PlayerInfo | null) {
    if (c.hit) { c.v = 0; c.wait += dt; if (c.wait > 6) c.alive = false; return; }
    const L = c.conn ?? c.lane.line;
    const rem = L.length - c.s;
    let stop = Infinity;
    if (!c.conn) {
      const lane = c.lane;
      // piétons engagés sur un passage devant
      for (const cr of lane.edge.crossings) {
        const d = lane.fromEdgeS(cr.s) - cr.halfLen - 1 - c.s;
        if (d < -1 || d > 25) continue;
        if (this.pedestrians.some((p) => p.crossing === cr && p.state === 'cross')) stop = Math.min(stop, Math.max(0, d));
      }
      // autre cycliste devant
      for (const o of this.cyclists) if (o !== c && !o.conn && o.lane === lane && o.s > c.s) stop = Math.min(stop, o.s - o.length - c.s - 1.5);
      // carrefour au bout de la bande
      const end = lane.endRef;
      if (end.vertex.ends.length >= 3) {
        const dEnd = Math.max(0, rem - 2.5);
        let hold = false;
        if (end.control === 'signal' && end.controller) hold = end.controller.state(end.group, this.time) !== 'green';
        else if (rem < 14 && c.wait < 9) {
          // sans feu : on passe quand rien ne bouge dans le carrefour
          const V = end.vertex;
          for (const o of this.vehicles) if (o.v > 1 && ((o.link && o.link.vertex === V) || (o.lane && o.lane.to === V && o.lane.line.length - o.s < 12 && o.lane.edge !== lane.edge))) { hold = true; break; }
          if (player && player.inJunction === V && Math.abs(player.speed) > 1) hold = true;
        }
        if (hold) stop = Math.min(stop, dEnd);
      }
    }
    // la voiture du joueur en travers de la bande
    if (player) {
      const pr = L.project(player.x, player.z);
      const d = pr.s - c.s - player.length / 2;
      if (Math.abs(pr.d) < 1.3 && d > -0.5 && d < 10 && pr.s < L.length - 0.01) stop = Math.min(stop, Math.max(0, d - 1));
    }
    let vt = c.cruise;
    if (stop < Infinity) vt = Math.min(vt, Math.sqrt(2 * 1.6 * Math.max(0, stop - 0.3)));
    if (!c.conn && c.lane.endRef.vertex.ends.length >= 3 && rem < 10) vt = Math.min(vt, 3.2); // on aborde le carrefour au ralenti
    c.v = Math.max(0, c.v + clamp((vt - c.v) * 1.5, -3.5, 0.9) * dt);
    if (c.v < 0.05 && vt < 0.1) { c.v = 0; c.wait += dt; } else if (c.v > 1) c.wait = 0;
    const ds = c.v * dt;
    c.s += ds; c.phase += ds;
    c.lean = clamp(L.curvatureAt(c.s, 3) * c.v * c.v / 9.81, -0.3, 0.3);
    if (c.s >= L.length) {
      if (c.conn) { c.lane = c.nextLane!; c.conn = null; c.s = 0.01; c.nextLane = this.nextCycleLane(c.lane); }
      else if (c.nextLane) {
        const a = L.at(L.length), b = c.nextLane.line.at(0);
        c.conn = new Polyline([a.x, a.z, b.x, b.z]); c.s = 0.01;
      } else { c.alive = false; return; } // la bande s'arrête : le cycliste quitte la simulation
    }
    this.placeCyclist(c);
  }

  // ───────────── piétons ─────────────
  private pedWave = new Map<Crossing, { t: number; n: number }>();
  private populatePedestrians(player: PlayerInfo) {
    for (const p of this.pedestrians) if (Math.hypot(p.x - player.x, p.z - player.z) > 170) p.alive = false;
    if (this.pedestrians.length >= this.opts.pedestrians) return;
    // passages proches du joueur
    const near: Crossing[] = [];
    for (const c of this.net.crossings) {
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d > 25 && d < 140) near.push(c);
    }
    if (!near.length) return;
    for (let k = 0; k < 3 && this.pedestrians.length < this.opts.pedestrians; k++) {
      const c = this.rng.pick(near);
      if (this.pedestrians.filter((p) => p.crossing === c).length >= 3) continue;
      // les piétons arrivent par petites vagues : après un groupe, le passage reste calme un moment,
      // sinon un flux continu paralyse le carrefour
      const w = this.pedWave.get(c);
      if (w && this.time - w.t < 34 && (this.time - w.t > 5 || w.n >= 2)) continue;
      if (!w || this.time - w.t >= 34) this.pedWave.set(c, { t: this.time, n: 1 }); else w.n++;
      this.spawnPedestrian(c);
    }
  }

  spawnPedestrian(c: Crossing, side?: 1 | -1, startAtKerb = false): Pedestrian {
    const p = new Pedestrian();
    p.id = this.nextId++;
    p.seed = this.rng.int(1, 1e9);
    p.crossing = c;
    p.side = side ?? (this.rng.next() < 0.5 ? 1 : -1);
    p.walkSpeed = this.rng.range(1.1, 1.6);
    p.assertive = this.rng.next();
    // départ sur le trottoir, à quelques mètres du passage
    const half = c.edge.half + 1.0;
    const along = startAtKerb ? 0 : this.alongSidewalk(c, this.rng.range(-9, 9));
    const nx = -c.tz, nz = c.tx;
    const lat = p.side * (half + (startAtKerb ? 0 : this.rng.range(0.4, 1.6)));
    // position prise le long de l'axe réel de la rue (qui peut être courbe)
    const start = c.edge.line.atOffset(c.s + along, lat);
    p.x = start.x; p.z = start.z;
    this.setTarget(p, c.x + nx * p.side * half + c.tx * this.rng.range(-c.halfLen * 0.6, c.halfLen * 0.6), c.z + nz * p.side * half + c.tz * this.rng.range(-c.halfLen * 0.6, c.halfLen * 0.6));
    p.state = 'approach';
    this.pedestrians.push(p);
    return p;
  }

  /**
   * Déplacement le long du trottoir à partir d'un passage : borné pour ne jamais déborder sur
   * la chaussée de la rue transversale (on reste entre les deux embouchures de la rue).
   */
  private alongSidewalk(c: Crossing, wanted: number): number {
    const e = c.edge;
    const lo = e.endA.trim + 2.5 - c.s, hi = e.length - e.endB.trim - 2.5 - c.s;
    if (lo >= hi) return 0;
    // si le sens voulu est bouché par le carrefour, on part de l'autre côté
    if (wanted < lo && -wanted <= hi) wanted = -wanted;
    else if (wanted > hi && -wanted >= lo) wanted = -wanted;
    return clamp(wanted, Math.min(lo, 0), Math.max(hi, 0));
  }

  private setTarget(p: Pedestrian, x: number, z: number) {
    p.tx = x; p.tz = z;
  }

  private stepPedestrian(p: Pedestrian, dt: number, player: PlayerInfo | null) {
    if (p.hit) { p.speed = 0; return; }
    const c = p.crossing!;
    const dx = p.tx - p.x, dz = p.tz - p.z;
    const dist = Math.hypot(dx, dz);
    const walk = (speed: number) => {
      if (dist > 0.05) {
        const want = Math.atan2(dx, -dz);
        let dh = want - p.heading;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        p.heading += clamp(dh, -5 * dt, 5 * dt);
        const step = Math.min(dist, speed * dt);
        p.x += (dx / dist) * step; p.z += (dz / dist) * step;
        p.phase += step; p.speed = speed;
      } else p.speed = 0;
    };
    const nx = -c.tz, nz = c.tx;
    switch (p.state) {
      case 'approach':
        walk(p.walkSpeed);
        if (dist < 0.25) { p.state = 'wait'; p.waitTime = 0; p.speed = 0; }
        break;
      case 'wait': {
        p.speed = 0;
        p.waitTime += dt;
        // face à la chaussée
        const want = Math.atan2(-nx * p.side, nz * p.side);
        let dh = want - p.heading;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        p.heading += clamp(dh, -4 * dt, 4 * dt);
        // feu piéton
        if (c.controller) {
          p.hasRight = c.controller.pedWalk(c.group, this.time);
          if (!p.hasRight) break;
        } else p.hasRight = true;
        if (p.waitTime < 0.7) break;
        // acceptation de créneau : véhicules en approche (IA et joueur)
        if (this.crossingClear(c, p, player)) {
          p.state = 'cross'; p.progress = 0;
          const half = c.edge.half + 1.0;
          const k = ((p.tx - c.x) * c.tx + (p.tz - c.z) * c.tz);
          this.setTarget(p, c.x - nx * p.side * half + c.tx * k, c.z - nz * p.side * half + c.tz * k);
        }
        break;
      }
      case 'cross': {
        walk(p.walkSpeed * 1.05);
        const half = c.edge.half + 1.0;
        const lat = (p.x - c.x) * nx + (p.z - c.z) * nz;
        p.progress = clamp((half - lat * p.side) / (2 * half), 0, 1);
        if (dist < 0.3) {
          p.state = 'leave';
          const along = this.alongSidewalk(c, this.rng.range(8, 22) * (this.rng.next() < 0.5 ? -1 : 1));
          const out = this.rng.range(0.3, 1.2);
          const k = (p.x - c.x) * c.tx + (p.z - c.z) * c.tz;
          const goal = c.edge.line.atOffset(c.s + k + along, -p.side * (half + out));
          this.setTarget(p, goal.x, goal.z);
        }
        break;
      }
      case 'leave':
        walk(p.walkSpeed);
        if (dist < 0.3) p.alive = false;
        break;
      case 'stroll':
        walk(p.walkSpeed);
        if (dist < 0.3) p.alive = false;
        break;
    }
  }

  /** Le piéton peut-il s'engager ? (aucun véhicule trop proche pour s'arrêter) */
  private crossingClear(c: Crossing, p: Pedestrian, player: PlayerInfo | null): boolean {
    // un piéton pressé accepte un créneau plus court ; au feu vert piéton, il s'engage si les voitures sont arrêtées
    const need = c.controller ? 1.2 : 2.2 + (1 - p.assertive) * 2.2;
    const check = (x: number, z: number, hx: number, hz: number, speed: number): boolean => {
      const rx = c.x - x, rz = c.z - z;
      const along = rx * hx + rz * hz; // distance jusqu'au passage dans le sens de marche du véhicule
      const lat = Math.abs(rx * -hz + rz * hx);
      if (along < -3 || along > 60 || lat > c.edge.half + 2) return true;
      // un véhicule arrêté cède le passage ; il ne gêne que s'il est immobilisé sur le passage lui-même
      // (mesuré dans le repère du passage : une voiture arrêtée dans la rue voisine ne compte pas)
      if (speed < 0.5) {
        const a = -(rx * c.tx + rz * c.tz), n = -(rx * -c.tz + rz * c.tx);
        return Math.abs(a) > c.halfLen + 2.3 || Math.abs(n) > c.edge.half + 0.4;
      }
      const eta = along / speed;
      // le véhicule doit pouvoir s'arrêter confortablement
      const stopDist = speed * 1.0 + (speed * speed) / (2 * 3.0);
      return eta > need && along > stopDist * (0.8 + 0.4 * (1 - p.assertive));
    };
    for (const v of this.vehicles) {
      if (Math.abs(v.x - c.x) > 70 || Math.abs(v.z - c.z) > 70) continue;
      if (!check(v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading), v.v)) return false;
    }
    if (player) {
      const sp = Math.abs(player.speed);
      const s = player.speed >= 0 ? 1 : -1;
      if (!check(player.x, player.z, Math.sin(player.heading) * s, -Math.cos(player.heading) * s, sp)) return false;
    }
    return true;
  }
}
