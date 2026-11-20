// Écrans du jeu : accueil, leçons, réglages (volant, retour de force, affichage, son), aide,
// pause, bilan de séance et résultat d'examen.

import { h } from './dom';
import { LESSONS, EXAM, FREE, type Lesson } from '../game/lessons';
import { TRANSMISSION_LABELS, saveSettings, type Settings } from '../game/settings';
import { ACTION_LABELS, AxisCapture, type Action, type Controls } from '../input/controls';
import type { ForceFeedback } from '../input/ffb';
import type { FaultEvent } from '../rules/engine';
import { GRILLE, sanctionText } from '../rules/infractions';
import type { TransmissionMode } from '../vehicle/car';
import type { Question } from '../game/quiz';

export interface MenuHost {
  settings: Settings;
  controls: Controls;
  ffb: ForceFeedback;
  start(lesson: Lesson): void;
  resume(): void;
  quit(): void;
  restart(): void;
  applySettings(): void;
  audioTest?(): void;
  /** le moniteur prend le volant pour montrer */
  toggleDemo?(): void;
}

export interface Bilan {
  lesson: Lesson;
  faults: FaultEvent[];
  duration: number;
  distance: number;
  points: number;
  amende: number;
  stars: number;
  success: boolean;
  exam?: { rows: { bloc: string; label: string; score: number | 'E'; max: number }[]; total: number; eliminated: boolean };
}

const ui = () => document.getElementById('ui')!;

export class Menus {
  private raf = 0;
  constructor(private host: MenuHost) {}

  get open(): boolean { return ui().classList.contains('show'); }
  close() { cancelAnimationFrame(this.raf); ui().classList.remove('show'); ui().innerHTML = ''; }
  private mount(el: HTMLElement) {
    cancelAnimationFrame(this.raf);
    const root = ui();
    root.innerHTML = '';
    root.append(el);
    root.classList.add('show');
    (el.querySelector('button, [tabindex]') as HTMLElement | null)?.focus();
  }

  // ───────────────────────── accueil ─────────────────────────
  main() {
    const s = this.host.settings;
    const dev = this.host.controls.state;
    const wheel = dev.device === 'wheel';
    const card = (title: string, text: string, tag: string, fn: () => void, big = true) =>
      h('button', { class: 'card' + (big ? ' big' : ''), onclick: fn }, h('h3', null, title, tag ? h('span', { class: 'tag' }, tag) : null), h('p', null, text));
    const done = Object.keys(s.progress).filter((k) => s.progress[k] > 0).length;
    this.mount(h('div', { class: 'menu panel' },
      h('h1', null, 'Conduite'),
      h('p', { class: 'sub' }, 'Auto-école virtuelle dans les vraies rues de Montreuil et du 20ᵉ arrondissement de Paris — Code de la route à jour, moniteur à vos côtés.'),
      h('div', { class: 'row', style: 'margin-bottom:16px' },
        h('span', { class: 'pill ' + (wheel ? 'ok' : 'warn') }, wheel ? `🎮 ${dev.deviceName}` : dev.device === 'pad' ? `🎮 Manette : ${dev.deviceName}` : '⌨ Aucun volant détecté — clavier (appuyez sur un bouton du volant pour l’activer)'),
        h('span', { class: 'pill' }, `Boîte : ${TRANSMISSION_LABELS[s.transmission]}`),
      ),
      h('div', { class: 'grid' },
        card('Leçons', `Neuf leçons progressives, de la première mise en route à l’itinéraire en autonomie. ${done ? `${done}/9 réussies.` : ''}`, 'Apprendre', () => this.lessons()),
        card('Conduite libre', FREE.summary, 'S’entraîner', () => this.host.start(FREE)),
        card('Examen blanc', EXAM.summary, 'Permis B', () => this.host.start(EXAM)),
        card('Volant et commandes', 'Calibrer le Logitech G923, activer le retour de force, choisir la boîte de vitesses.', '', () => this.settings('volant')),
        card('Réglages', 'Affichage, circulation, son, voix du moniteur.', '', () => this.settings('jeu')),
        card('Commandes et aide', 'Toutes les touches du clavier et les boutons du volant.', '', () => this.help()),
      ),
      h('p', { class: 'credits' },
        'Données cartographiques © les contributeurs d’OpenStreetMap (ODbL). Ciel et textures : Poly Haven (CC0). ',
        'Barème des infractions : Code de la route en vigueur en novembre 2026 (voir la documentation du projet). ',
        'Ce simulateur est un outil d’entraînement : il ne remplace pas les leçons avec un enseignant diplômé.'),
    ));
  }

