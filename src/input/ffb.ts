// Retour de force des volants Logitech via WebHID (Chrome / Edge).
//
// Deux protocoles :
//  • « classique » (G25/G27/G29, G923 version PlayStation/PC) : trames de 7 octets, effet de force
//    constante dans l'emplacement 1 (11 00 <niveau> pour le lancer, 1c 00 <niveau> pour le rafraîchir,
//    13 pour l'arrêter ; 0x80 = neutre), ressort de centrage matériel désactivé (f5), rotation réglée
//    à 900° (f8 81 …). Format relu dans le pilote Linux new-lg4ff, qui prend en charge le G923
//    (046d:c266 en mode natif ; en mode PlayStation, 046d:c267, il faut d'abord demander le mode natif
//    par le rapport 0x30 : f8 09 07 01 01) ;
//  • HID++ 4.2, fonctionnalité 0x8123 (G920, G923 version Xbox/PC, 046d:c26e) : effet « constant »
//    téléchargé (fonction 0x21) puis mis à jour en continu — relu dans hid-logitech-hidpp.c.
// Seul un couple constant est envoyé : amortissement, frottements, butées et vibrations sont
// calculés par le simulateur. N'a pas pu être essayé sur un volant réel depuis l'environnement de
// développement, et aucun pilote n'indique de quel côté de 0x80 le volant part à droite : un test
// (« le volant doit partir à droite ») et une option d'inversion sont prévus pour cela.

import { clamp } from '../core/math';

const LOGITECH = 0x046d;
// identifiants produit → protocole
const CLASSIC = new Set([0xc24f /* G29 */, 0xc260 /* G29 PS4 */, 0xc266 /* G923 PS */, 0xc267 /* G923 PS, mode PS */, 0xc29b /* G27 */, 0xc299 /* G25 */, 0xc298 /* DFP */, 0xc29a /* DFGT */, 0xc294 /* Driving Force */]);
const HIDPP = new Set([0xc262 /* G920 */, 0xc26e /* G923 Xbox */, 0xc26d /* G923 Xbox, mode Xbox */]);

export type FfbStatus = 'indisponible' | 'déconnecté' | 'connecté' | 'erreur';

export interface FfbSettings {
  enabled: boolean;
  /** gain global 0..1 */
  gain: number;
  invert: boolean;
  /** amortissement logiciel 0..1 */
  damping: number;
}

export class ForceFeedback {
  status: FfbStatus = 'hid' in navigator ? 'déconnecté' : 'indisponible';
  deviceName = '';
  protocol: 'classic' | 'hidpp' | null = null;
  settings: FfbSettings = { enabled: true, gain: 0.7, invert: false, damping: 0.35 };
  lastError = '';

  private device: HIDDevice | null = null;
  private reportId = 0;
  /** protocole classique : l'effet constant de l'emplacement 1 est-il lancé ? */
  private slotOn = false;
  private busy = false;
  private last = 0;
  private lastSent = 999;
  // HID++
  private ffIndex = 0;
  private slot = 0;
  private pending = new Map<number, (data: DataView) => void>();
  private longReport = 0x11;

  constructor() {
    try {
      const s = localStorage.getItem('conduite.ffb.v1');
      if (s) Object.assign(this.settings, JSON.parse(s));
    } catch { /* ignore */ }
    if ('hid' in navigator) {
      navigator.hid.addEventListener('disconnect', (e) => { if (e.device === this.device) { this.device = null; this.status = 'déconnecté'; } });
      // reconnexion silencieuse si l'autorisation a déjà été donnée
      navigator.hid.getDevices().then((list) => {
        const d = list.find((x) => x.vendorId === LOGITECH && (CLASSIC.has(x.productId) || HIDPP.has(x.productId)));
        if (d) this.open(d).catch(() => {});
      }).catch(() => {});
    }
    addEventListener('pagehide', () => { this.stop(); });
  }

  saveSettings() { try { localStorage.setItem('conduite.ffb.v1', JSON.stringify(this.settings)); } catch { /* ignore */ } }

  get available(): boolean { return 'hid' in navigator; }
  get connected(): boolean { return this.status === 'connecté' && !!this.device; }

