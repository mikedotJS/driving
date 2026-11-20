// Calcul d'itinéraire sur le réseau (Dijkstra sur les couples arête + sens) et consignes de guidage
// formulées comme le ferait un moniteur ou un inspecteur.

import type { Edge, RoadNet, Vertex } from './roadnet';
import { wrapAngle, Rng } from '../core/math';

export interface RouteStep { edge: Edge; dir: 1 | -1 }
export type TurnKind = 'gauche' | 'droite' | 'tout-droit' | 'giratoire' | 'arrivee';
export interface Maneuver {
  /** indice de l'étape qui suit la manœuvre */
  step: number;
  vertex: Vertex;
  kind: TurnKind;
  /** numéro de sortie (giratoire) */
  exit: number;
  /** distance depuis le début de l'itinéraire jusqu'au sommet */
  at: number;
  street: string;
  /** rang de la rue à prendre (1 = prochaine) parmi les rues du même côté depuis la manœuvre précédente */
  ordinal: number;
  signal: boolean;
}
export interface Route {
  steps: RouteStep[];
  /** distance cumulée au début de chaque étape */
  cum: number[];
  length: number;
  maneuvers: Maneuver[];
  /** abscisse d'arrivée sur la dernière arête (sens de parcours) */
  endS: number;
}

const key = (e: Edge, dir: number) => e.id * 2 + (dir > 0 ? 1 : 0);

function neighbors(e: Edge, dir: 1 | -1): { edge: Edge; dir: 1 | -1; turn: string }[] {
  const lanes = dir > 0 ? e.lanesF : e.lanesB;
  const out: { edge: Edge; dir: 1 | -1; turn: string }[] = [];
  for (const l of lanes) {
    for (const k of l.links) {
      if (!out.some((o) => o.edge === k.to.edge && o.dir === k.to.dir)) out.push({ edge: k.to.edge, dir: k.to.dir, turn: k.turn });
    }
  }
  return out;
}

export function findRoute(net: RoadNet, from: RouteStep, fromS: number, to: Edge, toS: number): Route | null {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const state = new Map<number, RouteStep>();
  // file de priorité simple (tas binaire)
  const heap: [number, number][] = [];
  const push = (d: number, k: number) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = (): [number, number] => {
    const top = heap[0]; const last = heap.pop()!;
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  const speed = (e: Edge) => Math.max(15, e.limit) / 3.6 * (e.living ? 0.7 : 1);
  const k0 = key(from.edge, from.dir);
  const firstLen = from.dir > 0 ? from.edge.length - fromS : fromS;
  dist.set(k0, firstLen / speed(from.edge));
  state.set(k0, from);
  push(dist.get(k0)!, k0);
  let goal = -1;
  while (heap.length) {
    const [d, k] = pop();
    if (d > (dist.get(k) ?? Infinity)) continue;
    const st = state.get(k)!;
    if (st.edge === to && k !== k0) { goal = k; break; }
    for (const n of neighbors(st.edge, st.dir)) {
      const nk = key(n.edge, n.dir);
      const end = st.dir > 0 ? st.edge.endB : st.edge.endA;
      let cost = n.edge.length / speed(n.edge);
      cost += n.turn === 'left' ? 9 : n.turn === 'right' ? 4 : 0;
      cost += end.control === 'signal' ? 12 : end.control === 'stop' ? 7 : end.control === 'yield' ? 3 : 0;
      if (n.edge.cls === 'service') cost += 20;
      const nd = d + cost;
      if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, k); state.set(nk, { edge: n.edge, dir: n.dir }); push(nd, nk); }
    }
  }
  if (goal < 0) return null;
  const steps: RouteStep[] = [];
  for (let k = goal; ; k = prev.get(k)!) { steps.unshift(state.get(k)!); if (k === k0) break; if (!prev.has(k)) return null; }
  return describe(steps, fromS, toS);
}

/** Calcule distances cumulées et manœuvres. */
export function describe(steps: RouteStep[], fromS: number, toS: number): Route {
  const cum: number[] = [];
  let acc = 0;
  steps.forEach((st, i) => {
    cum.push(acc);
    const full = st.edge.length;
    if (i === 0) acc += st.dir > 0 ? full - fromS : fromS;
    else if (i === steps.length - 1) acc += st.dir > 0 ? toS : full - toS;
    else acc += full;
  });
  const last = steps[steps.length - 1];
  const route: Route = { steps, cum, length: acc, maneuvers: [], endS: last.dir > 0 ? toS : last.edge.length - toS };
  let sideLeft = 0, sideRight = 0;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], b = steps[i];
    const V = a.dir > 0 ? a.edge.b : a.edge.a;
    const inEnd = a.dir > 0 ? a.edge.endB : a.edge.endA;
    const outEnd = b.dir > 0 ? b.edge.endA : b.edge.endB;
    const inHeading = Math.atan2(-inEnd.dx, inEnd.dz);
    const ang = wrapAngle(outEnd.heading - inHeading);
    const at = cum[i];
    // rues latérales rencontrées (pour « la deuxième à droite »)
    let nLeft = 0, nRight = 0;
    for (const o of V.ends) {
      if (o === inEnd || !o.canLeave || o.edge.cls === 'service') continue;
      const oa = wrapAngle(o.heading - inHeading);
      if (oa > 0.6 && oa < 2.6) nRight++; else if (oa < -0.6 && oa > -2.6) nLeft++;
    }
    // giratoire : on entre sur l'anneau
    if (!a.edge.roundabout && b.edge.roundabout) {
      let exit = 0, j = i;
      for (; j < steps.length && steps[j].edge.roundabout; j++) {
        const W = steps[j].dir > 0 ? steps[j].edge.b : steps[j].edge.a;
        if (W.ends.some((o) => !o.edge.roundabout && o.canLeave)) exit++;
      }
      const street = j < steps.length ? steps[j].edge.name : '';
      route.maneuvers.push({ step: i, vertex: V, kind: 'giratoire', exit: Math.max(1, exit), at, street, ordinal: 1, signal: false });
      sideLeft = sideRight = 0;
      continue;
    }
    if (a.edge.roundabout) continue;
    if (V.ends.length < 3) continue;
    const sameStreet = !!b.edge.name && b.edge.name === a.edge.name;
    if (Math.abs(ang) > 0.6 && !(sameStreet && Math.abs(ang) < 0.95)) {
      const right = ang > 0;
      route.maneuvers.push({
        step: i, vertex: V, kind: right ? 'droite' : 'gauche', exit: 0, at, street: b.edge.name,
        ordinal: (right ? sideRight : sideLeft) + 1, signal: inEnd.control === 'signal',
      });
      sideLeft = sideRight = 0;
    } else {
      sideLeft += nLeft; sideRight += nRight;
    }
  }
  route.maneuvers.push({ step: steps.length - 1, vertex: last.dir > 0 ? last.edge.b : last.edge.a, kind: 'arrivee', exit: 0, at: acc, street: last.edge.name, ordinal: 1, signal: false });
  return route;
}

