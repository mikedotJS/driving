// @ts-nocheck
/* Synthèse procédurale du son de la voiture école — cœurs DSP.
 *
 * Ce fichier est chargé tel quel dans l'AudioWorkletGlobalScope
 * (`audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url))`).
 * Il ne dépend de rien et n'importe rien. Les deux cœurs (`EngineCore`, `RoadCore`) sont
 * aussi exportés : `car-audio.ts` les réutilise dans un ScriptProcessor de secours quand
 * l'AudioWorklet est indisponible (contexte non sécurisé, http sur IP du réseau local…).
 *
 * EngineCore — 3 cylindres 1.0 turbo essence, 4 temps, entendu de l'habitacle :
 *   - accumulateur de phase sur le cycle moteur (2 tours) ; une table d'onde par timbre
 *     (charge nulle « creuse » / pleine charge « riche » / bas régime « impulsions séparées »)
 *     contenant les harmoniques du cycle : l'harmonique 3 (ordre 1,5 = fréquence d'allumage,
 *     tr/min ÷ 40) domine, ses multiples (ordres 3, 4,5, 6…) suivent, et les demi-ordres
 *     (0,5 · 1 · 2 · 2,5…) donnent le grondement du 3 cylindres ;
 *   - irrégularité cylindre à cylindre (gain tiré au hasard à chaque allumage, ratés près du calage) ;
 *   - bouffées de bruit synchrones de l'allumage (combustion/échappement), souffle d'admission
 *     dont la résonance suit le régime, sifflement de turbo, cliquetis d'injecteurs/soupapes ;
 *   - filtre d'habitacle (passe-bas 1,2 → 3 kHz selon la charge), résonance de caisse ≈ 150 Hz,
 *     saturation douce ;
 *   - démarreur (pignon sur couronne + « tchou-tchou » des compressions à ≈ 5,5 Hz),
 *     calage (2-3 derniers allumages qui secouent puis silence), coupure contact, broutement d'embrayage.
 *
 * RoadCore — bruits de roulement stéréo : route, vent, crissement des pneus, pavés, ABS, frottement de frein.
 */

const TWO_PI = 6.283185307179586;
const TS = 4096; // taille des tables d'onde (puissance de 2)
const TM = TS - 1;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function finite(x, d) { return Number.isFinite(x) ? x : d; }

/** Générateur pseudo-aléatoire déterministe (xorshift32) pour les tirages « par évènement ». */
class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 0x2545f491; }
  next() {
    let s = this.s;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    this.s = s;
    return s / 4294967296;
  }
  bi() { return this.next() * 2 - 1; }
}