  /** Demande l'accès au volant (doit être appelé depuis un clic). */
  async connect(): Promise<boolean> {
    if (!('hid' in navigator)) { this.lastError = 'WebHID n’est pas disponible dans ce navigateur (utilisez Chrome ou Edge).'; return false; }
    try {
      const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: LOGITECH }] });
      // un volant expose parfois plusieurs interfaces : on prend celle qui accepte nos rapports
      for (const d of devices) {
        if (await this.open(d)) return true;
      }
      if (!devices.length) this.lastError = 'Aucun périphérique sélectionné.';
      return false;
    } catch (e) {
      this.lastError = String((e as Error).message ?? e);
      this.status = 'erreur';
      return false;
    }
  }

  private async open(d: HIDDevice): Promise<boolean> {
    try {
      if (!d.opened) await d.open();
      const outs = d.collections.flatMap((c) => c.outputReports ?? []);
      const hidppReport = outs.find((r) => r.reportId === 0x11 || r.reportId === 0x12);
      const isHidpp = HIDPP.has(d.productId) || (!CLASSIC.has(d.productId) && !!hidppReport);
      if (isHidpp) {
        if (!hidppReport) return false;
        this.device = d; this.protocol = 'hidpp';
        d.addEventListener('inputreport', (e) => this.onInput(e));
        await this.initHidpp();
      } else {
        // rapport de sortie de 7 octets (identifiant 0 en général)
        const rep = outs.find((r) => (r.items ?? []).reduce((s, it) => s + ((it.reportSize ?? 0) * (it.reportCount ?? 0)) / 8, 0) >= 7) ?? outs[0];
        if (!rep && outs.length === 0 && d.collections.length === 0) return false;
        this.reportId = rep?.reportId ?? 0;
        if (d.productId === 0xc267) {
          // G923 en mode « PlayStation » : pas de retour de force dans ce mode. On demande le passage en mode
          // natif (commande du pilote new-lg4ff, rapport 0x30) ; le volant se déconnecte puis revient sous
          // l'identifiant 046d:c266, qu'il faut alors autoriser à son tour.
          await d.sendReport(0x30, new Uint8Array([0xf8, 0x09, 0x07, 0x01, 0x01, 0x00, 0x00]));
          this.status = 'déconnecté';
          this.lastError = 'Le volant passe en mode natif : il se reconnecte dans un instant. Cliquez de nouveau sur « Connecter le volant ».';
          return false;
        }
        this.device = d; this.protocol = 'classic'; this.slotOn = false;
        await this.sendClassic([0xf5, 0, 0, 0, 0, 0, 0]);          // coupe le ressort de centrage matériel
        await this.sendClassic([0xf8, 0x81, 900 & 0xff, 900 >> 8, 0, 0, 0]); // plage de rotation 900°
        await this.sendClassic([0x13, 0, 0, 0, 0, 0, 0]);           // aucun effort
      }
      this.deviceName = d.productName || 'Volant Logitech';
      this.status = 'connecté';
      this.lastError = '';
      return true;
    } catch (e) {
      this.lastError = String((e as Error).message ?? e);
      this.status = 'erreur';
      this.device = null;
      return false;
    }
  }

  private async sendClassic(bytes: number[]) {
    if (!this.device) return;
    await this.device.sendReport(this.reportId, new Uint8Array(bytes));
  }

  // ── HID++ ──
  private onInput(e: HIDInputReportEvent) {
    if (e.reportId !== 0x11 && e.reportId !== 0x12) return;
    const feature = e.data.getUint8(1), fn = e.data.getUint8(2);
    const key = (feature << 8) | fn;
    const cb = this.pending.get(key) ?? (feature === 0xff ? this.pending.get(-1) : undefined);
    if (cb) { this.pending.delete(key); cb(e.data); }
  }
  private hidpp(feature: number, fn: number, params: number[], waitMs = 400): Promise<DataView | null> {
    const d = this.device;
    if (!d) return Promise.resolve(null);
    const fnByte = (fn << 4) | 0x01; // identifiant logiciel 1
    const buf = new Uint8Array(19);
    buf[0] = 0xff; buf[1] = feature; buf[2] = fnByte;
    params.forEach((p, i) => { buf[3 + i] = p & 0xff; });
    return new Promise((resolve) => {
      const key = (feature << 8) | fnByte;
      const timer = setTimeout(() => { this.pending.delete(key); resolve(null); }, waitMs);
      this.pending.set(key, (data) => { clearTimeout(timer); resolve(data); });
      d.sendReport(this.longReport, buf).catch(() => { clearTimeout(timer); this.pending.delete(key); resolve(null); });
    });
  }
  private async initHidpp() {
    // IRoot.getFeature(0x8123) → indice de la fonctionnalité « force feedback »
    const r = await this.hidpp(0x00, 0x0, [0x81, 0x23]);
    if (!r) throw new Error('Le volant ne répond pas au protocole HID++.');
    this.ffIndex = r.getUint8(3);
    if (!this.ffIndex) throw new Error('Retour de force HID++ non pris en charge par ce volant.');
    await this.hidpp(this.ffIndex, 0x1, []);                 // réinitialise tous les effets (coupe le centrage)
    await this.hidpp(this.ffIndex, 0x8, [0xff, 0xff, 0, 0]); // gain global au maximum
    // télécharge un effet constant nul, démarrage automatique
    const dl = await this.hidpp(this.ffIndex, 0x2, [0, 0x00 | 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    this.slot = dl ? dl.getUint8(3) : 1;
  }

  /**
   * Couple demandé, normalisé -1..1 (positif = le volant est poussé vers la droite).
   * À appeler à chaque image ; l'envoi est limité à ~120 Hz et ignoré si rien ne change.
   */
  setForce(force: number) {
    const d = this.device;
    if (!d || !this.connected) return;
    let f = this.settings.enabled ? clamp(force * this.settings.gain, -1, 1) : 0;
    if (this.settings.invert) f = -f;
    const now = performance.now();
    if (this.busy || now - this.last < 8) return;
    if (Math.abs(f - this.lastSent) < 0.004) return;
    this.last = now; this.lastSent = f; this.busy = true;
    let p: Promise<unknown>;
    if (this.protocol === 'classic') {
      // 0x80 = neutre ; valeurs inférieures = effort vers la droite
      const level = clamp(Math.round(0x80 - f * 127), 1, 255);
      // effort constant dans l'emplacement 1, comme le pilote new-lg4ff (qui gère le G923) : 0x11 = charger
      // et lancer, 0x1c = rafraîchir la force, 0x13 = arrêter
      if (level === 0x80) { p = this.sendClassic([0x13, 0, 0, 0, 0, 0, 0]); this.slotOn = false; }
      else { p = this.sendClassic([this.slotOn ? 0x1c : 0x11, 0x00, level, 0, 0, 0, 0]); this.slotOn = true; }
    } else {
      const v = Math.round(clamp(-f, -1, 1) * 32767) & 0xffff;
      const buf = new Uint8Array(19);
      buf[0] = 0xff; buf[1] = this.ffIndex; buf[2] = (0x2 << 4) | 0x01;
      buf[3] = this.slot; buf[4] = 0x00 | 0x80; buf[9] = v >> 8; buf[10] = v & 0xff;
      p = d.sendReport(this.longReport, buf);
    }
    p.catch((e) => { this.lastError = String((e as Error).message ?? e); }).finally(() => { this.busy = false; });
  }

  /** Coupe tout effort (pause, sortie). */
  stop() {
    this.lastSent = 999;
    const d = this.device;
    if (!d) return;
    try {
      if (this.protocol === 'classic') { this.slotOn = false; void d.sendReport(this.reportId, new Uint8Array([0x13, 0, 0, 0, 0, 0, 0])); }
      else if (this.protocol === 'hidpp') {
        const buf = new Uint8Array(19);
        buf[0] = 0xff; buf[1] = this.ffIndex; buf[2] = (0x2 << 4) | 0x01; buf[3] = this.slot; buf[4] = 0x80;
        void d.sendReport(this.longReport, buf);
      }
    } catch { /* ignore */ }
  }

  /** Impulsion de test : pousse le volant vers la droite pendant une demi-seconde. */
  async test(): Promise<void> {
    if (!this.connected) return;
    const g = this.settings.enabled;
    this.settings.enabled = true;
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        if (t > 0.6) { this.setForceNow(0); resolve(); return; }
        this.setForceNow(0.45 * Math.sin((Math.PI * t) / 0.6));
        requestAnimationFrame(tick);
      };
      tick();
    });
    this.settings.enabled = g;
  }
  private setForceNow(f: number) { this.last = 0; this.lastSent = 999; this.setForce(f / Math.max(0.05, this.settings.gain)); }
}

