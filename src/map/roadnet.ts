// Réseau routier du jeu : construit à partir de la carte (public/maps/*.json) les voies,
// les carrefours, les lignes d'arrêt, les feux et les liaisons entre voies.
// Indépendant du rendu (utilisable en test sous Node).

import { Polyline, bezierLink } from './polyline';
import { clamp, hash32, wrapAngle } from '../core/math';

// ───────────── Format du fichier carte ─────────────
export interface RawFeature { k: 'sig' | 'stop' | 'yield' | 'x' | 'bump' | 'radar'; s: number; dir?: number; sig?: number; marked?: number; table?: number; sub?: string }
export interface RawEdge {
  a: number; b: number; n: string; c: string; ow: number; ms: number;
  st: [string, number, number, string?][]; p: number[]; f?: RawFeature[];
  rb?: number; lk?: number; dsc?: number; br?: number; sf?: string; tl?: string; pa?: number;
}
export interface RawVertex { x: number; z: number; sig?: number; xing?: number; stop?: number; yield?: number; mini?: number; exit?: number; dead?: number }
export interface RawPoly { o: number[]; h: number[][] }
/**
 * Bâtiment : emprise OpenStreetMap (p), hauteur (h, m) et niveaux (l). Les champs suivants viennent
 * de la BD TOPO de l'IGN et sont tous facultatifs (absents si le bâtiment n'a pas d'équivalent IGN
 * ou si l'attribut y est inconnu) :
 *  g  1 si h est la hauteur mesurée par l'IGN (à l'égout du toit) ; sinon h vient d'OSM ou est estimée
 *  m, m2  matériau principal et secondaire des murs : 1 pierre, 2 meulière, 3 béton, 4 briques,
 *         5 aggloméré, 6 bois, 9 autres
 *  r  matériau principal du toit : 1 tuiles, 2 ardoises, 3 zinc ou aluminium, 4 béton, 9 autres
 *  y  décennie d'apparition (1930 = années 1930 ; les dates du cadastre sont arrondies)
 *  u, u2  usage principal et secondaire : h résidentiel, c commercial et services, i industriel,
 *         s sportif, a annexe, r religieux, g agricole (u « h » + u2 « c » : commerce sous des logements)
 *  lg 1 pour une construction légère (hangar, abri, auvent)
 */
export interface RawBuilding {
  p: number[]; h: number; l: number; t: string; pa?: number; n?: string;
  g?: number; m?: number; m2?: number; r?: number; y?: number; u?: string; u2?: string; lg?: number;
}
export interface MapFile {
  version: number; name: string; attribution: string;
  origin: { lat: number; lon: number };
  rect: { x0: number; z0: number; x1: number; z1: number };
  chunk: number;
  vertices: RawVertex[];
  edges: RawEdge[];
  restrictions: { kind: string; from: number; via: number; to: number }[];
  /** par dalle : chaussée (r), trottoirs (w), cœurs d'îlot (g), espaces verts et places (a) */
  chunks: Record<string, { r: RawPoly[]; w: RawPoly[]; g?: RawPoly[]; a?: (RawPoly & { k: string })[] }>;
  buildings: RawBuilding[];
  barriers: { k: string; h: number; p: number[] }[];
  areas: { k: string; x: number; z: number; n: string }[];
  lines: { k: string; p: number[]; n?: string }[];
  trees: [number, number, number, number, string][];
  lamps: [number, number][];
  /**
   * Points d'intérêt OpenStreetMap. k : shop, pharmacy, bus, metro, velib… ; n : nom ; t : type de
   * commerce ; b : enseigne de chaîne si elle diffère du nom ; sh : arrêt de bus abrité ; r : lignes de
   * bus (« 102;115 »). Métro : n est la station, s le nom de la sortie, l la ligne.
   * Commerces rattachés à une façade : fb indice du bâtiment, fi indice du mur (du sommet fi au
   * suivant), f0 et f1 portion du mur qui porte la devanture (m depuis le sommet fi).
   */
  pois: {
    k: string; x: number; z: number; n?: string; t?: string; b?: string; sh?: number; r?: string; s?: string; l?: string;
    fb?: number; fi?: number; f0?: number; f1?: number;
  }[];
}

// ───────────── Structures du réseau ─────────────
export type StripKind = 'L' | 'B' | 'C' | 'P';
export interface Strip {
  kind: StripKind;
  w: number;
  dir: 1 | -1 | 0;
  /** décalage du centre de la bande par rapport à l'axe (positif = à droite du sens a→b) */
  off: number;
  park?: string;
}

export type Control = 'none' | 'signal' | 'stop' | 'yield';
export type SignalState = 'green' | 'yellow' | 'red';
export type Turn = 'left' | 'right' | 'straight';

/** rayon des bordures aux carrefours (identique à celui de tools/build-map.mjs) */
export const KERB_R = 4.5;

