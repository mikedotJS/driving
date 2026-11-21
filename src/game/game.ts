// Chef d'orchestre : charge le monde, fait tourner la simulation, relie commandes, physique,
// circulation, règles, moniteur, affichage et son, et gère leçons, conduite libre et examen.

import * as THREE from 'three';
import { RoadNet, type MapFile } from '../map/roadnet';
import { MaterialLib } from '../render/materials';
import { Sky } from '../render/sun';
import { PlayerView, VIEW_LABELS } from '../render/view';
import { TrafficView } from '../render/traffic-view';
import { City } from '../world/city';
import { Ortho, lireIndex, lireToits } from '../world/ortho';
import { Ground } from '../world/ground';
import { Props } from '../world/props';
import { ParkedCars } from '../world/parked';
import { Traffic } from '../traffic/traffic';
import { RulesEngine, type FaultEvent, type PlayerState, type Situation } from '../rules/engine';
import { GRILLE, type Competence } from '../rules/infractions';
import { Player } from './player';
import { Controls, type InputState } from '../input/controls';
import { ForceFeedback, FfbModel } from '../input/ffb';
import { Hud, type StepView } from '../ui/hud';
import { Menus, type Bilan, type MenuHost } from '../ui/menus';
import { CarAudio } from '../audio/car-audio';
import { Voice } from '../audio/voice';
import { loadSettings, saveSettings, TRAFFIC_COUNTS, type Settings } from './settings';
import { EXAM, FREE, LESSONS, START_STREETS, planExam, planLesson, planRoute, poseOn, quietStreet, startOnStreet, type Lesson, type LessonCtx, type StartPose } from './lessons';
import { findRoute, RouteFollower, type Route } from '../map/route';
import { Autopilot } from './autopilot';
import { drawQuiz } from './quiz';
import { clamp, hash32 } from '../core/math';

type State = 'menu' | 'drive' | 'pause' | 'bilan';

interface Session {
  time: number; distance: number; points: number; amende: number;
  faults: FaultEvent[]; offRoute: number; praised: number; stalls: number; seed: number;
}

export class Game implements MenuHost {
  settings: Settings = loadSettings();
  controls = new Controls();
  ffb = new ForceFeedback();
  private ffbModel = new FfbModel();
  private hud = new Hud();
  private menus = new Menus(this);
  private audio = new CarAudio();
  private voice = new Voice();

  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private sky!: Sky;
  private mats = new MaterialLib();
  net!: RoadNet;
  private city!: City;
  private ground!: Ground;
  private props!: Props;
  private parked!: ParkedCars;
  traffic!: Traffic;
  private trafficView!: TrafficView;
  rules!: RulesEngine;
  player!: Player;
  private view!: PlayerView;

  state: State = 'menu';
  lesson: Lesson = FREE;
  private route: Route | null = null;
  private follower: RouteFollower | null = null;
  private step = 0;
  private ctx: LessonCtx | null = null;
  session: Session = { time: 0, distance: 0, points: 12, amende: 0, faults: [], offRoute: 0, praised: 0, stalls: 0, seed: 1 };
  private lastTime = 0;
  private menuAngle = 0;
  private menuCenter = { x: 1080, z: -480 };
  private viewRadius = 300;
  private fpsAcc = 0; private fpsN = 0; private fpsTimer = 0;
  /** régulateur de fluidité : niveau d'allègement (0 = réglage choisi), compteurs de secondes lentes / rapides */
  private perfLevel = 0; private perfLow = 0; private perfHigh = 0; private perfWall = 0; private perfFrames = 0;
  /** dernière cadence mesurée (images par seconde réelles) */
  fps = 0;
  private perfFixed = new URLSearchParams(location.search).get('perf') === 'fixe';
  /** mesure de fluidité en cours : cadences relevées seconde par seconde */
  private bench: number[] | null = null;
  private hudTimer = 0;
  private audioReady = false;
  private lastInstruction = '';
  private lastInstructionKey: string | null = null;
  /** démonstration : le moniteur conduit à la place de l'élève */
  private demo: Autopilot | null = null;
  private demoSteer = 0;
  private demoIndOff = 0;
  /** fondu de la direction quand le moniteur rend le volant (s) */
  private handover = 0;
  private recalcCooldown = 0;
  private postGrid = new Map<number, { x: number; z: number; r: number }[]>();
  private startPose: StartPose | null = null;
  private introTimer = 0;
  time = 0;

