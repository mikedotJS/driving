// Voiture du joueur : physique, accessoires (clignotants, ceinture, frein à main, feux),
// lecture du sol sous les roues et collisions avec le décor et les autres usagers.

import { Car, type CarInputs, type TransmissionMode } from '../vehicle/car';
import type { InputState } from '../input/controls';
import type { Ground, Segment } from '../world/ground';
import { boxVsSegment } from '../world/ground';
import type { Traffic, Vehicle, Pedestrian } from '../traffic/traffic';
import type { RoadNet } from '../map/roadnet';
import { clamp } from '../core/math';

export interface StaticBox { x: number; z: number; heading: number; halfLen: number; halfWid: number }

export interface PlayerEvents {
  collision?: (kind: 'decor' | 'vehicule' | 'pieton' | 'poteau', speed: number) => void;
  kerb?: (wheel: number, up: boolean, speed: number) => void;
  message?: (text: string) => void;
  horn?: (on: boolean) => void;
  sound?: (name: 'gear' | 'grind' | 'stall' | 'handbrake-on' | 'handbrake-off' | 'seatbelt' | 'tick' | 'start-refused') => void;
}

export class Player {
  readonly car = new Car();
  inputs: CarInputs = { steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 1 };
  indicator: -1 | 0 | 1 = 0;
  hazards = false;
  seatbelt = false;
  lights = false;
  handbrake = true;
  horn = false;
  lookLeftAt = -99; lookRightAt = -99; lookBackAt = -99;
  /** phase du clignotant (0..1), allumé si < 0,5 */
  blink = 0;
  events: PlayerEvents = {};
  time = 0;
  /** obstacles fixes supplémentaires (voitures garées) */
  boxes: (x: number, z: number, r: number) => StaticBox[] = () => [];
  posts: (x: number, z: number, r: number) => { x: number; z: number; r: number }[] = () => [];
  private segBuf: Segment[] = [];
  private armed = 0;         // angle max atteint dans le sens du clignotant (rappel automatique)
  private lastHit = -9;
  starterHeld = 0;

  constructor(private ground: Ground, private net: RoadNet, private traffic: Traffic | null) {
    this.car.events.kerb = (w, up, sp) => this.events.kerb?.(w, up, sp);
    this.car.events.grind = () => this.events.sound?.('grind');
    this.car.events.shift = () => this.events.sound?.('gear');
    this.car.events.stall = () => this.events.sound?.('stall');
  }

  get mode(): TransmissionMode { return this.car.mode; }
  get indicatorLit(): boolean { return this.blink < 0.5; }
  get leftOn(): boolean { return (this.hazards || this.indicator < 0) && this.indicatorLit; }
  get rightOn(): boolean { return (this.hazards || this.indicator > 0) && this.indicatorLit; }

  spawn(x: number, z: number, heading: number, opts: { running?: boolean; belt?: boolean } = {}) {
    const c = this.car;
    c.reset(x, z, heading);
    c.stopEngine();
    c.gear = 0; c.lever = 0; c.selector = c.mode === 'auto' ? 'P' : 'N';
    this.indicator = 0; this.hazards = false; this.handbrake = true; this.horn = false;
    this.seatbelt = !!opts.belt;
    if (opts.running) {
      c.ignition = true; c.engineRunning = true; c.engineOmega = (c.spec.idleRpm * Math.PI) / 30;
    }
    this.sampleGround();
  }

  private sampleGround() {
    const c = this.car;
    for (let i = 0; i < 4; i++) {
      const [wx, wz] = c.wheelWorld(i);
      c.groundH[i] = this.ground.height(wx, wz);
    }
  }