/**
 * Calcule le couple à envoyer au volant à partir de l'état du véhicule.
 */
export class FfbModel {
  private kick = 0;
  private kickDir = 1;
  private phase = 0;
  /** à-coup bref (bordure, choc) */
  jolt(strength: number, dir = 1) { this.kick = Math.max(this.kick, strength); this.kickDir = dir; }

  compute(dt: number, o: {
    steerTorque: number;   // N·m au volant (modèle pneus)
    steer: number;         // position -1..1
    steerRate: number;     // unités/s
    speed: number;         // m/s
    abs: boolean;
    engineOn: boolean; rpm: number;
    damping: number;
    frontLoad: number;     // charge relative du train avant (1 = statique)
  }): number {
    // couple d'auto-alignement : 5 N·m ≈ pleine échelle d'un G923 (2,2 N·m réels)
    let f = o.steerTorque / 5.2;
    // frottement des pneus à l'arrêt / en manœuvre : s'oppose au mouvement du volant
    const slow = Math.max(0, 1 - o.speed / 3);
    f -= clamp(o.steerRate * 2.2, -1, 1) * 0.22 * slow * o.frontLoad;
    // amortissement (inertie de la direction, stabilité en ligne droite)
    f -= clamp(o.steerRate * (0.25 + 0.5 * o.damping), -0.5, 0.5) * (0.35 + 0.65 * Math.min(1, o.speed / 15));
    // butées de direction
    const over = Math.abs(o.steer) - 0.985;
    if (over > 0) f -= Math.sign(o.steer) * Math.min(1, over * 60);
    // ABS : pulsations dans le volant
    this.phase += dt;
    if (o.abs) f += 0.08 * Math.sign(Math.sin(this.phase * 2 * Math.PI * 14));
    // vibrations du trois-cylindres au ralenti
    if (o.engineOn && o.rpm < 1100) f += 0.012 * Math.sin(this.phase * 2 * Math.PI * (o.rpm / 60) * 1.5);
    // à-coups
    if (this.kick > 0.001) { f += this.kick * this.kickDir; this.kick *= Math.exp(-dt * 18); }
    return clamp(f, -1, 1);
  }
}
