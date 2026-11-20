// Modèle dynamique de la voiture du joueur.
//
// - Châssis plan à 3 degrés de liberté (avance, dérive, lacet) + caisse suspendue
//   (roulis, tangage, pompage) qui pilote le transfert de charge.
// - 4 roues avec rotation propre ; pneus « formule magique » en glissement combiné,
//   avec longueurs de relaxation (comportement correct à très basse vitesse et à l'arrêt).
// - Moteur (courbe de couple, frein moteur, régulation de ralenti, calage, démarreur),
//   embrayage à friction résolu implicitement, boîte 6 rapports, différentiel ouvert.
// - Freins avec ABS, frein à main sur l'arrière.
//
// Repères : monde x = est, z = sud ; cap ψ = 0 vers le nord, positif en sens horaire.
// Caisse : x vers l'avant, y vers la DROITE ; vitesse de lacet positive en sens horaire.
// Ordre des roues : AVG, AVD, ARG, ARD.

import { clamp, clamp01, DEG, table, approach } from '../core/math';
import { CITADINE, type CarSpec } from './spec';

export type TransmissionMode = 'manual' | 'autoclutch' | 'auto';

export interface CarInputs {
  /** position du volant, -1 (butée gauche) … +1 (butée droite) */
  steer: number;
  throttle: number;
  brake: number;
  /** pédale d'embrayage : 1 = enfoncée (débrayé) */
  clutch: number;
  handbrake: number;
}

export interface CarEvents {
  stall?: () => void;
  grind?: () => void;
  started?: () => void;
  shift?: (gear: number) => void;
  kerb?: (wheel: number, up: boolean, speed: number) => void;
}

const G = 9.81;
const RPM = (2 * Math.PI) / 60; // tr/min → rad/s
const AIR_RHO = 1.2;
const MF_C = 1.4;
const MF_B = Math.tan(Math.PI / (2 * MF_C));
const SUBSTEP = 1 / 1000;

/** Courbe d'adhérence normalisée (pic = 1 pour ρ = 1). */
function magic(rho: number): number {
  return Math.sin(MF_C * Math.atan(MF_B * rho));
}

export class Car {
  readonly spec: CarSpec;
  events: CarEvents = {};
  mode: TransmissionMode = 'manual';

  // ── pose et vitesses ──
  x = 0; z = 0; heading = 0;
  vx = 0; vy = 0; yawRate = 0;
  /** accélérations dans le repère caisse (m/s²) */
  ax = 0; ay = 0;

  // ── roues ──
  readonly wheelOmega = new Float64Array(4);
  readonly wheelAngle = new Float64Array(4);
  readonly kappa = new Float64Array(4);
  readonly tanAlpha = new Float64Array(4);
  readonly fz = new Float64Array(4);
  /** glissement combiné normalisé (1 = limite d'adhérence) */
  readonly slip = new Float64Array(4);
  /** coefficient d'adhérence du sol sous chaque roue */
  readonly grip = new Float64Array([1, 1, 1, 1]);
  /** hauteur du sol sous chaque roue (trottoir = 0,14) */
  readonly groundH = new Float64Array(4);
  private readonly prevGroundH = new Float64Array(4);
  readonly steerWheelAngle = new Float64Array(4);
  readonly absMod = new Float64Array([1, 1, 1, 1]);
  readonly fxWheel = new Float64Array(4);
  readonly fyWheel = new Float64Array(4);
  /** angle de braquage moyen des roues avant (rad) */
  steerAngle = 0;

  // ── groupe motopropulseur ──
  engineOmega = 0;
  engineRunning = false;
  ignition = false;
  private starter = 0;
  private starterTime = 0;
  throttleEff = 0;
  private idleInt = 0.12;
  private idleEff = 0.12;
  private pedalLag = 0;
  engineTorque = 0;
  clutchTorque = 0;
  private revCut = false;
  /** rapport engagé : -1 = marche arrière, 0 = point mort */
  gear = 0;
  /** rapport demandé par le levier (boîte en H) */
  lever = 0;
  private grindCooldown = 0;
  /** sélecteur de boîte automatique */
  selector: 'P' | 'R' | 'N' | 'D' = 'N';
  private shiftTimer = 0;
  private shiftHold = 0;
  private autoClutchPedal = 1;
  /** pédale d'embrayage effective (réelle ou pilotée) */
  clutchPedal = 0;
  /** l'embrayage patine-t-il ? */
  clutchSlip = 0;