const ORD = ['', 'première', 'deuxième', 'troisième', 'quatrième', 'cinquième'];

/** Consigne formulée comme à l'examen. `far` = annonce anticipée. */
export function instruction(m: Maneuver, far: boolean): string {
  if (m.kind === 'arrivee') return far ? 'Vous arrivez à destination. Cherchez un endroit pour vous arrêter sur la droite.' : 'Arrêtez-vous sur la droite en sécurité.';
  if (m.kind === 'giratoire') return `Au giratoire, prenez la ${ORD[Math.min(5, m.exit)]} sortie${m.street ? `, ${m.street}` : ''}.`;
  const side = m.kind === 'droite' ? 'à droite' : 'à gauche';
  if (!far) return `Tournez ${side}${m.street ? `, ${m.street}` : ''}.`;
  if (m.signal) return `Au feu, vous tournerez ${side}${m.street ? `, ${m.street}` : ''}.`;
  if (m.ordinal >= 2 && m.ordinal <= 3) return `Vous prendrez la ${ORD[m.ordinal]} ${side}${m.street ? `, ${m.street}` : ''}.`;
  return `À la prochaine intersection, tournez ${side}${m.street ? `, ${m.street}` : ''}.`;
}

/** Suivi de la progression du joueur le long d'un itinéraire. */
export class RouteFollower {
  step = 0;
  /** distance parcourue le long de l'itinéraire */
  progress = 0;
  offRoute = 0;
  done = false;
  private announced = new Set<string>();
  constructor(public route: Route) {}

  /** Met à jour avec la position courante ; renvoie une consigne à annoncer, ou null. */
  update(dt: number, edge: Edge | null, dir: 1 | -1, sTravel: number, speed: number): string | null {
    const r = this.route;
    if (this.done) return null;
    if (!edge) { this.offRoute += dt; return null; }
    // recherche de l'étape correspondante dans une fenêtre autour de l'étape courante
    let found = -1;
    for (let i = this.step; i < Math.min(r.steps.length, this.step + 4); i++) {
      if (r.steps[i].edge === edge && r.steps[i].dir === dir) { found = i; break; }
    }
    if (found < 0) { this.offRoute += dt; return null; }
    this.offRoute = 0;
    this.step = found;
    const st = r.steps[found];
    const along = found === 0 ? Math.max(0, sTravel - (st.edge.length - (r.cum[1] ?? r.length))) : sTravel;
    this.progress = r.cum[found] + Math.max(0, along);
    if (found === r.steps.length - 1 && sTravel >= r.endS - 12) {
      if (speed < 0.5) { this.done = true; return null; }
    }
    // prochaine manœuvre
    const m = r.maneuvers.find((x) => x.at >= this.progress - 2);
    if (!m) return null;
    const d = m.at - this.progress;
    const farDist = Math.max(70, speed * 9);
    const nearDist = Math.max(22, speed * 3.2);
    const id = `${m.step}`;
    if (d < nearDist && !this.announced.has(id + 'n')) { this.announced.add(id + 'n'); this.announced.add(id + 'f'); return instruction(m, false); }
    if (d < farDist && d > nearDist + 12 && !this.announced.has(id + 'f')) { this.announced.add(id + 'f'); return instruction(m, true); }
    return null;
  }

  /** Prochaine manœuvre et distance restante jusqu'à elle. */
  next(): { m: Maneuver; dist: number } | null {
    const m = this.route.maneuvers.find((x) => x.at >= this.progress - 2);
    return m ? { m, dist: Math.max(0, m.at - this.progress) } : null;
  }
}

/** Destination aléatoire à une distance donnée (rue ordinaire, hors impasse). */
export function randomDestination(net: RoadNet, x: number, z: number, minDist: number, maxDist: number, rng: Rng): Edge | null {
  for (let i = 0; i < 80; i++) {
    const e = rng.pick(net.edges);
    if (e.length < 50 || e.cls === 'service' || e.roundabout || e.a.dead || e.b.dead || !e.name) continue;
    const p = e.line.at(e.length / 2);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= minDist && d <= maxDist) return e;
  }
  return null;
}