export class Vertex {
  ends: EdgeEnd[] = [];
  sig = false; exit = false; dead = false;
  /** carrefour réel (au moins 3 branches) */
  junction = false;
  roundabout = false;
  controller: SignalController | null = null;
  /** rayon approximatif de la zone de carrefour */
  radius = 0;
  constructor(public id: number, public x: number, public z: number) {}
}

export class EdgeEnd {
  /** cap (radians, 0 = nord, sens horaire) de l'arête en quittant le sommet */
  heading = 0;
  /** direction unitaire en quittant le sommet */
  dx = 0; dz = 0;
  /** distance du sommet à l'embouchure du carrefour, le long de l'arête */
  trim = 0;
  /** régime de priorité pour le trafic qui ARRIVE au sommet par cette arête */
  control: Control = 'none';
  /** distance de la ligne d'arrêt au sommet (le long de l'arête) */
  stopDist = 0;
  controller: SignalController | null = null;
  group = 0;
  /** cette branche est intérieure à un grand carrefour à feux (pas de ligne d'arrêt) */
  internal = false;
  constructor(public edge: Edge, public atA: boolean, public vertex: Vertex) {}
  get other(): EdgeEnd { return this.atA ? this.edge.endB : this.edge.endA; }
  /** abscisse sur l'arête d'un point situé à `dist` du sommet */
  sAt(dist: number): number { return this.atA ? dist : this.edge.line.length - dist; }
  /** le trafic peut-il arriver au sommet par cette branche ? */
  get canArrive(): boolean { return this.atA ? this.edge.lanesB.length > 0 : this.edge.lanesF.length > 0; }
  get canLeave(): boolean { return this.atA ? this.edge.lanesF.length > 0 : this.edge.lanesB.length > 0; }
  get arriving(): Lane[] { return this.atA ? this.edge.lanesB : this.edge.lanesF; }
  get leaving(): Lane[] { return this.atA ? this.edge.lanesF : this.edge.lanesB; }
}

export class Crossing {
  controller: SignalController | null = null;
  group = 0;
  /** demi-longueur du passage dans le sens de la rue */
  halfLen = 1.75;
  x = 0; z = 0; tx = 1; tz = 0;
  constructor(public id: number, public edge: Edge, public s: number, public signalized: boolean, public marked: boolean, public raised: boolean) {
    const p = edge.line.at(s);
    this.x = p.x; this.z = p.z; this.tx = p.tx; this.tz = p.tz;
    this.halfLen = edge.width > 9 ? 2.0 : 1.5;
  }
}

export interface StopPoint {
  /** abscisse sur la voie (dans son sens de circulation) de la ligne d'arrêt */
  s: number;
  kind: 'signal' | 'stop' | 'yield' | 'crossing';
  controller?: SignalController;
  group?: number;
  crossing?: Crossing;
  /** point d'arrêt d'entrée de carrefour (sinon : en section courante) */
  atEnd: boolean;
}

export class Lane {
  links: LaneLink[] = [];
  inLinks: LaneLink[] = [];
  stops: StopPoint[] = [];
  left: Lane | null = null;
  right: Lane | null = null;
  constructor(
    public id: number, public edge: Edge, public dir: 1 | -1, public kind: 'L' | 'B' | 'C',
    /** rang depuis la gauche dans le sens de circulation (0 = voie la plus à gauche) */
    public index: number,
    /** décalage latéral du centre dans le repère de l'arête (positif = droite du sens a→b) */
    public off: number,
    public width: number,
    /** axe de la voie dans son sens de circulation, limité aux embouchures */
    public line: Polyline,
    /** abscisse sur l'arête du début de la voie (sens de circulation) */
    public s0: number,
  ) {}
  get from(): Vertex { return this.dir > 0 ? this.edge.a : this.edge.b; }
  get to(): Vertex { return this.dir > 0 ? this.edge.b : this.edge.a; }
  /** branche d'arrivée (au sommet `to`) */
  get endRef(): EdgeEnd { return this.dir > 0 ? this.edge.endB : this.edge.endA; }
  get startRef(): EdgeEnd { return this.dir > 0 ? this.edge.endA : this.edge.endB; }
  /** conversion abscisse voie → abscisse arête */
  /** longueur du tronçon d'axe couvert par la voie (entre les deux embouchures) */
  private get span(): number { return Math.max(0.01, this.edge.length - this.edge.endA.trim - this.edge.endB.trim); }
  /**
   * Abscisse de la voie → abscisse de l'axe de l'arête, et inversement. Dans une courbe, une voie décalée
   * n'a pas la longueur de l'axe : la correspondance se fait donc point à point (projection), et non par
   * simple décalage — sinon une ligne de feu au milieu d'une place se retrouvait plusieurs mètres trop loin.
   * Hors de la voie (avant son début, après sa fin), on prolonge linéairement.
   */
  toEdgeS(s: number): number {
    const L = this.line.length, d = this.dir;
    if (s <= 0) return this.s0 + d * s;
    if (s >= L) return this.s0 + d * (this.span + (s - L));
    const p = this.line.at(s);
    return this.edge.line.project(p.x, p.z).s;
  }
  fromEdgeS(es: number): number {
    const t = this.dir > 0 ? es - this.s0 : this.s0 - es; // distance le long de l'axe depuis le début de la voie
    const span = this.span;
    if (t <= 0) return t;
    if (t >= span) return this.line.length + (t - span);
    const p = this.edge.line.at(es);
    return this.line.project(p.x, p.z).s;
  }
}