  update(dt: number, input: InputState) {
    this.time += dt;
    const c = this.car;
    const P = input.pressed;

    // ── accessoires ──
    if (P.has('indicatorLeft')) this.setIndicator(this.indicator === -1 ? 0 : -1);
    if (P.has('indicatorRight')) this.setIndicator(this.indicator === 1 ? 0 : 1);
    if (P.has('hazards')) { this.hazards = !this.hazards; this.blink = 0; }
    if (P.has('seatbelt')) { this.seatbelt = !this.seatbelt; this.events.sound?.('seatbelt'); }
    if (P.has('lights')) this.lights = !this.lights;
    if (P.has('handbrake')) { this.handbrake = !this.handbrake; this.events.sound?.(this.handbrake ? 'handbrake-on' : 'handbrake-off'); }
    const horn = input.held.has('horn');
    if (horn !== this.horn) { this.horn = horn; this.events.horn?.(horn); }
    if (input.held.has('lookLeft')) this.lookLeftAt = this.time;
    if (input.held.has('lookRight')) this.lookRightAt = this.time;
    if (input.held.has('lookBack')) this.lookBackAt = this.time;

    // clignotant : cadence 1,5 Hz et rappel automatique au retour du volant
    const blinking = this.hazards || this.indicator !== 0;
    if (blinking) {
      const before = this.blink;
      this.blink = (this.blink + dt * 1.5) % 1;
      if ((before < 0.5) !== (this.blink < 0.5)) this.events.sound?.('tick');
    } else this.blink = 0;
    if (this.indicator !== 0) {
      const along = input.steer * this.indicator; // > 0 : volant tourné du côté du clignotant
      if (along > this.armed) this.armed = along;
      if (this.armed > 0.2 && along < 0.04) this.setIndicator(0);
    }

    // ── moteur ──
    this.inputs.steer = input.steer;
    this.inputs.throttle = input.throttle;
    this.inputs.brake = input.brake;
    this.inputs.clutch = c.mode === 'manual' ? input.clutch : 0;
    this.inputs.handbrake = this.handbrake ? 1 : 0;
    if (P.has('start')) {
      if (c.engineRunning) { c.stopEngine(); this.events.message?.('Moteur coupé.'); }
      else {
        const r = c.startEngine(this.inputs);
        if (r === 'clutch') {
          this.events.sound?.('start-refused');
          this.events.message?.(c.mode === 'auto' ? 'Mettez le sélecteur sur P ou N pour démarrer.' : 'Débrayez à fond (ou passez au point mort) pour démarrer.');
        }
      }
    }

    // ── boîte de vitesses ──
    if (c.mode === 'auto') {
      const order: ('P' | 'R' | 'N' | 'D')[] = ['P', 'R', 'N', 'D'];
      let i = order.indexOf(c.selector);
      if (P.has('shiftUp')) i = Math.min(3, i + 1);
      if (P.has('shiftDown')) i = Math.max(0, i - 1);
      if (P.has('gearR')) i = 1; if (P.has('gearN')) i = 2; if (P.has('gear1')) i = 3;
      if (order[i] !== c.selector) {
        // on ne quitte P qu'en freinant
        if (c.selector === 'P' && input.brake < 0.2) this.events.message?.('Appuyez sur le frein pour quitter la position P.');
        else { c.selector = order[i]; this.events.sound?.('gear'); }
      }
      if (c.selector === 'P') this.inputs.handbrake = 1;
    } else if (input.hGear !== null) {
      c.requestGear(input.hGear);
    } else {
      if (P.has('shiftUp')) c.shiftUp();
      if (P.has('shiftDown')) c.shiftDown();
      if (P.has('gearN')) c.requestGear(0);
      if (P.has('gearR')) c.requestGear(-1);
      for (let g = 1; g <= 6; g++) if (P.has(('gear' + g) as 'gear1')) c.requestGear(g);
    }

    // ── physique ──
    this.sampleGround();
    const e = this.net.locate(c.x, c.z, c.heading)?.edge;
    const grip = e && e.sett ? 0.86 : 1;
    for (let i = 0; i < 4; i++) c.grip[i] = c.groundH[i] > 0 ? 0.9 : grip;
    c.update(dt, this.inputs);
    this.collide();
  }

  setIndicator(v: -1 | 0 | 1) {
    this.indicator = v; this.armed = 0;
    if (v !== 0) this.blink = 0;
  }