  // ── caisse ──
  roll = 0; rollVel = 0;
  pitch = 0; pitchVel = 0;
  heave = 0; heaveVel = 0;

  // ── sorties ──
  /** couple ressenti au volant (N·m, positif = tend à tourner vers la droite) */
  steerTorque = 0;
  absActive = false;
  brakePressure = 0;
  odometer = 0;
  stalledFlag = false;

  private readonly px: number[];
  private readonly py: number[];
  private readonly fz0: number[];
  private readonly kRoll: number; private readonly cRoll: number; private readonly iRoll: number;
  private readonly kPitch: number; private readonly cPitch: number; private readonly iPitch: number;
  private readonly wHeave: number;

  constructor(spec: CarSpec = CITADINE) {
    this.spec = spec;
    const a = spec.cgToFront, b = spec.wheelbase - a;
    this.px = [a, a, -b, -b];
    this.py = [-spec.trackFront / 2, spec.trackFront / 2, -spec.trackRear / 2, spec.trackRear / 2];
    const wf = (spec.mass * G * b) / spec.wheelbase / 2;
    const wr = (spec.mass * G * a) / spec.wheelbase / 2;
    this.fz0 = [wf, wf, wr, wr];
    for (let i = 0; i < 4; i++) this.fz[i] = this.fz0[i];
    const mh = spec.mass * spec.cgHeight;
    this.kRoll = (mh * G) / (spec.rollGradDegPerG * DEG);
    this.kPitch = (mh * G) / (spec.pitchGradDegPerG * DEG);
    const wRoll = 2 * Math.PI * spec.bodyFreqHz * 1.35;
    const wPitch = 2 * Math.PI * spec.bodyFreqHz;
    this.iRoll = this.kRoll / (wRoll * wRoll);
    this.iPitch = this.kPitch / (wPitch * wPitch);
    this.cRoll = 2 * spec.bodyDamping * Math.sqrt(this.kRoll * this.iRoll);
    this.cPitch = 2 * spec.bodyDamping * Math.sqrt(this.kPitch * this.iPitch);
    this.wHeave = 2 * Math.PI * spec.bodyFreqHz;
  }

  // ── grandeurs dérivées ──
  get speed(): number { return Math.hypot(this.vx, this.vy); }
  get speedKmh(): number { return this.speed * 3.6; }
  get rpm(): number { return this.engineOmega / RPM; }
  /** vitesse sol → régime moteur dans le rapport courant */
  get gearRatio(): number {
    const s = this.spec;
    if (this.gear === 0) return 0;
    return (this.gear < 0 ? -s.reverse : s.gears[this.gear - 1]) * s.finalDrive;
  }
  get forwardX(): number { return Math.sin(this.heading); }
  get forwardZ(): number { return -Math.cos(this.heading); }
  /** position monde d'un point exprimé dans le repère caisse (avant, droite) */
  worldPoint(fwd: number, right: number): [number, number] {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    return [this.x + s * fwd + c * right, this.z - c * fwd + s * right];
  }
  wheelWorld(i: number): [number, number] { return this.worldPoint(this.px[i], this.py[i]); }
  /** les 4 coins de la carrosserie (repère monde) */
  corners(margin = 0): [number, number][] {
    const s = this.spec;
    const front = s.cgToFront + s.frontOverhang + margin;
    const rear = front - s.length - 2 * margin;
    const hw = s.width / 2 + margin;
    return [this.worldPoint(front, -hw), this.worldPoint(front, hw), this.worldPoint(rear, hw), this.worldPoint(rear, -hw)];
  }

