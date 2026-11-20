// Son procédural de la voiture école et de la ville (Web Audio, aucun fichier son, aucun accès réseau).
//
//   moteur + roulement : deux processeurs AudioWorklet (./engine-worklet.js) pilotés par AudioParam
//   bruitages          : oscillateurs / bruit filtré programmés à l'échantillon près
//   trafic, ambiance   : voix légères (bruit filtré + oscillateur), derrière le « filtre d'habitacle »
//
//   moteur ─┐
//   route  ─┴→ car (duck) ──────────────┐
//   trafic ─┬→ world (vitres, duck) ────┤
//   ville  ─┘                           ├→ master (volume/muet) → limiteur → écrêteur doux → sortie
//   bruitages (sfx), tableau de bord (ui)┤
//   voix du moniteur (voiceBus) ────────┘
//
// Tout le graphe se construit sur n'importe quel BaseAudioContext : `CarAudio.renderOffline()`
// rend un scénario dans un OfflineAudioContext (vérifications chiffrées de dev/audio.ts).
//
// Branchement type :
//   const audio = new CarAudio();
//   bouton.onclick = () => audio.init();                       // geste utilisateur obligatoire
//   car.events.stall = () => audio.play('stall');              // + engineOn: false dans l'état suivant
//   car.events.shift = () => audio.play('gear');
//   car.events.grind = () => audio.play('grind');
//   car.events.kerb = (_w, _up, v) => audio.play('kerb', Math.min(1, v / 6));
//   à chaque image : audio.update({ engineOn, starter, rpm, load, speed, slip, … }, dt);
//                    audio.setNearbyVehicle(id, distance, pan, vitesse, 'car');   // quelques véhicules proches
// `rpm` doit rester le régime réel du vilebrequin même moteur coupé (voiture en prise entraînée par les roues) ;
// au démarreur, le module impose sa propre cadence de lancement (≈ 215 tr/min, « tchou-tchou » à ≈ 5,4 Hz).

export interface CarAudioState {
  /** moteur tournant */
  engineOn: boolean;
  /** démarreur en action */
  starter: boolean;
  /** 0..7000 tr/min */
  rpm: number;
  /** 0..1 charge moteur (gaz réellement appliqués) */
  load: number;
  /** m/s */
  speed: number;
  /** 0..~3 glissement maximal des pneus (≥ 1 = au-delà de l'adhérence) */
  slip: number;
  /** 0..1 */
  brake: number;
  /** ABS en régulation */
  abs: boolean;
  surface: 'asphalt' | 'sett';
  /** clignotant ou feux de détresse : le module produit lui-même le tic-tac */
  indicator: boolean;
  /** rad/s de glissement de l'embrayage */
  clutchSlip: number;
  /** 0..1 vitre ouverte */
  windowOpen?: number;
}

export type OneShot =
  | 'stall' | 'gear' | 'grind' | 'kerb' | 'crash' | 'horn' | 'handbrake-on' | 'handbrake-off'
  | 'seatbelt' | 'door' | 'chime' | 'start-refused' | 'tick';

export type NearbyKind = 'car' | 'bus' | 'moto';

export interface RenderOfflineOptions {
  sampleRate?: number;
  /** pas de la boucle de mise à jour simulée (s) — 1/60 par défaut */
  step?: number;
}

const WORKLET_URL = new URL('./engine-worklet.js', import.meta.url);

const ENGINE_PARAMS = ['rpm', 'load', 'on', 'starter', 'stall', 'judder', 'window'] as const;
const ROAD_PARAMS = ['speed', 'slip', 'sett', 'brake', 'abs', 'window'] as const;

const MAX_VEHICLES = 6;
const VEHICLE_TIMEOUT = 0.5;
const INDICATOR_HALF_PERIOD = 1 / 3;      // tic … tac … : 1,5 cycle/s = 90 cycles/min
const LIMITER = { threshold: -9, knee: 6, ratio: 14, attack: 0.004, release: 0.18 };
const CEILING = 0.85;                      // plafond de l'écrêteur doux (≈ −1,4 dBFS)
const MAKEUP_ESTIMATE = 1.53;              // gain de compensation du limiteur si la mesure échoue (valeur mesurée sous Chromium)

function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
function num(x: number | undefined, d = 0): number { return typeof x === 'number' && Number.isFinite(x) ? x : d; }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cible d'un jeu de paramètres : AudioWorkletNode, ou cœur DSP exécuté dans un ScriptProcessor de secours. */
interface ParamSink {
  node: AudioNode;
  /** `smooth` : rejoint la valeur en douceur (grandeurs continues) au lieu d'un saut (états tout ou rien). */
  set(name: string, value: number, time: number, smooth?: boolean): void;
}

interface Graph {
  master: GainNode;
  car: GainNode;
  world: GainNode;
  worldLp: BiquadFilterNode;
  traffic: GainNode;
  amb: GainNode;
  sfx: GainNode;
  ui: GainNode;
  voice: GainNode;
  engine: ParamSink | null;
  road: ParamSink | null;
  noise: AudioBuffer;
  hornWave: PeriodicWave;
}

