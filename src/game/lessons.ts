// Leçons de conduite, organisées comme la progression d'une auto-école (les quatre compétences
// du référentiel REMC), et préparation des itinéraires adaptés au thème de chaque leçon.

import type { Player } from './player';
import type { Situation } from '../rules/engine';
import type { InputState } from '../input/controls';
import type { Edge, RoadNet } from '../map/roadnet';
import { describe, findRoute, randomDestination, type Route, type RouteStep } from '../map/route';
import { Rng } from '../core/math';

export interface LessonCtx {
  player: Player;
  sit: Situation;
  input: InputState;
  /** temps écoulé depuis le début de l'étape (s) */
  t: number;
  /** distance parcourue depuis le début de l'étape (m) */
  dist: number;
  /** drapeaux libres propres à l'étape */
  mem: Record<string, number>;
  auto: boolean;
  routeDone: boolean;
}
export interface LessonStep {
  text: string | ((auto: boolean) => string);
  hint?: string | ((auto: boolean) => string);
  done: (c: LessonCtx) => boolean;
}
export type Theme = 'bases' | 'allure' | 'tournants' | 'priorite' | 'feux' | 'pietons' | 'giratoire' | 'circulation' | 'autonomie' | 'examen' | 'libre';
export interface Lesson {
  id: string;
  num: number;
  title: string;
  summary: string;
  competence: string;
  theme: Theme;
  /** consigne d'introduction dite par le moniteur */
  intro: string;
  steps: LessonStep[];
  traffic: 'aucun' | 'faible' | 'normal';
  /** départ moteur tournant, ceinture attachée */
  ready: boolean;
}

const kmh = (c: LessonCtx) => Math.abs(c.player.car.vx) * 3.6;
const followRoute: LessonStep = {
  text: 'Suivez les indications du moniteur jusqu’à l’arrivée',
  hint: 'Les consignes s’affichent en haut de l’écran et sur le GPS. <kbd>T</kbd> pour les répéter.',
  done: (c) => c.routeDone,
};
const parkAndStop: LessonStep = {
  text: (auto) => (auto ? 'Arrêtez-vous sur la droite, sélecteur sur P, frein à main' : 'Arrêtez-vous sur la droite : point mort et frein à main'),
  hint: 'Clignotant à droite, freinez en douceur, puis sécurisez la voiture.',
  done: (c) => kmh(c) < 0.5 && c.player.handbrake && (c.auto ? c.player.car.selector === 'P' : c.player.car.gear === 0),
};