export class LaneLink {
  conflicts: LaneLink[] = [];
  /** passages piétons franchis en sortie de carrefour : abscisse d'arrêt sur la liaison */
  exitCrossings: { crossing: Crossing; s: number }[] = [];
  constructor(
    public id: number, public from: Lane, public to: Lane, public vertex: Vertex,
    public line: Polyline, public turn: Turn,
    /** changement de cap signé (positif = vers la droite) */
    public angle: number,
  ) {}
}

export class Edge {
  endA!: EdgeEnd; endB!: EdgeEnd;
  strips: Strip[] = [];
  width = 0;
  /** voies dans le sens a→b puis b→a, voie de gauche en premier */
  lanesF: Lane[] = [];
  lanesB: Lane[] = [];
  allLanes: Lane[] = [];
  crossings: Crossing[] = [];
  features: RawFeature[];
  name: string; cls: string; oneway: boolean; limit: number; limitTagged: boolean;
  roundabout: boolean; link: boolean; dsc: boolean; bridge: boolean; paris: boolean; sett: boolean; living: boolean;
  /** au moins une ligne continue axiale (rue à double sens large) */
  constructor(public id: number, public a: Vertex, public b: Vertex, public line: Polyline, raw: RawEdge) {
    this.name = raw.n; this.cls = raw.c; this.oneway = !!raw.ow;
    this.roundabout = !!raw.rb; this.link = !!raw.lk; this.dsc = !!raw.dsc; this.bridge = !!raw.br;
    this.paris = !!raw.pa; this.sett = raw.sf === 'sett'; this.living = raw.c === 'living_street';
    this.features = raw.f ?? [];
    this.limitTagged = raw.ms > 0;
    // sans relevé : zone de rencontre à 20, sinon 30 (Paris et Montreuil sont des « villes 30 »)
    this.limit = raw.ms > 0 ? raw.ms : this.living ? 20 : 30;
    let off = 0;
    const W = raw.st.reduce((s, x) => s + x[1], 0);
    this.width = W;
    off = -W / 2;
    for (const st of raw.st) {
      this.strips.push({ kind: st[0] as StripKind, w: st[1], dir: st[2] as 1 | -1 | 0, off: off + st[1] / 2, park: st[3] });
      off += st[1];
    }
  }
  get length(): number { return this.line.length; }
  get half(): number { return this.width / 2; }
  end(v: Vertex): EdgeEnd { return v === this.a ? this.endA : this.endB; }
  /** bande située au décalage latéral d (repère de l'arête) ; null si hors chaussée */
  stripAt(d: number): Strip | null {
    for (const s of this.strips) if (d >= s.off - s.w / 2 && d <= s.off + s.w / 2) return s;
    return null;
  }
  /** décalage latéral de la séparation entre sens opposés (double sens), sinon bord gauche */
  get axisOffset(): number {
    let off = -this.width / 2;
    for (const s of this.strips) {
      if (s.dir === 1) return off;
      off += s.w;
    }
    return off;
  }
}

/** Contrôleur de feux d'un carrefour (ou d'un passage piéton en section). */
export class SignalController {
  ends: EdgeEnd[] = [];
  crossings: Crossing[] = [];
  vertices: Vertex[] = [];
  groups = 1;
  /** durées (s) */
  green: number[] = [26];
  yellow = 3;
  allRed = 2;
  /** phase piétonne seule (passage en section) */
  pedGreen = 0;
  cycle = 0;
  offset = 0;
  x = 0; z = 0;
  constructor(public id: number) {}

  finalize() {
    this.cycle = 0;
    for (let g = 0; g < this.groups; g++) this.cycle += this.green[g] + this.yellow + this.allRed;
    this.cycle += this.pedGreen;
    this.offset = (hash32('sig' + this.id) % 1000) / 1000 * this.cycle;
  }

  /** État du feu pour un groupe à l'instant t (s). */
  state(group: number, t: number): SignalState {
    let u = (t + this.offset) % this.cycle;
    for (let g = 0; g < this.groups; g++) {
      if (u < this.green[g]) return g === group ? 'green' : 'red';
      u -= this.green[g];
      if (u < this.yellow) return g === group ? 'yellow' : 'red';
      u -= this.yellow;
      if (u < this.allRed) return 'red';
      u -= this.allRed;
    }
    return 'red';
  }

  /** Temps restant (s) avant le prochain changement d'état pour ce groupe. */
  timeToChange(group: number, t: number): number {
    const cur = this.state(group, t);
    for (let dt = 0.25; dt < this.cycle + 1; dt += 0.25) if (this.state(group, t + dt) !== cur) return dt;
    return this.cycle;
  }