interface VehicleVoice {
  kind: NearbyKind;
  lastT: number;
  lastDist: number;
  closing: number;
  noise: AudioBufferSourceNode;
  nf: BiquadFilterNode;
  ng: GainNode;
  osc: OscillatorNode;
  og: GainNode;
  out: GainNode;
  pan: StereoPannerNode;
}

interface HornVoice { oscs: OscillatorNode[]; gain: GainNode; }

interface ToneOpts { f: number; f2?: number; type?: OscillatorType; peak: number; a?: number; d: number; pan?: number; }
interface BurstOpts { type: BiquadFilterType; f: number; f2?: number; q?: number; peak: number; a?: number; d: number; /** position fixe dans le bruit : bruitage identique à chaque fois */ at?: number; }

let makeupCache: Promise<number> | null = null;

/** Gain de compensation appliqué d'office par DynamicsCompressorNode pour nos réglages (mesuré, sinon estimé). */
function compressorMakeup(): Promise<number> {
  if (!makeupCache) {
    makeupCache = (async () => {
      const estimate = MAKEUP_ESTIMATE;
      try {
        const sr = 44100;
        const ctx = new OfflineAudioContext(1, Math.round(sr * 0.15), sr);
        const src = ctx.createConstantSource();
        src.offset.value = 0.001;
        const comp = ctx.createDynamicsCompressor();
        configureLimiter(comp);
        src.connect(comp).connect(ctx.destination);
        src.start();
        const buf = await ctx.startRendering();
        const d = buf.getChannelData(0);
        const g = d[d.length - 1] / 0.001;
        return Number.isFinite(g) && g > 0.5 && g < 8 ? g : estimate;
      } catch {
        return estimate;
      }
    })();
  }
  return makeupCache;
}

function configureLimiter(c: DynamicsCompressorNode): void {
  c.threshold.value = LIMITER.threshold;
  c.knee.value = LIMITER.knee;
  c.ratio.value = LIMITER.ratio;
  c.attack.value = LIMITER.attack;
  c.release.value = LIMITER.release;
}