  reset(x: number, z: number, heading: number) {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = this.vy = this.yawRate = 0;
    this.ax = this.ay = 0;
    this.wheelOmega.fill(0); this.kappa.fill(0); this.tanAlpha.fill(0);
    this.roll = this.rollVel = this.pitch = this.pitchVel = this.heave = this.heaveVel = 0;
    this.groundH.fill(0); this.prevGroundH.fill(0);
    for (let i = 0; i < 4; i++) this.fz[i] = this.fz0[i];
  }

  // ── commandes ──
  /** Tourne la clé / appuie sur Start. */
  startEngine(inp: CarInputs): 'ok' | 'running' | 'clutch' {
    if (this.engineRunning) return 'running';
    this.ignition = true;
    const declutched = this.effectiveClutchPedal(inp) > 0.85;
    if (this.mode === 'manual' && this.gear !== 0 && !declutched) return 'clutch';
    if (this.mode === 'auto' && this.selector !== 'P' && this.selector !== 'N') return 'clutch';
    this.starter = 1; this.starterTime = 0;
    return 'ok';
  }
  stopEngine() {
    this.engineRunning = false; this.ignition = false; this.starter = 0;
  }

  /** Demande de rapport (levier en H ou séquentiel). */
  requestGear(g: number) {
    this.lever = clamp(Math.round(g), -1, this.spec.gears.length);
  }
  shiftUp() { if (this.lever < this.spec.gears.length) this.requestGear(this.lever === -1 ? 0 : this.lever + 1); }
  shiftDown() { if (this.lever > -1) this.requestGear(this.lever - 1); }

  private effectiveClutchPedal(inp: CarInputs): number {
    return this.mode === 'manual' ? inp.clutch : this.autoClutchPedal;
  }

  // ── intégration ──
  /** Avance la simulation de `dt` secondes (sous-pas internes de 1 ms). */
  update(dt: number, inp: CarInputs) {
    const n = clamp(Math.round(dt / SUBSTEP), 1, 60);
    const h = dt / n;
    for (let i = 0; i < n; i++) this.step(h, inp);
  }