  /** Les piétons qui traversent la branche du groupe `group` ont-ils le vert ? */
  pedWalk(group: number, t: number): boolean {
    // vert piéton quand les voitures de ce groupe sont au rouge, sauf pendant les 5 dernières secondes
    if (this.state(group, t) !== 'red') return false;
    if (this.state(group, t + 5) !== 'red') return false;
    // pas de vert piéton pendant le rouge de dégagement qui suit le jaune de ce même groupe
    if (this.state(group, t - this.allRed - 0.1) === 'yellow') return false;
    return true;
  }
}

export interface Located {
  edge: Edge;
  /** abscisse sur l'arête */
  s: number;
  /** décalage latéral dans le repère de l'arête (positif = à droite du sens a→b) */
  d: number;
  /** distance au bord de chaussée (négatif = dans l'emprise) */
  dist: number;
  tx: number; tz: number;
}

const TURN_STRAIGHT = 0.5; // rad

export class RoadNet {
  vertices: Vertex[] = [];
  edges: Edge[] = [];
  lanes: Lane[] = [];
  links: LaneLink[] = [];
  crossings: Crossing[] = [];
  controllers: SignalController[] = [];
  private grid = new Map<number, Edge[]>();
  private cell = 40;
  rect: MapFile['rect'];

  constructor(public map: MapFile) {
    this.rect = map.rect;
    map.vertices.forEach((rv, i) => {
      const v = new Vertex(i, rv.x, rv.z);
      v.sig = !!rv.sig; v.exit = !!rv.exit; v.dead = !!rv.dead;
      this.vertices.push(v);
    });
    map.edges.forEach((re, i) => {
      const e = new Edge(i, this.vertices[re.a], this.vertices[re.b], new Polyline(re.p), re);
      e.endA = new EdgeEnd(e, true, e.a);
      e.endB = new EdgeEnd(e, false, e.b);
      e.a.ends.push(e.endA);
      e.b.ends.push(e.endB);
      this.edges.push(e);
    });
    this.computeEnds();
    this.buildCrossings();
    this.buildLanes();
    this.assignControls();
    this.buildLinks();
    this.buildGrid();
  }

  // ── Branches : caps, tri angulaire, embouchures ──
  private computeEnds() {
    for (const v of this.vertices) {
      for (const end of v.ends) {
        const L = end.edge.line;
        const d = Math.min(8, L.length * 0.5);
        const p = L.at(end.atA ? d : L.length - d);
        let dx = p.x - v.x, dz = p.z - v.z;
        const l = Math.hypot(dx, dz) || 1;
        end.dx = dx / l; end.dz = dz / l;
        end.heading = Math.atan2(end.dx, -end.dz);
      }
      v.ends.sort((p, q) => p.heading - q.heading);
      v.junction = v.ends.length >= 3;
      v.roundabout = v.ends.some((e) => e.edge.roundabout);
    }
    for (const v of this.vertices) {
      const n = v.ends.length;
      if (n < 3) { v.radius = n ? v.ends[0].edge.half : 3; continue; }
      for (let i = 0; i < n; i++) {
        const e = v.ends[i];
        let trim = 0;
        for (const j of [(i + 1) % n, (i + n - 1) % n]) {
          const o = v.ends[j];
          // angle entre les deux branches (0..π)
          const th = Math.abs(wrapAngle(o.heading - e.heading));
          if (th > 2.8) continue; // quasi alignées : pas de coin
          const s = Math.max(0.25, Math.sin(th));
          const d = (o.edge.half + e.edge.half * Math.cos(th)) / s;
          // la voie s'arrête au point de tangence de l'arrondi de bordure : le virage est alors
          // concentrique à la bordure et les roues arrière intérieures ne la coupent pas
          const fillet = KERB_R / Math.tan(Math.max(0.3, th / 2));
          trim = Math.max(trim, d + fillet);
        }
        e.trim = clamp(trim, 1.5, Math.min(26, e.edge.length * 0.45));
      }
      v.radius = Math.max(...v.ends.map((e) => e.trim));
    }
    // Sommets à deux branches où le profil en travers change : raccord progressif des voies
    const offsets = (e: Edge, dir: 1 | -1): number[] => {
      const o: number[] = [];
      for (const st of e.strips) if (st.kind === 'L' && st.dir === dir) o.push(st.off * dir);
      return o.sort((p, q) => p - q); // de gauche à droite dans le sens de circulation
    };
    for (const v of this.vertices) {
      if (v.ends.length !== 2) continue;
      const [a, b] = v.ends;
      let shift = 0;
      for (const [inE, outE] of [[a, b], [b, a]] as const) {
        const ins = offsets(inE.edge, inE.atA ? -1 : 1), outs = offsets(outE.edge, outE.atA ? 1 : -1);
        const n = ins.length, m = outs.length;
        if (!n || !m) continue;
        for (let i = 0; i < n; i++) shift = Math.max(shift, Math.abs(ins[i] - outs[n >= m ? Math.min(i, m - 1) : i + (m - n)]));
      }
      // changement de cap au passage du sommet
      const dev = Math.abs(wrapAngle(b.heading - (a.heading + Math.PI)));
      const need = Math.max(shift > 0.25 ? clamp(shift * 3.2, 2, 11) : 0, dev > 0.25 ? Math.min(9, 5.5 * Math.tan(dev / 2)) : 0);
      if (need > 0) {
        a.trim = Math.min(need, a.edge.length * 0.45);
        b.trim = Math.min(need, b.edge.length * 0.45);
      }
    }
  }