  // ───────────────────────── collisions ─────────────────────────
  private collide() {
    const c = this.car, S = c.spec;
    const halfLen = S.length / 2, halfWid = S.width / 2;
    // décalage du centre géométrique par rapport au centre de gravité (vers l'avant)
    const shift = S.cgToFront + S.frontOverhang - halfLen;
    const fx = c.forwardX, fz = c.forwardZ;

    // murs et façades
    this.ground.segmentsNear(c.x, c.z, halfLen + 1.5, this.segBuf);
    for (const s of this.segBuf) {
      const hit = boxVsSegment(c.x, c.z, fx, fz, halfLen, halfWid, shift, s);
      if (hit) this.resolve(hit.nx, hit.nz, hit.depth, hit.px, hit.pz, 0, 0, s.kind === 'hedge' ? 'poteau' : 'decor');
    }
    // poteaux, arbres
    for (const p of this.posts(c.x, c.z, halfLen + 1)) this.circle(p.x, p.z, p.r, 0, 0, 'poteau');
    // voitures garées
    for (const b of this.boxes(c.x, c.z, halfLen + 4)) this.box(b.x, b.z, b.heading, b.halfLen, b.halfWid, 0, 0, null);

    if (this.traffic) {
      for (const v of this.traffic.vehicles) {
        const d = Math.hypot(v.x - c.x, v.z - c.z);
        if (d > halfLen + v.length / 2 + 1) continue;
        const sp = v.v;
        this.box(v.x, v.z, v.heading, v.length / 2, v.width / 2, Math.sin(v.heading) * sp, -Math.cos(v.heading) * sp, v);
      }
      for (const p of this.traffic.pedestrians) {
        if (p.hit) continue;
        if (Math.abs(p.x - c.x) > 4 || Math.abs(p.z - c.z) > 4) continue;
        this.circle(p.x, p.z, 0.28, Math.sin(p.heading) * p.speed, -Math.cos(p.heading) * p.speed, 'pieton', p);
      }
    }
  }

  /** Cercle (poteau, piéton) contre le rectangle de la voiture. */
  private circle(px: number, pz: number, r: number, vx: number, vz: number, kind: 'poteau' | 'pieton', ped?: Pedestrian) {
    const c = this.car, S = c.spec;
    const halfLen = S.length / 2, halfWid = S.width / 2;
    const shift = S.cgToFront + S.frontOverhang - halfLen;
    const fx = c.forwardX, fz = c.forwardZ, rx = -fz, rz = fx;
    const ox = c.x + fx * shift, oz = c.z + fz * shift;
    const lx = (px - ox) * fx + (pz - oz) * fz, ly = (px - ox) * rx + (pz - oz) * rz;
    const qx = clamp(lx, -halfLen, halfLen), qy = clamp(ly, -halfWid, halfWid);
    let dx = lx - qx, dy = ly - qy;
    let d = Math.hypot(dx, dy);
    if (d >= r) return;
    let depth: number;
    if (d < 1e-6) {
      // centre à l'intérieur : sortie par la face la plus proche
      const ex = halfLen - Math.abs(lx), ey = halfWid - Math.abs(ly);
      if (ex < ey) { dx = Math.sign(lx) || 1; dy = 0; depth = ex + r; } else { dx = 0; dy = Math.sign(ly) || 1; depth = ey + r; }
      d = 1;
    } else depth = r - d;
    // normale de l'obstacle vers la voiture (repère monde)
    const nlx = -dx / d, nly = -dy / d;
    const nx = nlx * fx + nly * rx, nz = nlx * fz + nly * rz;
    const cx = ox + qx * fx + qy * rx, cz = oz + qx * fz + qy * rz;
    if (kind === 'pieton' && ped) {
      const [pvx, pvz] = c.pointVelocity(cx, cz);
      const rel = Math.hypot(pvx - vx, pvz - vz);
      if (rel > 0.6) { ped.hit = true; this.hit('pieton', rel); }
      return; // un piéton n'arrête pas la voiture
    }
    this.resolve(nx, nz, depth, cx, cz, vx, vz, 'poteau');
  }