  // ───────────────────────── chargement ─────────────────────────
  async init(progress: (ratio: number, text: string) => void) {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    const q = this.settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== 'basse', powerPreference: 'high-performance' });
    this.applyPixelRatio();
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.62;
    this.scene.fog = new THREE.FogExp2(0xbfd0e0, 0.0015);

    progress(0.05, 'Lecture du plan des rues…');
    const map = (await (await fetch('maps/montreuil.json')).json()) as MapFile;
    progress(0.2, 'Construction du réseau routier…');
    await tick();
    this.net = new RoadNet(map);
    progress(0.3, 'Chargement des textures et du ciel…');
    this.sky = new Sky(this.scene, this.renderer, {
      shadows: true,
      cascades: q === 'basse' ? [22, 110] : [16, 55, 210],
      mapSize: q === 'haute' ? 4096 : q === 'moyenne' ? 2048 : 1024,
    });
    await Promise.all([this.mats.load(this.renderer), this.sky.load()]);
    progress(0.55, 'Mise en place de la signalisation…');
    await tick();
    this.ground = new Ground(map);
    // photo aérienne du sol : ?ortho=non la coupe, ?ortho=calage la montre seule, chaussée comprise
    const pOrtho = new URLSearchParams(location.search).get('ortho');
    const ixOrtho = pOrtho === 'non' ? null : await lireIndex();
    const ortho = ixOrtho ? new Ortho(ixOrtho, {
      mineral: this.mats.sidewalk, vegetal: this.mats.grass, pave: this.mats.plaza, uni: this.mats.uni, toit: this.mats.roof, chaussee: this.mats.road, moyennes: this.mats.moyennes,
    }, { calage: pOrtho === 'calage', toits: await lireToits(ixOrtho, map.buildings.length), envoyer: (t) => this.renderer.initTexture(t), anisotropie: Math.min(4, this.renderer.capabilities.getMaxAnisotropy()) }) : null;
    this.city = new City(this.net, this.mats, ortho);
    this.props = new Props(this.net, this.mats, this.ground, this.city.enseignes);
    this.parked = new ParkedCars(this.net);
    this.city.decorators.push((k, g, textes, uni) => this.props.populateChunk(k, g, textes, uni), (k, g) => this.parked.populateChunk(k, g));
    this.scene.add(this.city.group, this.props.group);
    for (const p of this.props.posts) {
      const k = (Math.floor(p.x / 16) + 4096) * 8192 + Math.floor(p.z / 16) + 4096;
      let a = this.postGrid.get(k);
      if (!a) this.postGrid.set(k, (a = []));
      a.push(p);
    }

    progress(0.65, 'Mise en circulation…');
    const tc = TRAFFIC_COUNTS[this.settings.traffic];
    this.traffic = new Traffic(this.net, { vehicles: tc.vehicles, pedestrians: tc.pedestrians, seed: 11 });
    this.trafficView = new TrafficView(this.traffic, this.ground);
    this.scene.add(this.trafficView.group);
    this.rules = new RulesEngine(this.net, this.traffic);
    this.player = new Player(this.ground, this.net, this.traffic);
    this.player.boxes = (x, z, r) => this.parked.near(x, z, r);
    this.player.posts = (x, z, r) => this.postsNear(x, z, r);
    this.view = new PlayerView(this.scene, this.renderer, innerWidth / innerHeight);

    this.wire();
    this.applySettings();

    progress(0.75, 'Construction du quartier…');
    const start = quietStreet(this.net, 1080, -480) ?? startOnStreet(this.net, 'Rue de Paris');
    if (start) this.menuCenter = { x: start.x, z: start.z };
    this.player.spawn(this.menuCenter.x, this.menuCenter.z, start?.heading ?? 0);
    // construction progressive pour laisser l'écran de chargement se rafraîchir
    for (let r = 100; r <= this.viewRadius; r += 100) {
      this.city.ensureAround(this.menuCenter.x, this.menuCenter.z, r);
      progress(0.75 + 0.2 * (r / this.viewRadius), 'Construction du quartier…');
      await tick();
    }
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'drive') this.pause(); });
    progress(0.97, 'Préparation de l’affichage…');
    await tick();
    await this.warmUp();
    progress(1, 'Prêt');
    this.state = 'menu';
    this.menus.main();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private postsNear(x: number, z: number, r: number) {
    const out: { x: number; z: number; r: number }[] = [];
    for (let i = Math.floor((x - r) / 16); i <= Math.floor((x + r) / 16); i++) {
      for (let j = Math.floor((z - r) / 16); j <= Math.floor((z + r) / 16); j++) {
        const a = this.postGrid.get((i + 4096) * 8192 + j + 4096);
        if (a) for (const p of a) if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r) out.push(p);
      }
    }
    return out;
  }

  /**
   * Régulateur de fluidité : mesure la cadence réelle et, si elle reste sous 40 images par seconde pendant
   * 3 s de conduite, allège l'affichage d'un cran (résolution et distance de vue, rétroviseurs en dernier) ;
   * après 25 s au-dessus de 57 images par seconde, il rétablit un cran.
   */
  private governor(elapsed: number) {
    if (!(elapsed > 0) || elapsed > 5) return; // onglet en arrière-plan, premier appel
    this.perfWall += elapsed; this.perfFrames++;
    if (this.perfWall < 1) return;
    this.fps = this.perfFrames / this.perfWall;
    this.perfWall = 0; this.perfFrames = 0;
    if (this.bench && this.state === 'drive') { this.bench.push(this.fps); if (this.bench.length >= 23) this.finishBenchmark(); return; }
    if (this.state !== 'drive' || !this.settings.autoQuality || this.perfFixed) { this.perfLow = this.perfHigh = 0; return; }
    this.perfLow = this.fps < 40 ? this.perfLow + 1 : 0;
    this.perfHigh = this.fps > 57 ? this.perfHigh + 1 : 0;
    if (this.perfLow >= 3 && this.perfLevel < 3) {
      this.perfLevel++; this.perfLow = 0;
      this.applySettings();
      this.hud.coach(this.perfLevel < 3 ? 'Affichage allégé pour garder la fluidité.' : 'Rétroviseurs coupés pour garder la fluidité : contrôlez en tournant la tête.', 'Réglable dans Réglages → Fluidité automatique', false, 5);
    } else if (this.perfHigh >= 25 && this.perfLevel > 0) {
      this.perfLevel--; this.perfHigh = 0;
      this.applySettings();
    }
  }

  private applyPixelRatio() {
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    const base = q === 'haute' ? Math.min(dpr, 2) : q === 'moyenne' ? Math.min(dpr, 1.25) : Math.min(dpr, 1);
    this.renderer.setPixelRatio(base * [1, 0.85, 0.72, 0.6][this.perfLevel]);
  }
  private resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.view.setAspect(innerWidth / innerHeight);
  }

  // ───────────────────────── câblage des événements ─────────────────────────
  private wire() {
    const exam = () => this.lesson.id === 'examen';
    this.rules.onFault = (f) => {
      if (f.inf.id === 'controle' && !this.settings.strict) { this.rules.faults.pop(); return; }
      if (this.demo) { this.rules.faults.pop(); return; } // le moniteur conduit : rien n'est retenu contre l'élève
      const s = this.session;
      s.faults.push(f);
      s.points = Math.max(0, s.points - f.inf.points);
      s.amende += f.inf.amende;
      if (f.inf.id === 'calage') s.stalls++;
      this.hud.setScore(s.points, s.amende, s.faults.filter((x) => x.inf.severity !== 'conseil').length);
      if (exam()) return; // l'inspecteur ne commente pas pendant l'épreuve
      this.hud.fault(f);
      this.voice.say(f.inf.moniteur, f.inf.id, f.inf.severity === 'grave');
      if (this.audioReady) this.audio.play('chime', f.inf.severity === 'grave' ? 1 : 0.6);
    };
    this.rules.onPraise = (text) => {
      this.session.praised++;
      if (exam()) return;
      this.hud.coach(text, '', true, 4);
      this.voice.say(text, 'bravo_pieton');
    };
    const P = this.player;
    P.events.collision = (kind, speed) => {
      const id = kind === 'pieton' ? 'collision_pieton' : kind === 'cycliste' ? 'collision_cycliste' : kind === 'vehicule' ? 'collision_vehicule' : 'collision';
      this.rules.report(id, P.car, `choc à ${Math.round(speed * 3.6)} km/h`);
      if (this.audioReady) this.audio.play('crash', clamp(speed / 8, 0.25, 1));
      this.ffbModel.jolt(clamp(speed / 6, 0.2, 0.9), Math.random() < 0.5 ? 1 : -1);
    };
    P.events.kerb = (wheel, up, speed) => {
      if (this.audioReady) this.audio.play('kerb', clamp(speed / 6, 0.3, 1));
      this.ffbModel.jolt(clamp(speed / 10, 0.1, 0.5) * (up ? 1 : 0.5), wheel % 2 ? -1 : 1);
    };
    P.events.message = (text) => { this.hud.coach(text, '', false, 5); };
    P.events.horn = (on) => { if (!this.audioReady) return; if (on) this.audio.hornOn(); else this.audio.hornOff(); };
    P.events.sound = (name) => { if (this.audioReady && name !== 'tick') this.audio.play(name); };
    P.car.events.grind = () => { if (this.audioReady) this.audio.play('grind'); this.rules.report('rapport', P.car); };
    P.car.events.started = () => { this.hud.coach('Moteur démarré.', '', true, 2.5); };
    this.controls.onDeviceChange = (name, kind) => {
      this.hud.setDevice(kind === 'wheel' ? `Volant : ${name}` : kind === 'pad' ? `Manette : ${name}` : 'Clavier');
      this.applySettings();
      if (this.state === 'menu' && this.menus.open) {
        // premier branchement d'un volant : on propose tout de suite la calibration
        if (kind === 'wheel' && this.controls.profile && !this.controls.profile.calibrated) this.menus.calibrate(() => { this.applySettings(); this.menus.main(); });
        else this.menus.main();
      } else if (kind === 'wheel' && this.state === 'drive' && this.controls.profile && !this.controls.profile.calibrated) {
        this.hud.coach('Volant détecté. Pensez à le calibrer : menu Pause → Réglages → Calibrer.', '', false, 8);
      }
    };
    this.hud.setDevice('Clavier');
    this.voice.onSpeak = (active) => { if (this.audioReady) this.audio.duck(active ? 0.45 : 0); };
    // le son ne peut démarrer qu'après un geste de l'utilisateur
    const unlock = () => { void this.initAudio(); };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  }

  private async initAudio() {
    if (this.audioReady) return;
    try {
      await this.audio.init();
      this.audioReady = this.audio.ready;
      this.audio.setMasterVolume(this.settings.volume);
      this.audio.setAmbience(0.5);
      await this.voice.init(this.audio.context, this.audio.voiceBus);
    } catch (e) { console.warn('Audio indisponible', e); }
  }

  // ───────────────────────── réglages ─────────────────────────
  applySettings() {
    const s = this.settings;
    const c = this.controls;
    if (c.profile) { c.profile.rangeDeg = s.wheelRange; c.profile.hShifter = s.hShifter; }
    c.brakeGamma = s.brakeGamma;
    if (s.transmissionAuto) {
      // sans pédale d'embrayage (clavier, manette, volant à deux pédales), l'embrayage est piloté
      const clutch = c.state.device === 'wheel' && !!c.profile?.clutch;
      s.transmission = clutch ? 'manual' : 'autoclutch';
    }
    if (this.player) this.player.car.mode = s.transmission;
    if (this.view) {
      this.view.fov = s.fov; this.view.lookIntoTurns = s.lookIntoTurns;
      this.view.mirrorsEnabled = s.mirrors && this.perfLevel < 3;
      this.view.mirrorRate = s.quality === 'haute' ? 3 : 1;
    }
    // photo aérienne du sol : coupée en qualité basse (mémoire vidéo et téléchargements épargnés)
    if (this.city?.ortho) this.city.ortho.active = s.quality !== 'basse';
    this.viewRadius = (s.quality === 'haute' ? 380 : s.quality === 'moyenne' ? 300 : 220) * [1, 0.82, 0.68, 0.58][this.perfLevel];
    if (this.renderer) this.applyPixelRatio(), this.renderer.setSize(innerWidth, innerHeight, false);
    if (this.traffic) {
      const tc = TRAFFIC_COUNTS[s.traffic];
      const k = this.lesson.traffic === 'aucun' ? 0 : this.lesson.traffic === 'faible' ? 0.45 : 1;
      this.traffic.opts.vehicles = Math.round(tc.vehicles * k);
      this.traffic.opts.pedestrians = Math.round(tc.pedestrians * (this.lesson.traffic === 'aucun' ? 0.25 : k));
    }
    this.voice.enabled = s.voice; this.voice.volume = s.volume;
    if (this.audioReady) this.audio.setMasterVolume(s.volume);
    this.hud.showMinimap = s.minimap;
    (document.getElementById('minimap') as HTMLElement).style.display = s.minimap ? '' : 'none';
    (document.getElementById('dash') as HTMLElement).style.display = s.hud ? '' : 'none';
  }

  // ───────────────────────── déroulement d'une séance ─────────────────────────
  start(lesson: Lesson) {
    void this.initAudio();
    this.lesson = lesson;
    const seed = hash32(lesson.id + Math.floor(Date.now() / 60000));
    this.session = { time: 0, distance: 0, points: 12, amende: 0, faults: [], offRoute: 0, praised: 0, stalls: 0, seed };
    this.rules.reset();
    this.rules.enabled = true;
    this.hud.clearFaults();
    this.hud.setScore(12, 0, 0);
    this.applySettings();

    // point de départ
    // on ne retient que des parcours dont chaque virage est praticable sans toucher une bordure ni un mur
    const clean = (r: Route) => { const ap = new Autopilot(this.net, null, r); ap.fitToRoad((x, z) => this.ground.isRoad(x, z)); return ap.pathIssues((x, z) => this.ground.isRoad(x, z), (x, z, fx, fz) => this.ground.bodyHits(x, z, fx, fz)); };
    const guided = lesson.steps.some((st) => st.text === 'Suivez les indications du moniteur jusqu’à l’arrivée');
    let pose: StartPose | null = null;
    if (lesson.theme === 'bases' || lesson.theme === 'allure') pose = quietStreet(this.net, 1080, -480);
    else {
      const names = START_STREETS[lesson.theme];
      // leçon guidée : la rue de départ est celle dont le parcours se prend le plus proprement
      if (lesson.theme !== 'examen' && guided) pose = planLesson(this.net, lesson.theme, seed, clean)?.pose ?? null;
      for (let i = 0; i < names.length && !pose; i++) pose = startOnStreet(this.net, names[(seed + i) % names.length], 0.25);
    }
    pose ??= quietStreet(this.net, 1080, -480) ?? poseOn(this.net.edges[0], 1, this.net.edges[0].length / 2);
    pose = this.freeSpot(pose);
    this.startPose = pose;
    const P = this.player;
    P.car.mode = this.settings.transmission;
    P.spawn(pose.x, pose.z, pose.heading, { running: lesson.ready, belt: lesson.ready });
    if (lesson.ready) P.handbrake = true;

    // itinéraire
    this.route = null; this.follower = null; this.demo = null; this.handover = 0; this.hud.setDemo(false);
    if (lesson.theme === 'examen') this.route = planExam(this.net, { edge: pose.edge, dir: pose.dir }, pose.s, seed, clean);
    else if (guided) this.route = planRoute(this.net, { edge: pose.edge, dir: pose.dir }, pose.s, lesson.theme, seed, undefined, clean);
    if (this.route) this.follower = new RouteFollower(this.route);
    this.step = 0;
    this.ctx = { player: P, sit: this.rules.situation, input: this.controls.state, t: 0, dist: 0, mem: {}, auto: P.car.mode === 'auto', routeDone: false };

    this.city.ensureAround(pose.x, pose.z, 160);
    this.traffic.vehicles.forEach((v) => { v.alive = false; });
    this.traffic.pedestrians.forEach((p) => { p.alive = false; });
    this.menus.close();
    this.hud.show(true);
    this.state = 'drive';
    this.view.mode = 'cockpit';
    this.introTimer = 1.2;
    this.lastInstruction = lesson.intro;
    this.updateSteps();
  }

  /** Décale le départ le long de la rue jusqu'à trouver une place dégagée (rien 11 m devant, 6 m derrière). */
  private freeSpot(pose: StartPose): StartPose {
    const e = pose.edge;
    const lo = e.endA.trim + 9, hi = e.length - e.endB.trim - 9;
    const offCrossing = (s: number) => !e.crossings.some((c) => Math.abs(c.s - s) < c.halfLen + 8);
    const clear = (p: StartPose) => {
      const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
      for (const b of this.parked.near(p.x, p.z, 14)) {
        const ahead = (b.x - p.x) * fx + (b.z - p.z) * fz;
        const lat = Math.abs((b.x - p.x) * -fz + (b.z - p.z) * fx);
        if (lat < 1.9 && ahead > -6.5 - b.halfLen && ahead < 11 + b.halfLen) return false;
      }
      return offCrossing(p.s);
    };
    const candidates: number[] = [pose.s];
    for (let k = 1; k <= 40; k++) candidates.push(pose.s + k * 2.5, pose.s - k * 2.5);
    // 1) le long du trottoir, entre deux voitures garées
    for (const s of candidates) {
      if (s < lo || s > hi) continue;
      const p = poseOn(e, pose.dir, s);
      if (clear(p)) return p;
    }
    // 2) à défaut, sur la voie de circulation, loin des passages piétons
    const lanes = pose.dir > 0 ? e.lanesF : e.lanesB;
    const lane = lanes[lanes.length - 1];
    for (const s of candidates) {
      if (s < lo || s > hi || !offCrossing(s)) continue;
      if (lane) { const q = e.line.atOffset(s, lane.off); return { ...pose, x: q.x, z: q.z, s }; }
    }
    return pose;
  }

  restart() { this.start(this.lesson); }

  resume() {
    this.menus.close();
    this.state = 'drive';
    this.lastTime = performance.now();
  }

  pause() {
    if (this.state !== 'drive') return;
    this.state = 'pause';
    this.ffb.stop();
    this.voice.stop();
    this.menus.pause(this.lesson);
  }

  /** Termine la séance et affiche le bilan. */
  quit(completed = false) {
    this.ffb.stop();
    this.voice.stop();
    const s = this.session;
    const graves = s.faults.filter((f) => f.inf.severity === 'grave').length;
    const fautes = s.faults.filter((f) => f.inf.severity === 'faute').length;
    const conseils = s.faults.filter((f) => f.inf.severity === 'conseil').length;
    const stars = graves ? 0 : fautes === 0 && conseils <= 2 ? 3 : fautes <= 2 ? 2 : 1;
    const bilan: Bilan = {
      lesson: this.lesson, faults: s.faults, duration: s.time, distance: s.distance, points: s.points, amende: s.amende,
      stars, success: completed && graves === 0,
    };
    const finish = () => {
      if (bilan.success && this.lesson.num > 0 && this.lesson.id !== 'examen') {
        this.settings.progress[this.lesson.id] = Math.max(this.settings.progress[this.lesson.id] ?? 0, stars);
        saveSettings(this.settings);
      }
      this.state = 'bilan';
      this.hud.show(false);
      this.menus.bilan(bilan, () => { this.state = 'menu'; this.menuCenter = { x: this.player.car.x, z: this.player.car.z }; this.menus.main(); });
    };
    if (this.lesson.id === 'examen' && completed) {
      this.state = 'bilan';
      this.hud.show(false);
      this.menus.quiz(drawQuiz(s.seed), (score) => { bilan.exam = this.examResult(score); bilan.success = !bilan.exam.eliminated && bilan.exam.total >= 20; finish(); });
    } else {
      if (this.lesson.id === 'examen') bilan.exam = this.examResult(0);
      finish();
    }
  }

  /** Notation selon la grille officielle (31 points). */
  private examResult(quiz: number): NonNullable<Bilan['exam']> {
    const s = this.session;
    const by = (c: Competence) => s.faults.filter((f) => f.inf.competence === c);
    let eliminated = false;
    const rows: NonNullable<Bilan['exam']>['rows'] = [];
    let total = 0;
    for (const g of GRILLE) {
      for (const it of g.items) {
        let score: number | 'E' = it.max;
        if (it.id === 'verifications') score = quiz;
        else if (it.id === 'analyse') score = Math.max(0, 1 - 0.5 * by('information').length);
        else if (it.id === 'adaptation') score = Math.max(0, 1 - 0.5 * by('allure').length);
        else if (it.id === 'autonomie') score = Math.max(0, 1 - 0.5 * s.offRoute);
        else if (it.id === 'courtoisie') score = by('courtoisie').length || s.faults.some((f) => f.inf.id === 'pieton') ? 0 : 1;
        else if (it.id === 'economie') score = by('economie').length > 1 || s.stalls > 2 ? 0 : 1;
        else {
          const fs = by(it.id as Competence);
          if (fs.some((f) => f.inf.severity === 'grave')) { score = 'E'; eliminated = true; }
          else score = Math.max(0, Math.round(it.max - fs.reduce((a, f) => a + (f.inf.severity === 'faute' ? 1 : 0.5), 0)));
        }
        if (typeof score === 'number') total += score;
        rows.push({ bloc: g.bloc, label: it.label, score, max: it.max });
      }
    }
    return { rows, total: Math.round(total * 2) / 2, eliminated };
  }

  /**
   * Compile les programmes de rendu pendant le chargement — vue principale, habitacle, rétroviseurs. Sans
   * cela, ils se compilent à la première image où chaque matériau apparaît : mesuré sur une vraie carte
   * graphique, le tout premier lancement d'une leçon se figeait plusieurs secondes.
   */
  private async warmUp() {
    try {
      const done = this.renderer.compileAsync(this.scene, this.view.camera).then(() => this.view.warmUpMirrors());
      // jamais plus de vingt secondes : au pire, les programmes restants se compileront à l'affichage
      await Promise.race([done, new Promise((r) => setTimeout(r, 20000))]);
    } catch { /* sans gravité */ }
  }

  // ───────────────────────── mesure de fluidité ─────────────────────────
  /** Le moniteur conduit 20 s sur un boulevard pendant que l'on relève la cadence d'images réelle. */
  benchmark() {
    const lesson = LESSONS.find((l) => l.id === 'circulation') ?? FREE;
    this.start(lesson);
    this.perfLevel = 0; this.applySettings();
    // quelques pas de simulation pour que la voiture soit située sur sa rue : sans cela la démonstration
    // refuse de démarrer et la mesure porterait sur une voiture à l'arrêt
    this.debugStep(0.1);
    this.toggleDemo();
    this.bench = [];
    this.hud.coach('Mesure de la fluidité en cours…', 'Environ 20 secondes', false, 20);
  }

  private finishBenchmark() {
    const samples = (this.bench ?? []).slice(3); // les premières secondes servent au chargement
    this.bench = null;
    this.demo = null; this.hud.setDemo(false);
    this.ffb.stop(); this.voice.stop();
    const avg = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length), min = Math.min(...samples);
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'inconnue';
    const info = this.renderer.info.render;
    const verdict = min >= 55 ? 'Très fluide : vous pouvez essayer la qualité « Haute ».'
      : avg >= 40 ? 'Fluide : ce réglage convient.'
      : avg >= 25 ? 'Juste : passez en qualité « Basse » ou laissez la fluidité automatique alléger l’affichage.'
      : 'Insuffisant : choisissez la qualité « Basse » et coupez les rétroviseurs ; vérifiez que le navigateur utilise bien la carte graphique.';
    this.state = 'menu'; this.hud.show(false);
    this.menuCenter = { x: this.player.car.x, z: this.player.car.z };
    this.menus.report('Mesure de la fluidité', [
      `Cadence moyenne : ${avg.toFixed(avg < 10 ? 1 : 0)} images par seconde (minimum ${min.toFixed(min < 10 ? 1 : 0)}) sur ${samples.length} relevés en conduite.`,
      `Carte graphique : ${gpu}`,
      `Qualité « ${this.settings.quality} », ${this.renderer.domElement.width} × ${this.renderer.domElement.height} points, rétroviseurs ${this.settings.mirrors ? 'actifs' : 'coupés'} ; ${info.calls} appels de dessin, ${Math.round(info.triangles / 1000)} milliers de triangles.`,
      verdict,
    ], () => this.menus.settings('jeu'));
  }

  // ───────────────────────── démonstration du moniteur ─────────────────────────
  /** Le moniteur prend (ou rend) le volant : il conduit en respectant le Code, sur l'itinéraire en cours. */
  toggleDemo() {
    if (this.state !== 'drive') return;
    if (this.demo) { this.endDemo('Je vous rends le volant. À vous !'); return; }
    if (this.lesson.id === 'examen') { this.hud.coach('Pas de démonstration pendant l’examen.', '', false, 3); return; }
    const P = this.player, c = P.car, sit = this.rules.situation;
    if (!sit.edge || sit.junction || sit.wrongWay) { this.hud.coach('Replacez-vous sur une voie, hors carrefour, pour lancer la démonstration.', '', false, 4); return; }
    // itinéraire : la suite de celui de la leçon, sinon une boucle à partir d'ici
    let route: Route | null = null;
    if (this.route && this.follower && !this.follower.done && this.route.steps[this.follower.step]?.edge === sit.edge && this.route.steps[this.follower.step].dir === sit.dir) {
      route = { ...this.route, steps: this.route.steps.slice(this.follower.step) };
    } else {
      const sEdge = sit.dir > 0 ? sit.sFront : sit.edge.length - sit.sFront;
      route = planRoute(this.net, { edge: sit.edge, dir: sit.dir }, sEdge, 'circulation', Math.floor(this.session.time * 7) + 1);
    }
    if (!route) { this.hud.coach('Impossible de préparer une démonstration ici.', '', false, 3); return; }
    const ap = new Autopilot(this.net, this.traffic, route);
    ap.fitToRoad((x, z) => this.ground.isRoad(x, z), c.spec.wheelbase, c.spec.trackRear / 2);
    if (!ap.segs.length) { this.hud.coach('Impossible de préparer une démonstration ici.', '', false, 3); return; }
    // le moniteur s'installe : ceinture, moteur, boîte automatique
    if (!c.engineRunning) { c.mode = 'auto'; c.selector = 'P'; c.startEngine({ steer: 0, throttle: 0, brake: 1, clutch: 1, handbrake: 1 }); c.engineRunning = true; }
    c.mode = 'auto'; c.selector = 'D';
    P.seatbelt = true; P.handbrake = false; P.hazards = false;
    this.demo = ap; this.demoSteer = this.controls.state.steer; this.demoIndOff = 0;
    this.hud.setDemo(true);
    this.say('Regardez bien : je prends le volant et je vous montre.', null, 'Démonstration — touche O ou coup de frein pour reprendre la main');
  }

  private endDemo(text: string) {
    if (!this.demo) return;
    this.demo = null;
    this.handover = 0.8;
    this.hud.setDemo(false);
    const c = this.player.car;
    // on rend la voiture dans la configuration choisie par l'élève
    c.mode = this.settings.transmission;
    if (c.mode !== 'auto') { const g = clamp(c.gear, 0, 6); c.gear = g; c.lever = g; }
    this.player.setIndicator(0);
    this.say(text);
  }

  /** Remplace les commandes de l'élève par celles du moniteur pendant la démonstration. */
  private demoInput(dt: number, input: InputState): InputState {
    const ap = this.demo;
    if (!ap) {
      // le moniteur vient de rendre la main : la direction rejoint en douceur la position réelle du volant
      if (this.handover > 0) {
        this.handover = Math.max(0, this.handover - dt);
        const k = this.handover / 0.8;
        return { ...input, steer: input.steer + (this.demoSteer - input.steer) * k * k };
      }
      return input;
    }
    const P = this.player;
    // l'élève reprend la main d'un coup de frein
    if (input.brake > 0.35) { this.endDemo('Vous reprenez la main.'); return input; }
    const cmd = ap.update(dt, P.car);
    this.demoSteer += clamp(cmd.steer - this.demoSteer, -2.2 * dt, 2.2 * dt);
    if (cmd.indicator !== 0 && cmd.indicator !== P.indicator) P.setIndicator(cmd.indicator);
    this.demoIndOff = cmd.indicator === 0 && P.indicator !== 0 ? this.demoIndOff + dt : 0;
    if (this.demoIndOff > 2.5) P.setIndicator(0);
    if (cmd.done) {
      P.handbrake = true;
      this.endDemo('Démonstration terminée. À vous de jouer !');
      return { ...input, throttle: 0, brake: 0.6, pressed: new Set(), held: new Set() };
    }
    // marche arrière (pour dégager un carrefour) ou retour en marche avant : à l'arrêt seulement
    const c = P.car, want = cmd.reverse ? 'R' : 'D';
    let throttle = cmd.throttle, brake = cmd.brake;
    if (c.selector !== want) { if (Math.abs(c.vx) < 0.25) c.selector = want; else { throttle = 0; brake = 0.6; } }
    return { ...input, steer: this.demoSteer, throttle, brake, clutch: 0, pressed: new Set(), held: new Set(), hGear: null, steerRate: 0 };
  }

  private say(text: string, key: string | null = null, sub = '') {
    this.lastInstruction = text; this.lastInstructionKey = key;
    this.hud.coach(text, sub, false, 7);
    this.voice.say(text, key);
  }

  private updateSteps() {
    const L = this.lesson;
    if (!L.steps.length) { this.hud.setSteps('', null); return; }
    const auto = this.player.car.mode === 'auto';
    const piloted = this.player.car.mode === 'autoclutch';
    const views: StepView[] = L.steps.map((st, i) => ({
      text: this.adapt(typeof st.text === 'function' ? st.text(auto) : st.text, piloted),
      hint: this.adapt((typeof st.hint === 'function' ? st.hint(auto) : st.hint) ?? '', piloted, true),
      state: i < this.step ? 'done' : i === this.step ? 'cur' : 'todo',
    }));
    this.hud.setSteps(L.num && L.id !== 'examen' ? `Leçon ${L.num} · ${L.title}` : L.title, views);
  }

  /** Adapte une consigne à la boîte à embrayage piloté (pas de pédale de gauche). */
  private adapt(text: string, piloted: boolean, hint = false): string {
    if (!piloted) return text;
    if (hint) return /embrayage|[Dd]ébray|pédale de gauche/i.test(text) ? '' : text;
    return text
      .replace('Débrayez à fond et démarrez le moteur', 'Démarrez le moteur')
      .replace('Relevez doucement l’embrayage jusqu’au point de patinage, puis accélérez légèrement', 'Accélérez doucement : l’embrayage est géré automatiquement')
      .replace(', débrayez', '');
  }

  private replaceCar() {
    const c = this.player.car;
    const loc = this.net.locate(c.x, c.z);
    if (!loc) return;
    const e = loc.edge;
    const fx = c.forwardX, fz = c.forwardZ;
    let dir: 1 | -1 = fx * loc.tx + fz * loc.tz >= 0 ? 1 : -1;
    if (dir > 0 && !e.lanesF.length) dir = -1;
    if (dir < 0 && !e.lanesB.length) dir = 1;
    const lanes = dir > 0 ? e.lanesF : e.lanesB;
    const lane = lanes[lanes.length - 1];
    const s = clamp(loc.s, e.endA.trim + 4, Math.max(e.endA.trim + 4, e.length - e.endB.trim - 4));
    const p = e.line.atOffset(s, lane ? lane.off : 0);
    const running = c.engineRunning;
    const gear = c.gear, lever = c.lever, sel = c.selector;
    c.reset(p.x, p.z, Math.atan2(p.tx * dir, -p.tz * dir));
    c.gear = gear; c.lever = lever; c.selector = sel;
    if (!running) c.stopEngine();
    this.hud.coach('Voiture replacée sur la chaussée.', '', false, 3);
  }

  // ───────────────────────── boucle principale ─────────────────────────
  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = clamp((now - this.lastTime) / 1000, 0.001, 0.05);
    this.governor((now - this.lastTime) / 1000);
    this.lastTime = now;
    this.time += dt;
    this.controls.speedHint = this.player.car.vx;
    this.controls.enabled = this.state === 'drive';
    const input = this.controls.update(dt);
    let fx: number, fz: number;

    if (this.state === 'drive') {
      this.driveFrame(dt, input);
      fx = this.player.car.x; fz = this.player.car.z;
    } else {
      // menu : la caméra tourne lentement au-dessus du quartier
      if (input.pressed.has('pause') && this.state === 'pause') this.resume();
      this.menuAngle += dt * 0.05;
      const c = this.menuCenter;
      if (this.state !== 'pause') {
        this.traffic.update(dt, { x: c.x, z: c.z, heading: 0, speed: 0, length: 4, width: 1.8, approach: null, approachDist: Infinity, inJunction: null, left: false, right: false });
        const cam = this.view.camera;
        cam.layers.disable(1); cam.layers.enable(2);
        cam.position.set(c.x + Math.sin(this.menuAngle) * 55, 26, c.z + Math.cos(this.menuAngle) * 55);
        cam.lookAt(c.x, 3, c.z);
        cam.updateMatrixWorld();
      }
      fx = c.x; fz = c.z;
    }
    this.trafficView.update(this.state === 'pause' ? 0 : dt);
    this.props.update(this.traffic.time);
    this.city.update(fx, fz, this.viewRadius, 4);
    this.props.voirArbres(fx, fz, this.viewRadius);
    this.sky.update(fx, fz);
    if (this.state === 'drive') this.view.renderMirrors();
    this.renderer.render(this.scene, this.view.camera);

    // images par seconde
    this.fpsAcc += dt; this.fpsN++; this.fpsTimer += dt;
    if (this.fpsTimer > 1) { this.hud.setFps(`${Math.round(this.fpsN / this.fpsAcc)} i/s`); this.fpsAcc = 0; this.fpsN = 0; this.fpsTimer = 0; }
  }

  /** Avance la simulation sans rendu (essais automatisés et mise au point). */
  debugStep(seconds: number, dt = 1 / 60) {
    for (let t = 0; t < seconds && this.state === 'drive'; t += dt) {
      this.time += dt;
      this.controls.speedHint = this.player.car.vx;
      this.driveFrame(dt, this.controls.update(dt));
    }
  }

  private driveFrame(dt: number, input: InputState) {
    const P = this.player, c = P.car, s = this.session;
    if (input.pressed.has('pause')) { this.pause(); return; }
    if (input.pressed.has('camera')) this.hud.coach(VIEW_LABELS[this.view.cycle()], '', false, 1.5);
    if (input.pressed.has('reset')) this.replaceCar();
    if (input.pressed.has('repeat')) { this.hud.coach(this.lastInstruction, '', false, 6); this.voice.say(this.lastInstruction, this.lastInstructionKey, true); }
    if (input.pressed.has('demo')) this.toggleDemo();
    input = this.demoInput(dt, input);

    P.update(dt, input);
    s.time += dt;
    s.distance += Math.abs(c.vx) * dt;

    const ps: PlayerState = {
      car: c, indicator: P.indicator, hazards: P.hazards, seatbelt: P.seatbelt, lights: P.lights, handbrake: P.handbrake, horn: P.horn,
      lookLeftAt: P.lookLeftAt - (P.time - this.rules.time), lookRightAt: P.lookRightAt - (P.time - this.rules.time), lookBackAt: P.lookBackAt - (P.time - this.rules.time), night: false,
    };
    const sit = this.rules.update(dt, ps);
    this.traffic.update(dt, this.rules.playerInfo(ps));

    // introduction
    if (this.introTimer > 0) {
      this.introTimer -= dt;
      if (this.introTimer <= 0) this.say(this.lesson.intro, 'intro_' + this.lesson.id);
    }

    this.lessonFrame(dt, sit, input);

    // retour de force
    const frontLoad = (c.fz[0] + c.fz[1]) / (c.spec.mass * 9.81 * 0.605);
    const ffbForce = this.ffbModel.compute(dt, {
      steerTorque: c.steerTorque, steer: input.steer, steerRate: input.steerRate, speed: c.speed, abs: c.absActive,
      engineOn: c.engineRunning, rpm: c.rpm, damping: this.ffb.settings.damping, frontLoad,
    });
    // pendant la démonstration, le volant de l'élève reste libre
    this.ffb.setForce(this.demo ? 0 : ffbForce);

    // son
    if (this.audioReady) {
      let slip = 0;
      for (let i = 0; i < 4; i++) slip = Math.max(slip, c.slip[i]);
      this.audio.update({
        engineOn: c.engineRunning, starter: c.cranking, rpm: c.rpm, load: c.throttleEff, speed: c.speed,
        slip: c.speed > 2 ? slip : 0, brake: c.brakePressure, abs: c.absActive, surface: sit.edge?.sett ? 'sett' : 'asphalt',
        indicator: P.hazards || P.indicator !== 0, clutchSlip: Math.abs(c.clutchSlip),
      }, dt);
      const fx = c.forwardX, fz = c.forwardZ;
      for (const { v, d } of this.trafficView.nearest(c.x, c.z, 4)) {
        if (d > 60) continue;
        const pan = clamp(((v.x - c.x) * -fz + (v.z - c.z) * fx) / Math.max(4, d), -1, 1);
        this.audio.setNearbyVehicle(v.id, d, pan, v.v, v.kind === 'bus' ? 'bus' : 'car');
      }
    }

    this.view.avoid = this.view.mode === 'poursuite' ? this.traffic.vehicles : null;
    this.view.update(dt, P, input, sit.limit);

    // affichage
    this.hudTimer -= dt;
    const gear = c.mode === 'auto' ? c.selector : c.gear === 0 ? 'N' : c.gear < 0 ? 'R' : String(c.gear);
    this.hud.setDash({
      speed: Math.abs(c.vx) * 3.6, limit: sit.limit, gear, rpm: c.rpm, left: P.leftOn, right: P.rightOn,
      belt: P.seatbelt, handbrake: P.handbrake, engine: c.engineRunning ? 'on' : c.ignition ? 'stalled' : 'off', lights: P.lights,
      throttle: input.throttle, brake: input.brake, clutch: c.mode === 'manual' ? input.clutch : c.clutchPedal,
    });
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.12;
      const zone = sit.edge ? (sit.edge.living ? 'zone de rencontre' : sit.limit === 30 ? 'zone 30' : '') : 'hors chaussée';
      this.hud.setStreet(sit.street, zone);
      this.hud.setNav(this.follower && !this.follower.done ? this.follower.next() : null);
      const next = this.follower && !this.follower.done ? this.follower.next() : null;
      const cockpit = this.view.mode === 'cockpit';
      this.hud.setCockpit(cockpit);
      if (cockpit) {
        this.hud.drawScreen(this.view.screenCanvas, this.net, c.x, c.z, c.heading, this.route, this.follower?.step ?? 0, next, sit.street, sit.limit);
        this.view.refreshScreen();
      } else if (this.settings.minimap) this.hud.drawMinimap(this.net, c.x, c.z, c.heading, this.route, this.follower?.step ?? 0);
    }
  }

  private lessonFrame(dt: number, sit: Situation, input: InputState) {
    const L = this.lesson, ctx = this.ctx!;
    const c = this.player.car;
    // guidage
    if (this.follower) {
      const f = this.follower;
      const msg = f.update(dt, sit.edge, sit.dir, sit.sFront, Math.abs(c.vx));
      if (msg) this.say(msg.text, msg.key);
      this.recalcCooldown -= dt;
      if (f.offRoute > 5 && sit.edge && this.recalcCooldown <= 0 && Math.abs(c.vx) > 1) {
        const last = this.route!.steps[this.route!.steps.length - 1];
        const r = findRoute(this.net, { edge: sit.edge, dir: sit.dir }, sit.loc!.s, last.edge, last.edge.length * 0.5);
        this.recalcCooldown = 8;
        if (r) {
          this.route = r; this.follower = new RouteFollower(r);
          this.session.offRoute++;
          this.say(L.id === 'examen' ? 'Ce n’est pas grave, je vous indique un autre chemin.' : 'Ce n’est pas la bonne rue, mais ce n’est pas grave : je recalcule.', 'recalcul');
        }
      }
      ctx.routeDone = f.done || (f.step === this.route!.steps.length - 1 && sit.sFront >= this.route!.endS - 15);
    }
    if (!L.steps.length) return;
    ctx.t += dt; ctx.dist += Math.abs(c.vx) * dt;
    ctx.sit = sit; ctx.input = input; ctx.auto = c.mode === 'auto';
    const st = L.steps[this.step];
    if (st && st.done(ctx)) {
      this.step++;
      ctx.t = 0; ctx.dist = 0; ctx.mem = {};
      this.updateSteps();
      if (this.step >= L.steps.length) {
        this.hud.coach(L.id === 'examen' ? 'L’épreuve de conduite est terminée.' : 'Leçon terminée, bravo !', '', true, 4);
        this.voice.say(L.id === 'examen' ? 'L’épreuve de conduite est terminée. Passons aux questions.' : 'Très bien, la leçon est terminée.', L.id === 'examen' ? 'fin_examen' : 'fin_lecon');
        setTimeout(() => { if (this.state === 'drive') this.quit(true); }, 2600);
      } else {
        const next = L.steps[this.step];
        const piloted = c.mode === 'autoclutch';
        const text = this.adapt(typeof next.text === 'function' ? next.text(ctx.auto) : next.text, piloted);
        // l'enregistrement vocal correspond à la boîte manuelle : sinon, synthèse vocale
        if (L.theme === 'bases' || L.theme === 'allure') this.say(text + '.', c.mode === 'manual' ? `step_${L.id}_${this.step}` : null);
      }
    }
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// rend les leçons accessibles aux outils de test
export { LESSONS, EXAM, FREE };