  private buildCrossings() {
    for (const e of this.edges) {
      for (const f of e.features) {
        if (f.k !== 'x' || !f.marked) continue;
        // on écarte les passages collés à un sommet d'extrémité de carte
        const c = new Crossing(this.crossings.length, e, f.s, !!f.sig, !!f.marked, !!f.table);
        e.crossings.push(c);
        this.crossings.push(c);
      }
    }
  }

  private buildLanes() {
    for (const e of this.edges) {
      const L = e.line;
      const sA = Math.min(e.endA.trim, L.length * 0.45);
      const sB = L.length - Math.min(e.endB.trim, L.length * 0.45);
      const fwd: Lane[] = [], back: Lane[] = [];
      for (const st of e.strips) {
        if (st.kind === 'P' || st.dir === 0) continue;
        const line = L.slice(sA, sB, st.off, st.dir < 0);
        const lane = new Lane(this.lanes.length, e, st.dir as 1 | -1, st.kind as 'L' | 'B' | 'C', 0, st.off, st.w, line, st.dir > 0 ? sA : sB);
        this.lanes.push(lane);
        e.allLanes.push(lane);
        if (st.kind !== 'L') continue;
        if (st.dir > 0) fwd.push(lane); else back.unshift(lane);
      }
      fwd.forEach((l, i) => { l.index = i; l.left = fwd[i - 1] ?? null; l.right = fwd[i + 1] ?? null; });
      back.forEach((l, i) => { l.index = i; l.left = back[i - 1] ?? null; l.right = back[i + 1] ?? null; });
      e.lanesF = fwd; e.lanesB = back;
    }
  }