  lessons() {
    const s = this.host.settings;
    const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
    this.mount(h('div', { class: 'menu panel' },
      h('h2', null, 'Leçons'),
      h('p', { class: 'sub' }, 'La progression suit les quatre compétences du programme de formation à la conduite (REMC).'),
      h('div', { class: 'grid' }, LESSONS.map((l) => h('button', { class: 'card', onclick: () => this.host.start(l) },
        h('h3', null, `${l.num}. ${l.title}`),
        h('p', null, l.summary),
        h('div', { class: 'best' }, s.progress[l.id] ? stars(s.progress[l.id]) : l.competence),
      ))),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn', onclick: () => this.main() }, '← Retour')),
    ));
  }

  // ───────────────────────── réglages ─────────────────────────
  settings(tab: 'volant' | 'jeu' = 'volant', back: () => void = () => this.main()) {
    const s = this.host.settings;
    const c = this.host.controls, ffb = this.host.ffb;
    const apply = () => { saveSettings(s); this.host.applySettings(); };
    const select = <T extends string>(value: T, options: [T, string][], on: (v: T) => void) => {
      const el = h('select', { onchange: (e: Event) => { on((e.target as HTMLSelectElement).value as T); apply(); } },
        options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
      return el;
    };
    const range = (value: number, min: number, max: number, step: number, on: (v: number) => void, fmt: (v: number) => string) => {
      const out = h('span', { style: 'min-width:54px;text-align:right;font:12px ui-monospace,monospace;color:#9aa5b4' }, fmt(value));
      return h('span', { class: 'row' }, h('input', { type: 'range', min, max, step, value, oninput: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value); on(v); out.textContent = fmt(v); apply(); } }), out);
    };
    const check = (value: boolean, on: (v: boolean) => void) => h('input', { type: 'checkbox', checked: value, onchange: (e: Event) => { on((e.target as HTMLInputElement).checked); apply(); } });
    const field = (label: string, note: string, control: HTMLElement) => h('div', { class: 'field' }, h('div', null, label, note ? h('small', null, note) : null), control);