/** Courbe de l'écrêteur : linéaire jusqu'à 0,5 puis arrondie vers CEILING ; l'entrée du WaveShaper vaut x/2. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const knee = 0.5, span = CEILING - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + span * Math.tanh((ax - knee) / span);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

export class CarAudio {
  /** Force le chemin de secours ScriptProcessor (mise au point). */
  static forceScriptProcessor = false;

  private ctx: BaseAudioContext | null = null;
  private live: AudioContext | null = null;
  private g: Graph | null = null;
  private initP: Promise<void> | null = null;
  private tOverride = -1;
  private volume = 1;
  private muted = false;
  private duckAmt = 0;
  private ambLevel = 0;
  private windowOpen = 0;
  private rng = mulberry32(0xa11d10);
  private last = new Map<string, number>();
  private indOn = false;
  private indNext = 0;
  private indTock = false;
  private birdNext = -1;
  private vehicles = new Map<number, VehicleVoice>();
  private hornVoice: HornVoice | null = null;

  constructor() { /* rien avant init() : la création du contexte exige un geste de l'utilisateur */ }

  // ───────────────────────────────────────────────────────────── cycle de vie ──

  /** À appeler depuis un geste utilisateur ; crée/reprend l'AudioContext et charge le worklet. Réentrant. */
  init(): Promise<void> {
    if (this.live && this.live.state === 'suspended') void this.live.resume().catch(() => undefined);
    if (!this.initP) {
      this.initP = this.doInit().catch((e: unknown) => {
        this.initP = null;
        throw e;
      });
    }
    return this.initP;
  }

  get ready(): boolean { return this.g !== null; }
  get context(): AudioContext | null { return this.live; }
  get voiceBus(): GainNode | null { return this.g ? this.g.voice : null; }

  private async doInit(): Promise<void> {
    if (!this.live) {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) throw new Error('Web Audio indisponible');
      this.live = new AC({ latencyHint: 'interactive' });
    }
    void this.live.resume().catch(() => undefined);
    if (!this.g) await this.attach(this.live);
  }

  /**
   * Rend `seconds` secondes hors ligne. `script(t, audio)` est appelé à chaque pas (1/60 s) comme le ferait
   * la boucle de jeu et renvoie l'état de la voiture ; il peut aussi déclencher des bruitages via `audio`.
   */
  static async renderOffline(
    seconds: number,
    script: (t: number, audio: CarAudio) => CarAudioState,
    opts: RenderOfflineOptions = {},
  ): Promise<AudioBuffer> {
    const sr = opts.sampleRate ?? 48000;
    const step = opts.step ?? 1 / 60;
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sr)), sr);
    const audio = new CarAudio();
    await audio.attach(ctx);
    const n = Math.ceil(seconds / step);
    for (let i = 0; i < n; i++) {
      const t = i * step;
      audio.tOverride = t;
      audio.update(script(t, audio), step);
    }
    return ctx.startRendering();
  }

  private now(): number {
    if (this.tOverride >= 0) return this.tOverride;
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ─────────────────────────────────────────────────────────────── graphe ──

  private async attach(ctx: BaseAudioContext): Promise<void> {
    const [makeup, sinks] = await Promise.all([compressorMakeup(), this.createSinks(ctx)]);
    const sr = ctx.sampleRate;

    // bruit blanc partagé par tous les bruitages
    const noise = ctx.createBuffer(1, Math.round(sr * 3), sr);
    const nd = noise.getChannelData(0);
    const r = mulberry32(0x5eed);
    for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;

    // sortie : volume → limiteur → compensation → écrêteur doux
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    const limiter = ctx.createDynamicsCompressor();
    configureLimiter(limiter);
    const post = ctx.createGain();
    post.gain.value = 0.5 / makeup;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    master.connect(limiter).connect(post).connect(clip).connect(ctx.destination);

    const mk = (v: number, to: AudioNode): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      n.connect(to);
      return n;
    };
    const car = mk(1, master);
    const sfx = mk(1, master);
    const ui = mk(1, master);
    const voice = mk(1, master);
    const world = mk(0.5, master);
    const worldLp = ctx.createBiquadFilter();
    worldLp.type = 'lowpass';
    worldLp.frequency.value = 900;
    worldLp.Q.value = 0.6;
    worldLp.connect(world);
    const traffic = mk(1, worldLp);
    const amb = mk(0, worldLp);

    if (sinks.engine) sinks.engine.node.connect(car);
    if (sinks.road) sinks.road.node.connect(car);

    // rumeur de la ville : bruit brun stéréo qui respire lentement
    const hum = ctx.createBuffer(2, Math.round(sr * 7), sr);
    for (let c = 0; c < 2; c++) {
      const d = hum.getChannelData(c);
      let b = 0, lp = 0;
      for (let i = 0; i < d.length; i++) {
        b = 0.985 * b + 0.12 * (r() * 2 - 1);
        lp += 0.0006 * (b - lp);
        d[i] = (b - lp) * 1.35;
      }
      // raccord de boucle sans clic
      const xf = Math.round(sr * 0.25);
      for (let i = 0; i < xf; i++) {
        const k = i / xf;
        d[i] = d[i] * k + d[d.length - xf + i] * (1 - k);
      }
    }
    const humSrc = ctx.createBufferSource();
    humSrc.buffer = hum;
    humSrc.loop = true;
    humSrc.loopEnd = hum.duration - 0.25;
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 380;
    humLp.Q.value = 0.5;
    const breath = ctx.createGain();
    breath.gain.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.083;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.2;
    lfo.connect(lfoDepth).connect(breath.gain);
    humSrc.connect(humLp).connect(breath).connect(amb);
    humSrc.start();
    lfo.start();

    // klaxon : deux lames, spectre riche
    const nh = 12;
    const real = new Float32Array(new ArrayBuffer((nh + 1) * 4));
    const imag = new Float32Array(new ArrayBuffer((nh + 1) * 4));
    const hAmp = [0, 1, 0.5, 0.72, 0.46, 0.5, 0.36, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05];
    for (let i = 1; i <= nh; i++) imag[i] = hAmp[i];
    const hornWave = ctx.createPeriodicWave(real, imag);

    this.ctx = ctx;
    this.g = { master, car, world, worldLp, traffic, amb, sfx, ui, voice, engine: sinks.engine, road: sinks.road, noise, hornWave };
    this.last.clear();
    this.applyWorld(0);
    this.setAmbience(this.ambLevel);
  }

  private async createSinks(ctx: BaseAudioContext): Promise<{ engine: ParamSink | null; road: ParamSink | null }> {
    if (!CarAudio.forceScriptProcessor && ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
      try {
        await ctx.audioWorklet.addModule(WORKLET_URL);
        const wrap = (node: AudioWorkletNode): ParamSink => ({
          node,
          set: (name, value, time, smooth) => {
            const p = node.parameters.get(name);
            if (!p) return;
            if (smooth) p.setTargetAtTime(value, Math.max(0, time), 0.012);
            else p.setValueAtTime(value, Math.max(0, time));
          },
        });
        const engine = new AudioWorkletNode(ctx, 'car-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        const road = new AudioWorkletNode(ctx, 'car-road', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        return { engine: wrap(engine), road: wrap(road) };
      } catch (e) {
        console.warn('[CarAudio] AudioWorklet indisponible, repli sur ScriptProcessor', e);
      }
    }
    try {
      return await this.createFallbackSinks(ctx);
    } catch (e) {
      console.warn('[CarAudio] synthèse moteur indisponible', e);
      return { engine: null, road: null };
    }
  }

  /** Secours sans AudioWorklet (contexte non sécurisé) : mêmes cœurs DSP dans des ScriptProcessor. */
  private async createFallbackSinks(ctx: BaseAudioContext): Promise<{ engine: ParamSink; road: ParamSink }> {
    interface Core { render(...args: unknown[]): void }
    const mod = (await import(/* @vite-ignore */ WORKLET_URL.href)) as {
      EngineCore: new (sr: number, seed: number) => Core;
      RoadCore: new (sr: number, seed: number) => Core;
    };
    const engineCore = new mod.EngineCore(ctx.sampleRate, 1234567);
    const roadCore = new mod.RoadCore(ctx.sampleRate, 7654321);
    const pe: Record<string, number> = {};
    const pr: Record<string, number> = {};
    for (const k of ENGINE_PARAMS) pe[k] = 0;
    for (const k of ROAD_PARAMS) pr[k] = 0;
    const size = 1024;
    const en = ctx.createScriptProcessor(size, 0, 1);
    en.onaudioprocess = (ev) => {
      const out = ev.outputBuffer.getChannelData(0);
      for (let o = 0; o < out.length; o += 128) engineCore.render(out, o, Math.min(128, out.length - o), pe);
    };
    const rn = ctx.createScriptProcessor(size, 0, 2);
    rn.onaudioprocess = (ev) => {
      const l = ev.outputBuffer.getChannelData(0), rr = ev.outputBuffer.getChannelData(1);
      for (let o = 0; o < l.length; o += 128) roadCore.render(l, rr, o, Math.min(128, l.length - o), pr);
    };
    return {
      engine: {
        node: en,
        set: (name, value) => {
          // pas d'automation ici : l'impulsion de calage doit rester visible au moins un bloc
          if (name === 'stall' && value === 0) setTimeout(() => { pe.stall = 0; }, 150);
          else pe[name] = value;
        },
      },
      road: { node: rn, set: (name, value) => { pr[name] = value; } },
    };
  }

  private send(sink: ParamSink | null, key: string, name: string, value: number, t: number, eps: number): void {
    if (!sink) return;
    const prev = this.last.get(key);
    // zone morte contre les micro-variations ; le retour à zéro est toujours transmis exactement
    if (prev !== undefined && (value === prev || (value !== 0 && Math.abs(value - prev) <= eps))) return;
    this.last.set(key, value);
    sink.set(name, value, t, eps > 0);
  }

  // ───────────────────────────────────────────────────────── mise à jour ──

  /** À appeler à chaque image (~60 Hz) ; le lissage (pas de bruit de marche d'escalier ni de clic) est interne. */
  update(s: CarAudioState, dt: number): void {
    const g = this.g;
    if (!g) return;
    const t = this.now();
    const rpm = clamp(num(s.rpm), 0, 7500);
    const load = clamp(num(s.load), 0, 1);
    const speed = Math.abs(num(s.speed));
    const win = clamp(num(s.windowOpen), 0, 1);
    const on = s.engineOn ? 1 : 0;
    // broutement : l'embrayage patine fort alors que le moteur est au ralenti ou en dessous
    const judder = on * clamp((Math.abs(num(s.clutchSlip)) - 25) / 75, 0, 1) * clamp((1250 - rpm) / 400, 0, 1);

    const E = g.engine, R = g.road;
    this.send(E, 'e.rpm', 'rpm', rpm, t, 0.25);
    this.send(E, 'e.load', 'load', load, t, 0.002);
    this.send(E, 'e.on', 'on', on, t, 0);
    this.send(E, 'e.starter', 'starter', s.starter ? 1 : 0, t, 0);
    this.send(E, 'e.judder', 'judder', judder, t, 0.004);
    this.send(E, 'e.window', 'window', win, t, 0.004);
    this.send(R, 'r.speed', 'speed', speed, t, 0.005);
    this.send(R, 'r.slip', 'slip', clamp(num(s.slip), 0, 3), t, 0.004);
    this.send(R, 'r.sett', 'sett', s.surface === 'sett' ? 1 : 0, t, 0);
    this.send(R, 'r.brake', 'brake', clamp(num(s.brake), 0, 1), t, 0.004);
    this.send(R, 'r.abs', 'abs', s.abs ? 1 : 0, t, 0);
    this.send(R, 'r.window', 'window', win, t, 0.004);

    if (Math.abs(win - this.windowOpen) > 0.004) {
      this.windowOpen = win;
      this.applyWorld(t);
    }

    // clignotant : tic (aigu) … tac (grave), programmés avec un peu d'avance
    if (s.indicator) {
      if (!this.indOn || this.indNext < t - 0.05) {
        this.indOn = true;
        this.indTock = false;
        this.indNext = t + 0.005;
      }
      const horizon = t + Math.max(0.12, num(dt) * 3);
      while (this.indNext < horizon) {
        this.relay(g.ui, this.indNext, this.indTock, 1);
        this.indTock = !this.indTock;
        this.indNext += INDICATOR_HALF_PERIOD;
      }
    } else this.indOn = false;

    // oiseaux : rares, seulement s'il y a de l'ambiance
    if (this.ambLevel > 0.12) {
      if (this.birdNext < 0 || this.birdNext < t - 1) this.birdNext = t + 2 + this.rng() * 8;
      if (t >= this.birdNext) {
        this.bird(t + 0.02);
        this.birdNext = t + (5 + this.rng() * 11) / (0.4 + 0.6 * this.ambLevel);
      }
    }

    // véhicules qui ne sont plus mis à jour
    if (this.vehicles.size) {
      for (const [id, v] of this.vehicles) {
        if (t - v.lastT > VEHICLE_TIMEOUT) this.releaseVehicle(id, v, t);
      }
    }
  }

  private applyWorld(t: number): void {
    const g = this.g;
    if (!g) return;
    const w = this.windowOpen;
    g.world.gain.setTargetAtTime((0.5 + 0.9 * w) * (1 - 0.4 * this.duckAmt), t, 0.1);
    g.worldLp.frequency.setTargetAtTime(900 + 5200 * w * w, t, 0.1);
  }

  // ───────────────────────────────────────────────────────────── réglages ──

  /** Niveau de l'ambiance urbaine 0..1 (rumeur de circulation lointaine, quelques oiseaux). */
  setAmbience(level: number): void {
    this.ambLevel = clamp(num(level), 0, 1);
    if (this.g) this.g.amb.gain.setTargetAtTime(this.ambLevel * 0.045, this.now(), 0.4);
  }

  setMasterVolume(v: number): void {
    this.volume = clamp(num(v, 1), 0, 1);
    this.applyMaster();
  }

  setMuted(m: boolean): void {
    this.muted = !!m;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (this.g) this.g.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.now(), 0.025);
  }

  /** Libère le contexte audio (rechargement à chaud, fin de partie). L'instance peut être réinitialisée par init(). */
  dispose(): void {
    const live = this.live;
    this.live = null;
    this.ctx = null;
    this.g = null;
    this.initP = null;
    this.hornVoice = null;
    this.vehicles.clear();
    this.last.clear();
    this.indOn = false;
    if (live && live.state !== 'closed') void live.close().catch(() => undefined);
  }

  /** 0..1 : baisse en douceur moteur, roulement et ville tant que le moniteur parle (rappeler duck(0) ensuite). */
  duck(amount: number): void {
    this.duckAmt = clamp(num(amount), 0, 1);
    const g = this.g;
    if (!g) return;
    const t = this.now();
    g.car.gain.setTargetAtTime(1 - 0.55 * this.duckAmt, t, 0.12);
    this.applyWorld(t);
  }

  // ──────────────────────────────────────────────────────────── bruitages ──

  private env(p: AudioParam, t: number, peak: number, a: number, d: number): number {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), t + a + d);
    p.linearRampToValueAtTime(0, t + a + d + 0.004);
    return t + a + d + 0.01;
  }

  /** Oscillateur amorti (glissando f → f2 facultatif). */
  private tone(dest: AudioNode, t: number, o: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.a ?? 0.003) + o.d * 0.6);
    const g = ctx.createGain();
    const end = this.env(g.gain, t, o.peak, o.a ?? 0.003, o.d);
    let tail: AudioNode = g;
    if (o.pan !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p);
      tail = p;
    }
    osc.connect(g);
    tail.connect(dest);
    osc.start(t);
    osc.stop(end);
    osc.onended = () => { tail.disconnect(); };
  }

  /** Bouffée de bruit filtré (balayage du filtre f → f2 facultatif). */
  private burst(dest: AudioNode, t: number, o: BurstOpts): void {
    const ctx = this.ctx, g = this.g;
    if (!ctx || !g) return;
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.f, t);
    if (o.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.f2), t + (o.a ?? 0.001) + o.d * 0.7);
    f.Q.value = o.q ?? 0.8;
    const eg = ctx.createGain();
    const end = this.env(eg.gain, t, o.peak, o.a ?? 0.001, o.d);
    src.connect(f).connect(eg).connect(dest);
    src.start(t, o.at ?? this.rng() * (g.noise.duration - 0.2));
    src.stop(end);
    src.onended = () => { eg.disconnect(); };
  }

  /** Relais de clignotant : tic (aigu) ou tac (grave). */
  private relay(dest: AudioNode, t: number, tock: boolean, k: number): void {
    this.burst(dest, t, { type: 'bandpass', f: tock ? 1500 : 2300, q: 2.2, peak: 0.34 * k, d: 0.011, at: tock ? 0.731 : 0.137 });
    this.tone(dest, t, { f: tock ? 610 : 880, peak: 0.03 * k, a: 0.001, d: 0.022 });
    this.burst(dest, t, { type: 'lowpass', f: 420, peak: 0.03 * k, d: 0.016, at: 1.9 });
  }

  private chimeAt(t: number, k: number): void {
    const g = this.g;
    if (!g) return;
    const notes = [1046.5, 784];
    for (let i = 0; i < notes.length; i++) {
      const tt = t + i * 0.19, f = notes[i];
      this.tone(g.ui, tt, { f, peak: 0.07 * k, a: 0.004, d: 0.75 });
      this.tone(g.ui, tt, { f: f * 2, peak: 0.017 * k, a: 0.004, d: 0.4 });
      this.tone(g.ui, tt, { f: f * 3.01, peak: 0.006 * k, a: 0.004, d: 0.2 });
    }
  }

  private bird(t: number): void {
    const g = this.g;
    if (!g) return;
    const rnd = this.rng;
    const n = 2 + Math.floor(rnd() * 4);
    const base = 2600 + rnd() * 1800;
    const pan = rnd() * 1.6 - 0.8;
    const lvl = 0.035 * (0.4 + 0.6 * this.ambLevel) * (0.5 + rnd() * 0.5);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = base * (0.9 + rnd() * 0.3);
      this.tone(g.traffic, tt, { f, f2: f * (rnd() < 0.5 ? 1.35 : 0.72), peak: lvl, a: 0.012, d: 0.07 + rnd() * 0.05, pan });
      tt += 0.09 + rnd() * 0.09;
    }
  }

  private hornStart(t: number, level: number): HornVoice | null {
    const ctx = this.ctx, g = this.g;
    if (!ctx || !g) return null;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.012);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 260;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    lp.Q.value = 0.7;
    hp.connect(lp).connect(gain).connect(g.sfx);
    const oscs: OscillatorNode[] = [];
    for (const f of [420, 500]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(g.hornWave);
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      o.connect(og).connect(hp);
      o.start(t);
      oscs.push(o);
    }
    oscs[0].onended = () => { gain.disconnect(); };
    return { oscs, gain };
  }

  private hornStop(h: HornVoice, t: number): void {
    h.gain.gain.cancelScheduledValues(t);
    h.gain.gain.setTargetAtTime(0, t, 0.018);
    for (const o of h.oscs) o.stop(t + 0.15);
  }

  /** Klaxon maintenu. */
  hornOn(): void {
    if (this.hornVoice || !this.g) return;
    this.hornVoice = this.hornStart(this.now() + 0.003, 0.3);
  }

  hornOff(): void {
    if (!this.hornVoice) return;
    this.hornStop(this.hornVoice, this.now());
    this.hornVoice = null;
  }

  /** Bruitage ponctuel ; `intensity` 0..1 (1 par défaut). `'horn'` = coup bref (klaxon tenu : hornOn/hornOff). */
  play(name: OneShot, intensity = 1): void {
    const g = this.g;
    if (!g) return;
    const k = clamp(num(intensity, 1), 0, 1.5);
    if (k <= 0) return;
    const t = this.now() + 0.004;
    const sfx = g.sfx, ui = g.ui;
    switch (name) {
      case 'tick':
        this.relay(ui, t, false, k);
        break;
      case 'stall': {
        // le calage lui-même (2-3 derniers allumages qui secouent) est joué par le processeur moteur
        if (g.engine) {
          g.engine.set('stall', 1, t);
          g.engine.set('stall', 0, t + 0.06);
        }
        this.tone(sfx, t + 0.5, { f: 70, f2: 45, peak: 0.07 * k, a: 0.01, d: 0.16 });      // la caisse retombe
        this.chimeAt(t + 0.95, 0.4);                                                      // témoins : contact mis, moteur arrêté
        break;
      }
      case 'gear':
        this.tone(sfx, t, { f: 150, f2: 95, peak: 0.1 * k, a: 0.002, d: 0.07 });
        this.burst(sfx, t, { type: 'bandpass', f: 1000, q: 1.2, peak: 0.1 * k, d: 0.024 });
        this.tone(sfx, t + 0.055, { f: 112, f2: 84, peak: 0.07 * k, a: 0.002, d: 0.06 });
        this.burst(sfx, t + 0.055, { type: 'bandpass', f: 700, q: 1, peak: 0.08 * k, d: 0.03 });
        break;
      case 'grind': {
        const ctx = this.ctx;
        if (!ctx) break;
        const dur = 0.4 * (0.75 + 0.25 * k);
        const am = ctx.createGain();
        am.gain.value = 0.5;
        const eg = ctx.createGain();
        eg.gain.setValueAtTime(0, t);
        eg.gain.linearRampToValueAtTime(0.3 * k, t + 0.012);
        eg.gain.setValueAtTime(0.3 * k, t + dur - 0.07);
        eg.gain.linearRampToValueAtTime(0, t + dur);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2100;
        bp.Q.value = 1.1;
        const src = ctx.createBufferSource();
        src.buffer = g.noise;
        src.loop = true;
        src.connect(bp).connect(am);
        const nodes: AudioScheduledSourceNode[] = [src];
        // dents qui ripent : modulation rapide en dents de scie
        for (const [f, depth] of [[78, 0.36], [131, 0.14]] as const) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(f, t);
          o.frequency.linearRampToValueAtTime(f * 0.78, t + dur);
          const og = ctx.createGain();
          og.gain.value = depth;
          o.connect(og).connect(am.gain);
          nodes.push(o);
        }
        for (const [f, a] of [[1850, 0.1], [2740, 0.07]] as const) {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          const og = ctx.createGain();
          og.gain.value = a;
          o.connect(og).connect(am);
          nodes.push(o);
        }
        am.connect(eg).connect(sfx);
        for (const nd of nodes) { nd.start(t); nd.stop(t + dur + 0.02); }
        src.onended = () => { eg.disconnect(); };
        break;
      }
      case 'kerb':
        this.tone(sfx, t, { f: 86, f2: 54, peak: 0.42 * k, a: 0.004, d: 0.17 });
        this.burst(sfx, t, { type: 'lowpass', f: 900, peak: 0.2 * k, d: 0.04 });
        this.burst(sfx, t + 0.004, { type: 'bandpass', f: 220, q: 2, peak: 0.3 * k, d: 0.09 });
        break;
      case 'crash': {
        this.burst(sfx, t, { type: 'lowpass', f: 3200, f2: 500, q: 0.5, peak: 0.8 * k, a: 0.002, d: 0.42 + 0.2 * k });
        this.tone(sfx, t, { f: 62, f2: 32, peak: 0.6 * k, a: 0.003, d: 0.36 });
        this.burst(sfx, t + 0.03, { type: 'bandpass', f: 1800, q: 0.8, peak: 0.34 * k, d: 0.13 });
        const ring = [437, 811, 1289, 1973, 2861];
        for (let i = 0; i < ring.length; i++) {
          this.tone(sfx, t + 0.004 * i, { f: ring[i] * (0.97 + 0.06 * this.rng()), type: 'triangle', peak: (0.09 * k) / Math.sqrt(i + 1), a: 0.002, d: 0.45 + 0.4 * this.rng() });
        }
        if (k > 0.55) {
          for (let i = 0; i < 6; i++) {
            this.tone(sfx, t + 0.06 + this.rng() * 0.45, { f: 3200 + this.rng() * 3200, peak: 0.03 * k, a: 0.001, d: 0.05 + this.rng() * 0.08, pan: this.rng() * 1.2 - 0.6 });
          }
        }
        break;
      }
      case 'horn': {
        const h = this.hornStart(t, 0.3 * Math.min(1, 0.5 + 0.5 * k));
        if (h) this.hornStop(h, t + 0.22 + 0.2 * Math.min(1, k));
        break;
      }
      case 'handbrake-on': {
        const gaps = [0, 0.058, 0.108, 0.152, 0.193, 0.231, 0.266, 0.298];
        const n = clamp(Math.round(4 + 3 * k), 3, gaps.length);
        for (let i = 0; i < n; i++) {
          this.burst(sfx, t + gaps[i], { type: 'bandpass', f: 1900 + 110 * i, q: 3, peak: 0.3, d: 0.016 });
          this.tone(sfx, t + gaps[i], { f: 1240 + 55 * i, peak: 0.028, a: 0.001, d: 0.012 });
        }
        this.tone(sfx, t + gaps[n - 1], { f: 140, f2: 100, peak: 0.05, a: 0.003, d: 0.06 });
        break;
      }
      case 'handbrake-off':
        this.burst(sfx, t, { type: 'bandpass', f: 2400, q: 2, peak: 0.2 * k, d: 0.014 });
        this.burst(sfx, t + 0.075, { type: 'bandpass', f: 900, q: 1, peak: 0.16 * k, d: 0.04 });
        this.tone(sfx, t + 0.075, { f: 132, f2: 88, peak: 0.12 * k, a: 0.003, d: 0.09 });
        break;
      case 'seatbelt':
        this.burst(ui, t, { type: 'bandpass', f: 3200, q: 2.5, peak: 0.28 * k, d: 0.011 });
        this.burst(ui, t + 0.032, { type: 'bandpass', f: 1500, q: 2, peak: 0.34 * k, d: 0.03 });
        this.tone(ui, t + 0.032, { f: 2450, peak: 0.028 * k, a: 0.001, d: 0.07 });
        break;
      case 'door':
        this.burst(sfx, t, { type: 'bandpass', f: 2000, q: 1.5, peak: 0.12 * k, d: 0.014 });
        this.tone(sfx, t + 0.015, { f: 78, f2: 47, peak: 0.3 * k, a: 0.004, d: 0.2 });
        this.burst(sfx, t + 0.015, { type: 'lowpass', f: 500, peak: 0.24 * k, a: 0.002, d: 0.09 });
        this.burst(sfx, t + 0.05, { type: 'bandpass', f: 1200, q: 1.2, peak: 0.06 * k, d: 0.03 });
        break;
      case 'chime':
        this.chimeAt(t, k);
        break;
      case 'start-refused':
        // le relais colle mais le démarreur ne part pas, puis double « bip » grave du tableau de bord
        this.burst(sfx, t, { type: 'bandpass', f: 1800, q: 2, peak: 0.3 * k, d: 0.02 });
        this.tone(sfx, t, { f: 96, f2: 70, peak: 0.12 * k, a: 0.002, d: 0.07 });
        for (const dt of [0.14, 0.31]) {
          this.tone(ui, t + dt, { f: 392, type: 'triangle', peak: 0.075 * k, a: 0.006, d: 0.13 });
          this.tone(ui, t + dt, { f: 196, peak: 0.03 * k, a: 0.006, d: 0.13 });
        }
        break;
    }
  }

  // ───────────────────────────────────────────────────── autres véhicules ──

  /**
   * Véhicule voisin, à appeler à chaque image pour les quelques véhicules les plus proches (identifiant stable).
   * `distance` en m, `pan` −1 (gauche) … +1 (droite), `speed` m/s (vitesse du véhicule ou vitesse de rapprochement :
   * seule sa valeur absolue compte, elle règle le bruit de roulement et le régime) ; l'effet Doppler est déduit de la
   * variation de distance. La voix s'éteint d'elle-même si elle n'est plus mise à jour pendant 0,5 s.
   */
  setNearbyVehicle(id: number, distance: number, pan: number, speed: number, kind: NearbyKind): void {
    const ctx = this.ctx, g = this.g;
    if (!ctx || !g) return;
    const t = this.now();
    const d = Math.max(0, num(distance, 999));
    const sp = Math.abs(num(speed));
    let v = this.vehicles.get(id);
    if (v && v.kind !== kind) {
      this.releaseVehicle(id, v, t);
      v = undefined;
    }
    if (!v) {
      if (d > 80) return;
      if (this.vehicles.size >= MAX_VEHICLES) {
        let farId = -1, far = d;
        for (const [oid, ov] of this.vehicles) if (ov.lastDist > far) { far = ov.lastDist; farId = oid; }
        if (farId < 0) return;
        const fv = this.vehicles.get(farId);
        if (fv) this.releaseVehicle(farId, fv, t);
      }
      v = this.createVehicle(ctx, g, kind, t, d);
      this.vehicles.set(id, v);
    }
    const dtv = t - v.lastT;
    if (dtv > 1e-4) {
      const closing = clamp(-(d - v.lastDist) / dtv, -45, 45);
      v.closing += (closing - v.closing) * Math.min(1, dtv * 6);
    }
    v.lastT = t;
    v.lastDist = d;

    const doppler = 1 + clamp(v.closing, -34, 34) / 340;
    const att = (1 / (1 + Math.pow(d / 6, 1.6))) * clamp((80 - d) / 20, 0, 1);
    const roll = 0.12 + 0.88 * Math.pow(Math.min(1, sp / 14), 1.5);
    let fOsc: number, aOsc: number, aNoise: number;
    if (kind === 'bus') { fOsc = clamp(30 + 2.2 * sp, 30, 75); aOsc = 0.8; aNoise = 1.2 * roll + 0.12; }
    else if (kind === 'moto') { fOsc = clamp(85 + 11 * sp, 85, 420); aOsc = 0.75; aNoise = 0.45 * roll; }
    else { fOsc = clamp(45 + 4 * sp, 45, 140); aOsc = 0.4; aNoise = roll; }
    const tc = 0.06;
    v.osc.frequency.setTargetAtTime(fOsc * doppler, t, tc);
    v.nf.frequency.setTargetAtTime((520 + 38 * sp) * doppler, t, tc);
    v.og.gain.setTargetAtTime(aOsc, t, tc);
    v.ng.gain.setTargetAtTime(aNoise, t, tc);
    v.out.gain.setTargetAtTime(att * 0.6, t, tc);
    v.pan.pan.setTargetAtTime(clamp(num(pan), -1, 1), t, tc);
  }

  private createVehicle(ctx: BaseAudioContext, g: Graph, kind: NearbyKind, t: number, d: number): VehicleVoice {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    const pan = ctx.createStereoPanner();
    out.connect(pan).connect(g.traffic);
    // roulement
    const noise = ctx.createBufferSource();
    noise.buffer = g.noise;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 800;
    nf.Q.value = 0.55;
    const ng = ctx.createGain();
    ng.gain.value = 0;
    noise.connect(nf).connect(ng).connect(out);
    // moteur
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = kind === 'moto' ? 120 : 50;
    const of = ctx.createBiquadFilter();
    if (kind === 'moto') { of.type = 'bandpass'; of.frequency.value = 650; of.Q.value = 0.7; }
    else { of.type = 'lowpass'; of.frequency.value = kind === 'bus' ? 210 : 280; of.Q.value = kind === 'bus' ? 2 : 0.8; }
    const og = ctx.createGain();
    og.gain.value = 0;
    osc.connect(of).connect(og).connect(out);
    noise.start(t, this.rng() * (g.noise.duration - 0.2));
    osc.start(t);
    return { kind, lastT: t, lastDist: d, closing: 0, noise, nf, ng, osc, og, out, pan };
  }

  private releaseVehicle(id: number, v: VehicleVoice, t: number): void {
    this.vehicles.delete(id);
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, 0.07);
    v.noise.stop(t + 0.5);
    v.osc.stop(t + 0.5);
    v.osc.onended = () => { v.pan.disconnect(); };
  }
}