export const LESSONS: Lesson[] = [
  {
    id: 'installation', num: 1, title: 'S’installer et démarrer', competence: 'Compétence 1 · Maîtriser le véhicule', theme: 'bases', traffic: 'aucun', ready: false,
    summary: 'Ceinture, contrôles, démarrage du moteur, point de patinage : les premiers tours de roue sans caler.',
    intro: 'Bienvenue ! On commence par les bases : s’installer, démarrer et s’arrêter. Prenez votre temps.',
    steps: [
      { text: 'Attachez votre ceinture', hint: 'Touche <kbd>B</kbd> ou bouton « Ceinture » du volant.', done: (c) => c.player.seatbelt },
      { text: 'Vérifiez vos rétroviseurs : regardez à gauche, puis à droite', hint: 'Touches <kbd>W</kbd> et <kbd>V</kbd>, ou les boutons « Regarder » du volant.',
        done: (c) => { if (c.input.held.has('lookLeft')) c.mem.l = 1; if (c.input.held.has('lookRight')) c.mem.r = 1; return !!c.mem.l && !!c.mem.r; } },
      { text: (a) => (a ? 'Pied sur le frein, démarrez le moteur' : 'Débrayez à fond et démarrez le moteur'),
        hint: (a) => (a ? 'Frein enfoncé puis <kbd>Entrée</kbd>.' : 'Pédale de gauche à fond (ou <kbd>Maj</kbd>), puis <kbd>Entrée</kbd>.'), done: (c) => c.player.car.engineRunning },
      { text: (a) => (a ? 'Passez le sélecteur sur D' : 'Passez la première'),
        hint: (a) => (a ? 'Pied sur le frein, puis palette de droite ou <kbd>E</kbd>.' : 'Embrayage toujours enfoncé : levier en 1re, palette de droite ou <kbd>E</kbd>.'),
        done: (c) => (c.auto ? c.player.car.selector === 'D' : c.player.car.gear === 1) },
      { text: 'Clignotant à gauche et coup d’œil dans l’angle mort', hint: 'Clignotant gauche : <kbd>;</kbd> · angle mort : <kbd>W</kbd>.',
        done: (c) => { if (c.input.held.has('lookLeft') && c.player.indicator === -1) c.mem.ok = 1; return !!c.mem.ok; } },
      { text: 'Desserrez le frein à main', hint: 'Touche <kbd>Espace</kbd> ou bouton « Frein à main ».', done: (c) => !c.player.handbrake },
      { text: (a) => (a ? 'Relâchez le frein : la voiture avance seule, accélérez doucement' : 'Relevez doucement l’embrayage jusqu’au point de patinage, puis accélérez légèrement'),
        hint: (a) => (a ? 'Dosez l’accélérateur du bout du pied.' : 'Quand le régime baisse et que la voiture frémit, maintenez le pied une seconde avant de finir de relâcher. Si vous calez : débrayez et redémarrez.'),
        done: (c) => kmh(c) > 8 && c.dist > 12 && c.player.car.engineRunning },
      { text: (a) => (a ? 'Roulez jusqu’à 25 km/h' : 'Vers 15 à 20 km/h, passez la deuxième'), hint: (a) => (a ? '' : 'Relâchez l’accélérateur, débrayez, 2e, puis relâchez l’embrayage en douceur.'),
        done: (c) => (c.auto ? kmh(c) > 24 : c.player.car.gear >= 2 && kmh(c) > 14) },
      { text: 'Clignotant à droite et arrêtez-vous le long du trottoir', hint: (a) => (a ? 'Freinez progressivement.' : 'Freinez progressivement et débrayez juste avant l’arrêt pour ne pas caler.'),
        done: (c) => c.dist > 40 && kmh(c) < 0.4 && c.player.car.engineRunning },
      { text: (a) => (a ? 'Sélecteur sur P, frein à main, coupez le moteur' : 'Point mort, frein à main, coupez le moteur'), hint: 'On sécurise toujours la voiture avant de relâcher les pédales.',
        done: (c) => c.player.handbrake && !c.player.car.engineRunning && (c.auto ? c.player.car.selector === 'P' : c.player.car.gear === 0) },
    ],
  },
  {
    id: 'allure', num: 2, title: 'Passer les vitesses et doser son allure', competence: 'Compétence 1 · Maîtriser le véhicule', theme: 'allure', traffic: 'aucun', ready: true,
    summary: 'Monter et descendre les rapports, tenir 30 km/h sans regarder le compteur en permanence, freiner en douceur.',
    intro: 'Nous allons travailler la boîte de vitesses et la régularité de l’allure. Ici, c’est limité à trente.',
    steps: [
      { text: 'Démarrez et montez jusqu’à 30 km/h', hint: (a) => (a ? '' : 'Changez de rapport vers 2 000 à 2 500 tours : 2e vers 15 km/h, 3e vers 30 km/h.'),
        done: (c) => kmh(c) > 27 && (c.auto || c.player.car.gear >= 2) },
      { text: 'Tenez entre 25 et 30 km/h pendant 12 secondes', hint: 'Regardez loin devant ; un coup d’œil au compteur suffit.',
        done: (c) => { const v = kmh(c); c.mem.t = v > 24 && v <= 31.5 ? (c.mem.t ?? 0) + 1 / 60 : 0; return c.mem.t > 12; } },
      { text: (a) => (a ? 'Ralentissez à 15 km/h en relâchant l’accélérateur' : 'Ralentissez sous 20 km/h et rétrogradez en deuxième'), hint: 'Le frein moteur ralentit la voiture sans toucher au frein.',
        done: (c) => kmh(c) < 19 && (c.auto || c.player.car.gear === 2) },
      { text: 'Réaccélérez jusqu’à 30 km/h', done: (c) => kmh(c) > 27 },
      { text: 'Freinez pour vous arrêter en douceur, sans à-coup', hint: 'Freinage dégressif : relâchez un peu la pédale juste avant l’arrêt.',
        done: (c) => { c.mem.max = Math.max(c.mem.max ?? 0, -c.player.car.ax); return kmh(c) < 0.4; } },
      parkAndStop,
    ],
  },
  {
    id: 'tournants', num: 3, title: 'Tourner à droite et à gauche', competence: 'Compétence 2 · Appréhender la route', theme: 'tournants', traffic: 'faible', ready: true,
    summary: 'Rétroviseurs, clignotant, placement, allure : la méthode pour chaque changement de direction.',
    intro: 'Avant chaque virage : rétroviseurs, clignotant, on ralentit, on rétrograde, puis on tourne en regardant où l’on va.',
    steps: [followRoute, parkAndStop],
  },
  {
    id: 'priorite', num: 4, title: 'La priorité à droite', competence: 'Compétence 2 · Appréhender la route', theme: 'priorite', traffic: 'normal', ready: true,
    summary: 'Dans les rues de Montreuil, la plupart des carrefours n’ont aucun panneau : on cède à droite.',
    intro: 'Dans ce quartier, presque aucun carrefour n’a de panneau. Sans signalisation, vous cédez le passage à tout ce qui vient de votre droite. Ralentissez et regardez à chaque intersection.',
    steps: [followRoute, parkAndStop],
  },
  {
    id: 'feux', num: 5, title: 'Feux, stops et cédez-le-passage', competence: 'Compétence 2 · Appréhender la route', theme: 'feux', traffic: 'normal', ready: true,
    summary: 'S’arrêter à la ligne d’effet des feux, marquer le stop, anticiper l’orange.',
    intro: 'Sur ce parcours, vous allez rencontrer des feux et des stops. À l’orange on s’arrête, sauf si c’est dangereux. Au stop, les roues s’immobilisent complètement.',
    steps: [followRoute, parkAndStop],
  },
  {
    id: 'pietons', num: 6, title: 'Piétons, zones 30 et zones de rencontre', competence: 'Compétence 3 · Partager la route', theme: 'pietons', traffic: 'normal', ready: true,
    summary: 'Céder le passage au piéton qui s’engage ou manifeste son intention : six points en jeu.',
    intro: 'Attention aux piétons : dès qu’un piéton s’engage ou montre qu’il veut traverser, vous le laissez passer. En zone de rencontre, il est prioritaire partout et vous roulez à vingt.',
    steps: [followRoute, parkAndStop],
  },
  {
    id: 'giratoire', num: 7, title: 'Les giratoires', competence: 'Compétence 2 · Appréhender la route', theme: 'giratoire', traffic: 'normal', ready: true,
    summary: 'Céder à l’anneau, se placer, clignoter pour sortir.',
    intro: 'À l’entrée d’un giratoire, vous cédez le passage aux véhicules qui sont sur l’anneau. Clignotant à droite juste après avoir dépassé la sortie qui précède la vôtre.',
    steps: [followRoute, parkAndStop],
  },
  {
    id: 'circulation', num: 8, title: 'Circuler sur les grands axes', competence: 'Compétence 3 · Partager la route', theme: 'circulation', traffic: 'normal', ready: true,
    summary: 'Boulevards, couloirs de bus, distances de sécurité, changements de voie.',
    intro: 'Nous allons sur les grands axes. Gardez deux secondes de distance, restez hors des couloirs de bus, et contrôlez votre angle mort avant chaque changement de voie.',
    steps: [followRoute, parkAndStop],
  },
  {
    id: 'autonomie', num: 9, title: 'Itinéraire en autonomie', competence: 'Compétence 4 · Conduite autonome', theme: 'autonomie', traffic: 'normal', ready: false,
    summary: 'Un trajet complet de Montreuil vers Paris en suivant le GPS, comme pendant la phase autonome de l’examen.',
    intro: 'Vous êtes autonome : installez-vous, démarrez et suivez le GPS jusqu’à destination. Je n’interviens que si nécessaire.',
    steps: [
      { text: 'Installez-vous et démarrez', hint: 'Ceinture, moteur, clignotant, contrôle, frein à main.', done: (c) => c.player.seatbelt && c.player.car.engineRunning && kmh(c) > 5 },
      followRoute, parkAndStop,
    ],
  },
];