  // ── Régimes de priorité, lignes d'arrêt, feux ──
  private assignControls() {
    const SIG_RANGE = 45;
    interface Mid { edge: Edge; s: number; dir: number; crossing?: Crossing }
    const mids: Mid[] = [];

    for (const e of this.edges) {
      const len = e.length;
      for (const f of e.features) {
        const dA = f.s, dB = len - f.s;
        const isSig = f.k === 'sig' || (f.k === 'x' && f.sig);
        if (f.k !== 'stop' && f.k !== 'yield' && !isSig) continue;
        const dir = f.dir ?? 0;
        // à quelle extrémité s'applique l'élément ?
        let target: EdgeEnd | null = null;
        if (dir > 0) target = dB <= SIG_RANGE || !isSig ? e.endB : null;
        else if (dir < 0) target = dA <= SIG_RANGE || !isSig ? e.endA : null;
        else if (Math.min(dA, dB) <= (isSig ? SIG_RANGE : 60)) target = dA < dB ? e.endA : e.endB;
        if (target && !target.canArrive) {
          // sens unique : l'élément ne peut concerner que l'autre extrémité si elle est proche
          const o = target.other;
          const dO = o.atA ? dA : dB;
          target = o.canArrive && dO <= 70 ? o : null;
        }
        if (target && (target.vertex.ends.length >= 3 || target.vertex.sig || !isSig)) {
          const dist = target.atA ? dA : dB;
          const kind: Control = isSig ? 'signal' : f.k === 'stop' ? 'stop' : 'yield';
          if (target.vertex.ends.length < 3 && !isSig) continue; // stop sans carrefour : ignoré
          this.setControl(target, kind, f.k === 'x' ? 0 : dist);
        } else if (isSig) {
          mids.push({ edge: e, s: f.s, dir, crossing: e.crossings.find((c) => Math.abs(c.s - f.s) < 12) });
        }
      }
    }

    for (const v of this.vertices) {
      if (v.ends.length < 3) continue;
      for (const end of v.ends) {
        if (!end.canArrive) continue;
        if (v.sig) this.setControl(end, 'signal', 0);
        else if (map_stop(v, this.map)) this.setControl(end, 'stop', 0);
        // entrée de giratoire : cédez-le-passage (panneau AB25 + AB3a)
        if (end.control === 'none' && v.roundabout && !end.edge.roundabout) this.setControl(end, 'yield', 0);
        // débouché d'une voie de desserte : cède le passage (R415-9)
        if (end.control === 'none' && end.edge.cls === 'service' && v.ends.some((o) => o.edge.cls !== 'service')) this.setControl(end, 'yield', 0);
      }
    }

    // Lignes d'arrêt : en amont de l'embouchure et du passage piéton éventuel
    for (const e of this.edges) {
      for (const end of [e.endA, e.endB]) {
        if (!end.canArrive) continue;
        let stop = end.trim + 0.4;
        for (const c of e.crossings) {
          const dc = end.atA ? c.s : e.length - c.s;
          // (un passage situé vers l'autre bout d'un tronçon court appartient au carrefour précédent)
          if (dc < end.trim + 16 && dc < e.length * 0.6) stop = Math.max(stop, dc + c.halfLen + 1.2);
        }
        // ligne reculée d'après la position du panneau dans OSM — sauf sur un tronçon court, où elle
        // se retrouverait à la sortie du carrefour précédent
        const usable = e.length - end.trim - end.other.trim;
        if (end.control !== 'none' && end.stopDist > stop && end.stopDist < stop + 9 && end.stopDist - end.trim < usable * 0.4) stop = end.stopDist;
        end.stopDist = Math.min(stop, Math.max(end.trim + 0.4, e.length - end.other.trim - 3));
      }
    }

    // Regroupement des sommets à feux proches en un même contrôleur
    const parent = new Map<Vertex, Vertex>();
    const find = (v: Vertex): Vertex => { let r = v; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(v, r); return r; };
    const sigVertices = this.vertices.filter((v) => v.ends.some((e) => e.control === 'signal'));
    for (const v of sigVertices) parent.set(v, v);
    for (const e of this.edges) {
      if (parent.has(e.a) && parent.has(e.b) && e.length < 38) parent.set(find(e.a), find(e.b));
    }
    const ctrlOf = new Map<Vertex, SignalController>();
    for (const v of sigVertices) {
      const root = find(v);
      let c = ctrlOf.get(root);
      if (!c) { c = new SignalController(this.controllers.length); this.controllers.push(c); ctrlOf.set(root, c); }
      c.vertices.push(v);
      v.controller = c;
    }
    for (const c of this.controllers) {
      c.x = c.vertices.reduce((s, v) => s + v.x, 0) / c.vertices.length;
      c.z = c.vertices.reduce((s, v) => s + v.z, 0) / c.vertices.length;
      const inside = new Set(c.vertices);
      for (const v of c.vertices) {
        for (const end of v.ends) {
          if (end.control !== 'signal') continue;
          // branche intérieure au carrefour : pas de feu
          if (inside.has(end.other.vertex) && end.edge.length < 38) { end.control = 'none'; end.internal = true; continue; }
          end.controller = c;
          c.ends.push(end);
        }
      }
      // Phases : deux groupes selon l'axe dominant
      if (c.ends.length) {
        const score = (e: EdgeEnd) => ({ primary: 5, secondary: 4, tertiary: 3 } as Record<string, number>)[e.edge.cls] ?? 1;
        const main = c.ends.reduce((a, b) => (score(b) * 10 + b.edge.width > score(a) * 10 + a.edge.width ? b : a));
        let hasB = false;
        for (const end of c.ends) {
          // cap d'arrivée = opposé du cap en quittant le sommet ; on compare modulo π
          let d = Math.abs(wrapAngle(end.heading - main.heading));
          if (d > Math.PI / 2) d = Math.PI - d;
          end.group = d < Math.PI / 4 ? 0 : 1;
          if (end.group === 1) hasB = true;
        }
        if (hasB) {
          c.groups = 2;
          const big = score(main) >= 4;
          c.green = [big ? 30 : 22, big ? 18 : 20];
          c.pedGreen = 0;
        } else {
          c.groups = 1; c.green = [34]; c.pedGreen = 14;
        }
      }
      c.finalize();
    }

    // Feux de passage piéton en section courante
    for (const m of mids) {
      const c = new SignalController(this.controllers.length);
      this.controllers.push(c);
      c.groups = 1; c.green = [38]; c.pedGreen = 13;
      const p = m.edge.line.at(m.s);
      c.x = p.x; c.z = p.z;
      c.finalize();
      const cross = m.crossing;
      if (cross) { cross.controller = c; cross.group = 0; cross.signalized = true; c.crossings.push(cross); }
      const es = cross ? cross.s : m.s;
      const half = cross ? cross.halfLen + 1.2 : 0.5;
      for (const lane of m.edge.allLanes) {
        if (lane.kind === 'C') continue;
        if (m.dir && m.dir !== lane.dir) continue;
        const s = lane.fromEdgeS(es) - half;
        if (s < 2 || s > lane.line.length - 1) continue;
        lane.stops.push({ s, kind: 'signal', controller: c, group: 0, atEnd: false });
      }
    }

    // Points d'arrêt sur les voies : fin de voie (carrefour) et passages piétons
    for (const e of this.edges) {
      for (const lane of e.allLanes) {
        if (lane.kind === 'C') continue;
        const end = lane.endRef;
        const sStop = lane.fromEdgeS(end.sAt(end.stopDist));
        if (end.control !== 'none') {
          lane.stops.push({ s: clamp(sStop, 0, lane.line.length), kind: end.control, controller: end.controller ?? undefined, group: end.group, atEnd: true });
        }
        for (const c of e.crossings) {
          const s = lane.fromEdgeS(c.s) - c.halfLen - 0.8;
          // un passage situé avant le début de la voie (sortie de carrefour) est rattaché aux liaisons
          if (s < -1) continue;
          // au-delà de la fin de voie : il est dans l'embouchure du carrefour, on s'arrête en bout de voie
          lane.stops.push({ s: clamp(s, 0, lane.line.length - 0.2), kind: 'crossing', crossing: c, atEnd: s > lane.line.length });
        }
        lane.stops.sort((p, q) => p.s - q.s);
      }
      // rattache les passages proches d'un carrefour à feux à son contrôleur
      for (const c of e.crossings) {
        if (c.controller) continue;
        for (const end of [e.endA, e.endB]) {
          const dc = end.atA ? c.s : e.length - c.s;
          const ctl = end.controller ?? (end.other.internal ? null : end.vertex.controller);
          if (ctl && dc < end.trim + 22) {
            c.controller = ctl; c.signalized = true;
            c.group = end.controller ? end.group : this.groupForHeading(ctl, end.heading);
            ctl.crossings.push(c);
            break;
          }
        }
        if (!c.controller) c.signalized = false;
      }
    }
  }