  private step(dt: number, inp: CarInputs) {
    const S = this.spec;
    const R = S.wheelRadius;
    const L = S.wheelbase;

    // 1 ── direction (épure d'Ackermann)
    const delta = clamp(inp.steer, -1, 1) * S.maxSteerDeg * DEG;
    this.steerAngle = delta;
    let dFL = delta, dFR = delta;
    if (Math.abs(delta) > 1e-4) {
      const rad = L / Math.tan(delta);
      dFL = Math.atan(L / (rad + S.trackFront / 2));
      dFR = Math.atan(L / (rad - S.trackFront / 2));
    }
    this.steerWheelAngle[0] = dFL; this.steerWheelAngle[1] = dFR;

    // 2 ── boîte de vitesses et embrayage piloté
    this.updateTransmission(dt, inp);
    const pedal = this.effectiveClutchPedal(inp);
    this.clutchPedal = pedal;

    // 3 ── charges verticales (transfert de charge via la caisse suspendue)
    const hFront = (this.groundH[0] + this.groundH[1]) / 2, hRear = (this.groundH[2] + this.groundH[3]) / 2;
    const hLeft = (this.groundH[0] + this.groundH[2]) / 2, hRight = (this.groundH[1] + this.groundH[3]) / 2;
    const pitchBump = (hRear - hFront) / L;
    const rollBump = (hRight - hLeft) / S.trackFront;
    const dLong = (this.kPitch * (this.pitch - pitchBump) + this.cPitch * this.pitchVel) / L;
    const dLat = (this.kRoll * (this.roll - rollBump) + this.cRoll * this.rollVel) / ((S.trackFront + S.trackRear) / 2);
    const fShare = S.rollStiffnessFrontShare;
    const mq = S.mass / 4;
    const wz2 = this.wHeave * this.wHeave;
    let heaveForce = 0;
    for (let i = 0; i < 4; i++) {
      const front = i < 2, left = (i & 1) === 0;
      let f = this.fz0[i] + (front ? dLong / 2 : -dLong / 2) + (left ? 1 : -1) * dLat * (front ? fShare : 1 - fShare);
      const bump = mq * (wz2 * (this.groundH[i] - this.heave) - 2 * 0.35 * this.wHeave * this.heaveVel);
      f += bump; heaveForce += bump;
      this.fz[i] = Math.max(0, f);
      // franchissement de bordure : à-coup
      if (this.groundH[i] !== this.prevGroundH[i]) {
        const up = this.groundH[i] > this.prevGroundH[i];
        const sp = this.speed;
        if (up && sp > 0.3) {
          // perte d'énergie en montant la bordure
          const loss = Math.min(0.5, 0.06 + sp * 0.03);
          const k = Math.max(0, 1 - (loss / Math.max(sp, 0.5)) * 0.5);
          this.vx *= k; this.vy *= k;
        }
        this.events.kerb?.(i, up, sp);
        this.prevGroundH[i] = this.groundH[i];
      }
    }
    this.heaveVel += (heaveForce / S.mass) * dt;
    this.heave += this.heaveVel * dt;

    // 4 ── efforts des pneus
    const kPeak = S.slipRatioPeak;
    const tanPeak = Math.tan(S.slipAnglePeakDeg * DEG);
    let sumFx = 0, sumFy = 0, sumMz = 0, kingpin = 0;
    const fl = this.fxWheel, ft = this.fyWheel;
    for (let i = 0; i < 4; i++) {
      const d = i === 0 ? dFL : i === 1 ? dFR : 0;
      const c = Math.cos(d), s = Math.sin(d);
      const wvx = this.vx - this.yawRate * this.py[i];
      const wvy = this.vy + this.yawRate * this.px[i];
      const vl = wvx * c + wvy * s;
      const vt = -wvx * s + wvy * c;
      const wr = this.wheelOmega[i] * R;
      const av = Math.abs(vl);
      // états transitoires (relaxation)
      let k = this.kappa[i] + (dt * (wr - vl - av * this.kappa[i])) / S.relaxLong;
      let ta = this.tanAlpha[i] + (dt * (-vt - av * this.tanAlpha[i])) / S.relaxLat;
      k = clamp(k, -2.5, 2.5); ta = clamp(ta, -1.6, 1.6);
      this.kappa[i] = k; this.tanAlpha[i] = ta;
      // amortissement à basse vitesse (évite les oscillations à l'arrêt)
      const fade = av < 3 ? 0.5 * (1 + Math.cos((Math.PI * av) / 3)) : 0;
      const kEff = k + 0.03 * fade * (wr - vl);
      const tEff = ta + 0.08 * fade * -vt;
      const sx = kEff / kPeak, sy = tEff / tanPeak;
      const rho = Math.hypot(sx, sy);
      this.slip[i] = rho;
      let Fl = 0, Ft = 0;
      const fzi = this.fz[i];
      if (rho > 1e-9 && fzi > 0) {
        const mu = S.tyreMu * this.grip[i] * clamp(1 - S.tyreLoadSens * (fzi / this.fz0[i] - 1), 0.6, 1.25);
        const F = (mu * fzi * magic(rho)) / rho;
        Fl = F * sx; Ft = F * sy;
      }
      fl[i] = Fl; ft[i] = Ft;
      const Fx = Fl * c - Ft * s, Fy = Fl * s + Ft * c;
      sumFx += Fx; sumFy += Fy;
      sumMz += this.px[i] * Fy - this.py[i] * Fx;
      if (i < 2) {
        // couple d'auto-alignement : chasse pneumatique (s'annule à la limite) + chasse géométrique
        const trail = S.pneumaticTrail * Math.max(0, 1 - rho * 0.85) + S.casterTrail;
        kingpin += -Ft * trail;
      }
    }

    // 5 ── châssis
    const sp = this.speed;
    const drag = 0.5 * AIR_RHO * S.cdA * sp;
    const aX = (sumFx - drag * this.vx) / S.mass;
    const aY = (sumFy - drag * this.vy) / S.mass;
    this.ax = aX; this.ay = aY;
    this.vx += (aX + this.yawRate * this.vy) * dt;
    this.vy += (aY - this.yawRate * this.vx) * dt;
    this.yawRate += (sumMz / S.yawInertia) * dt;

    // caisse : roulis / tangage
    const mh = S.mass * S.cgHeight;
    this.rollVel += ((mh * aY - this.kRoll * (this.roll - rollBump) - this.cRoll * this.rollVel) / this.iRoll) * dt;
    this.roll += this.rollVel * dt;
    this.pitchVel += ((-mh * aX - this.kPitch * (this.pitch - pitchBump) - this.cPitch * this.pitchVel) / this.iPitch) * dt;
    this.pitch += this.pitchVel * dt;

    // 6 ── moteur
    const Te = this.engineTorqueAt(dt, inp);
    this.engineTorque = Te;

    // 7 ── embrayage (résolution implicite : colle si le couple requis tient dans la capacité)
    const Gr = this.gearRatio;
    const Iw = S.wheelInertia, Ie = S.engineInertia;
    let bite = clamp01((S.clutchBiteStart - pedal) / (S.clutchBiteStart - S.clutchBiteEnd));
    bite = bite * bite * (3 - 2 * bite); // progressivité
    const cap = Gr !== 0 ? S.clutchMaxTorque * Math.pow(bite, 1.3) : 0;
    const tTire0 = -fl[0] * R, tTire1 = -fl[1] * R;
    let Tc = 0;
    if (cap > 0) {
      const wIn = (Gr * (this.wheelOmega[0] + this.wheelOmega[1])) / 2;
      const aIn0 = (Gr * (tTire0 + tTire1)) / (2 * Iw);
      const slipPred = this.engineOmega - wIn + (Te / Ie - aIn0) * dt;
      const lock = slipPred / (dt * (1 / Ie + (Gr * Gr) / (2 * Iw)));
      Tc = clamp(lock, -cap, cap);
      this.clutchSlip = Math.abs(lock) > cap ? this.engineOmega - wIn : 0;
    } else this.clutchSlip = 0;
    this.clutchTorque = Tc;
    this.engineOmega += ((Te - Tc) / Ie) * dt;
    // frottements internes du moteur arrêté (tient la voiture en prise)
    if (!this.engineRunning && this.starter === 0) {
      const hold = 28;
      const stop = (this.engineOmega * Ie) / dt;
      this.engineOmega -= (clamp(stop, -hold, hold) * dt) / Ie;
    }
    if (this.engineOmega < 0) this.engineOmega = Math.max(this.engineOmega, -20);

    // 8 ── roues : couple moteur, pneus, freins (frottement résolu implicitement)
    const drive = (Tc * Gr * (Tc * this.engineOmega > 0 ? S.drivelineEfficiency : 1)) / 2;
    const brake = clamp01(inp.brake);
    this.brakePressure = brake;
    const hb = clamp01(inp.handbrake);
    let abs = false;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      // ABS : relâche la pression quand la roue part au blocage
      const wvx = this.vx - this.yawRate * this.py[i];
      if (brake > 0.05 && Math.abs(wvx) > 1.8) {
        const sr = (this.wheelOmega[i] * R - wvx) / Math.abs(wvx);
        const locking = wvx > 0 ? sr < -0.17 : sr > 0.17;
        if (locking) { this.absMod[i] = Math.max(0.05, this.absMod[i] - 28 * dt); abs = true; }
        else this.absMod[i] = Math.min(1, this.absMod[i] + 7 * dt);
      } else this.absMod[i] = Math.min(1, this.absMod[i] + 7 * dt);
      const tTire = -fl[i] * R;
      const tDrive = front ? drive : 0;
      const wFree = this.wheelOmega[i] + ((tDrive + tTire) / Iw) * dt;
      const capB = brake * (front ? S.brakeTorqueFront : S.brakeTorqueRear) * this.absMod[i]
        + (front ? 0 : hb * S.handbrakeTorque)
        + S.rollingResistance * this.fz[i] * R;
      const stop = (wFree * Iw) / dt;
      const w = wFree - (clamp(stop, -capB, capB) * dt) / Iw;
      this.wheelOmega[i] = w;
      this.wheelAngle[i] += w * dt;
    }
    this.absActive = abs;