  /** Rectangle orienté (autre voiture) contre la voiture du joueur : test par axes séparateurs. */
  private box(bx: number, bz: number, bh: number, bHalfLen: number, bHalfWid: number, bvx: number, bvz: number, veh: Vehicle | null) {
    const c = this.car, S = c.spec;
    const aHalfLen = S.length / 2, aHalfWid = S.width / 2;
    const shift = S.cgToFront + S.frontOverhang - aHalfLen;
    const afx = c.forwardX, afz = c.forwardZ, arx = -afz, arz = afx;
    const ax = c.x + afx * shift, az = c.z + afz * shift;
    const bfx = Math.sin(bh), bfz = -Math.cos(bh), brx = -bfz, brz = bfx;
    const dx = bx - ax, dz = bz - az;
    let best = Infinity, bnx = 0, bnz = 0;
    const axes: [number, number][] = [[afx, afz], [arx, arz], [bfx, bfz], [brx, brz]];
    for (const [ux, uz] of axes) {
      const ra = aHalfLen * Math.abs(afx * ux + afz * uz) + aHalfWid * Math.abs(arx * ux + arz * uz);
      const rb = bHalfLen * Math.abs(bfx * ux + bfz * uz) + bHalfWid * Math.abs(brx * ux + brz * uz);
      const dist = dx * ux + dz * uz;
      const overlap = ra + rb - Math.abs(dist);
      if (overlap <= 0) return;
      if (overlap < best) { best = overlap; const s = dist > 0 ? -1 : 1; bnx = ux * s; bnz = uz * s; }
    }
    // point de contact approximatif : milieu entre les deux centres, ramené sur la voiture du joueur
    const px = ax + clamp((dx * afx + dz * afz) * 0.5, -aHalfLen, aHalfLen) * afx + clamp((dx * arx + dz * arz) * 0.5, -aHalfWid, aHalfWid) * arx;
    const pz = az + clamp((dx * afx + dz * afz) * 0.5, -aHalfLen, aHalfLen) * afz + clamp((dx * arx + dz * arz) * 0.5, -aHalfWid, aHalfWid) * arz;
    const speed = this.resolve(bnx, bnz, best, px, pz, bvx, bvz, 'vehicule');
    if (veh && speed > 0.3) veh.crashed = Math.max(veh.crashed, 2.5);
  }

  /**
   * Sépare la voiture de l'obstacle et applique l'impulsion de choc.
   * (nx, nz) : normale de l'obstacle vers la voiture ; (ovx, ovz) : vitesse de l'obstacle.
   * Renvoie la vitesse d'impact.
   */
  private resolve(nx: number, nz: number, depth: number, px: number, pz: number, ovx: number, ovz: number, kind: 'decor' | 'vehicule' | 'poteau'): number {
    const c = this.car, S = c.spec;
    c.x += nx * depth; c.z += nz * depth;
    const [vx, vz] = c.pointVelocity(px, pz);
    const vn = (vx - ovx) * nx + (vz - ovz) * nz;
    if (vn >= 0) return 0;
    const rx = px - c.x, rz = pz - c.z;
    const rn = rx * nz - rz * nx;
    const e = 0.12;
    const j = (-(1 + e) * vn) / (1 / S.mass + (rn * rn) / S.yawInertia);
    c.applyImpulse(nx * j, nz * j, px, pz);
    // frottement tangent (la carrosserie racle)
    const tx = -nz, tz = nx;
    const vt = (vx - ovx) * tx + (vz - ovz) * tz;
    const jt = clamp(-vt * S.mass * 0.25, -0.4 * j, 0.4 * j);
    c.applyImpulse(tx * jt, tz * jt, px, pz);
    const impact = -vn;
    if (impact > 0.6) this.hit(kind, impact);
    return impact;
  }

  private hit(kind: 'decor' | 'vehicule' | 'pieton' | 'poteau', speed: number) {
    if (this.time - this.lastHit < 0.5 && kind !== 'pieton') return;
    this.lastHit = this.time;
    this.events.collision?.(kind, speed);
  }
}