export const EXAM: Lesson = {
  id: 'examen', num: 10, title: 'Examen blanc', competence: 'Épreuve pratique du permis B', theme: 'examen', traffic: 'normal', ready: false,
  summary: 'Un parcours noté sur 31 points avec la grille officielle. 20 points et aucune faute éliminatoire pour réussir.',
  intro: 'Bonjour, je suis votre inspecteur. Installez-vous, puis démarrez quand vous êtes prêt. Je vous indiquerai la direction à suivre.',
  steps: [
    { text: 'Installez-vous et démarrez', hint: 'Ceinture, rétroviseurs, moteur, clignotant et contrôle avant de partir.', done: (c) => c.player.seatbelt && c.player.car.engineRunning && kmh(c) > 5 },
    { text: 'Suivez les indications de l’inspecteur', done: (c) => c.routeDone },
    { text: (a) => (a ? 'Arrêtez-vous, sélecteur sur P, frein à main, moteur coupé' : 'Arrêtez-vous, point mort, frein à main, moteur coupé'),
      done: (c) => kmh(c) < 0.5 && c.player.handbrake && !c.player.car.engineRunning },
  ],
};

export const FREE: Lesson = {
  id: 'libre', num: 0, title: 'Conduite libre', competence: '', theme: 'libre', traffic: 'normal', ready: false,
  summary: 'Roulez où vous voulez dans Montreuil et le 20e arrondissement. Le moniteur relève vos fautes.',
  intro: 'Conduite libre : allez où vous voulez. Je reste à côté de vous et je vous signale vos erreurs.',
  steps: [],
};