    // 9 ── calage / démarrage
    if (this.engineRunning && this.engineOmega < S.stallRpm * RPM) {
      this.engineRunning = false;
      this.stalledFlag = true;
      this.events.stall?.();
    }
    if (this.starter > 0) {
      this.starterTime += dt;
      if (this.engineOmega > 260 * RPM && this.starterTime > 0.55) {
        this.engineRunning = true; this.starter = 0; this.idleInt = 0.2;
        this.stalledFlag = false;
        this.events.started?.();
      } else if (this.starterTime > 2.5) this.starter = 0;
    }

    // 10 ── couple au volant (retour d'effort)
    // assistance électrique : forte en manœuvre, plus légère en roulant
    const assist = 0.72 - 0.3 * clamp01(sp / 25);
    this.steerTorque = (kingpin / S.steeringRatio) * (1 - assist) * 1.15;

    // 11 ── position
    const sn = Math.sin(this.heading), cs = Math.cos(this.heading);
    this.x += (sn * this.vx + cs * this.vy) * dt;
    this.z += (-cs * this.vx + sn * this.vy) * dt;
    this.heading += this.yawRate * dt;
    this.odometer += sp * dt;
    if (this.grindCooldown > 0) this.grindCooldown -= dt;
  }

  /** Couple moteur instantané (N·m), régulation de ralenti et coupure comprises. */
  private engineTorqueAt(dt: number, inp: CarInputs): number {
    const S = this.spec;
    const rpm = this.engineOmega / RPM;
    if (this.starter > 0 && !this.engineRunning) {
      // démarreur : entraîne le moteur jusqu'à ~300 tr/min
      return rpm < 320 ? 75 : 10;
    }
    if (!this.engineRunning) { this.throttleEff = 0; return 0; }
    // régulation du ralenti avec anti-calage (réagit vite : avance à l'allumage + papillon)
    const err = (S.idleRpm - rpm) / 1000;
    this.idleInt = clamp(this.idleInt + err * 1.6 * dt, 0.05, 0.5);
    if (rpm > S.idleRpm + 250) this.idleInt = approach(this.idleInt, 0.12, 0.5 * dt);
    const idleTarget = rpm < S.idleRpm + 450 ? clamp(this.idleInt + err * 2.6, 0, 0.8) : 0;
    this.idleEff += ((idleTarget - this.idleEff) * dt) / 0.045;
    let pedal = clamp01(inp.throttle);
    if (this.mode !== 'manual' && this.shiftTimer > 0) pedal = Math.min(pedal, 0.05);
    // coupure à la zone rouge
    if (rpm > S.redlineRpm) this.revCut = true; else if (rpm < S.redlineRpm - 150) this.revCut = false;
    if (this.revCut) pedal = 0;
    // temps de réponse à la pédale (turbo plus paresseux à bas régime)
    const tau = pedal > this.pedalLag ? 0.09 + 0.16 * clamp01((2600 - rpm) / 1800) : 0.07;
    this.pedalLag += ((pedal - this.pedalLag) * dt) / tau;
    this.throttleEff = this.revCut ? 0 : Math.max(this.pedalLag, this.idleEff);
    const wot = table(S.torqueCurve, rpm), fric = table(S.frictionCurve, rpm);
    return this.throttleEff * (wot + fric) - fric;
  }

  private updateTransmission(dt: number, inp: CarInputs) {
    const S = this.spec;
    const vKmh = this.vx * 3.6;
    if (this.mode === 'manual') {
      if (this.lever !== this.gear) {
        if (this.lever === 0) { this.gear = 0; this.events.shift?.(0); }
        else {
          // il faut débrayer (ou moteur arrêté) ; la marche arrière ne passe pas en roulant
          const ok = (inp.clutch > 0.6 || !this.engineRunning) && !(this.lever === -1 && vKmh > 4) && !(this.lever > 0 && vKmh < -4);
          if (ok) { this.gear = this.lever; this.events.shift?.(this.gear); }
          else {
            if (this.gear !== 0) this.gear = 0;
            if (this.grindCooldown <= 0) { this.events.grind?.(); this.grindCooldown = 0.8; }
          }
        }
      }
      return;
    }

    // ── boîte robotisée / automatique ──
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.shiftHold > 0) this.shiftHold -= dt;
    let wanted = this.gear;
    if (this.mode === 'auto') {
      if (this.selector === 'P' || this.selector === 'N') wanted = 0;
      else if (this.selector === 'R') wanted = -1;
      else {
        if (this.gear <= 0) wanted = 1;
        else if (this.shiftHold <= 0 && this.shiftTimer <= 0) {
          const rpm = this.rpm, thr = clamp01(inp.throttle);
          const up = 2000 + 3600 * thr * thr + 600 * thr;
          const down = 1150 + 1400 * thr * thr;
          if (rpm > up && this.gear < S.gears.length) wanted = this.gear + 1;
          else if (this.gear > 1) {
            const lower = S.gears[this.gear - 2] / S.gears[this.gear - 1];
            if (rpm < down || (thr > 0.92 && rpm * lower < 5200)) wanted = this.gear - 1;
          }
        }
      }
    } else {
      // manuelle à embrayage piloté : le levier commande directement
      wanted = this.lever;
      if (wanted === -1 && vKmh > 4) wanted = this.gear;
      if (wanted > 0 && vKmh < -4) wanted = this.gear;
    }
    if (wanted !== this.gear) {
      this.gear = wanted;
      this.lever = wanted;
      this.shiftTimer = 0.28;
      this.shiftHold = 1.1;
      this.events.shift?.(wanted);
    }
    // embrayage piloté : débraye pendant le passage et sous le régime de ralenti
    let target: number;
    const rpm = this.rpm;
    const wIn = Math.abs((this.gearRatio * (this.wheelOmega[0] + this.wheelOmega[1])) / 2) / RPM;
    if (this.gear === 0 || this.shiftTimer > 0 || !this.engineRunning) target = 1;
    else if (wIn > 1050) target = 0; // collé
    else {
      // décollage : la prise suit le régime ; rampage en boîte auto, frein relâché
      const e = clamp01((rpm - 950) / 900);
      const creep = this.mode === 'auto' && inp.brake < 0.08 ? 0.16 : 0;
      const eng = Math.max(e, creep);
      target = S.clutchBiteStart - eng * (S.clutchBiteStart - S.clutchBiteEnd);
      if (inp.throttle < 0.02 && eng === 0) target = 1;
    }
    this.autoClutchPedal = approach(this.autoClutchPedal, target, dt * (target > this.autoClutchPedal ? 9 : 2.2));
  }

  /** Applique une impulsion (N·s, repère monde) en un point du monde. */
  applyImpulse(jx: number, jz: number, wx: number, wz: number) {
    const S = this.spec;
    const sn = Math.sin(this.heading), cs = Math.cos(this.heading);
    // monde → caisse
    const jf = sn * jx - cs * jz, jr = cs * jx + sn * jz;
    const rx = wx - this.x, rz = wz - this.z;
    const pf = sn * rx - cs * rz, pr = cs * rx + sn * rz;
    this.vx += jf / S.mass; this.vy += jr / S.mass;
    this.yawRate += (pf * jr - pr * jf) / S.yawInertia;
    // les roues suivent (évite un patinage artificiel après le choc)
    for (let i = 0; i < 4; i++) {
      this.kappa[i] *= 0.3; this.tanAlpha[i] *= 0.3;
    }
  }

  /** Vitesse (monde) d'un point du monde lié à la caisse. */
  pointVelocity(wx: number, wz: number): [number, number] {
    const sn = Math.sin(this.heading), cs = Math.cos(this.heading);
    const rx = wx - this.x, rz = wz - this.z;
    const pf = sn * rx - cs * rz, pr = cs * rx + sn * rz;
    const vf = this.vx - this.yawRate * pr, vr = this.vy + this.yawRate * pf;
    return [sn * vf + cs * vr, -cs * vf + sn * vr];
  }
}
