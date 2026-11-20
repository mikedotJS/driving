// Commandes : volant (Logitech G923 et autres), manette ou clavier.
//
// Le volant est lu par l'API Gamepad. Comme l'ordre des axes dépend du système, du navigateur
// et du mode du volant (PlayStation / Xbox / PC), un profil par périphérique est enregistré
// après calibration (assistant « tournez le volant, appuyez sur chaque pédale »).

import { approach, clamp, clamp01 } from '../core/math';

export type Action =
  | 'shiftUp' | 'shiftDown' | 'indicatorLeft' | 'indicatorRight' | 'hazards' | 'horn' | 'start'
  | 'handbrake' | 'seatbelt' | 'lights' | 'lookLeft' | 'lookRight' | 'lookBack' | 'camera' | 'reset' | 'pause'
  | 'gear1' | 'gear2' | 'gear3' | 'gear4' | 'gear5' | 'gear6' | 'gearR' | 'gearN' | 'repeat' | 'demo';

export const ACTION_LABELS: Record<Action, string> = {
  shiftUp: 'Rapport supérieur', shiftDown: 'Rapport inférieur',
  indicatorLeft: 'Clignotant gauche', indicatorRight: 'Clignotant droit', hazards: 'Feux de détresse',
  horn: 'Avertisseur sonore', start: 'Démarrer / couper le moteur', handbrake: 'Frein à main',
  seatbelt: 'Ceinture de sécurité', lights: 'Feux de croisement',
  lookLeft: 'Regarder à gauche (angle mort)', lookRight: 'Regarder à droite (angle mort)', lookBack: 'Regarder derrière',
  camera: 'Changer de vue', reset: 'Replacer la voiture', pause: 'Pause / menu',
  gear1: '1re', gear2: '2e', gear3: '3e', gear4: '4e', gear5: '5e', gear6: '6e', gearR: 'Marche arrière', gearN: 'Point mort',
  repeat: 'Répéter la consigne', demo: 'Démonstration : le moniteur conduit',
};

export interface AxisMap { index: number; rest: number; full: number }
export interface WheelProfile {
  id: string;
  steer: { index: number; left: number; right: number };
  /** angle total de rotation réglé sur le volant (degrés, butée à butée) */
  rangeDeg: number;
  throttle: AxisMap | null;
  brake: AxisMap | null;
  clutch: AxisMap | null;
  buttons: Partial<Record<Action, number>>;
  hShifter: boolean;
  calibrated: boolean;
}

export interface InputState {
  steer: number; throttle: number; brake: number; clutch: number;
  /** actions déclenchées pendant cette image */
  pressed: Set<Action>;
  held: Set<Action>;
  /** rapport imposé par un levier en H (null si absent) */
  hGear: number | null;
  device: 'wheel' | 'pad' | 'keyboard';
  deviceName: string;
  hasClutchPedal: boolean;
  /** vitesse angulaire du volant (unités normalisées par seconde) */
  steerRate: number;
}

const WHEEL_RE = /wheel|volant|G29|G920|G923|G27|G25|driving force|c24f|c260|c261|c262|c266|c267|c26d|c26e|c29b|T150|T248|T300|T500|TMX|thrustmaster|fanatec|moza|simucube|racing/i;
const LOGITECH_RE = /046d/i;

const KEYS: Record<string, Action> = {
  KeyE: 'shiftUp', KeyQ: 'shiftDown', // AZERTY : E / A
  Comma: 'indicatorLeft', Period: 'indicatorRight', KeyH: 'hazards', KeyK: 'horn',
  Enter: 'start', Space: 'handbrake', KeyB: 'seatbelt', KeyL: 'lights',
  KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyP: 'pause',
  Digit1: 'gear1', Digit2: 'gear2', Digit3: 'gear3', Digit4: 'gear4', Digit5: 'gear5', Digit6: 'gear6', Digit0: 'gearN', Backquote: 'gearR', Digit9: 'gearR',
  KeyZ: 'lookLeft', KeyX: 'lookBack', KeyV: 'lookRight', // AZERTY : W / X / V
  KeyT: 'repeat', KeyO: 'demo',
};
// touches « maintenues »
const HOLD_KEYS: Record<string, 'left' | 'right' | 'throttle' | 'brake' | 'clutch'> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'throttle', KeyW: 'throttle', ArrowDown: 'brake', KeyS: 'brake',
  ShiftLeft: 'clutch', ShiftRight: 'clutch',
};