// ───────────────────────── points de départ et itinéraires ─────────────────────────
export interface StartPose { x: number; z: number; heading: number; edge: Edge; dir: 1 | -1; s: number }

/** Place la voiture le long du trottoir (sur la bande de stationnement s'il y en a une). */
export function poseOn(edge: Edge, dir: 1 | -1, s: number): StartPose {
  const lanes = dir > 0 ? edge.lanesF : edge.lanesB;
  const lane = lanes[lanes.length - 1];
  // bande de stationnement du côté droit du sens de marche
  const park = edge.strips.find((st) => st.kind === 'P' && Math.sign(st.off) === dir);
  const off = park ? park.off : lane ? lane.off + dir * Math.max(0, lane.width / 2 - 1.25) : 0;
  const p = edge.line.atOffset(s, off);
  return { x: p.x, z: p.z, heading: Math.atan2(p.tx * dir, -p.tz * dir), edge, dir, s };
}

function score(theme: Theme, r: Route): number {
  let turns = 0, signals = 0, stops = 0, free = 0, crossings = 0, living = 0, rb = 0, major = 0, len = 0;
  for (const m of r.maneuvers) { if (m.kind === 'gauche' || m.kind === 'droite') turns++; if (m.kind === 'giratoire') rb++; }
  r.steps.forEach((st, i) => {
    const e = st.edge;
    len += e.length;
    crossings += e.crossings.length;
    if (e.living) living += e.length;
    if (e.cls === 'primary' || e.cls === 'secondary') major += e.length;
    if (i < r.steps.length - 1) {
      const end = st.dir > 0 ? e.endB : e.endA;
      if (end.vertex.ends.length >= 3) {
        if (end.control === 'signal') signals++;
        else if (end.control === 'stop' || end.control === 'yield') stops++;
        else if (!end.vertex.roundabout) free++;
      }
    }
  });
  const lenPenalty = Math.abs(r.length - (theme === 'autonomie' ? 2400 : theme === 'examen' ? 1600 : 1300)) / 300;
  switch (theme) {
    case 'tournants': return turns * 2 - lenPenalty - signals * 0.5;
    case 'priorite': return free * 1.5 + turns - signals * 1.5 - major / 200 - lenPenalty;
    case 'feux': return signals * 2 + stops * 2.5 - lenPenalty;
    case 'pietons': return crossings * 0.6 + living / 60 - lenPenalty;
    case 'giratoire': return rb * 12 + turns * 0.5 - lenPenalty;
    case 'circulation': return major / 120 + signals - lenPenalty;
    default: return turns + signals + stops + free * 0.5 + rb * 3 - lenPenalty;
  }
}