  private groupForHeading(c: SignalController, heading: number): number {
    let best = 0, bd = Infinity;
    for (const end of c.ends) {
      let d = Math.abs(wrapAngle(end.heading - heading));
      if (d > Math.PI / 2) d = Math.PI - d;
      if (d < bd) { bd = d; best = end.group; }
    }
    return best;
  }

  private setControl(end: EdgeEnd, kind: Control, dist: number) {
    const rank = { none: 0, yield: 1, stop: 2, signal: 3 } as const;
    if (rank[kind] < rank[end.control]) return;
    end.control = kind;
    if (dist > 0) end.stopDist = Math.max(end.stopDist, dist);
  }

  // ── Liaisons entre voies dans les carrefours ──
  private buildLinks() {
    const banned = new Set<string>();
    const only = new Map<string, number>();
    for (const r of this.map.restrictions) {
      if (r.kind.startsWith('no_')) banned.add(`${r.from}>${r.via}>${r.to}`);
      else if (r.kind.startsWith('only_')) only.set(`${r.from}>${r.via}`, r.to);
    }
    for (const v of this.vertices) {
      for (const inEnd of v.ends) {
        const ins = inEnd.arriving;
        if (!ins.length) continue;
        const n = ins.length;
        const inDirX = -inEnd.dx, inDirZ = -inEnd.dz; // sens de circulation en arrivant
        for (const outEnd of v.ends) {
          if (outEnd === inEnd) continue;
          if (outEnd.edge === inEnd.edge) continue; // boucle
          const outs = outEnd.leaving;
          if (!outs.length) continue;
          const key = `${inEnd.edge.id}>${v.id}`;
          if (banned.has(`${key}>${outEnd.edge.id}`)) continue;
          if (only.has(key) && only.get(key) !== outEnd.edge.id) continue;
          const m = outs.length;
          const cross = inDirX * outEnd.dz - inDirZ * outEnd.dx;
          const dot = inDirX * outEnd.dx + inDirZ * outEnd.dz;
          const ang = Math.atan2(cross, dot);
          if (Math.abs(ang) > 2.75 && v.ends.length > 2) continue; // demi-tour
          const turn: Turn = Math.abs(ang) < TURN_STRAIGHT ? 'straight' : ang > 0 ? 'right' : 'left';
          const pairs: [number, number][] = [];
          if (v.ends.length === 2 || turn === 'straight') {
            for (let i = 0; i < n; i++) pairs.push([i, n >= m ? Math.min(i, m - 1) : i + (m - n)]);
            // voies supplémentaires en sortie : la voie de gauche peut aussi s'y déporter
            if (m > n) for (let j = 0; j < m - n; j++) pairs.push([0, j]);
          } else if (turn === 'left') pairs.push([0, 0]);
          else pairs.push([n - 1, m - 1]);
          for (const [i, j] of pairs) this.addLink(ins[i], outs[j], v, turn, ang);
        }
      }
    }
    // conflits (croisements et convergences)
    for (const v of this.vertices) {
      const ls: LaneLink[] = [];
      for (const end of v.ends) for (const lane of end.arriving) for (const l of lane.links) ls.push(l);
      for (let i = 0; i < ls.length; i++) {
        for (let j = i + 1; j < ls.length; j++) {
          const a = ls[i], b = ls[j];
          if (a.from === b.from) continue;
          if (a.to === b.to || polylinesCross(a.line, b.line)) { a.conflicts.push(b); b.conflicts.push(a); }
        }
      }
    }
  }