const STORE = 'conduite.wheelProfiles.v1';

function defaultProfile(pad: Gamepad): WheelProfile {
  const logi = LOGITECH_RE.test(pad.id);
  const n = pad.axes.length;
  // Disposition la plus courante d'un G29/G923 dans Chrome : 0 volant, 1 embrayage, 2 accélérateur, 5 frein
  const p: WheelProfile = {
    id: pad.id, steer: { index: 0, left: -1, right: 1 }, rangeDeg: 900,
    throttle: n > 2 ? { index: 2, rest: 1, full: -1 } : null,
    brake: n > 5 ? { index: 5, rest: 1, full: -1 } : n > 3 ? { index: 3, rest: 1, full: -1 } : null,
    clutch: n > 5 ? { index: 1, rest: 1, full: -1 } : null,
    buttons: logi
      ? {
          shiftUp: 4, shiftDown: 5, indicatorRight: 6, indicatorLeft: 7, handbrake: 0, lookLeft: 1, lookRight: 2, lookBack: 3,
          seatbelt: 8, start: 9, hazards: 10, lights: 11, gear1: 12, gear2: 13, gear3: 14, gear4: 15, gear5: 16, gear6: 17, gearR: 18,
          horn: 23, camera: 19, repeat: 20, pause: 24,
        }
      : { shiftUp: 4, shiftDown: 5 },
    hShifter: false, calibrated: false,
  };
  return p;
}

export class Controls {
  state: InputState = {
    steer: 0, throttle: 0, brake: 0, clutch: 0, pressed: new Set(), held: new Set(), hGear: null,
    device: 'keyboard', deviceName: 'Clavier', hasClutchPedal: false, steerRate: 0,
  };
  profile: WheelProfile | null = null;
  /** sensibilité du frein (exposant de courbe : < 1 = plus sensible) */
  brakeGamma = 1.0;
  /** assistance clavier : vitesse du véhicule (m/s) pour adapter la direction */
  speedHint = 0;
  enabled = true;

  private keysDown = new Set<string>();
  private queued = new Set<Action>();
  private prevButtons: boolean[] = [];
  private padIndex = -1;
  private kbSteer = 0; private kbThrottle = 0; private kbBrake = 0; private kbClutch = 0;
  private lastSteer = 0;
  private profiles: Record<string, WheelProfile> = {};
  onDeviceChange?: (name: string, kind: InputState['device']) => void;