/** Cherche, parmi des destinations tirées au hasard, l'itinéraire le mieux adapté au thème. */
/**
 * `check` (facultatif) valide un itinéraire candidat — le jeu s'en sert pour ne retenir que des parcours
 * dont chaque virage est praticable sans toucher une bordure (voir Autopilot.pathIssues).
 */
export function planRoute(net: RoadNet, from: RouteStep, fromS: number, theme: Theme, seed: number, range?: [number, number], check?: (r: Route) => boolean): Route | null {
  const rng = new Rng(seed);
  const p = from.edge.line.at(fromS);
  const found: { r: Route; sc: number }[] = [];
  const [dmin, dmax] = range ?? (theme === 'autonomie' ? [1300, 2300] : [500, 1200]);
  for (let i = 0; i < 46; i++) {
    const dest = randomDestination(net, p.x, p.z, dmin, dmax, rng);
    if (!dest) continue;
    const r = findRoute(net, from, fromS, dest, dest.length * 0.5);
    if (!r || r.steps.length < 3 || !drivable(r)) continue;
    found.push({ r, sc: score(theme, r) });
  }
  found.sort((a, b) => b.sc - a.sc);
  if (!check) return found[0]?.r ?? null;
  // le meilleur candidat dont tous les virages sont praticables (au pire, le meilleur tout court)
  for (const c of found.slice(0, 8)) if (check(c.r)) return c.r;
  return found[0]?.r ?? null;
}

/**
 * L'itinéraire est-il praticable sans manœuvre ? On écarte ceux qui comportent une épingle : un virage
 * de plus de 125°, ou deux virages du même côté enchaînés sur quelques mètres (entrer dans un giratoire
 * pour en ressortir aussitôt par la branche voisine, par exemple) — une voiture n'y passe pas en une fois.
 */
export function drivable(route: Route): boolean {
  const turnAt = (i: number): number | null => {
    const a = route.steps[i], b = route.steps[i + 1];
    if (!b) return null;
    let best: number | null = null;
    for (const lane of a.dir > 0 ? a.edge.lanesF : a.edge.lanesB) {
      for (const l of lane.links) if (l.to.edge === b.edge && l.to.dir === b.dir && (best === null || Math.abs(l.angle) < Math.abs(best))) best = l.angle;
    }
    return best;
  };
  for (let i = 0; i + 1 < route.steps.length; i++) {
    const t = turnAt(i);
    if (t === null) continue;
    if (Math.abs(t) > 2.2) return false;
    const next = turnAt(i + 1), mid = route.steps[i + 1].edge;
    if (next !== null && mid.length < 14 && Math.sign(next) === Math.sign(t) && Math.abs(t + next) > 2.2) return false;
  }
  return true;
}