/** Filtre à variable d'état (forme TPT de Zavalishin) : stable quand on module la fréquence. */
class Svf {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 1; this.m = 0; }
  set(fc, q, sr) {
    const g = Math.tan(Math.PI * clamp(fc, 5, sr * 0.45) / sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  /** cloche (peaking) : gain linéaire A² au centre. */
  setBell(fc, q, gainDb, sr) {
    const A = Math.pow(10, gainDb / 40);
    const g = Math.tan(Math.PI * clamp(fc, 5, sr * 0.45) / sr);
    this.k = 1 / (q * A);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    this.m = this.k * (A * A - 1);
  }
  lp(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v2;
  }
  /** passe-bande normalisé (gain 1 au centre). */
  bp(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return this.k * v1;
  }
  hp(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return x - this.k * v1 - v2;
  }
  bell(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return x + this.m * v1;
  }
  reset() { this.ic1 = 0; this.ic2 = 0; }
}

const SIN = new Float32Array(TS + 1);
const COS = new Float32Array(TS + 1);
for (let i = 0; i <= TS; i++) { SIN[i] = Math.sin(TWO_PI * i / TS); COS[i] = Math.cos(TWO_PI * i / TS); }

/** Table d'un cycle (somme d'harmoniques), normalisée à une valeur efficace de 1. */
function buildTable(nh, ampFn, phaseFn) {
  const t = new Float32Array(TS + 1);
  for (let h = 1; h <= nh; h++) {
    const a = ampFn(h);
    if (!(a > 1e-5)) continue;
    const ph = phaseFn(h);
    const ac = a * Math.cos(ph), as = a * Math.sin(ph);
    for (let i = 0; i < TS; i++) {
      const j = (h * i) & TM;
      t[i] += ac * SIN[j] + as * COS[j];
    }
  }
  let e = 0;
  for (let i = 0; i < TS; i++) e += t[i] * t[i];
  const g = 1 / Math.sqrt(e / TS || 1);
  for (let i = 0; i < TS; i++) t[i] *= g;
  t[TS] = t[0];
  return t;
}

const NH = 192; // harmoniques du cycle (jusqu'à l'ordre 96)

/** Niveau relatif des demi-ordres (harmoniques du cycle non multiples de 3). */
function halfOrderRatio(h) {
  switch (h) {
    case 1: return 0.15; // ordre 0,5
    case 2: return 0.27; // ordre 1 (couple de basculement du 3 cylindres)
    case 4: return 0.27; // ordre 2
    case 5: return 0.23; // ordre 2,5
    case 7: return 0.19;
    case 8: return 0.17;
    default: return 0.14;
  }
}

const ENGINE_PARAMS = ['rpm', 'load', 'on', 'starter', 'stall', 'judder', 'window'];
const ROAD_PARAMS = ['speed', 'slip', 'sett', 'brake', 'abs', 'window'];

// ───────────────────────────────────────────────────────────────── moteur ──

// Niveaux (calibrés par mesure, cf. dev/audio.ts)
const ENG_GAIN = 0.118;     // niveau tonal de référence
const ENG_COMB = 0.50;      // bouffées de combustion
const ENG_INTAKE = 0.62;    // souffle d'admission
const ENG_TICK = 0.07;     // cliquetis injecteurs / soupapes
const ENG_TURBO = 0.0034;   // sifflement de turbo (très discret)
const ENG_STARTER = 0.075;  // démarreur
const ENG_DRIVE = 1.7;      // saturation douce
// Loi de niveau : multiplicateurs à charge nulle / pleine charge selon le régime (interpolation linéaire),
// ajustés pour que le niveau efficace croisse de façon monotone avec le régime et la charge.
const LV_RPM = [0, 850, 1150, 1500, 2000, 3000, 4000, 5000, 6000, 7000];
const LV0 = [0.384, 0.384, 0.428, 0.435, 0.466, 0.517, 0.575, 0.620, 0.659, 0.723];
const LV1 = [0.621, 0.621, 0.753, 0.874, 0.996, 1.219, 1.469, 1.644, 1.822, 2.020];
function lvAt(tab, rpm) {
  if (rpm <= 0) return tab[0];
  for (let i = 1; i < LV_RPM.length; i++) {
    if (rpm <= LV_RPM[i]) return tab[i - 1] + (tab[i] - tab[i - 1]) * (rpm - LV_RPM[i - 1]) / (LV_RPM[i] - LV_RPM[i - 1]);
  }
  return tab[tab.length - 1];
}
const CRANK_RPM = 215;      // régime d'entraînement au démarreur
const RING_TEETH = 128;     // dents de la couronne de volant moteur

class EngineCore {
  constructor(sr, seed) {
    this.sr = sr;
    this.seed = ((seed | 0) ^ 0x5bd1e995) | 1;
    this.rng = new Rng((seed | 0) + 77);
    const prng = new Rng(0xC0FFEE);
    const phases = new Float32Array(NH + 1);
    for (let h = 1; h <= NH; h++) phases[h] = h % 3 === 0 ? prng.bi() * 0.7 : prng.next() * TWO_PI;
    const env = (m, p, mc) => Math.pow(m, -p) * Math.exp(-m / mc);
    // pleine charge : riche, impulsions marquées
    this.tHi = buildTable(NH, (h) => {
      const m = h / 3;
      if (h % 3 === 0) return env(m, 0.78, 48);
      return halfOrderRatio(h) * env(Math.max(m, 1), 0.78, 48);
    }, (h) => phases[h]);
    // charge nulle : creux (harmoniques paires de l'allumage atténuées), demi-ordres plus présents (bourdonnement de retenue)
    this.tLo = buildTable(NH, (h) => {
      const m = h / 3;
      if (h % 3 === 0) return env(m, 0.92, 24) * ((h / 3) % 2 === 0 ? 0.7 : 1);
      return 1.45 * halfOrderRatio(h) * env(Math.max(m, 1), 0.92, 24);
    }, (h) => phases[h]);
    // bas régime (ralenti, sous-régime, démarreur) : train d'impulsions bien séparées, spectre plat en ordres
    this.tId = buildTable(NH, (h) => {
      const m = h / 3;
      if (h % 3 === 0) return env(m, 0.46, 30);
      return 0.85 * halfOrderRatio(h) * env(Math.max(m, 1), 0.46, 30);
    }, (h) => phases[h]);
    // démarreur : engrènement pignon/couronne
    this.tSt = buildTable(5, (h) => Math.pow(h, -0.85), (h) => h * 1.3);

    this.mode = 0;          // 0 arrêté · 1 en marche · 2 coupure (roue libre) · 3 calage
    this.lock = false;      // après un calage : attend contact coupé ou démarreur
    this.lockT = 0;
    this.stallPrev = false;
    this.crank = 0;         // tr/min réels du vilebrequin simulé
    this.th = 0;            // phase du cycle 0..1 (2 tours)
    this.lastCyl = 0;
    this.halfDone = false;
    this.loadS = 0;
    this.gC = 1; this.gT = 1;
    this.bEnv = 0; this.tickEnv = 0;
    this.aTon = 0; this.aComb = 0; this.aInt = 0; this.aTick = 0; this.aTurbo = 0; this.mixS = 0; this.idS = 1; this.shS = 0; this.judS = 0;
    this.spool = 0; this.turboPh = 0;
    this.st = 0; this.stPh = 0; this.stPh2 = 0; this.stLp = 0;
    this.judPh = 0;
    this.hunt = 0; this.huntLp = 0;
    this.lp1 = 0; this.dc = 0; this.tickLp = 0;
    this.tail = 0;
    this.bias = [1.0, 0.935, 1.055];
    this.combBp = new Svf(); this.intBp = new Svf(); this.body = new Svf(); this.cab = new Svf();
    this.tickBp = new Svf(); this.stBp = new Svf(); this.judBp = new Svf();
    this.body.setBell(150, 1.0, 3.0, sr);
    this.tickBp.set(2700, 1.0, sr);
    this.stBp.set(1900, 0.8, sr);
    this.judBp.set(58, 2.2, sr);
    this.kR = 1 - Math.exp(-1 / (0.022 * sr));   // suivi du régime
    this.kS = 1 - Math.exp(-1 / (0.075 * sr));   // lancement par le démarreur
    this.kA = 1 - Math.exp(-1 / (0.009 * sr));   // lissage des gains
    this.kStUp = 1 - Math.exp(-1 / (0.02 * sr));
    this.kStDn = 1 - Math.exp(-1 / (0.07 * sr));
    this.aDc = 1 - Math.exp(-TWO_PI * 7 / sr);
    this.tickDec = Math.exp(-1 / (0.002 * sr));
    this.aStLp = 1 - Math.exp(-TWO_PI * 2600 / sr);
    this.aTickLp = 1 - Math.exp(-TWO_PI * 3800 / sr);
  }

  /** Rend `n` échantillons mono dans `out` à partir de `off`. P : valeurs courantes des paramètres. */
  render(out, off, n, P) {
    const sr = this.sr, dt = 1 / sr;
    const on = P.on >= 0.5, starter = P.starter >= 0.5, stallNow = P.stall >= 0.5;
    const rpmT = clamp(finite(P.rpm, 0), 0, 7500);
    const loadT = clamp(finite(P.load, 0), 0, 1);
    const judT = clamp(finite(P.judder, 0), 0, 1);
    const win = clamp(finite(P.window, 0), 0, 1);

    // ── machine d'états ──
    if (stallNow && !this.stallPrev && (this.mode === 1 || this.crank > 60)) {
      this.mode = 3; this.lock = true; this.lockT = 0;
      this.crank = clamp(this.crank, 340, 520);
    }
    this.stallPrev = stallNow;
    if (this.lock) {
      this.lockT += n * dt;
      if (!on || starter || this.lockT > 2.5) this.lock = false;
    }
    if (this.mode === 1 && !on) this.mode = 2;
    else if ((this.mode === 0 || this.mode === 2) && on && !this.lock) this.mode = 1;

    const active = this.mode !== 0 || starter || this.crank > 0 || rpmT > 1 || this.st > 1e-4;
    if (active) this.tail = (0.4 * sr) | 0;
    else if (this.tail <= 0) { for (let i = 0; i < n; i++) out[off + i] = 0; return; }
    else this.tail -= n;

    // ── grandeurs calculées une fois par bloc ──
    let mode = this.mode, crank = this.crank, th = this.th;
    const kBlk = 1 - Math.exp(-n / (0.045 * sr));
    this.loadS += (loadT - this.loadS) * kBlk;
    const loadS = this.loadS;
    const running = mode === 1 || mode === 3;
    const u = mode === 3 ? 1 : mode === 1 ? clamp((760 - crank) / 320, 0, 1) : 0;   // proximité du calage (0 au ralenti, 1 vers 440 tr/min)
    const mixT = running ? loadS * (1.7 - 0.7 * loadS) : 0;
    const idleF = clamp((1500 - crank) / 700, 0, 1);
    const overrunF = clamp((crank - 1100) / 800, 0, 1) * (1 - loadS) * (1 - loadS);
    const lugLoad = loadS * clamp((1500 - crank) / 600, 0, 1);
    const jit = running ? 0.04 + 0.075 * idleF + 0.12 * overrunF + 0.42 * u : 0.12;
    const misP = running ? 0.3 * u + 0.05 * overrunF : 0;
    const x = Math.min(crank, 7000) / 1000;
    const present = clamp(crank / 250, 0, 1);
    const idT = clamp((1350 - crank) / 500, 0, 1);            // part de la table « bas régime »
    let aTonT, aCombT, aIntT, aTickT;
    if (running) {
      const l0 = lvAt(LV0, crank), l1 = lvAt(LV1, crank);
      const lv = (l0 + (l1 - l0) * loadS) * (1 + 0.55 * u) * present * (1 + 0.2 * win);
      aTonT = ENG_GAIN * lv;
      aCombT = ENG_GAIN * ENG_COMB * lv * (0.7 + 0.45 * mixT + 0.3 * overrunF + 0.6 * u);
      aIntT = ENG_GAIN * ENG_INTAKE * lv * loadS * loadS * (0.45 + 0.55 * x / 4);
      aTickT = ENG_TICK * (0.22 + 0.24 * x) * present;
    } else {
      // moteur entraîné (démarreur, roue libre) : compressions seulement
      const mot = clamp(crank / 170, 0, 1);
      aTonT = ENG_GAIN * 0.5 * LV0[1] * mot;
      aCombT = ENG_GAIN * 0.7 * LV0[1] * mot;
      aIntT = 0;
      aTickT = ENG_TICK * 0.3 * mot;
    }
    const shT = 0.85 * u + 0.28 * lugLoad;
    // irrégularité cyclique : forte au démarreur et près du calage, négligeable sinon
    const wob = running ? 0.012 + 0.2 * u + 0.03 * lugLoad : 0.2 * clamp((700 - crank) / 400, 0.1, 1);
    // turbo
    const spoolT = mode === 1 ? Math.pow(clamp((crank - 1400) / 3600, 0, 1), 0.7) * (0.12 + 0.88 * loadS) : 0;
    this.spool += (spoolT - this.spool) * (1 - Math.exp(-n / ((spoolT > this.spool ? 0.42 : 0.85) * sr)));
    const turboF = 3000 + 6000 * this.spool;
    const aTurboT = ENG_TURBO * clamp((crank - 2200) / 500, 0, 1) * loadS * this.spool;
    // filtres
    const fFire = Math.max(crank, 60) / 40;
    this.combBp.set(230 + 270 * mixT, 0.9, sr);
    this.intBp.set(clamp(fFire * 3 + 110, 160, 980), 2.2, sr);
    this.cab.set(1200 + 1800 * mixT + 1400 * win, 0.62, sr);
    const a1 = 1 - Math.exp(-TWO_PI * (240 + 520 * mixT + 0.02 * crank) / sr);
    const firePeriod = 40 / Math.max(crank, 120);
    const kG = 1 - Math.exp(-1 / (0.1 * firePeriod * sr));
    const bDec = Math.exp(-1 / (clamp(0.17 * firePeriod, 0.0022, 0.016) * sr));
    // ralenti : le régulateur « chasse » très légèrement
    this.huntLp += (this.rng.bi() - this.huntLp) * 0.02;
    const huntT = mode === 1 ? this.huntLp * (0.004 + 0.02 * idleF) : 0;

    const kR = this.kR, kS = this.kS, kA = this.kA, aDc = this.aDc, tickDec = this.tickDec;
    const tLo = this.tLo, tHi = this.tHi, tId = this.tId, tSt = this.tSt, bias = this.bias, rng = this.rng;
    const combBp = this.combBp, intBp = this.intBp, body = this.body, cab = this.cab, tickBp = this.tickBp, stBp = this.stBp, judBp = this.judBp;
    let seed = this.seed, lastCyl = this.lastCyl, halfDone = this.halfDone;
    let gC = this.gC, gT = this.gT, bEnv = this.bEnv, tickEnv = this.tickEnv;
    let aTon = this.aTon, aComb = this.aComb, aInt = this.aInt, aTick = this.aTick, aTurbo = this.aTurbo, mix = this.mixS, idm = this.idS, sh = this.shS, jud = this.judS;
    let turboPh = this.turboPh, st = this.st, stPh = this.stPh, stPh2 = this.stPh2, stLp = this.stLp, judPh = this.judPh;
    let lp1 = this.lp1, dc = this.dc, hunt = this.hunt, tickLp = this.tickLp;
    const aTickLp = this.aTickLp;
    const stT = starter ? 1 : 0;
    const kSt = stT > st ? this.kStUp : this.kStDn;
    const drive = ENG_DRIVE, invDrive = 1 / ENG_DRIVE;

    for (let i = 0; i < n; i++) {
      // ── vilebrequin ──
      if (mode === 1) crank += (rpmT - crank) * kR;
      else if (mode === 3) {
        crank -= (640 + (crank < 150 ? 1700 : 0)) * dt;
        if (crank <= 0) { crank = 0; mode = 0; }
        else if (crank < rpmT && !on) mode = 2;                   // calé mais encore entraîné par les roues
      } else if (starter) crank += (CRANK_RPM - crank) * kS;
      else if (rpmT > crank) crank += (rpmT - crank) * kR;       // moteur arrêté mais entraîné par les roues (voiture en prise)
      else if (crank > 0) {
        crank -= (mode === 2 ? 900 + crank * 1.5 : 1400) * dt;
        if (crank < rpmT) crank = rpmT;
        if (crank <= 0) { crank = 0; mode = 0; }
      }
      const t3 = th * 3;
      let cyl = t3 | 0; if (cyl > 2) cyl = 2;
      const f3 = t3 - cyl;
      const c3 = COS[(f3 * TS) | 0];
      hunt += (huntT - hunt) * 0.0005;
      const inst = crank * (1 - wob * c3) * (1 + hunt);
      th += inst * dt * (1 / 120);
      if (th >= 1) th -= 1;

      // ── évènements : allumage (ou compression) du cylindre suivant ──
      if (cyl !== lastCyl) {
        lastCyl = cyl; halfDone = false;
        let g = bias[cyl] * (1 + jit * rng.bi());
        let b = 0.55 + 0.9 * rng.next();
        if (misP > 0 && rng.next() < misP) { g *= 0.3; b *= 0.3; }
        gT = g; bEnv = b; tickEnv = 0.6 + 0.4 * rng.next();
      } else if (!halfDone && f3 >= 0.5) {
        halfDone = true;
        const tk = 0.3 + 0.3 * rng.next();
        if (tk > tickEnv) tickEnv = tk;
      }
      gC += (gT - gC) * kG;
      aTon += (aTonT - aTon) * kA; aComb += (aCombT - aComb) * kA; aInt += (aIntT - aInt) * kA;
      aTick += (aTickT - aTick) * kA; aTurbo += (aTurboT - aTurbo) * kA;
      mix += (mixT - mix) * kA; idm += (idT - idm) * kA; sh += (shT - sh) * kA; jud += (judT - jud) * kA;

      // ── composante périodique ──
      const pos = th * TS;
      const i0 = pos | 0;
      const fr = pos - i0;
      const lo = tLo[i0] + (tLo[i0 + 1] - tLo[i0]) * fr;
      const hi = tHi[i0] + (tHi[i0 + 1] - tHi[i0]) * fr;
      const id = tId[i0] + (tId[i0 + 1] - tId[i0]) * fr;
      const pulse = COS[((f3 + 0.88) * TS) & TM];           // maximum juste après l'allumage
      let s = lo + (hi - lo) * mix;
      s = (s + (id - s) * idm) * gC * (1 + sh * pulse) * aTon;

      // ── bruits synchrones ──
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const w = seed * 4.656612873077393e-10;
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const w2 = seed * 4.656612873077393e-10;
      bEnv *= bDec;
      s += combBp.bp(w * bEnv) * aComb * 6;
      s += intBp.bp(w2 * (0.62 + 0.38 * pulse)) * aInt * 4;
      if (jud > 1e-4) {
        judPh += 11.5 * dt; if (judPh >= 1) judPh -= 1;
        const js = SIN[(judPh * TS) | 0];
        s *= 1 + 0.32 * jud * js;
        s += judBp.bp(w2) * jud * (0.6 + 0.4 * js) * 0.22;
      }

      // ── caisse + habitacle ──
      s = body.bell(s);
      s = Math.tanh(s * drive) * invDrive;
      lp1 += a1 * (s - lp1);
      let y = cab.lp(lp1);
      dc += aDc * (y - dc);
      y -= dc;

      // ── composantes aiguës (hors filtre d'habitacle) ──
      tickEnv *= tickDec;
      tickLp += aTickLp * (tickBp.bp(w * tickEnv) - tickLp);
      y += tickLp * aTick;
      if (aTurbo > 1e-6) {
        turboPh += turboF * (1 + 0.004 * w2) * dt; if (turboPh >= 1) turboPh -= 1;
        y += SIN[(turboPh * TS) | 0] * aTurbo;
      }

      // ── démarreur ──
      st += (stT - st) * kSt;
      if (st > 1e-4) {
        const fMesh = Math.min(inst * (RING_TEETH / 60), 3600);
        stPh += fMesh * dt; if (stPh >= 1) stPh -= 1;
        stPh2 += fMesh * 3.73 * dt; if (stPh2 >= 1) stPh2 -= Math.floor(stPh2);
        const p2 = stPh * TS, j0 = p2 | 0;
        const mesh = tSt[j0] + (tSt[j0 + 1] - tSt[j0]) * (p2 - j0);
        const raw = (mesh + 0.22 * SIN[(stPh2 * TS) | 0] + stBp.bp(w2) * 1.6) * (0.78 - 0.22 * c3);
        stLp += this.aStLp * (raw - stLp);
        y += stLp * st * ENG_STARTER;
      }
      out[off + i] = y;
    }

    this.mode = mode; this.crank = crank; this.th = th; this.seed = seed; this.lastCyl = lastCyl; this.halfDone = halfDone;
    this.gC = gC; this.gT = gT; this.bEnv = bEnv; this.tickEnv = tickEnv;
    this.aTon = aTon; this.aComb = aComb; this.aInt = aInt; this.aTick = aTick; this.aTurbo = aTurbo; this.mixS = mix; this.idS = idm; this.shS = sh; this.judS = jud;
    this.turboPh = turboPh; this.st = st; this.stPh = stPh; this.stPh2 = stPh2; this.stLp = stLp; this.judPh = judPh;
    this.lp1 = lp1; this.dc = dc; this.hunt = hunt; this.tickLp = tickLp;
  }
}

// ──────────────────────────────────────────────────────────────── roulement ──

const ROAD_GAIN = 0.28;     // bruit de roulement à 130 km/h (avant filtres)
const WIND_GAIN = 0.30;
const SQUEAL_GAIN = 0.11;
const SCRUB_GAIN = 0.05;
const SETT_GAIN = 0.22;
const ABS_GAIN = 0.45;
const BRAKE_GAIN = 0.12;

class RoadCore {
  constructor(sr, seed) {
    this.sr = sr;
    this.seed = ((seed | 0) ^ 0x1b873593) | 1;
    this.rng = new Rng((seed | 0) + 4242);
    this.v = 0; this.slipS = 0; this.settS = 0; this.brakeS = 0; this.absS = 0; this.winS = 0;
    this.gs = new Float64Array(10);   // gains lissés à l'échantillon : route (2), vent, crissement, frottement, pavés, frein, texture, rafales, battement
    this.gs[7] = 1; this.gs[8] = 1;
    this.tail = 0;
    const mk = () => new Svf();
    this.boom = [mk(), mk()]; this.roar = [mk(), mk()]; this.wind = [mk(), mk()];
    this.sq1 = [mk(), mk()]; this.sq2 = [mk(), mk()]; this.scrub = [mk(), mk()];
    this.settA = [mk(), mk()]; this.settB = [mk(), mk()]; this.settN = [mk(), mk()];
    this.absA = mk(); this.absB = mk(); this.brakeBp = mk(); this.pumpLp = mk();
    this.hpS = [0, 0]; this.windHp = [0, 0]; this.sqLp = [0, 0]; this.wobS = [0, 0]; this.settCnt = [0, 0];
    this.pink = [new Float64Array(3), new Float64Array(3)];
    this.tex = 0; this.gust = 0; this.sqPh = 0; this.buffPh = 0; this.wheelPh = 0;
    this.absPh = 0; this.absEnv = 0; this.pumpPh = 0;
    this.absA.set(165, 4, sr); this.absB.set(1150, 2.5, sr); this.pumpLp.set(380, 0.7, sr);
    this.brakeBp.set(430, 3, sr);
    for (let c = 0; c < 2; c++) {
      this.boom[c].set(92, 0.75, sr);
      this.settA[c].set(c ? 66 : 60, 2.4, sr);
      this.settB[c].set(c ? 198 : 184, 2.6, sr);
      this.settN[c].set(110, 0.7, sr);
      this.scrub[c].set(c ? 980 : 880, 0.6, sr);
    }
    this.kV = 1 - Math.exp(-1 / (0.07 * sr));
    this.kP = 1 - Math.exp(-1 / (0.035 * sr));
    this.kG = 1 - Math.exp(-1 / (0.008 * sr));
    this.aHp = 1 - Math.exp(-TWO_PI * 110 / sr);
    this.aWindHp = 1 - Math.exp(-TWO_PI * 300 / sr);
    this.aSqLp = 1 - Math.exp(-TWO_PI * 4200 / sr);
    this.absDec = Math.exp(-1 / (0.009 * sr));
  }

  /** Rend `n` échantillons stéréo. P : speed (m/s), slip, sett 0/1, brake 0..1, abs 0/1, window 0..1. */
  render(outL, outR, off, n, P) {
    const sr = this.sr, dt = 1 / sr;
    const vT = clamp(Math.abs(finite(P.speed, 0)), 0, 70);
    const slipT = clamp(finite(P.slip, 0), 0, 3);
    const settT = P.sett >= 0.5 ? 1 : 0;
    const brakeT = clamp(finite(P.brake, 0), 0, 1);
    const absT = P.abs >= 0.5 ? 1 : 0;
    const winT = clamp(finite(P.window, 0), 0, 1);

    const active = vT > 0.02 || this.v > 0.02 || absT > 0 || this.absS > 1e-3 || slipT > 0.5 || this.slipS > 0.5;
    if (active) this.tail = (0.5 * sr) | 0;
    else if (this.tail <= 0) { for (let i = 0; i < n; i++) { outL[off + i] = 0; outR[off + i] = 0; } return; }
    else this.tail -= n;

    const v0 = this.v;
    const rng = this.rng;
    // ── par bloc ──
    const roadLv = ROAD_GAIN * Math.pow(Math.min(v0, 45) / 36, 1.5);
    const bright = clamp(v0 / 36, 0, 1.2);
    const gBoomT = roadLv * 1.0;
    const gRoarT = roadLv * (0.5 + 0.55 * bright) * (1 + 0.5 * this.winS);
    const wn = clamp((v0 - 11.5) / 24, 0, 1.6);
    const gWindT = WIND_GAIN * wn * wn * (1 + 1.6 * this.winS) + WIND_GAIN * 0.5 * this.winS * Math.pow(Math.min(v0, 40) / 30, 2);
    const buffDepthT = 0.45 * clamp(this.winS * 1.5 - 0.2, 0, 1) * clamp((v0 - 12) / 14, 0, 1);
    const sq = clamp((this.slipS - 0.85) / 0.45, 0, 1);       // progressif de 0,85 à 1,3
    const gSqT = SQUEAL_GAIN * Math.pow(sq, 0.9) * (0.35 + 0.65 * Math.min(1, v0 / 6));
    const sqDrive = 14 + 34 * sq;
    const gScrubT = SCRUB_GAIN * clamp((this.slipS - 0.55) / 0.5, 0, 1) * Math.min(1, v0 / 5);
    const settLvT = SETT_GAIN * this.settS * Math.pow(clamp(v0 / 9, 0, 1.8), 0.9);
    const settPeriod = v0 > 0.3 ? sr * 0.135 / v0 : 1e9;
    const brakeLvT = BRAKE_GAIN * this.brakeS * clamp(v0 / 1.2, 0, 1) * clamp((4.2 - v0) / 2.6, 0, 1);
    const wheelF = v0 / (TWO_PI * 0.308);
    // modulations lentes
    this.tex += (rng.bi() - this.tex) * 0.04;
    this.gust += (rng.bi() - this.gust) * 0.012;
    const texGT = 1 + 1.6 * this.tex;
    const gustGT = 1 + 2.2 * this.gust;
    this.sqPh += 5.3 * n * dt; if (this.sqPh >= 1) this.sqPh -= 1;
    const lfo = Math.sin(TWO_PI * this.sqPh);
    const fSq = 760 + 380 * sq + 8 * Math.min(v0, 30);
    for (let c = 0; c < 2; c++) {
      this.wobS[c] += (rng.bi() - this.wobS[c]) * 0.06;
      const f = clamp(fSq * (c ? 1.07 : 1) * (1 + (c ? -0.03 : 0.03) * lfo + 0.22 * this.wobS[c]), 700, 1500);
      this.sq1[c].set(f, 22, sr);
      this.sq2[c].set(f * 1.48, 14, sr);
      this.roar[c].set(230 + 17 * v0 + 500 * this.winS, 0.6, sr);
      this.wind[c].set((c ? 780 : 700) + 28 * v0 + 2500 * this.winS, 0.7, sr);
      if (this.settCnt[c] > settPeriod * 1.5) this.settCnt[c] = settPeriod * rng.next();
    }
    const kV = this.kV, kP = this.kP, aHp = this.aHp, aWindHp = this.aWindHp, aSqLp = this.aSqLp, absDec = this.absDec;
    let seed = this.seed, v = this.v, slipS = this.slipS, settS = this.settS, brakeS = this.brakeS, absS = this.absS, winS = this.winS;
    let absPh = this.absPh, absEnv = this.absEnv, pumpPh = this.pumpPh, buffPh = this.buffPh, wheelPh = this.wheelPh;
    const gs = this.gs, kG = this.kG;
    let gBoom = gs[0], gRoar = gs[1], gWind = gs[2], gSq = gs[3], gScrub = gs[4], settLv = gs[5], brakeLv = gs[6], texG = gs[7], gustG = gs[8], buffDepth = gs[9];
    const squealOn = gSqT > 1e-5 || gSq > 1e-5, scrubOn = gScrubT > 1e-5 || gScrub > 1e-5, settOn = settLvT > 1e-5 || settLv > 1e-5, windOn = gWindT > 1e-5 || gWind > 1e-5;
    const brakeOn = brakeLvT > 1e-5 || brakeLv > 1e-5;

    for (let i = 0; i < n; i++) {
      v += (vT - v) * kV; slipS += (slipT - slipS) * kP; settS += (settT - settS) * kP;
      brakeS += (brakeT - brakeS) * kP; absS += (absT - absS) * kP; winS += (winT - winS) * kP;
      gBoom += (gBoomT - gBoom) * kG; gRoar += (gRoarT - gRoar) * kG; gWind += (gWindT - gWind) * kG; gSq += (gSqT - gSq) * kG;
      gScrub += (gScrubT - gScrub) * kG; settLv += (settLvT - settLv) * kG; brakeLv += (brakeLvT - brakeLv) * kG;
      texG += (texGT - texG) * kG; gustG += (gustGT - gustG) * kG; buffDepth += (buffDepthT - buffDepth) * kG;
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const wc = seed * 4.656612873077393e-10;
      let buff = 1;
      if (buffDepth > 1e-3) { buffPh += 16.5 * dt; if (buffPh >= 1) buffPh -= 1; buff = 1 + buffDepth * SIN[(buffPh * TS) | 0]; }

      // ── ABS (centré) ──
      let mono = 0;
      if (absS > 1e-3) {
        let imp = 0;
        absPh += 12.2 * dt * (1 + 0.05 * wc);
        if (absPh >= 1) { absPh -= 1; absEnv = 1; imp = 1; }
        absEnv *= absDec;
        pumpPh += 88 * dt; if (pumpPh >= 1) pumpPh -= 1;
        const pump = this.pumpLp.lp(pumpPh * 2 - 1) * (0.5 + 0.5 * absEnv);
        mono += (this.absA.bp(imp * 7) + this.absB.bp(wc * absEnv) * 1.5 + pump * 0.22) * absS * ABS_GAIN;
      }
      // ── frottement de frein à très basse vitesse ──
      if (brakeOn) {
        wheelPh += wheelF * dt; if (wheelPh >= 1) wheelPh -= 1;
        mono += this.brakeBp.bp(wc) * brakeLv * (0.65 + 0.35 * SIN[(wheelPh * TS) | 0]);
      }

      for (let c = 0; c < 2; c++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const wo = seed * 4.656612873077393e-10;
        const w = 0.55 * wc + 0.83 * wo;
        // bruit rose (filtre économique de Kellet)
        const pk = this.pink[c];
        pk[0] = 0.99765 * pk[0] + w * 0.0990460;
        pk[1] = 0.96300 * pk[1] + w * 0.2965164;
        pk[2] = 0.57000 * pk[2] + w * 1.0526913;
        const pn = (pk[0] + pk[1] + pk[2] + w * 0.1848) * 0.25;
        // route
        let y = this.boom[c].bp(pn) * gBoom * 2.4;
        const r = this.roar[c].lp(pn);
        this.hpS[c] += aHp * (r - this.hpS[c]);
        y += (r - this.hpS[c]) * gRoar * 1.7;
        y *= texG;
        // vent
        if (windOn) {
          const wl = this.wind[c].lp(wo);
          this.windHp[c] += aWindHp * (wl - this.windHp[c]);
          y += (wl - this.windHp[c]) * gWind * gustG * buff;
        }
        // pneus
        if (scrubOn) y += this.scrub[c].bp(wo) * gScrub;
        if (squealOn) {
          const q = Math.tanh((this.sq1[c].bp(wo) + 0.45 * this.sq2[c].bp(wo)) * sqDrive);
          this.sqLp[c] += aSqLp * (q - this.sqLp[c]);
          y += this.sqLp[c] * gSq;
        }
        // pavés
        if (settOn) {
          let imp = 0;
          if (--this.settCnt[c] <= 0) {
            this.settCnt[c] = settPeriod * (0.55 + 0.9 * rng.next());
            imp = (0.4 + rng.next()) * (rng.next() < 0.5 ? -1 : 1);
          }
          y += (this.settA[c].bp(imp * 26) + this.settB[c].bp(imp * 9) * 0.55 + this.settN[c].bp(pn) * 1.3) * settLv;
        }
        if (c === 0) outL[off + i] = y + mono; else outR[off + i] = y + mono;
      }
    }
    this.seed = seed; this.v = v; this.slipS = slipS; this.settS = settS; this.brakeS = brakeS; this.absS = absS; this.winS = winS;
    this.absPh = absPh; this.absEnv = absEnv; this.pumpPh = pumpPh; this.buffPh = buffPh; this.wheelPh = wheelPh;
    gs[0] = gBoom; gs[1] = gRoar; gs[2] = gWind; gs[3] = gSq; gs[4] = gScrub; gs[5] = settLv; gs[6] = brakeLv; gs[7] = texG; gs[8] = gustG; gs[9] = buffDepth;
  }
}

// ─────────────────────────────────────────────────────────────── processeurs ──

if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
  const descriptors = (names) => names.map((name) => ({ name, defaultValue: 0, minValue: -1e6, maxValue: 1e6, automationRate: 'k-rate' }));

  class CarEngineProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() { return descriptors(ENGINE_PARAMS); }
    constructor(options) {
      super();
      const o = (options && options.processorOptions) || {};
      this.core = new EngineCore(sampleRate, o.seed || 1234567);
      this.P = {};
    }
    process(_inputs, outputs, parameters) {
      const out = outputs[0];
      if (!out || !out[0]) return true;
      const P = this.P;
      for (let i = 0; i < ENGINE_PARAMS.length; i++) P[ENGINE_PARAMS[i]] = parameters[ENGINE_PARAMS[i]][0];
      this.core.render(out[0], 0, out[0].length, P);
      for (let c = 1; c < out.length; c++) out[c].set(out[0]);
      return true;
    }
  }

  class CarRoadProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() { return descriptors(ROAD_PARAMS); }
    constructor(options) {
      super();
      const o = (options && options.processorOptions) || {};
      this.core = new RoadCore(sampleRate, o.seed || 7654321);
      this.P = {};
      this.tmp = new Float32Array(128);
    }
    process(_inputs, outputs, parameters) {
      const out = outputs[0];
      if (!out || !out[0]) return true;
      const P = this.P;
      for (let i = 0; i < ROAD_PARAMS.length; i++) P[ROAD_PARAMS[i]] = parameters[ROAD_PARAMS[i]][0];
      const n = out[0].length;
      if (out.length > 1) this.core.render(out[0], out[1], 0, n, P);
      else {
        if (this.tmp.length < n) this.tmp = new Float32Array(n);
        this.core.render(out[0], this.tmp, 0, n, P);
      }
      return true;
    }
  }

  registerProcessor('car-engine', CarEngineProcessor);
  registerProcessor('car-road', CarRoadProcessor);
}

export { EngineCore, RoadCore, ENGINE_PARAMS, ROAD_PARAMS };