  private addLink(from: Lane, to: Lane, v: Vertex, turn: Turn, ang: number) {
    if (from.links.some((l) => l.to === to)) return;
    const a = from.line.at(from.line.length);
    const b = to.line.at(0);
    const line = bezierLink(a.x, a.z, a.tx, a.tz, b.x, b.z, b.tx, b.tz, 0.8);
    const link = new LaneLink(this.links.length, from, to, v, line, turn, ang);
    for (const c of to.edge.crossings) {
      const s = to.fromEdgeS(c.s) - c.halfLen - 0.8; // négatif : avant le début de la voie d'arrivée
      if (s < -1 && s > -(to.startRef.trim + 4)) link.exitCrossings.push({ crossing: c, s: Math.max(0.5, line.length + s) });
    }
    this.links.push(link);
    from.links.push(link);
    to.inLinks.push(link);
  }

  // ── Index spatial ──
  private key(i: number, j: number) { return (i + 5000) * 10000 + (j + 5000); }
  private buildGrid() {
    const c = this.cell;
    for (const e of this.edges) {
      const L = e.line;
      const pad = e.half + 2;
      // on indexe par segment pour ne pas surcharger les cellules avec les longues arêtes courbes
      const seen = new Set<number>();
      for (let k = 0; k < L.n - 1; k++) {
        const x0 = Math.min(L.pts[k * 2], L.pts[k * 2 + 2]) - pad, x1 = Math.max(L.pts[k * 2], L.pts[k * 2 + 2]) + pad;
        const z0 = Math.min(L.pts[k * 2 + 1], L.pts[k * 2 + 3]) - pad, z1 = Math.max(L.pts[k * 2 + 1], L.pts[k * 2 + 3]) + pad;
        for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
          for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
            const key = this.key(i, j);
            if (seen.has(key)) continue;
            seen.add(key);
            let a = this.grid.get(key);
            if (!a) this.grid.set(key, (a = []));
            a.push(e);
          }
        }
      }
    }
  }

  /** Arêtes dont l'emprise peut contenir le point. */
  edgesNear(x: number, z: number): Edge[] {
    return this.grid.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? [];
  }

  /**
   * Arête la plus proche d'un point. Si un cap est fourni, on favorise l'arête alignée
   * (utile dans les carrefours) ; `prefer` ajoute une hystérésis sur l'arête courante.
   */
  locate(x: number, z: number, heading?: number, prefer?: Edge | null): Located | null {
    let best: Located | null = null;
    let bestScore = Infinity;
    const cand = this.edgesNear(x, z);
    for (const e of cand) {
      const p = e.line.project(x, z);
      // en bout d'arête la projection est écrasée sur le sommet : il faut la vraie distance, pas le seul écart latéral
      const clamped = p.s <= 0.01 || p.s >= e.length - 0.01;
      const dist = (clamped ? Math.hypot(x - p.x, z - p.z) : Math.abs(p.d)) - e.half;
      let score = Math.max(dist, -1.5);
      if (heading !== undefined) {
        const eh = Math.atan2(p.tx, -p.tz);
        let da = Math.abs(wrapAngle(heading - eh));
        const along = da <= Math.PI / 2;
        if (!along) da = Math.PI - da; // sens indifférent pour l'alignement
        score += da * 3.0;
        // deux chaussées à sens unique qui se recouvrent (grande place) : à égalité, le véhicule est sur
        // celle qui va dans son sens, pas à contresens sur l'autre
        if (e.oneway && !(along ? e.lanesF : e.lanesB).some((l) => l.kind !== 'C')) score += 2.0;
      }
      if (clamped) score += 1.0;
      if (e === prefer) score -= 1.2;
      if (score < bestScore) {
        bestScore = score;
        best = { edge: e, s: p.s, d: p.d, dist, tx: p.tx, tz: p.tz };
      }
    }
    return best;
  }

  /** Sommet de carrefour dont la zone contient le point (ou null). */
  junctionAt(loc: Located): Vertex | null {
    const e = loc.edge;
    if (loc.s < e.endA.trim && e.a.junction) return e.a;
    if (loc.s > e.length - e.endB.trim && e.b.junction) return e.b;
    return null;
  }
}

function map_stop(v: Vertex, map: MapFile): boolean {
  return !!map.vertices[v.id].stop;
}

function polylinesCross(a: Polyline, b: Polyline): boolean {
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ) return false;
  for (let i = 0; i < a.n - 1; i++) {
    const ax = a.pts[i * 2], az = a.pts[i * 2 + 1], bx = a.pts[i * 2 + 2], bz = a.pts[i * 2 + 3];
    for (let j = 0; j < b.n - 1; j++) {
      const cx = b.pts[j * 2], cz = b.pts[j * 2 + 1], dx = b.pts[j * 2 + 2], dz = b.pts[j * 2 + 3];
      const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
      if (d1 * d2 > 0) continue;
      const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
      const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
      if (d3 * d4 > 0) continue;
      if (d1 === 0 && d2 === 0) continue; // colinéaires
      return true;
    }
  }
  return false;
}