  constructor(target: Window = window) {
    try { this.profiles = JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { this.profiles = {}; }
    target.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code in HOLD_KEYS || e.code in KEYS) e.preventDefault();
      if (e.repeat) return;
      this.keysDown.add(e.code);
      const a = KEYS[e.code];
      if (a) this.queued.add(a);
    });
    target.addEventListener('keyup', (e) => { this.keysDown.delete(e.code); });
    target.addEventListener('blur', () => this.keysDown.clear());
    target.addEventListener('gamepadconnected', (e) => this.attach((e as GamepadEvent).gamepad));
    target.addEventListener('gamepaddisconnected', (e) => {
      if ((e as GamepadEvent).gamepad.index === this.padIndex) { this.padIndex = -1; this.profile = null; this.onDeviceChange?.('Clavier', 'keyboard'); }
    });
  }

  private attach(pad: Gamepad) {
    const isWheel = WHEEL_RE.test(pad.id);
    // un volant a priorité sur une manette déjà branchée
    if (this.padIndex >= 0 && !(isWheel && this.state.device !== 'wheel')) return;
    this.padIndex = pad.index;
    this.prevButtons = [];
    if (isWheel || pad.mapping !== 'standard') {
      this.profile = this.profiles[pad.id] ?? defaultProfile(pad);
      this.state.device = 'wheel';
    } else {
      this.profile = null;
      this.state.device = 'pad';
    }
    this.state.deviceName = pad.id.replace(/\s*\(.*?(Vendor|STANDARD).*?\)\s*/i, '').trim() || pad.id;
    this.onDeviceChange?.(this.state.deviceName, this.state.device);
  }

  /** Périphérique actif (ou null). */
  get pad(): Gamepad | null {
    if (this.padIndex < 0) {
      // certains navigateurs n'émettent l'événement qu'après un appui : on scrute
      for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) { this.attach(p); break; }
    }
    return this.padIndex >= 0 ? navigator.getGamepads()[this.padIndex] ?? null : null;
  }

  saveProfile() {
    if (!this.profile) return;
    this.profiles[this.profile.id] = this.profile;
    try { localStorage.setItem(STORE, JSON.stringify(this.profiles)); } catch { /* stockage indisponible */ }
  }
  resetProfile() {
    const pad = this.pad;
    if (!pad) return;
    delete this.profiles[pad.id];
    this.profile = defaultProfile(pad);
    this.saveProfile();
  }

  /** Lecture brute des axes (pour l'assistant de calibration). */
  rawAxes(): number[] { return this.pad ? Array.from(this.pad.axes) : []; }
  rawButtons(): boolean[] { return this.pad ? this.pad.buttons.map((b) => b.pressed) : []; }

  private axis(pad: Gamepad, m: AxisMap | null): number {
    if (!m || m.index >= pad.axes.length) return 0;
    const span = m.full - m.rest;
    if (Math.abs(span) < 0.05) return 0;
    const v = (pad.axes[m.index] - m.rest) / span;
    // petite zone morte en début et fin de course
    return clamp01((v - 0.02) / 0.96);
  }

  update(dt: number): InputState {
    const st = this.state;
    st.pressed = this.queued;
    this.queued = new Set();
    st.held.clear();
    st.hGear = null;
    const pad = this.pad;
    const kd = this.keysDown;
    for (const code of kd) { const a = KEYS[code]; if (a) st.held.add(a); }

    // ── clavier (toujours actif, s'ajoute au périphérique) ──
    const left = kd.has('ArrowLeft') || kd.has('KeyA'), right = kd.has('ArrowRight') || kd.has('KeyD');
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    // braquage limité et plus lent quand la vitesse augmente (comme le ferait un conducteur)
    const v = Math.abs(this.speedHint);
    const maxSteer = clamp(1 / (1 + (v * v) / 90), 0.07, 1);
    const rate = dir !== 0 ? 1.5 / (1 + v / 9) : 3.0 / (1 + v / 30);
    this.kbSteer = approach(this.kbSteer, dir * maxSteer, rate * dt);
    this.kbThrottle = approach(this.kbThrottle, kd.has('ArrowUp') || kd.has('KeyW') ? 0.85 : 0, (kd.has('ArrowUp') || kd.has('KeyW') ? 1.6 : 4) * dt);
    this.kbBrake = approach(this.kbBrake, kd.has('ArrowDown') || kd.has('KeyS') ? 0.75 : 0, (kd.has('ArrowDown') || kd.has('KeyS') ? 2.2 : 6) * dt);
    // embrayage au clavier : on relâche vite jusqu'au point de patinage, puis lentement tant que la voiture est presque à l'arrêt
    const clutchKey = kd.has('ShiftLeft') || kd.has('ShiftRight');
    const inBite = this.kbClutch < 0.74 && this.kbClutch > 0.34;
    const release = inBite && v < 3.2 ? 0.3 : 1.6;
    this.kbClutch = approach(this.kbClutch, clutchKey ? 1 : 0, (clutchKey ? 8 : release) * dt);

    let steer = this.kbSteer, throttle = this.kbThrottle, brake = this.kbBrake, clutch = this.kbClutch;
    st.hasClutchPedal = false;

    if (pad && this.enabled) {
      const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
      const edge = (i: number) => pressed[i] && !this.prevButtons[i];
      if (this.profile && st.device === 'wheel') {
        const p = this.profile;
        const raw = pad.axes[p.steer.index] ?? 0;
        // position normalisée -1..1 sur la course calibrée, puis rapport à la butée de la voiture (±450°)
        const mid = (p.steer.left + p.steer.right) / 2, half = (p.steer.right - p.steer.left) / 2 || 1;
        const wheel = clamp((raw - mid) / half, -1, 1);
        steer = clamp((wheel * p.rangeDeg) / 900, -1, 1);
        throttle = Math.max(throttle, this.axis(pad, p.throttle));
        brake = Math.max(brake, Math.pow(this.axis(pad, p.brake), this.brakeGamma));
        if (p.clutch) { clutch = Math.max(clutch, this.axis(pad, p.clutch)); st.hasClutchPedal = true; }
        for (const [action, idx] of Object.entries(p.buttons) as [Action, number][]) {
          if (idx === undefined || idx < 0) continue;
          if (edge(idx)) st.pressed.add(action);
          if (pressed[idx]) st.held.add(action);
        }
        if (p.hShifter) {
          st.hGear = 0;
          const gears: Action[] = ['gear1', 'gear2', 'gear3', 'gear4', 'gear5', 'gear6'];
          gears.forEach((g, i) => { const b = p.buttons[g]; if (b !== undefined && pressed[b]) st.hGear = i + 1; });
          const r = p.buttons.gearR; if (r !== undefined && pressed[r]) st.hGear = -1;
        }
      } else if (pad.mapping === 'standard') {
        // manette : stick gauche, gâchettes
        const sx = pad.axes[0] ?? 0;
        const dz = Math.abs(sx) < 0.08 ? 0 : (sx - Math.sign(sx) * 0.08) / 0.92;
        const target = Math.sign(dz) * dz * dz * maxSteer;
        if (Math.abs(dz) > 0.01 || Math.abs(this.kbSteer) < 0.01) { this.kbSteer = approach(this.kbSteer, target, 2.6 * dt); steer = this.kbSteer; }
        throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
        brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
        const map: [number, Action][] = [[0, 'handbrake'], [1, 'shiftUp'], [2, 'shiftDown'], [3, 'camera'], [4, 'indicatorLeft'], [5, 'indicatorRight'], [9, 'pause'], [8, 'start'], [12, 'lights'], [13, 'hazards'], [14, 'lookLeft'], [15, 'lookRight'], [10, 'horn'], [11, 'seatbelt']];
        for (const [i, a] of map) { if (edge(i)) st.pressed.add(a); if (pressed[i]) st.held.add(a); }
      }
      this.prevButtons = pressed;
    }

    st.steerRate = dt > 0 ? (steer - this.lastSteer) / dt : 0;
    this.lastSteer = steer;
    st.steer = steer; st.throttle = clamp01(throttle); st.brake = clamp01(brake); st.clutch = clamp01(clutch);
    return st;
  }
}