    const wheelName = c.state.device === 'wheel' ? c.state.deviceName : null;
    const ffbStatus = h('span', { class: 'pill ' + (ffb.connected ? 'ok' : 'warn') }, ffb.connected ? `Retour de force actif — ${ffb.deviceName}` : ffb.available ? 'Retour de force non connecté' : 'WebHID indisponible (utilisez Chrome ou Edge)');
    const volant = h('div', null,
      h('div', { class: 'row', style: 'margin-bottom:10px' },
        h('span', { class: 'pill ' + (wheelName ? 'ok' : 'warn') }, wheelName ? `Volant détecté : ${wheelName}` : 'Aucun volant détecté : branchez-le et appuyez sur un de ses boutons'),
        ffbStatus),
      field('Calibration du volant et des pédales', 'Indispensable au premier branchement : le jeu repère quel axe correspond au volant et à chaque pédale.',
        h('button', { class: 'btn primary', onclick: () => this.calibrate(() => this.settings('volant', back)) }, 'Calibrer…')),
      field('Angle de rotation du volant', 'Doit correspondre au réglage du pilote Logitech (G HUB) : 900° pour un comportement réaliste.',
        range(s.wheelRange, 270, 1080, 30, (v) => { s.wheelRange = v; }, (v) => `${v}°`)),
      field('Boîte de vitesses', 'La boîte manuelle utilise la pédale d’embrayage du G923 ; sans embrayage, choisissez « embrayage piloté ».',
        select<TransmissionMode>(s.transmission, Object.entries(TRANSMISSION_LABELS) as [TransmissionMode, string][], (v) => { s.transmission = v; s.transmissionAuto = false; })),
      field('Levier de vitesses en H (Driving Force Shifter)', 'Décochez pour changer de rapport avec les palettes au volant.', check(s.hShifter, (v) => { s.hShifter = v; })),
      field('Sensibilité de la pédale de frein', 'La pédale du G923 est très ferme : augmentez si le freinage vous semble trop dur à doser.',
        range(s.brakeGamma, 0.5, 1.5, 0.05, (v) => { s.brakeGamma = v; }, (v) => (v < 0.95 ? 'forte' : v > 1.05 ? 'douce' : 'normale'))),
      field('Retour de force', 'Connexion directe au volant par WebHID. Expérimental : n’a pas pu être essayé sur un volant réel — commencez avec une force modérée.',
        h('span', { class: 'row' },
          h('button', { class: 'btn', onclick: async () => { await ffb.connect(); this.settings('volant', back); } }, ffb.connected ? 'Reconnecter' : 'Connecter le volant…'),
          h('button', { class: 'btn', disabled: !ffb.connected, onclick: () => ffb.test() }, 'Tester'))),
      ffb.lastError ? h('p', { class: 'note', style: 'color:#ffb0b0' }, ffb.lastError) : null,
      field('Force', 'Le test doit pousser le volant vers la droite ; sinon cochez « Inverser ».',
        range(ffb.settings.gain, 0, 1, 0.05, (v) => { ffb.settings.gain = v; ffb.saveSettings(); }, (v) => `${Math.round(v * 100)} %`)),
      field('Inverser le sens du retour de force', '', check(ffb.settings.invert, (v) => { ffb.settings.invert = v; ffb.saveSettings(); })),
      field('Amortissement', 'Stabilise le volant en ligne droite.', range(ffb.settings.damping, 0, 1, 0.05, (v) => { ffb.settings.damping = v; ffb.saveSettings(); }, (v) => `${Math.round(v * 100)} %`)),
      h('p', { class: 'note', style: 'margin-top:12px' }, 'Sans retour de force actif, le volant reste parfaitement utilisable : activez simplement le ressort de centrage dans G HUB (« centrage pour les jeux sans retour de force »).'),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn', onclick: () => this.bindings(() => this.settings('volant', back)) }, 'Attribuer les boutons du volant…')),
    );
    const jeu = h('div', null,
      field('Qualité d’affichage', 'Ombres, résolution, distance d’affichage.', select(s.quality, [['basse', 'Basse'], ['moyenne', 'Moyenne'], ['haute', 'Haute']], (v) => { s.quality = v; })),
      field('Fluidité automatique', 'Sous 40 images par seconde, le jeu réduit de lui-même la résolution et la distance d’affichage (puis les rétroviseurs en dernier recours), et les rétablit quand la cadence remonte.', check(s.autoQuality, (v) => { s.autoQuality = v; })),
      field('Rétroviseurs', 'Trois rétroviseurs calculés en temps réel (coûteux sur les petites cartes graphiques).', check(s.mirrors, (v) => { s.mirrors = v; })),
      field('Champ de vision', '', range(s.fov, 40, 85, 1, (v) => { s.fov = v; }, (v) => `${v}°`)),
      field('Regard vers l’intérieur des virages', 'La tête accompagne le volant, utile sur un seul écran.', range(s.lookIntoTurns, 0, 1, 0.05, (v) => { s.lookIntoTurns = v; }, (v) => `${Math.round(v * 100)} %`)),
      field('Circulation', '', select(s.traffic, [['faible', 'Faible'], ['normal', 'Normale'], ['dense', 'Dense']], (v) => { s.traffic = v; })),
      field('Moniteur exigeant', 'Relève aussi les contrôles visuels oubliés (rétroviseurs, angles morts).', check(s.strict, (v) => { s.strict = v; })),
      field('Affichage tête haute', 'Compteur, limitation et témoins en bas de l’écran.', check(s.hud, (v) => { s.hud = v; })),
      field('Mini-carte', '', check(s.minimap, (v) => { s.minimap = v; })),
      field('Volume général', '', range(s.volume, 0, 1, 0.05, (v) => { s.volume = v; }, (v) => `${Math.round(v * 100)} %`)),
      field('Voix du moniteur', '', check(s.voice, (v) => { s.voice = v; })),
    );
    const body = h('div', null, tab === 'volant' ? volant : jeu);
    this.mount(h('div', { class: 'menu panel narrow' },
      h('h2', null, 'Réglages'),
      h('div', { class: 'tabs' },
        h('button', { class: tab === 'volant' ? 'on' : '', onclick: () => this.settings('volant', back) }, 'Volant et commandes'),
        h('button', { class: tab === 'jeu' ? 'on' : '', onclick: () => this.settings('jeu', back) }, 'Affichage, circulation, son')),
      body,
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn', onclick: back }, '← Retour')),
    ));
  }

  // ───────────────────────── calibration ─────────────────────────
  calibrate(done: () => void) {
    const c = this.host.controls;
    if (!c.pad || !c.profile) {
      this.mount(h('div', { class: 'menu panel narrow' }, h('h2', null, 'Calibration'),
        h('p', { class: 'sub' }, 'Aucun volant détecté. Branchez le volant, appuyez sur l’un de ses boutons, puis réessayez.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => this.calibrate(done) }, 'Réessayer'), h('button', { class: 'btn ghost', onclick: done }, 'Retour'))));
      return;
    }
    const cap = new AxisCapture(c);
    const p = c.profile;
    const used: number[] = [];
    type Stage = { title: string; text: string; apply: (r: NonNullable<ReturnType<AxisCapture['result']>>) => void; optional?: boolean; skip?: () => void };
    const stages: Stage[] = [
      { title: 'Volant', text: 'Tournez le volant à fond à gauche, puis à fond à droite, et revenez au centre.',
        apply: (r) => { p.steer = { index: r.index, left: r.min, right: r.max }; used.push(r.index); } },
      { title: 'Accélérateur', text: 'Appuyez à fond sur la pédale de droite, puis relâchez.',
        apply: (r) => { p.throttle = { index: r.index, rest: r.rest, full: Math.abs(r.max - r.rest) > Math.abs(r.min - r.rest) ? r.max : r.min }; used.push(r.index); } },
      { title: 'Frein', text: 'Appuyez à fond sur la pédale du milieu, puis relâchez.',
        apply: (r) => { p.brake = { index: r.index, rest: r.rest, full: Math.abs(r.max - r.rest) > Math.abs(r.min - r.rest) ? r.max : r.min }; used.push(r.index); } },
      { title: 'Embrayage', text: 'Appuyez à fond sur la pédale de gauche, puis relâchez. Pas d’embrayage ? Cliquez sur « Passer ».', optional: true,
        apply: (r) => { p.clutch = { index: r.index, rest: r.rest, full: Math.abs(r.max - r.rest) > Math.abs(r.min - r.rest) ? r.max : r.min }; used.push(r.index); }, skip: () => { p.clutch = null; } },
    ];
    let i = 0;
    const meter = h('i');
    const title = h('h2', null, ''), text = h('p', { class: 'sub' }, '');
    const next = h('button', { class: 'btn primary', onclick: () => advance(false) }, 'Valider');
    const skip = h('button', { class: 'btn ghost', onclick: () => advance(true) }, 'Passer');
    const info = h('p', { class: 'note' }, '');
    const show = () => {
      const st = stages[i];
      title.textContent = `Calibration ${i + 1}/${stages.length} — ${st.title}`;
      text.textContent = st.text;
      skip.style.display = st.optional ? '' : 'none';
      cap.begin();
    };
    const advance = (skipped: boolean) => {
      const st = stages[i];
      const r = cap.result(i === 0 ? [] : used);
      if (skipped) st.skip?.();
      else if (!r) { info.textContent = 'Aucun mouvement détecté : recommencez le geste en allant bien jusqu’au bout.'; cap.begin(); return; }
      else st.apply(r);
      info.textContent = '';
      i++;
      if (i >= stages.length) {
        p.calibrated = true; p.rangeDeg = this.host.settings.wheelRange;
        c.saveProfile();
        cancelAnimationFrame(this.raf);
        this.mount(h('div', { class: 'menu panel narrow' }, h('h2', null, 'Calibration terminée'),
          h('p', { class: 'sub' }, `Volant : axe ${p.steer.index} · accélérateur : axe ${p.throttle?.index ?? '—'} · frein : axe ${p.brake?.index ?? '—'} · embrayage : ${p.clutch ? 'axe ' + p.clutch.index : 'absent'}.`),
          h('p', { class: 'note' }, p.clutch ? 'Embrayage détecté : la boîte manuelle complète est disponible.' : 'Sans pédale d’embrayage, choisissez la boîte « embrayage piloté » ou « automatique ».'),
          h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn primary', onclick: done }, 'Terminer'))));
        return;
      }
      show();
    };
    this.mount(h('div', { class: 'menu panel narrow' }, title, text, h('div', { class: 'meter' }, meter), info,
      h('div', { class: 'row', style: 'margin-top:16px' }, next, skip, h('button', { class: 'btn ghost', onclick: () => { cancelAnimationFrame(this.raf); done(); } }, 'Annuler'))));
    show();
    const tick = () => {
      cap.sample();
      meter.style.width = `${Math.round(cap.progress(i === 0 ? [] : used) * 100)}%`;
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /** Attribution des boutons du volant. */
  bindings(done: () => void) {
    const c = this.host.controls;
    const p = c.profile;
    if (!c.pad || !p) { done(); return; }
    const actions: Action[] = ['shiftUp', 'shiftDown', 'indicatorLeft', 'indicatorRight', 'hazards', 'horn', 'start', 'handbrake', 'seatbelt', 'lights', 'lookLeft', 'lookRight', 'lookBack', 'camera', 'repeat', 'demo', 'pause', 'gear1', 'gear2', 'gear3', 'gear4', 'gear5', 'gear6', 'gearR'];
    let waiting: Action | null = null;
    let base: boolean[] = [];
    const rows = new Map<Action, HTMLElement>();
    const label = (a: Action) => (p.buttons[a] !== undefined ? `bouton ${p.buttons[a]}` : '—');
    const table = h('table', { class: 'keys' }, actions.map((a) => {
      const cell = h('td', null, label(a));
      rows.set(a, cell);
      return h('tr', null, h('td', null, ACTION_LABELS[a]), cell, h('td', null, h('button', { class: 'btn', onclick: () => { waiting = a; base = c.rawButtons(); cell.textContent = 'appuyez sur un bouton…'; } }, 'Changer')));
    }));
    this.mount(h('div', { class: 'menu panel narrow' }, h('h2', null, 'Boutons du volant'),
      h('p', { class: 'sub' }, 'Cliquez sur « Changer », puis appuyez sur le bouton du volant (ou enclenchez le rapport sur le levier en H).'),
      table,
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', { class: 'btn primary', onclick: () => { cancelAnimationFrame(this.raf); c.saveProfile(); done(); } }, 'Enregistrer'),
        h('button', { class: 'btn ghost', onclick: () => { c.resetProfile(); this.bindings(done); } }, 'Rétablir les valeurs par défaut'))));
    const tick = () => {
      if (waiting) {
        const now = c.rawButtons();
        const idx = now.findIndex((b, i) => b && !base[i]);
        if (idx >= 0) { p.buttons[waiting] = idx; rows.get(waiting)!.textContent = label(waiting); waiting = null; }
      }
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  // ───────────────────────── aide ─────────────────────────
  help(back: () => void = () => this.main()) {
    const k = (s: string) => h('kbd', null, s);
    const row = (label: string, ...keys: (string | Node)[]) => h('tr', null, h('td', null, label), h('td', null, ...keys));
    this.mount(h('div', { class: 'menu panel narrow' },
      h('h2', null, 'Commandes'),
      h('p', { class: 'sub' }, 'Clavier AZERTY. Sur le volant, tout est modifiable dans « Volant et commandes ».'),
      h('table', { class: 'keys' },
        row('Accélérer · freiner', k('↑'), ' ', k('↓'), ' ou ', k('Z'), ' ', k('S')),
        row('Tourner', k('←'), ' ', k('→'), ' ou ', k('Q'), ' ', k('D')),
        row('Embrayage', k('Maj')),
        row('Rapport supérieur · inférieur', k('E'), ' ', k('A'), ' · palettes du volant'),
        row('Rapports directs', k('1'), '…', k('6'), ' · ', k('0'), ' point mort · ', k('9'), ' marche arrière'),
        row('Démarrer / couper le moteur', k('Entrée')),
        row('Frein à main', k('Espace')),
        row('Ceinture', k('B')),
        row('Clignotant gauche · droit', k(';'), ' ', k(':')),
        row('Feux de détresse · feux de croisement', k('H'), ' ', k('L')),
        row('Avertisseur sonore', k('K')),
        row('Regarder à gauche · derrière · à droite', k('W'), ' ', k('X'), ' ', k('V')),
        row('Changer de vue', k('C')),
        row('Répéter la consigne', k('T')),
        row('Démonstration : le moniteur conduit', k('O')),
        row('Replacer la voiture sur la chaussée', k('R')),
        row('Pause', k('Échap'), ' ou ', k('P')),
      ),
      h('p', { class: 'note', style: 'margin-top:12px' }, 'Avec la boîte manuelle : débrayez à fond pour démarrer le moteur et pour chaque changement de rapport. Si vous calez, débrayez, revenez au point mort et redémarrez.'),
      h('div', { class: 'row', style: 'margin-top:16px' }, h('button', { class: 'btn', onclick: back }, '← Retour')),
    ));
  }

  // ───────────────────────── pause ─────────────────────────
  pause(lesson: Lesson) {
    this.mount(h('div', { class: 'menu panel narrow' },
      h('h2', null, 'Pause'),
      h('p', { class: 'sub' }, lesson.num ? `Leçon ${lesson.num} — ${lesson.title}` : lesson.title),
      h('div', { class: 'grid' },
        h('button', { class: 'card', onclick: () => this.host.resume() }, h('h3', null, 'Reprendre')),
        h('button', { class: 'card', onclick: () => this.host.restart() }, h('h3', null, 'Recommencer')),
        ...(lesson.id !== 'examen' && this.host.toggleDemo ? [h('button', { class: 'card', onclick: () => { this.host.resume(); this.host.toggleDemo!(); } }, h('h3', null, 'Démonstration du moniteur'), h('p', null, 'Le moniteur prend le volant et vous montre. Un coup de frein pour reprendre la main.'))] : []),
        h('button', { class: 'card', onclick: () => this.settings('volant', () => this.pause(lesson)) }, h('h3', null, 'Réglages')),
        h('button', { class: 'card', onclick: () => this.help(() => this.pause(lesson)) }, h('h3', null, 'Commandes')),
        h('button', { class: 'card', onclick: () => this.host.quit() }, h('h3', null, 'Terminer la séance'), h('p', null, 'Affiche le bilan de votre conduite.')),
      )));
  }

  // ───────────────────────── questions d'examen ─────────────────────────
  quiz(questions: Question[], done: (score: number) => void) {
    let i = 0, score = 0;
    const labels = { verification: 'Vérification du véhicule', securite: 'Sécurité routière', secours: 'Premiers secours' };
    const show = () => {
      const q = questions[i];
      const fb = h('p', { class: 'note', style: 'min-height:3em;margin-top:12px' }, '');
      const next = h('button', { class: 'btn primary', style: 'display:none', onclick: () => { i++; if (i >= questions.length) done(score); else show(); } }, i === questions.length - 1 ? 'Voir le résultat' : 'Question suivante');
      const buttons = q.choices.map((c, k) => h('button', { class: 'card', onclick: () => {
        if (next.style.display !== 'none') return;
        const ok = k === q.answer;
        if (ok) score++;
        buttons.forEach((b, j) => { b.style.borderColor = j === q.answer ? '#2fb36a' : j === k ? '#d0222b' : ''; });
        fb.textContent = (ok ? 'Exact. ' : 'Ce n’est pas la bonne réponse. ') + q.explain;
        next.style.display = '';
      } }, h('h3', null, c)));
      this.mount(h('div', { class: 'menu panel narrow' },
        h('h2', null, `Question ${i + 1}/${questions.length} — ${labels[q.theme]}`),
        h('p', { class: 'sub' }, q.q),
        h('div', { class: 'grid', style: 'grid-template-columns:1fr' }, buttons), fb,
        h('div', { class: 'row' }, next)));
    };
    show();
  }

  // ───────────────────────── bilan ─────────────────────────
  bilan(b: Bilan, next: () => void) {
    const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const graves = b.faults.filter((f) => f.inf.severity === 'grave').length;
    const fautes = b.faults.filter((f) => f.inf.severity === 'faute').length;
    const conseils = b.faults.filter((f) => f.inf.severity === 'conseil').length;
    const list = b.faults.length
      ? h('div', { class: 'bilan-list' }, b.faults.map((f) => h('div', { class: 'bilan-item ' + f.inf.severity },
          h('time', null, mmss(f.time)),
          h('div', null, f.inf.titre, f.detail ? ` — ${f.detail}` : '', h('small', null, `${f.street || 'hors voirie'}${f.inf.article ? ' · art. ' + f.inf.article : ''}`)),
          h('div', { style: 'text-align:right;font-size:12px;color:#c6ceda;max-width:170px' }, f.inf.classe ? sanctionText(f.inf) : 'conseil'))))
      : h('p', { class: 'note', style: 'margin:14px 0' }, 'Aucune faute relevée. Conduite irréprochable !');
    let verdict: HTMLElement;
    if (b.exam) {
      const ok = !b.exam.eliminated && b.exam.total >= 20;
      verdict = h('div', { class: 'verdict ' + (ok ? 'ok' : 'ko') }, ok ? `Examen réussi : ${b.exam.total}/31` : b.exam.eliminated ? `Échec : faute éliminatoire (${b.exam.total}/31)` : `Échec : ${b.exam.total}/31, il faut 20 points`);
    } else if (b.lesson.id === 'libre') {
      verdict = h('div', { class: 'verdict ' + (graves ? 'ko' : 'ok') }, graves ? `${graves} faute${graves > 1 ? 's' : ''} grave${graves > 1 ? 's' : ''} : à retravailler` : 'Bonne séance');
    } else {
      verdict = h('div', { class: 'verdict ' + (b.success ? 'ok' : 'ko') }, b.success ? `Leçon réussie  ${'★'.repeat(b.stars)}${'☆'.repeat(3 - b.stars)}` : graves ? 'Leçon à refaire : faute grave' : 'Leçon interrompue');
    }
    const grid = b.exam
      ? h('table', { class: 'grille' }, ...GRILLE.flatMap((g) => [
          h('tr', null, h('th', { colSpan: 2 }, g.bloc)),
          ...g.items.map((it) => { const r = b.exam!.rows.find((x) => x.label === it.label)!; return h('tr', null, h('td', null, it.label), h('td', null, `${r.score} / ${it.max}`)); }),
        ]))
      : null;
    this.mount(h('div', { class: 'menu panel' },
      h('h2', null, b.exam ? 'Résultat de l’examen blanc' : 'Bilan de la séance'),
      h('p', { class: 'sub' }, `${b.lesson.num && !b.exam ? `Leçon ${b.lesson.num} — ` : ''}${b.lesson.title} · ${mmss(b.duration)} · ${(b.distance / 1000).toFixed(2)} km`),
      verdict,
      h('div', { class: 'row', style: 'gap:22px;font-size:14px;margin-bottom:6px' },
        h('span', null, `Fautes graves : ${graves}`), h('span', null, `Fautes : ${fautes}`), h('span', null, `Conseils : ${conseils}`),
        h('span', null, `Points de permis restants : ${b.points}/12`), h('span', null, `Amendes : ${b.amende} €`)),
      grid,
      list,
      h('p', { class: 'note' }, 'Les sanctions indiquées sont celles encourues dans la réalité pour chaque infraction (amende forfaitaire et retrait de points).'),
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'btn primary', onclick: () => this.host.restart() }, 'Recommencer'),
        h('button', { class: 'btn', onclick: next }, 'Retour au menu')),
    ));
  }
}