/** Itinéraire d'examen : plusieurs tronçons variés enchaînés. */
export function planExam(net: RoadNet, from: RouteStep, fromS: number, seed: number, check?: (r: Route) => boolean): Route | null {
  const themes: Theme[] = ['priorite', 'feux', 'circulation'];
  let cur = from, s = fromS;
  const steps: RouteStep[] = [];
  let endS = 0;
  for (let k = 0; k < themes.length; k++) {
    const r = planRoute(net, cur, s, themes[k], seed + k * 101, [380, 760], check);
    if (!r) break;
    const part = k === 0 ? r.steps : r.steps.slice(1);
    steps.push(...part);
    const last = r.steps[r.steps.length - 1];
    endS = last.edge.length * 0.5;
    cur = last; s = endS;
  }
  if (steps.length < 3) return null;
  return describe(steps, fromS, endS);
}

/** Rue calme et rectiligne pour les premières leçons, près d'un point donné. */
export function quietStreet(net: RoadNet, x: number, z: number): StartPose | null {
  let best: Edge | null = null, bestScore = -Infinity;
  for (const e of net.edges) {
    if (e.cls !== 'residential' && e.cls !== 'unclassified') continue;
    if (e.length < 170 || e.roundabout || e.living) continue;
    // une vraie petite rue : ni couloir de bus ni bande cyclable, pas de feux aux extrémités
    if (e.strips.some((s) => s.kind === 'B' || s.kind === 'C')) continue;
    if (/^(Boulevard|Avenue|Place)/.test(e.name)) continue;
    if (e.endA.control === 'signal' || e.endB.control === 'signal') continue;
    const a = e.line.at(0), b = e.line.at(e.length);
    const straight = Math.hypot(b.x - a.x, b.z - a.z) / e.length;
    if (straight < 0.985) continue;
    const m = e.line.at(e.length / 2);
    const d = Math.hypot(m.x - x, m.z - z);
    const sc = e.length - d * 0.35 - e.crossings.length * 25 + (e.strips.some((s) => s.kind === 'P') ? 30 : 0);
    if (sc > bestScore) { bestScore = sc; best = e; }
  }
  if (!best) return null;
  const dir: 1 | -1 = best.lanesF.length ? 1 : -1;
  return poseOn(best, dir, dir > 0 ? best.endA.trim + 12 : best.length - best.endB.trim - 12);
}

/** Point de départ sur une rue nommée. */
export function startOnStreet(net: RoadNet, name: string, t = 0.2): StartPose | null {
  const norm = (v: string) => v.replace(/’/g, "'").toLowerCase();
  const cands = net.edges.filter((e) => norm(e.name) === norm(name) && e.length > 60 && !e.roundabout).sort((a, b) => b.length - a.length);
  const e = cands[0];
  if (!e) return null;
  const dir: 1 | -1 = e.lanesF.length ? 1 : -1;
  const s = dir > 0 ? e.endA.trim + (e.length - e.endA.trim - e.endB.trim) * t : e.length - e.endB.trim - (e.length - e.endA.trim - e.endB.trim) * t;
  return poseOn(e, dir, s);
}

/** Départs propres à chaque thème (rues réelles de Montreuil et de Paris 20e). */
export const START_STREETS: Record<Theme, string[]> = {
  bases: [], allure: [],
  tournants: ['Rue Marceau', 'Rue Voltaire', 'Rue de Vincennes'],
  priorite: ['Rue Voltaire', 'Rue Marceau', 'Rue Kléber'],
  feux: ['Rue de Paris', 'Boulevard Chanzy', 'Avenue de la Résistance'],
  pietons: ['Rue de l’Église', 'Rue Victor Hugo', 'Boulevard Rouget de Lisle'],
  giratoire: ['Avenue de la Résistance', 'Boulevard Paul Vaillant-Couturier', 'Avenue du Général de Gaulle'],
  circulation: ['Rue des Pyrénées', 'Rue d’Avron', 'Boulevard Davout'],
  autonomie: ['Boulevard Rouget de Lisle', 'Rue de Paris'],
  examen: ['Boulevard Rouget de Lisle', 'Avenue Pasteur', 'Rue de Paris'],
  libre: ['Boulevard Rouget de Lisle', 'Rue de Paris'],
};