/** Assistant de calibration : repère l'axe qui a le plus bougé depuis `begin()`. */
export class AxisCapture {
  private base: number[] = [];
  private min: number[] = [];
  private max: number[] = [];
  constructor(private controls: Controls) {}
  begin() {
    this.base = this.controls.rawAxes();
    this.min = this.base.slice(); this.max = this.base.slice();
  }
  sample() {
    const a = this.controls.rawAxes();
    for (let i = 0; i < a.length; i++) {
      if (this.min[i] === undefined) { this.base[i] = this.min[i] = this.max[i] = a[i]; continue; }
      if (a[i] < this.min[i]) this.min[i] = a[i];
      if (a[i] > this.max[i]) this.max[i] = a[i];
    }
  }
  /** Axe ayant la plus grande excursion ; `exclude` = axes déjà attribués. */
  result(exclude: number[] = []): { index: number; rest: number; min: number; max: number; range: number } | null {
    let best = -1, range = 0.25;
    for (let i = 0; i < this.base.length; i++) {
      if (exclude.includes(i)) continue;
      const r = this.max[i] - this.min[i];
      if (r > range) { range = r; best = i; }
    }
    if (best < 0) return null;
    return { index: best, rest: this.base[best], min: this.min[best], max: this.max[best], range };
  }
  /** Progression (0..1) de l'axe le plus actif, pour l'affichage. */
  progress(exclude: number[] = []): number {
    let r = 0;
    for (let i = 0; i < this.base.length; i++) if (!exclude.includes(i)) r = Math.max(r, this.max[i] - this.min[i]);
    return clamp01(r / 1.9);
  }
}
