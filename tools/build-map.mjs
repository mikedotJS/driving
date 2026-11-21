#!/usr/bin/env node
// Convertit les données OpenStreetMap brutes (data/osm-raw) en carte de jeu compacte
// (public/maps/montreuil.json) : graphe de rues avec profils en travers, signalisation,
// polygones de chaussée/trottoir par dalle, bâtiments, espaces verts, mobilier.
// Les commerces y sont rattachés au mur qui porte leur devanture, les bouches de métro à leur station.
//
// Données © les contributeurs d'OpenStreetMap (ODbL).
// Hauteurs, étages, matériaux et dates des bâtiments : IGN – BD TOPO (Licence Ouverte Etalab 2.0),
// reportés sur les emprises OSM quand data/ign-raw existe (tools/fetch-ign.sh).

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { loadOsm } from './lib/osm-load.mjs';
import { loadIgn, apparier } from './lib/ign.mjs';
import { rattacher, stationsDeMetro } from './lib/enseignes.mjs';
import * as G from './lib/geom.mjs';
import * as SOL from './lib/sol.mjs';
import { createRequire } from 'node:module';
const ClipperLib = createRequire(import.meta.url)('clipper-lib');

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ───────────────────────── Paramètres ─────────────────────────
const BBOX = { lon0: 2.405, lon1: 2.448, lat0: 48.85, lat1: 48.866 };
const LAT0 = (BBOX.lat0 + BBOX.lat1) / 2;
const LON0 = (BBOX.lon0 + BBOX.lon1) / 2;
const R_EARTH = 6378137;
const D2R = Math.PI / 180;
const KX = R_EARTH * D2R * Math.cos(LAT0 * D2R);
const KZ = R_EARTH * D2R;
const proj = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];

const MARGIN = 20; // on garde les rues jusqu'à 20 m au-delà de la zone téléchargée
const [X0, Z1] = proj(BBOX.lat0, BBOX.lon0);
const [X1, Z0] = proj(BBOX.lat1, BBOX.lon1);
const RECT = { x0: X0 - MARGIN, x1: X1 + MARGIN, z0: Z0 - MARGIN, z1: Z1 + MARGIN };
const CHUNK = 100; // m
const KERB_R = 4.5; // rayon de raccordement des bordures aux carrefours (m)
const MIN_SIDEWALK = 1.4;
const SCALE = 100; // clipper travaille en cm entiers

const r2 = (v) => Math.round(v * 100) / 100;

// ───────────────────────── Chargement ─────────────────────────
const { nodes, ways, relations, files } = loadOsm(new URL('../data/osm-raw', import.meta.url).pathname);
log(`OSM : ${files} tuiles, ${nodes.size} nœuds, ${ways.size} chemins, ${relations.size} relations`);

const nodeXZ = new Map(); // id -> [x, z]
for (const n of nodes.values()) nodeXZ.set(n.id, proj(n.lat, n.lon));
const inRect = (p) => p[0] >= RECT.x0 && p[0] <= RECT.x1 && p[1] >= RECT.z0 && p[1] <= RECT.z1;

// Limite Paris / banlieue : le boulevard périphérique (lon en fonction de lat)
const periph = [];
for (const w of ways.values()) {
  if (w.tags.highway === 'trunk' && /Périphérique/.test(w.tags.name ?? '')) {
    for (const id of w.nds) { const n = nodes.get(id); if (n) periph.push([n.lat, n.lon]); }
  }
}
periph.sort((a, b) => a[0] - b[0]);
function isParis(x, z) {
  if (!periph.length) return false;
  const lat = LAT0 - z / KZ, lon = LON0 + x / KX;
  // moyenne des longitudes du périph. autour de cette latitude
  let sum = 0, n = 0;
  for (const p of periph) if (Math.abs(p[0] - lat) < 0.0012) { sum += p[1]; n++; }
  if (!n) {
    let best = periph[0];
    for (const p of periph) if (Math.abs(p[0] - lat) < Math.abs(best[0] - lat)) best = p;
    return lon < best[1];
  }
  return lon < sum / n;
}

// ───────────────────────── Bâtiments, murs ─────────────────────────
function wayRing(w) {
  const pts = [];
  for (const id of w.nds) { const p = nodeXZ.get(id); if (p) pts.push(p); }
  if (pts.length >= 4 && G.dist(pts[0], pts[pts.length - 1]) < 0.01) pts.pop();
  return pts;
}

/** Assemble les chemins d'un rôle (« outer » par défaut) d'une relation multipolygone en anneaux. */
function relationRings(rel, inner = false) {
  const segs = [];
  for (const m of rel.members) {
    if (m.type !== 'way' || (inner ? m.role !== 'inner' : m.role !== 'outer' && m.role !== '')) continue;
    const w = ways.get(m.ref);
    if (!w) continue;
    segs.push(w.nds);
  }
  const rings = [];
  for (const ids of SOL.assembler(segs)) {
    const pts = ids.map((id) => nodeXZ.get(id)).filter(Boolean);
    if (pts.length >= 3) rings.push(pts);
  }
  return rings;
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rnd01 = (seed) => (hash32(String(seed)) % 100000) / 100000;

const buildings = [];
const obstacleGrid = new G.SegGrid(20);

function addBuilding(id, tags, ring) {
  if (ring.length < 3) return;
  if (tags.location === 'underground' || +tags.layer < 0) return;
  let pts = G.simplifyRing(ring, 0.15);
  let area = G.ringArea(pts);
  if (Math.abs(area) < 6) return;
  if (area < 0) { pts = pts.slice().reverse(); area = -area; }
  const c = G.ringCentroid(pts);
  if (!inRect(c)) return;
  const paris = isParis(c[0], c[1]);
  const kind = tags.building;
  const open = tags.wall === 'no' || kind === 'roof' || kind === 'carport';
  let levels = parseFloat(tags['building:levels']);
  let h = parseFloat(tags.height);
  // une hauteur ou un nombre de niveaux saisis dans OSM priment sur l'IGN (voir l'appariement plus bas)
  const tagged = levels > 0 || h > 0;
  const r = rnd01(id);
  if (!(levels > 0)) {
    if (h > 0) levels = Math.max(1, Math.round((h - 1) / 3));
    else if (open) levels = 1;
    else if (/^(garage|garages|shed|hut|kiosk|service|greenhouse)$/.test(kind)) levels = 1;
    else if (/^(industrial|warehouse|retail|supermarket|commercial)$/.test(kind)) levels = 1 + Math.floor(r * 2);
    else if (paris) levels = area < 60 ? 2 + Math.floor(r * 3) : 5 + Math.floor(r * 3);
    else if (area < 45) levels = 1;
    else if (area < 110) levels = 1 + Math.floor(r * 2.4);
    else if (area < 260) levels = 2 + Math.floor(r * 3.2);
    else if (area < 900) levels = 3 + Math.floor(r * 4);
    else levels = 4 + Math.floor(r * 5);
  }
  levels = Math.max(1, Math.min(30, Math.round(levels)));
  if (!(h > 0)) h = open ? 3.2 : levels * 2.95 + (levels >= 3 ? 1.2 : 0.6);
  let type = 'res';
  if (open) type = 'roof';
  else if (/^(church|chapel|cathedral|mosque|synagogue|temple)$/.test(kind)) type = 'church';
  else if (/^(industrial|warehouse|garage|garages|shed|hangar)$/.test(kind)) type = 'indus';
  else if (/^(retail|supermarket|commercial|office)$/.test(kind)) type = 'com';
  else if (/^(school|kindergarten|university|college|hospital|public|civic|government)$/.test(kind) || tags.amenity === 'school') type = 'pub';
  else if (/^(house|detached|semidetached_house|bungalow|terrace)$/.test(kind) || (!paris && levels <= 2 && area < 140)) type = 'house';
  buildings.push({ id, pts, h: r2(h), lv: levels, type, paris, area, name: tags.name, tagged });
  if (!open) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      obstacleGrid.add(a[0], a[1], b[0], b[1], 1);
    }
  }
}

for (const w of ways.values()) {
  if (w.tags.building && w.tags.building !== 'no') addBuilding('w' + w.id, w.tags, wayRing(w));
}
for (const rel of relations.values()) {
  if (rel.tags.type === 'multipolygon' && rel.tags.building && rel.tags.building !== 'no') {
    relationRings(rel).forEach((ring, i) => addBuilding(`r${rel.id}_${i}`, rel.tags, ring));
  }
}
log(`bâtiments : ${buildings.length}`);

const barriers = [];
for (const w of ways.values()) {
  const b = w.tags.barrier;
  if (!b || !/^(wall|fence|hedge|retaining_wall|guard_rail)$/.test(b)) continue;
  if (w.tags.highway || w.tags.building) continue;
  let pts = w.nds.map((id) => nodeXZ.get(id)).filter(Boolean);
  if (pts.length < 2) continue;
  if (!pts.some(inRect)) continue;
  pts = G.simplifyDP(pts, 0.15);
  const kind = b === 'retaining_wall' ? 'wall' : b === 'guard_rail' ? 'rail' : b;
  // une haie cartographiée comme une surface est un massif planté : son contour reste un obstacle,
  // mais il n'est plus dressé en mur (voir les espaces « massif »)
  const massif = b === 'hedge' && w.tags.area === 'yes' && w.nds.length >= 4 && w.nds[0] === w.nds[w.nds.length - 1];
  barriers.push({ kind: massif ? 'massif' : kind, pts, h: massif ? 0.5 : parseFloat(w.tags.height) || (kind === 'wall' ? 2.2 : kind === 'hedge' ? 1.5 : kind === 'rail' ? 0.8 : 1.7) });
  for (let i = 1; i < pts.length; i++) obstacleGrid.add(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 2);
}
log(`murs/clôtures : ${barriers.length}`);

// Les arbres d'alignement bornent aussi la chaussée (ils sont plantés sur le trottoir)
const treeGrid = new G.SegGrid(20);
for (const n of nodes.values()) {
  if (n.tags.natural !== 'tree') continue;
  const p = nodeXZ.get(n.id);
  treeGrid.add(p[0] - 0.05, p[1], p[0] + 0.05, p[1], 3);
}

// ───────────────────────── Sélection des rues carrossables ─────────────────────────
const DRIVE = new Set([
  'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'primary_link', 'secondary_link', 'tertiary_link', 'service',
]);
function drivable(w) {
  const t = w.tags;
  if (!DRIVE.has(t.highway)) return false;
  if (t.area === 'yes') return false;
  if (t.tunnel && t.tunnel !== 'no') return false;
  if (+t.layer < 0) return false;
  const acc = t.motor_vehicle ?? t.motorcar ?? t.vehicle ?? t.access;
  if (acc && /^(no|private|customers|permit|delivery|agricultural|forestry|emergency|military)$/.test(acc)) return false;
  if (t.highway === 'service') {
    if (t.service) return false;
    if (!t.name) return false;
  }
  return true;
}

function parseMaxspeed(t) {
  const m = /^(\d+)/.exec(t.maxspeed ?? '');
  if (m) return +m[1];
  if (/30/.test(t['zone:maxspeed'] ?? '')) return 30;
  if (/20/.test(t['zone:maxspeed'] ?? '')) return 20;
  return 0;
}

function parkingOf(v, orient) {
  if (v == null) return undefined; // inconnu
  if (/^(lane|street_side|yes|parallel|diagonal|perpendicular)$/.test(v)) {
    if (orient === 'diagonal' || v === 'diagonal') return 'diagonal';
    if (orient === 'perpendicular' || v === 'perpendicular') return 'perpendicular';
    return 'parallel';
  }
  return 'no';
}

/** Attributs normalisés d'un chemin, exprimés dans le sens du chemin OSM. */
function parseAttr(w) {
  const t = w.tags;
  const link = t.highway.endsWith('_link');
  const cls = t.highway.replace('_link', '');
  const roundabout = t.junction === 'roundabout' || t.junction === 'circular';
  let ow = 0;
  if (t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || roundabout) ow = 1;
  else if (t.oneway === '-1' || t.oneway === 'reverse') ow = -1;

  const bw = t.busway, bwl = t['busway:left'], bwr = t['busway:right'], bwb = t['busway:both'];
  const cl = t['cycleway:left'] ?? t['cycleway:both'] ?? t.cycleway;
  const cr = t['cycleway:right'] ?? t['cycleway:both'] ?? t.cycleway;
  const clContra = t['cycleway:left:oneway'] === '-1' || /^opposite/.test(cl ?? '');

  let busF = bwr === 'lane' || bwb === 'lane' || bw === 'lane' || cr === 'share_busway';
  let busB = false;
  if (ow) {
    busB = bw === 'opposite_lane' || bwl === 'opposite_lane' || cl === 'opposite_share_busway' || (cl === 'share_busway' && (clContra || bwl === 'lane'));
  } else {
    busB = bwl === 'lane' || bwb === 'lane' || cl === 'share_busway';
  }
  let cycR = cr === 'lane';
  let cycL = false;
  if (ow) cycL = (cl === 'lane' && (clContra || t['oneway:bicycle'] === 'no')) || cl === 'opposite_lane';
  else cycL = cl === 'lane';
  if (busF) cycR = false;
  if (busB) cycL = false;
  const dsc = !!ow && (t['oneway:bicycle'] === 'no' || /^opposite/.test(t.cycleway ?? '') || /^opposite/.test(cl ?? '') || cycL);

  let total = parseInt(t.lanes) || 0;
  let lf = parseInt(t['lanes:forward']) || 0;
  let lb = parseInt(t['lanes:backward']) || 0;
  let nF, nB;
  if (ow) {
    if (!total) total = 1 + (busB ? 1 : 0) + (busF && cls !== 'residential' ? 1 : 0);
    nF = Math.max(1, total - (busB ? 1 : 0) - (busF ? 1 : 0));
    nB = 0;
  } else {
    if (!total) total = Math.max(2, lf + lb);
    if (!lf && !lb) { lb = Math.floor(total / 2); lf = total - lb; }
    else if (!lf) lf = Math.max(1, total - lb);
    else if (!lb) lb = Math.max(1, total - lf);
    nF = Math.max(1, lf - (busF ? 1 : 0));
    nB = Math.max(1, lb - (busB ? 1 : 0));
  }
  nF = Math.min(nF, 4); nB = Math.min(nB, 4);

  const pb = t['parking:both'] ?? t['parking:lane:both'];
  const parkL = parkingOf(t['parking:left'] ?? t['parking:lane:left'] ?? pb, t['parking:left:orientation'] ?? t['parking:both:orientation']);
  const parkR = parkingOf(t['parking:right'] ?? t['parking:lane:right'] ?? pb, t['parking:right:orientation'] ?? t['parking:both:orientation']);

  let width = parseFloat(t.width);
  if (!(width > 2)) width = 0;

  return {
    name: t.name ?? '', cls, link, roundabout, ow, ms: parseMaxspeed(t),
    nF, nB, busF, busB, cycR, cycL, dsc, parkL, parkR, width,
    living: cls === 'living_street', bridge: !!t.bridge && t.bridge !== 'no',
    surface: /sett|cobble|paving_stones/.test(t.surface ?? '') ? 'sett' : 'asphalt',
    turn: t['turn:lanes'] ?? '',
  };
}
function reverseAttr(a) {
  return { ...a, ow: -a.ow, nF: a.nB, nB: a.nF, busF: a.busB, busB: a.busF, cycR: a.cycL, cycL: a.cycR, parkL: a.parkR, parkR: a.parkL, turn: '' };
}
const sigOf = (a) => JSON.stringify([a.name, a.cls, a.link, a.roundabout, a.ow, a.ms, a.nF, a.nB, a.busF, a.busB, a.cycR, a.cycL, a.dsc, a.parkL, a.parkR, a.width, a.living, a.bridge, a.surface]);

// Découpe d'un chemin par le rectangle de la carte → portions conservées
let synth = 0;
function clipIds(w) {
  const runs = [];
  let cur = null;
  const ids = w.nds.filter((id) => nodeXZ.has(id));
  const cut = (pIn, pOut) => {
    // point de sortie du rectangle sur le segment pIn→pOut
    let t = 1;
    const dx = pOut[0] - pIn[0], dz = pOut[1] - pIn[1];
    if (dx > 0) t = Math.min(t, (RECT.x1 - pIn[0]) / dx);
    if (dx < 0) t = Math.min(t, (RECT.x0 - pIn[0]) / dx);
    if (dz > 0) t = Math.min(t, (RECT.z1 - pIn[1]) / dz);
    if (dz < 0) t = Math.min(t, (RECT.z0 - pIn[1]) / dz);
    t = Math.max(0, Math.min(1, t));
    const id = `c${synth++}`;
    nodeXZ.set(id, [pIn[0] + dx * t, pIn[1] + dz * t]);
    exitNodes.add(id);
    return id;
  };
  for (let i = 0; i < ids.length; i++) {
    const p = nodeXZ.get(ids[i]);
    const inside = inRect(p);
    if (inside) {
      if (!cur) {
        cur = [];
        if (i > 0) cur.push(cut(p, nodeXZ.get(ids[i - 1])));
      }
      cur.push(ids[i]);
    } else if (cur) {
      cur.push(cut(nodeXZ.get(ids[i - 1]), p));
      if (cur.length >= 2) runs.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length >= 2) runs.push(cur);
  return runs;
}

const exitNodes = new Set();
const runs = [];
for (const w of ways.values()) {
  if (!drivable(w)) continue;
  for (const ids of clipIds(w)) runs.push({ w, ids });
}
log(`chemins carrossables : ${runs.length} portions`);

// Sommets du graphe
const use = new Map();
for (const { ids } of runs) {
  ids.forEach((id, i) => use.set(id, (use.get(id) ?? 0) + (i === 0 || i === ids.length - 1 ? 2 : 1)));
}
const isVertex = (id) => (use.get(id) ?? 0) >= 2;

let edges = [];
let edgeSeq = 0;
for (const { w, ids } of runs) {
  const base = parseAttr(w);
  let start = 0;
  for (let i = 1; i < ids.length; i++) {
    if (!isVertex(ids[i]) && i < ids.length - 1) continue;
    let seg = ids.slice(start, i + 1);
    start = i;
    if (seg.length < 2) continue;
    const mk = (s) => {
      let attr = base, sg = s.map(() => 1), nid = s;
      if (attr.ow === -1) { nid = s.slice().reverse(); sg = sg.map(() => -1); attr = reverseAttr(attr); }
      edges.push({ id: edgeSeq++, a: nid[0], b: nid[nid.length - 1], ids: nid, sg, attr, ways: new Set([w.id]) });
    };
    if (seg[0] === seg[seg.length - 1] && seg.length >= 4) {
      // boucle : on coupe en deux
      const mid = Math.floor(seg.length / 2);
      use.set(seg[mid], 2);
      mk(seg.slice(0, mid + 1)); mk(seg.slice(mid));
    } else mk(seg);
  }
}
log(`arêtes brutes : ${edges.length}`);

const coords = (e) => e.ids.map((id) => nodeXZ.get(id));
const rawLen = (e) => G.polyLen(coords(e));

function incidence() {
  const inc = new Map();
  for (const e of edges) {
    for (const v of [e.a, e.b]) { let a = inc.get(v); if (!a) inc.set(v, (a = [])); a.push(e); }
  }
  return inc;
}

// Composante connexe principale
{
  const inc = incidence();
  const seen = new Map();
  let comp = 0; const sizes = [];
  for (const v of inc.keys()) {
    if (seen.has(v)) continue;
    let size = 0; const st = [v]; seen.set(v, comp);
    while (st.length) {
      const u = st.pop(); size++;
      for (const e of inc.get(u)) { const o = e.a === u ? e.b : e.a; if (!seen.has(o)) { seen.set(o, comp); st.push(o); } }
    }
    sizes.push(size); comp++;
  }
  const main = sizes.indexOf(Math.max(...sizes));
  const before = edges.length;
  edges = edges.filter((e) => seen.get(e.a) === main);
  log(`composante principale : ${edges.length}/${before} arêtes (${sizes.length} composantes)`);
}

// Élagage des moignons très courts (restes de voies exclues)
for (let pass = 0; pass < 4; pass++) {
  const inc = incidence();
  const before = edges.length;
  edges = edges.filter((e) => {
    const da = inc.get(e.a).length, db = inc.get(e.b).length;
    const dead = (da === 1 && !exitNodes.has(e.a)) || (db === 1 && !exitNodes.has(e.b));
    return !(dead && rawLen(e) < 14);
  });
  if (edges.length === before) break;
}

// Fusion des sommets de degré 2 quand les attributs sont identiques
function reverseEdge(e) {
  e.ids.reverse(); e.sg = e.sg.reverse().map((s) => -s);
  [e.a, e.b] = [e.b, e.a];
  e.attr = reverseAttr(e.attr);
}
{
  let merged = 0, changed = true;
  while (changed) {
    changed = false;
    const inc = incidence();
    for (const [v, list] of inc) {
      if (list.length !== 2) continue;
      let [e1, e2] = list;
      if (e1 === e2 || e1.dead || e2.dead) continue;
      if (e1.a === e1.b || e2.a === e2.b) continue;
      // orienter : e1 arrive en v, e2 part de v
      if (e1.a === v && e2.b === v) [e1, e2] = [e2, e1];
      else if (e1.b === v && e2.b === v) { if (e2.attr.ow) continue; reverseEdge(e2); }
      else if (e1.a === v && e2.a === v) { if (e1.attr.ow) continue; reverseEdge(e1); }
      if (!(e1.b === v && e2.a === v)) continue;
      if (sigOf(e1.attr) !== sigOf(e2.attr)) continue;
      if (e1.a === e2.b) continue; // éviterait de créer une boucle
      e1.ids = e1.ids.concat(e2.ids.slice(1));
      e1.sg = e1.sg.concat(e2.sg.slice(1));
      e1.b = e2.b;
      for (const wid of e2.ways) e1.ways.add(wid);
      if (!e1.attr.turn) e1.attr = { ...e1.attr, turn: e2.attr.turn };
      e2.dead = true; merged++; changed = true;
      break;
    }
    edges = edges.filter((e) => !e.dead);
  }
  log(`fusion degré 2 : ${merged} fusions → ${edges.length} arêtes`);
}

// ───────────────────────── Géométrie et éléments le long des arêtes ─────────────────────────
function nodeFeature(id, sign) {
  const n = nodes.get(id);
  if (!n) return null;
  const t = n.tags;
  const dirTag = t['traffic_signals:direction'] ?? t.direction;
  const dir = dirTag === 'forward' ? sign : dirTag === 'backward' ? -sign : 0;
  if (t.highway === 'traffic_signals') return { k: 'sig', dir };
  if (t.highway === 'stop') return { k: 'stop', dir };
  if (t.highway === 'give_way') return { k: 'yield', dir };
  if (t.highway === 'crossing' || t.crossing) {
    const sig = t.crossing === 'traffic_signals' || t['crossing:signals'] === 'yes';
    const marked = !(t.crossing === 'unmarked' || t.crossing === 'informal' || t.crossing === 'no' || t['crossing:markings'] === 'no');
    return { k: 'x', sig: sig ? 1 : 0, marked: marked ? 1 : 0, table: t.traffic_calming === 'table' ? 1 : 0 };
  }
  if (t.traffic_calming && /^(bump|hump|table|cushion)$/.test(t.traffic_calming)) return { k: 'bump', sub: t.traffic_calming };
  if (t.highway === 'speed_camera') return { k: 'radar', dir };
  return null;
}

for (const e of edges) {
  const raw = coords(e);
  let pts = G.roundCorners(raw, e.attr.roundabout ? 4 : 8);
  pts = G.simplifyDP(pts, 0.025);
  e.pts = pts;
  e.len = G.polyLen(pts);
  e.feat = [];
  for (let i = 1; i < e.ids.length - 1; i++) {
    const f = nodeFeature(e.ids[i], e.sg[i]);
    if (!f) continue;
    const p = nodeXZ.get(e.ids[i]);
    f.s = r2(G.projectOnPolyline(pts, p).s);
    e.feat.push(f);
  }
  e.feat.sort((a, b) => a.s - b.s);
  const mid = G.pointAt(pts, e.len / 2);
  e.paris = isParis(mid.x, mid.z);
}

// ───────────────────────── Profils en travers ─────────────────────────
const LANE_W = { primary: 3.2, secondary: 3.2, tertiary: 3.0, unclassified: 2.9, residential: 2.85, living_street: 2.7, service: 2.8 };
const PARK_W = { parallel: 2.0, diagonal: 4.4, perpendicular: 5.0 };
let autoPark = 0;

function designStrips(e) {
  const A = e.attr;
  // dégagement latéral jusqu'aux façades / murs
  const cl = [], cr = [], tl = [], tr = [];
  const step = Math.max(3, e.len / 40);
  for (let s = Math.min(6, e.len / 2); s <= e.len - Math.min(6, e.len / 2) + 1e-6; s += step) {
    const p = G.pointAt(e.pts, s);
    const c = obstacleGrid.clearance(p.x, p.z, p.tx, p.tz, 26);
    cl.push(c.left); cr.push(c.right);
    const t = treeGrid.clearance(p.x, p.z, p.tx, p.tz, 26);
    tl.push(t.left); tr.push(t.right);
  }
  const pct = (a, q = 0.12) => { if (!a.length) return 26; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length * q)]; };
  const cL = pct(cl), cR = pct(cr);
  // arbres : ponctuels, donc on prend un quantile plus haut parmi les échantillons proches d'un arbre
  const nearT = (a) => { const b = a.filter((d) => d < 25); return b.length >= 3 ? pct(b, 0.25) : 26; };
  const tL = nearT(tl), tR = nearT(tr);
  e.clearL = cL; e.clearR = cR;
  // demi-largeur maximale : façades (trottoir mini) et pieds d'arbres
  const H = Math.min(cL - MIN_SIDEWALK, cR - MIN_SIDEWALK, tL - 0.7, tR - 0.7);
  const Hpark = Math.min(cL - 2.1, cR - 2.1, tL - 0.7, tR - 0.7); // pour le stationnement « deviné »
  const bounded = Math.min(cL, cR, tL, tR) < 25;

  const lanesTotal = A.nF + A.nB;
  let lw = LANE_W[A.cls] ?? 3.0;
  if (A.ow && lanesTotal === 1) lw = A.living ? 3.2 : 3.4;
  if (A.roundabout) lw = lanesTotal === 1 ? 5.5 : 3.6;
  if (A.link) lw = Math.max(lw, 3.4);
  const busW = 3.3, cycW = 1.5;
  let nBus = (A.busF ? 1 : 0) + (A.busB ? 1 : 0);
  let cycL = A.cycL, cycR = A.cycR;
  let nCyc = (cycR ? 1 : 0) + (cycL ? 1 : 0);
  const travel = () => lanesTotal * lw + nBus * busW + nCyc * cycW;

  let pL = A.parkL, pR = A.parkR;
  const noAuto = A.living || A.roundabout || A.link || A.bridge || A.cls === 'service' || e.len < 25;
  const contra = A.ow && (A.busB || cycL);
  let wL = pL && pL !== 'no' ? PARK_W[pL] : 0;
  let wR = pR && pR !== 'no' ? PARK_W[pR] : 0;
  const autoL = pL === undefined && !noAuto && !contra;
  const autoR = pR === undefined && !noAuto;

  if (A.width) {
    // largeur relevée : on répartit ; si tout ne tient pas, on renonce d'abord à la bande cyclable
    if (A.width - travel() - wL - wR < -0.3 && nCyc) { cycL = false; cycR = false; nCyc = 0; }
    let rem = A.width - travel() - wL - wR;
    if (rem >= 1.9 && autoR && !wR) { wR = 2.0; rem -= 2.0; pR = 'parallel'; }
    if (rem >= 1.9 && autoL && !wL) { wL = 2.0; rem -= 2.0; pL = 'parallel'; }
    if (rem > 0) lw += Math.min(0.7, rem / lanesTotal);
    else if (rem < 0) lw = Math.max(lanesTotal === 1 ? 2.9 : 2.6, lw + rem / lanesTotal);
  } else if (bounded) {
    let avail = 2 * Hpark - travel() - wL - wR;
    // stationnement « deviné » si la rue est assez large entre façades
    const firstRight = hash32(A.name || String(e.id)) % 3 !== 0;
    const tryAdd = (side) => {
      if (side === 'R' && autoR && !wR && avail >= 2.0) { wR = 2.0; pR = 'parallel'; avail -= 2.0; autoPark++; }
      if (side === 'L' && autoL && !wL && avail >= 2.0) { wL = 2.0; pL = 'parallel'; avail -= 2.0; autoPark++; }
    };
    if (firstRight) { tryAdd('R'); tryAdd('L'); } else { tryAdd('L'); tryAdd('R'); }
    if (avail > 1.2 && lanesTotal <= 2) lw += Math.min(0.35, (avail - 1.2) / lanesTotal);
  } else if (!noAuto) {
    // pas de façades à proximité : valeurs par défaut
    if (autoR && !wR && (A.cls === 'residential' || A.cls === 'unclassified' || A.cls === 'tertiary')) { wR = 2.0; pR = 'parallel'; }
  }

  // respect du couloir disponible
  if (bounded) {
    let W = travel() + wL + wR;
    // rue trop étroite pour tout loger : on renonce d'abord à la bande cyclable matérialisée
    if (travel() > 2 * H && nCyc && lanesTotal * 2.9 + nBus * busW <= 2 * H + 0.4) { cycL = false; cycR = false; nCyc = 0; }
    const maxW = Math.max(2 * H, lanesTotal * (lanesTotal === 1 ? 2.9 : 2.6) + nBus * 3.0 + nCyc * 1.2);
    if (W > maxW && wL) { W -= wL; wL = 0; }
    if (W > maxW && wR) { W -= wR; wR = 0; }
    if (W > maxW) {
      const over = W - maxW;
      lw = Math.max(lanesTotal === 1 ? 2.9 : 2.6, lw - over / lanesTotal);
    }
  }

  const strips = [];
  if (wL) strips.push(['P', r2(wL), 0, pL]);
  if (cycL) strips.push(['C', cycW, -1]);
  if (A.busB) strips.push(['B', busW, -1]);
  for (let i = 0; i < A.nB; i++) strips.push(['L', r2(lw), -1]);
  for (let i = 0; i < A.nF; i++) strips.push(['L', r2(lw), 1]);
  if (A.busF) strips.push(['B', busW, 1]);
  if (cycR) strips.push(['C', cycW, 1]);
  if (wR) strips.push(['P', r2(wR), 0, pR]);
  e.strips = strips;
  e.width = r2(strips.reduce((s, x) => s + x[1], 0));
}
for (const e of edges) designStrips(e);
log(`profils en travers calculés (stationnement déduit sur ${autoPark} côtés)`);

// ───────────────────────── Sommets ─────────────────────────
const vIndex = new Map();
const vertices = [];
function vid(id) {
  let i = vIndex.get(id);
  if (i === undefined) {
    i = vertices.length; vIndex.set(id, i);
    const p = nodeXZ.get(id);
    const n = nodes.get(id);
    const v = { x: r2(p[0]), z: r2(p[1]) };
    if (n) {
      const t = n.tags;
      if (t.highway === 'traffic_signals') v.sig = 1;
      if (t.highway === 'crossing' || t.crossing) { v.xing = 1; if (t.crossing === 'traffic_signals' || t['crossing:signals'] === 'yes') v.sig = 1; }
      if (t.highway === 'stop') v.stop = 1;
      if (t.highway === 'give_way') v.yield = 1;
      if (t.highway === 'mini_roundabout') v.mini = 1;
    }
    if (exitNodes.has(id)) v.exit = 1;
    vertices.push(v);
  }
  return i;
}
edges.forEach((e, i) => { e.idx = i; e.ia = vid(e.a); e.ib = vid(e.b); });
const deg = new Array(vertices.length).fill(0);
for (const e of edges) { deg[e.ia]++; deg[e.ib]++; }
vertices.forEach((v, i) => { if (deg[i] === 1 && !v.exit) v.dead = 1; });

// Interdictions de tourner
const restrictions = [];
{
  const byWay = new Map();
  for (const e of edges) for (const w of e.ways) { let a = byWay.get(w); if (!a) byWay.set(w, (a = [])); a.push(e); }
  for (const rel of relations.values()) {
    if (rel.tags.type !== 'restriction' || !rel.tags.restriction) continue;
    const from = rel.members.find((m) => m.role === 'from' && m.type === 'way');
    const to = rel.members.find((m) => m.role === 'to' && m.type === 'way');
    const via = rel.members.find((m) => m.role === 'via' && m.type === 'node');
    if (!from || !to || !via || !vIndex.has(via.ref)) continue;
    const v = vIndex.get(via.ref);
    const ef = (byWay.get(from.ref) ?? []).find((e) => e.ia === v || e.ib === v);
    const et = (byWay.get(to.ref) ?? []).find((e) => (e.ia === v || e.ib === v) && e !== ef) ?? (from.ref === to.ref ? ef : null);
    if (ef && et) restrictions.push({ kind: rel.tags.restriction, from: ef.idx, via: v, to: et.idx });
  }
}
log(`sommets : ${vertices.length}, arêtes : ${edges.length}, interdictions de tourner : ${restrictions.length}`);

// ───────────────────────── Chaussée : union des emprises ─────────────────────────
const C = ClipperLib;
const toPath = (pts) => pts.map((q) => ({ X: Math.round(q[0] * SCALE), Y: Math.round(q[1] * SCALE) }));
const ARC_TOL = 2.5; // cm
function bufferLine(pts, half) {
  const co = new C.ClipperOffset(2, ARC_TOL);
  co.AddPath(toPath(pts), C.JoinType.jtRound, C.EndType.etOpenRound);
  const out = new C.Paths(); co.Execute(out, half * SCALE); return out;
}
function inflate(paths, d) {
  const co = new C.ClipperOffset(2, ARC_TOL);
  co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const out = new C.Paths(); co.Execute(out, d * SCALE); return out;
}
const NZ = C.PolyFillType.pftNonZero;
function boolOp(type, subj, clip) {
  const c = new C.Clipper();
  c.AddPaths(subj, C.PolyType.ptSubject, true);
  if (clip) c.AddPaths(clip, C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(type, out, NZ, NZ);
  return out;
}
/** Opération booléenne → liste de polygones à trous {outer, holes}. */
function boolEx(type, subj, clip) {
  const c = new C.Clipper();
  c.AddPaths(subj, C.PolyType.ptSubject, true);
  if (clip) c.AddPaths(clip, C.PolyType.ptClip, true);
  const tree = new C.PolyTree();
  c.Execute(type, tree, NZ, NZ);
  return C.JS.PolyTreeToExPolygons(tree);
}
const UNION = C.ClipType.ctUnion, INTER = C.ClipType.ctIntersection, DIFF = C.ClipType.ctDifference;
const areaM2 = (paths) => paths.reduce((s, p) => s + C.Clipper.Area(p), 0) / (SCALE * SCALE);
const nVerts = (paths) => paths.reduce((s, p) => s + p.length, 0);
function circle(cx, cz, rad, n = 40) {
  const p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]); }
  return toPath(p);
}

let road;
{
  let all = [];
  for (const e of edges) all = all.concat(bufferLine(e.pts, e.width / 2));
  // Changement de largeur entre deux tronçons qui se prolongent (y compris à une fourche) : biseau
  // progressif côté étroit, sinon la bordure fait une marche en travers des voies qui se décalent
  const bends = []; // sommets à deux branches formant un coude : coin intérieur à arrondir
  {
    const at = new Map();
    edges.forEach((e) => { for (const i of [e.ia, e.ib]) { let a = at.get(i); if (!a) at.set(i, (a = [])); a.push({ e, pts: e.ia === i ? e.pts : e.pts.slice().reverse() }); } });
    const hull = (P) => {
      const p = P.slice().sort((u, w) => u[0] - w[0] || u[1] - w[1]);
      const cr = (o, u, w) => (u[0] - o[0]) * (w[1] - o[1]) - (u[1] - o[1]) * (w[0] - o[0]);
      const lo = [], up = [];
      for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
      for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    let tapers = 0;
    for (const [i, list] of at) {
      if (list.length < 2) continue;
      // direction de chaque branche en quittant le sommet
      for (const en of list) {
        const a = en.pts[0], b = en.pts[1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        en.dx = (b[0] - a[0]) / l; en.dz = (b[1] - a[1]) / l;
      }
      if (list.length === 2 && list[0].e !== list[1].e && list[0].dx * list[1].dx + list[0].dz * list[1].dz > -0.95) bends.push(i);
      for (const wide of list) for (const narrow of list) {
        if (wide.e === narrow.e) continue;
        const dh = (wide.e.width - narrow.e.width) / 2;
        if (dh < 0.3) continue;
        if (wide.dx * narrow.dx + wide.dz * narrow.dz > -0.64) continue; // pas dans le prolongement
        const pts = narrow.pts;
        let len = 0;
        for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        const T = Math.min(Math.max(4, dh * 3.2 + 3), 12.5, len * 0.45);
        const pT = G.pointAt(pts, T);
        const ax = -wide.dx, az = -wide.dz; // sens d'arrivée par le tronçon large
        const hA = wide.e.width / 2, hB = narrow.e.width / 2;
        const v = pts[0];
        const quad = toPath(hull([[v[0] - az * hA, v[1] + ax * hA], [pT.x - pT.tz * hB, pT.z + pT.tx * hB], [pT.x + pT.tz * hB, pT.z - pT.tx * hB], [v[0] + az * hA, v[1] - ax * hA]]));
        // même sens que les autres emprises, sinon l'union (règle « non nul ») creuserait un trou
        if (!C.Clipper.Orientation(quad)) quad.reverse();
        all.push(quad);
        tapers++;
      }
    }
    log(`biseaux de changement de largeur : ${tapers}, coudes à arrondir : ${bends.length}`);
  }
  let U = boolOp(UNION, all, null);
  log(`union chaussée : ${U.length} anneaux, ${nVerts(U)} sommets, ${(areaM2(U) / 1e4).toFixed(1)} ha`);
  // fermeture morphologique limitée au voisinage des carrefours → bordures arrondies
  const closed = inflate(inflate(U, KERB_R), -KERB_R);
  log('fermeture morphologique calculée');
  const discs = [];
  const maxHalf = new Array(vertices.length).fill(0);
  for (const e of edges) { maxHalf[e.ia] = Math.max(maxHalf[e.ia], e.width / 2); maxHalf[e.ib] = Math.max(maxHalf[e.ib], e.width / 2); }
  vertices.forEach((v, i) => {
    if (deg[i] < 3 && !bends.includes(i)) return;
    discs.push(circle(v.x, v.z, maxHalf[i] + KERB_R * 2.2 + 1.5));
  });
  const fill = boolOp(INTER, closed, boolOp(UNION, discs, null));
  U = boolOp(UNION, U.concat(fill), null);
  // nettoyage : petits trous et éclats
  let dropped = 0;
  const cleaned = U.filter((p) => { const a = Math.abs(C.Clipper.Area(p)) / (SCALE * SCALE); if (a < 7) { dropped++; return false; } return true; });
  // un trou supprimé = on le rebouche : il suffit de retirer l'anneau négatif
  road = boolOp(UNION, C.Clipper.CleanPolygons(cleaned, 1.2), null);
  log(`chaussée finale : ${road.length} anneaux, ${nVerts(road)} sommets, ${(areaM2(road) / 1e4).toFixed(1)} ha (${dropped} éclats supprimés)`);
}

// Bâtiments qui empiètent largement sur la chaussée → supprimés
{
  let removed = 0;
  const cells = new Map();
  for (const b of buildings) {
    const c = G.ringCentroid(b.pts);
    const k = `${Math.floor(c[0] / 200)},${Math.floor(c[1] / 200)}`;
    let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(b);
  }
  for (const [k, list] of cells) {
    const [ci, cj] = k.split(',').map(Number);
    const pad = 80;
    const rect = [toPath([[ci * 200 - pad, cj * 200 - pad], [ci * 200 + 200 + pad, cj * 200 - pad], [ci * 200 + 200 + pad, cj * 200 + 200 + pad], [ci * 200 - pad, cj * 200 + 200 + pad]])];
    const local = boolOp(INTER, road, rect);
    if (!local.length) continue;
    for (const b of list) {
      const a = Math.abs(areaM2(boolOp(INTER, [toPath(b.pts)], local)));
      b.overlap = a / b.area;
      if (b.overlap > 0.3 || a > 60) { b.drop = true; removed++; }
    }
  }
  log(`bâtiments empiétant sur la chaussée supprimés : ${removed}`);
}
const keptBuildings = buildings.filter((b) => !b.drop);

// ───────────────────────── Bâtiments : attributs de la BD TOPO (IGN) ─────────────────────────
// Placé après tout ce qui dessine la chaussée, et sans toucher ni aux emprises ni à la liste :
// les murs OSM ont déjà servi à dimensionner les rues, le réseau ne doit pas dépendre de l'IGN.
let ignUsed = false;
{
  const ign = loadIgn(new URL('../data/ign-raw', import.meta.url).pathname, proj);
  if (!ign) {
    console.warn('ATTENTION : data/ign-raw absent ou vide (bash tools/fetch-ign.sh) — hauteurs estimées, sans matériaux, comme avant.');
  } else {
    ignUsed = true;
    const res = apparier(keptBuildings, ign.list);
    const st = { apparies: 0, hIgn: 0, hOsm: 0, etages: 0, murs: 0, toits: 0, dates: 0, usages: 0, sIgn: 0, sOsm: 0, sTot: 0 };
    keptBuildings.forEach((b, i) => {
      const a = res[i];
      st.sTot += b.area;
      if (b.tagged) { st.hOsm++; st.sOsm += b.area; }
      if (!a) return;
      st.apparies++;
      if (a.h > 0 && !b.tagged) {
        // La hauteur IGN est mesurée à l'égout du toit. Bornes : un plancher pour que le mur reste
        // visible, 6 m pour les auvents et préaux (un auvent de station-service accolé à un immeuble
        // n'a pas sa hauteur). Les lieux de culte gardent leur estimation si elle est plus haute :
        // l'égout d'une nef est bien plus bas que ce qu'on voit depuis la rue.
        let h = Math.max(2.2, Math.min(110, a.h));
        if (b.type === 'roof') h = Math.min(h, 6);
        if (b.type === 'church' && h < b.h) h = b.h;
        else {
          b.ign = 1;
          st.hIgn++; st.sIgn += b.area;
          b.h = r2(h);
          // niveaux : ceux de l'IGN s'ils sont cohérents avec la hauteur, sinon déduits de la hauteur
          // (le rendu étire les étages entre le rez-de-chaussée et le toit)
          if (b.type === 'roof') b.lv = 1;
          else if (a.etages) { b.lv = Math.max(1, Math.min(30, Math.round(a.etages))); st.etages++; }
          else b.lv = Math.max(1, Math.min(30, Math.round((h - 0.6) / 3)));
        }
      }
      if (a.mur) { b.mur = a.mur; if (a.mur2) b.mur2 = a.mur2; st.murs++; }
      if (a.toit) { b.toit = a.toit; st.toits++; }
      // les dates du cadastre sont arrondies (pics en 1900, 1920) : la décennie suffit et pèse moins
      if (a.an) { b.dec = Math.floor(a.an / 10) * 10; st.dates++; }
      if (a.u) { b.u = a.u; if (a.u2) b.u2 = a.u2; st.usages++; }
      if (a.leger) b.leger = 1;
    });
    const pc = (v) => `${v} (${((v / keptBuildings.length) * 100).toFixed(1)} %)`;
    log(`IGN BD TOPO : ${ign.list.length} bâtiments en service (${ign.files} fichiers) ; appariés ${pc(st.apparies)}`);
    log(`  hauteur IGN ${pc(st.hIgn)}, hauteur ou niveaux OSM ${pc(st.hOsm)}, estimée ${pc(keptBuildings.length - st.hIgn - st.hOsm)}`);
    log(`  en surface bâtie : hauteur IGN ${((st.sIgn / st.sTot) * 100).toFixed(1)} %, OSM ${((st.sOsm / st.sTot) * 100).toFixed(1)} %`);
    log(`  étages IGN ${pc(st.etages)}, murs ${pc(st.murs)}, toit ${pc(st.toits)}, décennie ${pc(st.dates)}, usage ${pc(st.usages)}`);
  }
}

// ───────────────────────── Découpage en dalles ─────────────────────────
const ci0 = Math.floor(RECT.x0 / CHUNK), ci1 = Math.floor(RECT.x1 / CHUNK);
const cj0 = Math.floor(RECT.z0 / CHUNK), cj1 = Math.floor(RECT.z1 / CHUNK);
const rectPath = (x0, z0, x1, z1) => [toPath([[x0, z0], [x1, z0], [x1, z1], [x0, z1]])];

function exToPolys(ex, ox, oz) {
  const ring = (path) => { const a = []; for (const p of path) a.push(p.X - Math.round(ox * SCALE), p.Y - Math.round(oz * SCALE)); return a; };
  const polys = [];
  for (const e of ex) {
    if (e.outer.length < 3) continue;
    polys.push({ o: ring(e.outer), h: e.holes.filter((h) => h.length >= 3).map(ring) });
  }
  return polys;
}

// Bande de trottoir : jusqu'à 6 m du bord de chaussée (plus les voies piétonnes) ; au-delà, cœur d'îlot.
const SIDEWALK_BAND = 6;
let band, bandePietonne = [];
{
  let ped = [];
  for (const w of ways.values()) {
    const t = w.tags;
    if (!(t.highway === 'pedestrian' && t.area !== 'yes')) continue;
    if (t.tunnel && t.tunnel !== 'no') continue;
    const pts = w.nds.map((id) => nodeXZ.get(id)).filter(Boolean);
    if (pts.length < 2 || !pts.some(inRect)) continue;
    ped = ped.concat(bufferLine(G.simplifyDP(pts, 0.2), 5));
  }
  bandePietonne = ped;
  band = boolOp(UNION, inflate(road, SIDEWALK_BAND).concat(ped), null);
  band = C.Clipper.CleanPolygons(band, 3);
  log(`bande de trottoir : ${band.length} anneaux, ${nVerts(band)} sommets`);
}

const chunks = {};
const roadCells = new Map(); // dalle → chaussée (chemins Clipper), pour les soustractions locales
let nRoadV = 0, nWalkV = 0;
const countV = (polys) => polys.reduce((s, p) => s + p.o.length / 2 + p.h.reduce((t, h) => t + h.length / 2, 0), 0);
for (let ci = ci0; ci <= ci1; ci++) {
  const colRect = rectPath(ci * CHUNK, RECT.z0 - 500, (ci + 1) * CHUNK, RECT.z1 + 500);
  const col = boolOp(INTER, road, colRect);
  const bandCol = boolOp(INTER, band, colRect);
  for (let cj = cj0; cj <= cj1; cj++) {
    const x0 = ci * CHUNK, z0 = cj * CHUNK;
    const rect = rectPath(x0, z0, x0 + CHUNK, z0 + CHUNK);
    const cellRoad = boolOp(INTER, col, rect);
    const cellBand = boolOp(INTER, bandCol, rect);
    const roadPolys = exToPolys(boolEx(UNION, cellRoad, null), x0, z0);
    const walkPolys = exToPolys(boolEx(DIFF, cellBand, cellRoad), x0, z0);
    nRoadV += countV(roadPolys); nWalkV += countV(walkPolys);
    if (cellRoad.length) roadCells.set(`${ci},${cj}`, cellRoad);
    chunks[`${ci},${cj}`] = { r: roadPolys, w: walkPolys };
  }
}
log(`dalles : ${Object.keys(chunks).length} (${nRoadV} sommets chaussée, ${nWalkV} trottoir)`);

// ───────────────────────── Requêtes ponctuelles : chaussée, bâti ─────────────────────────
/** Le point est-il sur la chaussée (polygones `r` des dalles) ? */
function onRoad(x, z) {
  const ck = chunks[`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`];
  if (!ck) return false;
  const lx = (x - Math.floor(x / CHUNK) * CHUNK) * SCALE, lz = (z - Math.floor(z / CHUNK) * CHUNK) * SCALE;
  const inside = (ring) => {
    let c = false;
    for (let i = 0, n = ring.length / 2, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1];
      if ((zi > lz) !== (zj > lz) && lx < ((xj - xi) * (lz - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (const poly of ck.r) if (inside(poly.o) && !poly.h.some(inside)) return true;
  return false;
}
/** Bord de chaussée le plus proche de (x, z), à moins de `max` m : { x, z, d } ou null. */
const bordGrid = new Map();
{
  const cell = 10;
  for (const ring of road) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const seg = [a.X / SCALE, a.Y / SCALE, b.X / SCALE, b.Y / SCALE];
      const i0 = Math.floor(Math.min(seg[0], seg[2]) / cell), i1 = Math.floor(Math.max(seg[0], seg[2]) / cell);
      const j0 = Math.floor(Math.min(seg[1], seg[3]) / cell), j1 = Math.floor(Math.max(seg[1], seg[3]) / cell);
      for (let ii = i0; ii <= i1; ii++) for (let jj = j0; jj <= j1; jj++) {
        const k = `${ii},${jj}`;
        let l = bordGrid.get(k); if (!l) bordGrid.set(k, (l = [])); l.push(seg);
      }
    }
  }
}
function bordProche(x, z, max = 2.5) {
  const cell = 10;
  let best = null;
  for (let ii = Math.floor((x - max) / cell); ii <= Math.floor((x + max) / cell); ii++) for (let jj = Math.floor((z - max) / cell); jj <= Math.floor((z + max) / cell); jj++) {
    const l = bordGrid.get(`${ii},${jj}`);
    if (!l) continue;
    for (const s of l) {
      const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2)) : 0;
      const px = s[0] + dx * t, pz = s[1] + dz * t, d = Math.hypot(x - px, z - pz);
      if (d <= max && (!best || d < best.d)) best = { x: px, z: pz, d };
    }
  }
  return best;
}
/** Bâtiment (auvents compris) dont l'emprise contient le point, ou undefined. */
const batiGrid = new Map();
for (const b of keptBuildings) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  for (let i = Math.floor(x0 / 50); i <= Math.floor(x1 / 50); i++) for (let j = Math.floor(z0 / 50); j <= Math.floor(z1 / 50); j++) {
    const k = `${i},${j}`;
    let l = batiGrid.get(k); if (!l) batiGrid.set(k, (l = [])); l.push(b);
  }
}
const dansBati = (x, z) => (batiGrid.get(`${Math.floor(x / 50)},${Math.floor(z / 50)}`) ?? []).find((b) => SOL.dansAnneau(b.pts, x, z));

// ───────────────────────── Espaces : parcs, places, terrains, massifs ─────────────────────────
// Chaque surface OSM reconnue (tools/lib/sol.mjs) devient un espace, avec son revêtement et ses trous.
const areas = [];
let massifsEcartes = 0;
function addArea(tags, relation, outer, holes) {
  let pts = G.simplifyRing(outer, 0.2);
  if (pts.length < 3) return;
  const aire = Math.abs(G.ringArea(pts));
  const nat = SOL.nature(tags, relation, aire);
  if (!nat) return;
  if (aire < (nat.k === 'massif' ? 3 : 12)) return;
  if (!pts.some(inRect)) return;
  // même sens pour tous : sous la règle « non nul », deux anneaux de sens contraires s'annuleraient
  if (G.ringArea(pts) < 0) pts.reverse();
  let paths = [toPath(pts)];
  if (!C.Clipper.Orientation(paths[0])) paths[0].reverse();
  const trous = holes.map((h) => G.simplifyRing(h, 0.2)).filter((h) => h.length >= 3);
  if (trous.length) paths = boolOp(DIFF, paths, trous.map(toPath));
  // un massif se voit en relief : son contour arrête une voiture, comme celui des haies surfaciques
  // (déjà dans les barrières). On ne le garde que s'il ne mord pas sur la chaussée du jeu.
  if (nat.k === 'massif' && tags.barrier !== 'hedge') {
    let libre = true;
    for (let i = 0; i < pts.length && libre; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(G.dist(a, b)));
      for (let k = 0; k < n && libre; k++) if (onRoad(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)) libre = false;
    }
    // s'il mord sur la chaussée, il n'est pas dessiné du tout : un volume qu'on traverse est pire qu'un massif en moins
    if (!libre) { massifsEcartes++; return; }
    barriers.push({ kind: 'massif', pts: [...pts, pts[0]], h: nat.e / 10 });
  }
  areas.push({ ...nat, kind: nat.k, pts, paths, aire: aire - trous.reduce((t, h) => t + Math.abs(G.ringArea(h)), 0), name: tags.name, trous: trous.length });
}
for (const w of ways.values()) {
  if (w.nds.length < 4 || w.nds[0] !== w.nds[w.nds.length - 1]) continue;
  if (!SOL.nature(w.tags, false, 0)) continue;
  addArea(w.tags, false, wayRing(w), []);
}
for (const rel of relations.values()) {
  if (rel.tags.type !== 'multipolygon') continue;
  if (!SOL.nature(rel.tags, true, 0)) continue;
  for (const poly of SOL.rangerTrous(relationRings(rel), relationRings(rel, true))) addArea(rel.tags, true, poly.o, poly.h);
}
{
  const par = {};
  for (const a of areas) { const e = (par[a.kind] ??= [0, 0]); e[0]++; e[1] += a.aire; }
  log(`espaces : ${areas.length} (${areas.filter((a) => a.trous).length} à trous, ${massifsEcartes} massifs écartés parce qu'ils mordent sur la chaussée) — ` + Object.entries(par).map(([k, e]) => `${k} ${e[0]} (${(e[1] / 1e4).toFixed(2)} ha)`).join(', '));
}

// Végétation relevée sur la photo aérienne (tools/fetch-ortho.mjs --prepare, après une première
// compilation de la carte) : jardins et arbres que la carte OpenStreetMap ne décrit pas. Sans ce relevé,
// les jardins sont déduits du bâti et seuls les arbres cartographiés sont plantés.
let vegetation = null;
try {
  vegetation = SOL.lireVegetation(JSON.parse(readFileSync(new URL('../data/ortho-raw/vegetation.json', import.meta.url), 'utf8')));
} catch { /* pas de relevé */ }
log(vegetation ? `végétation de la photo aérienne : ${vegetation.l} × ${vegetation.h} cases de ${vegetation.cote} m, ${vegetation.arbres.length} houppiers` : 'végétation de la photo aérienne : pas de relevé (data/ortho-raw/vegetation.json)');

// ───────────────────────── Sol par défaut des cœurs d'îlot : jardin ou cour ─────────────────────────
// OpenStreetMap ne décrit ni les jardins privés ni les cours : on les déduit du bâti. Un îlot de
// pavillons est en herbe, tout le reste est minéral (cour, dalle, enrobé). Les pelouses des grands
// ensembles, elles, sont cartographiées (landuse=grass) et restent vertes par-dessus.
let jardins = [];
{
  const GRAND = 20000; // m² : au-delà, l'îlot mêle souvent pavillons et immeubles
  const offset = (paths, d) => {
    const co = new C.ClipperOffset(2, 25);
    co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
    const out = new C.Paths(); co.Execute(out, d * SCALE); return out;
  };
  const ilots = boolEx(DIFF, rectPath(RECT.x0, RECT.z0, RECT.x1, RECT.z1), band).map((e) => {
    const o = e.outer.map((p) => [p.X / SCALE, p.Y / SCALE]);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of o) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return { ex: e, o, h: e.holes.map((h) => h.map((p) => [p.X / SCALE, p.Y / SCALE])), box: [x0, z0, x1, z1], bats: [], aire: (Math.abs(C.Clipper.Area(e.outer)) - e.holes.reduce((t, h) => t + Math.abs(C.Clipper.Area(h)), 0)) / (SCALE * SCALE) };
  });
  for (const b of keptBuildings) {
    const c = G.ringCentroid(b.pts);
    const il = ilots.find((i) => c[0] >= i.box[0] && c[0] <= i.box[2] && c[1] >= i.box[1] && c[1] <= i.box[3] && SOL.dansAnneau(i.o, c[0], c[1]) && !i.h.some((h) => SOL.dansAnneau(h, c[0], c[1])));
    if (il) il.bats.push({ t: b.type, l: b.lv, aire: b.area, pts: b.pts });
  }
  let nJ = 0, nC = 0, nG = 0, all = [];
  if (vegetation) {
    // La photo aérienne dit où le sol est vert : les cases de jardin du relevé remplacent la déduction
    // par le bâti. Leur contour en escalier est simplifié à 3,2 m près (la limite ne suit plus les cases,
    // et la carte ne s'alourdit pas de milliers de sommets) ; les lambeaux et les petits trous sont écartés.
    const cases = SOL.casesJardin(vegetation).map(([x0, z0, x1, z1]) => rectPath(x0, z0, x1, z1)[0]);
    const lisse = (ring) => toPath(G.simplifyRing(ring.map((p) => [p.X / SCALE, p.Y / SCALE]), 3.2));
    let v = [];
    for (const e of boolEx(UNION, cases, null)) {
      if (Math.abs(C.Clipper.Area(e.outer)) / (SCALE * SCALE) < 220) continue;
      const o = lisse(e.outer);
      if (o.length < 3) continue;
      const trous = e.holes.filter((h) => Math.abs(C.Clipper.Area(h)) / (SCALE * SCALE) >= 100).map(lisse).filter((h) => h.length >= 3);
      v = v.concat(trous.length ? boolOp(DIFF, [o], trous) : [o]);
    }
    v = boolOp(INTER, boolOp(UNION, v, null), ilots.flatMap((il) => [il.ex.outer, ...il.ex.holes]));
    v = C.Clipper.CleanPolygons(v, 40).filter((p) => p.length >= 3);
    for (const e of boolEx(UNION, v, null)) {
      if (Math.abs(C.Clipper.Area(e.outer)) / (SCALE * SCALE) < 120) continue;
      all.push(e.outer); nJ++;
      for (const h of e.holes) if (Math.abs(C.Clipper.Area(h)) / (SCALE * SCALE) >= 60) all.push(h);
    }
  } else for (const il of ilots) {
    const contour = [il.ex.outer, ...il.ex.holes];
    if (il.aire <= GRAND) {
      if (SOL.tissu(il.bats) === 'jardin') { all = all.concat(contour); nJ++; } else nC++;
      continue;
    }
    // grand îlot : en herbe à moins de 28 m d'une maison, sauf à moins de 12 m d'un immeuble
    nG++;
    const maisons = il.bats.filter((b) => b.t !== 'roof' && SOL.estMaison(b)), autres = il.bats.filter((b) => b.t !== 'roof' && !SOL.estMaison(b));
    if (!maisons.length) continue;
    let g = offset(offset(maisons.map((b) => toPath(b.pts)), 32), -4);
    if (autres.length) g = boolOp(DIFF, g, offset(autres.map((b) => toPath(b.pts)), 12));
    g = boolOp(INTER, g, contour);
    g = C.Clipper.CleanPolygons(g, 20).filter((p) => p.length >= 3);
    // les lambeaux de moins de 80 m² ne sont pas des jardins
    for (const e of boolEx(UNION, g, null)) {
      if (Math.abs(C.Clipper.Area(e.outer)) / (SCALE * SCALE) < 80) continue;
      all.push(e.outer); for (const h of e.holes) all.push(h);
    }
  }
  jardins = boolOp(UNION, all, null);
  log(vegetation ? `cœurs d'îlot : ${ilots.length} îlots, ${nJ} jardins relevés sur la photo aérienne ; jardins` : `cœurs d'îlot : ${ilots.length} îlots — ${nJ} en jardin, ${nC} en cour, ${nG} grands îlots recoupés ; jardins ${(areaM2(jardins) / 1e4).toFixed(1)} ha, ${nVerts(jardins)} sommets`);
}

// ───────────────────────── Jardins de devant et clôtures sur rue ─────────────────────────
// La bande de 6 m le long de la chaussée est du trottoir : devant un pavillon, la maison se retrouvait
// posée sur une dalle continue jusqu'à la bordure. Là où un jardin (relevé sur la photo) borde la rue,
// le trottoir est ramené à TROTTOIR_JARDIN m ; au-delà, la bande devient un jardin de devant, fermé
// sur la rue par une clôture (muret, haie) coupée d'un portail à chaque parcelle. Rien de tout cela
// n'est cartographié : c'est déduit, et les barrières créées portent d: 1.
const TROTTOIR_JARDIN = 3;
if (vegetation && jardins.length) {
  const offset = (paths, d) => {
    const co = new C.ClipperOffset(2, 25);
    co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon);
    const out = new C.Paths(); co.Execute(out, d * SCALE); return out;
  };
  const ailleurs = boolOp(UNION, areas.flatMap((a) => a.paths).concat(bandePietonne), null);
  const GARDE_DEVANT = 0.15;
  const derriere = boolOp(DIFF, offset(jardins, TROTTOIR_JARDIN + 0.3), offset(ailleurs, GARDE_DEVANT));
  const ligne = inflate(road, TROTTOIR_JARDIN);
  let devant = boolOp(INTER, boolOp(DIFF, inflate(road, SIDEWALK_BAND - GARDE_DEVANT), ligne), derriere);
  // nettoyage (lames, sommets en trop) : il déplace des sommets de 10 cm au plus, d'où la garde de
  // GARDE_DEVANT m laissée autour des espaces voisins et du cœur d'îlot, pour ne rien recouvrir
  devant = C.Clipper.CleanPolygons(ouvrir(devant, 0.4), 10).filter((p) => p.length >= 3 && Math.abs(C.Clipper.Area(p)) >= 8 * SCALE * SCALE);
  const pts = devant.flatMap((p) => p.map((q) => [q.X / SCALE, q.Y / SCALE]));
  if (pts.length) areas.push({ k: 'devant', kind: 'devant', pts, paths: devant, aire: areaM2(devant), pret: true });
  // clôtures : la ligne à TROTTOIR_JARDIN m de la chaussée, là où un jardin est derrière
  const c = new C.Clipper();
  for (const r of ligne) c.AddPath(r.concat([r[0]]), C.PolyType.ptSubject, false);
  c.AddPaths(boolOp(INTER, derriere, offset(devant, 0.5)), C.PolyType.ptClip, true);
  const arbre = new C.PolyTree();
  c.Execute(INTER, arbre, NZ, NZ);
  let n = 0, km = 0, nb = 0;
  for (const chemin of C.Clipper.OpenPathsFromPolyTree(arbre)) {
    const q = G.simplifyDP(chemin.map((p) => [p.X / SCALE, p.Y / SCALE]), 0.45);
    if (G.polyLen(q) < 4) continue;
    for (const m of SOL.decouperCloture(q, hash32(`${r2(q[0][0])}|${r2(q[0][1])}`))) {
      // ni dans un bâtiment (maison à l'alignement), ni sur la chaussée
      let libre = true;
      const len = G.polyLen(m.pts);
      for (let d = 0; d <= len && libre; d += 0.75) { const p = G.pointAt(m.pts, d); if (dansBati(p.x, p.z) || onRoad(p.x, p.z)) libre = false; }
      if (!libre) { nb++; continue; }
      n++; km += len / 1000;
      if (m.muret) barriers.push({ kind: 'muret', pts: m.pts, h: m.muret, c: m.ton, d: 1 });
      if (m.haie) {
        // la haie pousse derrière le muret, côté jardin
        const dedans = m.pts.map((p) => {
          const b = bordProche(p[0], p[1], TROTTOIR_JARDIN + 1.5);
          if (!b || b.d < 0.01) return p;
          const k = (m.muret ? 0.4 : 0.1) / b.d;
          return [p[0] + (p[0] - b.x) * k, p[1] + (p[1] - b.z) * k];
        });
        barriers.push({ kind: 'hedge', pts: dedans, h: m.haie, d: 1 });
      }
    }
  }
  log(`jardins de devant : ${(areaM2(devant) / 1e4).toFixed(1)} ha, ${nVerts(devant)} sommets ; clôtures sur rue : ${n} parcelles, ${km.toFixed(1)} km (${nb} écartées : bâtiment à l'alignement)`);
}

// Sol sans recouvrement : dans l'ordre de superposition (SOL.ordreDessus), chaque espace est amputé
// de la chaussée et des espaces qui le recouvrent, et le cœur d'îlot de tous les espaces. Tout le sol
// d'une dalle est alors un pavage, sans faces superposées qui scintillent. Les soustractions se font
// sur la carte entière, la découpe en dalles en dernier : soustraire dalle par dalle laissait des
// trous collés au bord de la dalle, que la triangulation ne sait pas traiter.
const sansEclats = (ex) => ex.filter((e) => Math.abs(C.Clipper.Area(e.outer)) >= 0.5 * SCALE * SCALE);
/**
 * Ouverture morphologique de 10 cm : retire les pointes et les lames plus fines que 20 cm, et sépare
 * un trou collé au contour (arêtes communes laissées par une soustraction). Sans cela, la
 * triangulation du rendu (earcut) déborde du polygone.
 */
function ouvrir(paths, d = 0.1) {
  const off = (p, dd) => {
    const co = new C.ClipperOffset(8, ARC_TOL);
    co.AddPaths(p, C.JoinType.jtMiter, C.EndType.etClosedPolygon);
    const out = new C.Paths(); co.Execute(out, dd * SCALE); return out;
  };
  return off(off(paths, -d), d);
}
function interEx(subj, rect) {
  const c = new C.Clipper();
  c.StrictlySimple = true;
  c.AddPaths(subj, C.PolyType.ptSubject, true);
  c.AddPaths(rect, C.PolyType.ptClip, true);
  const tree = new C.PolyTree();
  c.Execute(INTER, tree, NZ, NZ);
  return sansEclats(C.JS.PolyTreeToExPolygons(tree));
}
{
  const boite = (a) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of a.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return [x0, z0, x1, z1];
  };
  const ordre = areas.slice().sort(SOL.ordreDessus);
  const byCell = new Map();
  ordre.forEach((a, i) => {
    a.box = boite(a);
    const [x0, z0, x1, z1] = a.box;
    if (a.pret) {
      // déjà découpé (jardins de devant) : ni chaussée ni autre espace dessous
      a.vis = a.paths;
      for (const k of Object.keys(chunks)) { let l = byCell.get(k); if (!l) byCell.set(k, (l = [])); l.push(a); }
      return;
    }
    let vis = a.paths;
    let roadHere = [];
    for (let ci = Math.floor(x0 / CHUNK); ci <= Math.floor(x1 / CHUNK); ci++) for (let cj = Math.floor(z0 / CHUNK); cj <= Math.floor(z1 / CHUNK); cj++) roadHere = roadHere.concat(roadCells.get(`${ci},${cj}`) ?? []);
    if (roadHere.length) vis = boolOp(DIFF, vis, roadHere);
    const dessus = ordre.slice(0, i).filter((b) => !b.pret && b.box[0] < x1 && b.box[2] > x0 && b.box[1] < z1 && b.box[3] > z0).flatMap((b) => b.paths);
    if (dessus.length && vis.length) vis = boolOp(DIFF, vis, dessus);
    a.vis = vis = ouvrir(vis);
    if (!vis.length) return;
    for (let ci = Math.floor(x0 / CHUNK); ci <= Math.floor(x1 / CHUNK); ci++) for (let cj = Math.floor(z0 / CHUNK); cj <= Math.floor(z1 / CHUNK); cj++) {
      const k = `${ci},${cj}`;
      if (!chunks[k]) continue;
      let l = byCell.get(k); if (!l) byCell.set(k, (l = [])); l.push(a);
    }
  });
  // cœurs d'îlot : tout ce qui n'est ni chaussée, ni bande de trottoir, ni espace
  const tous = boolOp(UNION, areas.flatMap((a) => a.paths), null);
  const coeur = boolOp(DIFF, boolOp(DIFF, rectPath(RECT.x0, RECT.z0, RECT.x1, RECT.z1), band), tous);
  const jardG = ouvrir(boolOp(INTER, coeur, jardins)), courG = ouvrir(boolOp(DIFF, coeur, jardins));
  log(`cœurs d'îlot hors espaces : jardins ${(areaM2(jardG) / 1e4).toFixed(1)} ha, cours ${(areaM2(courG) / 1e4).toFixed(1)} ha (bâti compris)`);
  let n = 0, nJ = 0, nC = 0, vA = 0, vJ = 0, vC = 0;
  for (let ci = ci0; ci <= ci1; ci++) {
    const colRect = rectPath(ci * CHUNK, RECT.z0 - 500, (ci + 1) * CHUNK, RECT.z1 + 500);
    const jardCol = boolOp(INTER, jardG, colRect), courCol = boolOp(INTER, courG, colRect);
    for (let cj = cj0; cj <= cj1; cj++) {
      const k = `${ci},${cj}`;
      const x0 = ci * CHUNK, z0 = cj * CHUNK;
      const rect = rectPath(x0, z0, x0 + CHUNK, z0 + CHUNK);
      const out = [];
      for (const a of byCell.get(k) ?? []) {
        for (const poly of exToPolys(interEx(a.vis, rect), x0, z0)) {
          const o = { k: a.kind, o: poly.o, h: poly.h };
          if (a.s) o.s = a.s;
          if (a.e) o.e = a.e;
          out.push(o); n++; vA += countV([poly]);
        }
      }
      if (out.length) chunks[k].a = out;
      const g = jardCol.length ? exToPolys(interEx(jardCol, rect), x0, z0) : [];
      const c = courCol.length ? exToPolys(interEx(courCol, rect), x0, z0) : [];
      if (g.length) { chunks[k].g = g; nJ += g.length; vJ += countV(g); }
      if (c.length) { chunks[k].c = c; nC += c.length; vC += countV(c); }
    }
  }
  log(`sol par dalle : ${n} polygones d'espaces (${vA} sommets), ${nJ} de jardin (${vJ}), ${nC} de cour (${vC})`);
}

// Voies piétonnes linéaires et voies de tram (servent au rattachement des devantures), allées et
// escaliers : seules les portions qui traversent de l'herbe sont gardées, ailleurs le sol est déjà minéral.
const lines = [];
{
  const veg = areas.filter((a) => SOL.VEGETAL.test(a.kind)).flatMap((a) => a.paths);
  const autres = areas.filter((a) => !SOL.VEGETAL.test(a.kind) && a.kind !== 'massif').flatMap((a) => a.paths);
  const herbe = boolOp(DIFF, boolOp(UNION, veg.concat(jardins), null), boolOp(UNION, autres.concat(road), null));
  const herbeCells = new Set(), herbeBox = [];
  for (const p of herbe) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of p) { x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X); z0 = Math.min(z0, q.Y); z1 = Math.max(z1, q.Y); }
    herbeBox.push([x0 / SCALE, z0 / SCALE, x1 / SCALE, z1 / SCALE]);
    for (let i = Math.floor(x0 / SCALE / CHUNK); i <= Math.floor(x1 / SCALE / CHUNK); i++) for (let j = Math.floor(z0 / SCALE / CHUNK); j <= Math.floor(z1 / SCALE / CHUNK); j++) herbeCells.add(`${i},${j}`);
  }
  const LARGEUR = { footway: 2.2, path: 1.6, steps: 2.2, cycleway: 2.6, track: 2.8, service: 3.2, pedestrian: 4 };
  let km = 0, nAl = 0;
  for (const w of ways.values()) {
    const t = w.tags;
    if (t.tunnel && t.tunnel !== 'no') continue;
    let pts = w.nds.map((id) => nodeXZ.get(id)).filter(Boolean);
    if (pts.length < 2 || !pts.some(inRect)) continue;
    if (t.highway === 'pedestrian' && t.area !== 'yes') lines.push({ kind: 'ped', pts: G.simplifyDP(pts, 0.1), name: t.name });
    else if (t.railway === 'tram') lines.push({ kind: 'tram', pts: G.simplifyDP(pts, 0.1), name: t.name });
    if (!(t.highway in LARGEUR) || t.area === 'yes') continue;
    if (t.highway === 'service' && drivable(w)) continue;
    if (t.indoor === 'yes' || +t.level < 0 || +t.layer < 0 || t.location === 'underground' || t.covered === 'yes') continue;
    if (t.footway === 'crossing') continue;
    if (!pts.some((p) => herbeCells.has(`${Math.floor(p[0] / CHUNK)},${Math.floor(p[1] / CHUNK)}`))) continue;
    pts = G.simplifyDP(pts, 0.3);
    const c = new C.Clipper();
    c.AddPath(toPath(pts), C.PolyType.ptSubject, false);
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const q of pts) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); bz0 = Math.min(bz0, q[1]); bz1 = Math.max(bz1, q[1]); }
    // seuls les anneaux d'herbe qui croisent l'emprise du chemin (un trou est toujours dans l'emprise de son contour)
    const ici = herbe.filter((_, k) => { const b = herbeBox[k]; return b[0] < bx1 && b[2] > bx0 && b[1] < bz1 && b[3] > bz0; });
    if (!ici.length) continue;
    c.AddPaths(ici, C.PolyType.ptClip, true);
    const tree = new C.PolyTree();
    c.Execute(INTER, tree, NZ, NZ);
    const larg = Math.min(6, parseFloat(t.width) || LARGEUR[t.highway]);
    for (const path of C.Clipper.OpenPathsFromPolyTree(tree)) {
      const q = path.map((p) => [p.X / SCALE, p.Y / SCALE]);
      const len = G.polyLen(q);
      if (len < 2.5) continue;
      const l = { kind: t.highway === 'steps' ? 'marches' : 'allee', pts: q, w: Math.round(larg * 10) };
      const s = SOL.revetement(t.surface);
      if (s) l.s = s;
      lines.push(l); km += len / 1000; nAl++;
    }
  }
  log(`allées et escaliers dans l'herbe : ${nAl} tronçons, ${km.toFixed(1)} km`);
}

const trees = [], lamps = [], pois = [];
const stations = stationsDeMetro(relations);
// Mobilier ponctuel : jamais sur la chaussée ni dans un bâtiment. Ce qui est saisi sur une bande de
// stationnement (arceaux vélo, conteneurs) est reporté sur le trottoir le plus proche, à 2,5 m au plus.
const MOBILIER = /^(bench|bollard|bin|recycling|postbox|velib|bikepark|hydrant|eau|table|wc)$/;
const mob = { garde: 0, deplace: 0, chaussee: 0, bati: 0, interieur: 0 };
for (const n of nodes.values()) {
  const t = n.tags;
  const p = nodeXZ.get(n.id);
  if (!inRect(p)) continue;
  if (t.natural === 'tree') {
    const h = parseFloat(t.height) || 0;
    const circ = parseFloat(t.circumference) || 0;
    trees.push([r2(p[0]), r2(p[1]), Math.round(h), Math.round(circ * 100), (t.genus ?? t.species ?? '').split(' ')[0].toLowerCase()]);
  } else if (t.highway === 'street_lamp') lamps.push([r2(p[0]), r2(p[1])]);
  else {
    let k = null;
    if (t.highway === 'bus_stop') k = 'bus';
    else if (t.amenity === 'bench') k = 'bench';
    else if (t.barrier === 'bollard') k = 'bollard';
    else if (t.amenity === 'waste_basket') k = 'bin';
    else if (t.amenity === 'recycling') k = 'recycling';
    else if (t.amenity === 'post_box') k = 'postbox';
    else if (t.amenity === 'bicycle_rental') k = 'velib';
    else if (t.amenity === 'bicycle_parking') k = 'bikepark';
    else if (t.railway === 'subway_entrance') k = 'metro';
    else if (t.amenity === 'pharmacy') k = 'pharmacy';
    else if (t.emergency === 'fire_hydrant') k = 'hydrant';
    else if (t.amenity === 'drinking_water') k = 'eau';
    else if (t.leisure === 'picnic_table') k = 'table';
    else if (t.amenity === 'toilets') k = 'wc';
    else if (t.shop || (t.amenity && /^(restaurant|cafe|bar|fast_food|bank|driving_school|pub)$/.test(t.amenity))) k = 'shop';
    if (!k) continue;
    const o = { k, x: r2(p[0]), z: r2(p[1]) };
    if (MOBILIER.test(k)) {
      if (t.indoor === 'yes' || +t.level < 0 || +t.layer < 0 || t.location === 'underground' || t.location === 'indoor'
        || (k === 'recycling' && t.recycling_type === 'centre') || (k === 'hydrant' && t['fire_hydrant:type'] === 'underground')) { mob.interieur++; continue; }
      // un potelet saisi sur la chaussée barre une voie que le jeu laisse ouverte : on ne le pose pas
      const q = k === 'bollard' ? (onRoad(p[0], p[1]) ? null : p) : SOL.versTrottoir(p[0], p[1], onRoad);
      if (!q) { mob.chaussee++; continue; }
      if (dansBati(q[0], q[1])) { mob.bati++; continue; }
      if (q[0] !== p[0] || q[1] !== p[1]) mob.deplace++;
      mob.garde++;
      o.x = r2(q[0]); o.z = r2(q[1]);
      const cap = parseInt(t.capacity);
      if (cap > 0 && (k === 'bikepark' || k === 'velib')) o.c = cap;
      const dir = parseFloat(t.direction);
      if (k === 'bench' && Number.isFinite(dir)) o.d = Math.round(dir);
    }
    if (t.name) o.n = t.name;
    if (k === 'shop') o.t = t.shop ?? t.amenity;
    // l'enseigne d'une chaîne décide de la couleur du bandeau quand le nom seul ne la dit pas
    if (k === 'shop' && t.brand && t.brand !== t.name) o.b = t.brand;
    if (k === 'bus' && t.shelter === 'yes') o.sh = 1;
    // lignes desservies, telles qu'affichées sur le poteau d'arrêt
    if (k === 'bus' && t.route_ref) o.r = t.route_ref;
    if (k === 'metro') {
      // le « name » d'une bouche est celui de la sortie : la station vient de la relation stop_area
      const st = stations.get(n.id);
      if (st) {
        if (t.name) o.s = t.name;
        o.n = st.station;
        if (st.ligne) o.l = st.ligne;
      }
    }
    pois.push(o);
  }
}
log(`mobilier : ${mob.garde} objets gardés (${mob.deplace} reportés sur le trottoir), écartés : ${mob.chaussee} sur la chaussée, ${mob.bati} dans un bâtiment, ${mob.interieur} en intérieur ou enterrés`);
for (const w of ways.values()) {
  if (w.tags.natural !== 'tree_row') continue;
  const pts = w.nds.map((id) => nodeXZ.get(id)).filter(Boolean);
  const len = G.polyLen(pts);
  const genre = (w.tags.genus ?? w.tags.species ?? '').split(' ')[0].toLowerCase();
  for (let s = 0; s <= len; s += 9) {
    const p = G.pointAt(pts, s);
    if (inRect([p.x, p.z])) trees.push([r2(p.x), r2(p.z), 0, 0, genre]);
  }
}
// Arbres : jamais sur la chaussée ni dans un bâtiment. Un arbre saisi à moins de 1,2 m à l'intérieur
// du bord (imprécision de saisie, ou chaussée du jeu un peu plus large que la vraie) est reporté à
// 0,8 m sur le trottoir, comme ceux qui frôlent la bordure ; plus loin dans la chaussée, il est retiré.
{
  const st = { avant: trees.length, deplaces: 0, chaussee: 0, bati: 0 };
  for (let i = trees.length - 1; i >= 0; i--) {
    const t = trees[i];
    const dedans = onRoad(t[0], t[1]);
    const q = SOL.ecarterArbre(t[0], t[1], bordProche(t[0], t[1]), dedans);
    if (!q || onRoad(q[0], q[1]) || (bordProche(q[0], q[1], 0.7)?.d ?? 1) < 0.7) { trees.splice(i, 1); st.chaussee++; continue; }
    if (dansBati(q[0], q[1])) { trees.splice(i, 1); st.bati++; continue; }
    if (q[0] !== t[0] || q[1] !== t[1]) { t[0] = r2(q[0]); t[1] = r2(q[1]); st.deplaces++; }
  }
  log(`arbres : ${trees.length} sur ${st.avant} (${st.deplaces} écartés du bord de chaussée, ${st.chaussee} retirés de la chaussée, ${st.bati} retirés d'un bâtiment), lampadaires : ${lamps.length}, points : ${pois.length}`);
}

// Arbres relevés sur la photo aérienne : ceux des squares, des places et des jardins, que la carte
// OpenStreetMap ne connaît pas (elle ne relève guère que les arbres d'alignement). Ils sont ajoutés
// après coup : les largeurs de chaussée, bornées par les arbres cartographiés, ne dépendent pas d'eux.
// Au plus QUOTA_ARBRES par dalle (budget de rendu), les grands houppiers et les bords de rue d'abord.
const QUOTA_ARBRES = 10;
if (vegetation) {
  const connus = new Map();
  const cle = (x, z) => `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
  for (const t of trees) { const k = cle(t[0], t[1]); let l = connus.get(k); if (!l) connus.set(k, (l = [])); l.push(t); }
  const pres = (x, z, d) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const t of connus.get(cle(x + i * 10, z + j * 10)) ?? []) if (Math.hypot(t[0] - x, t[1] - z) < d) return true;
    return false;
  };
  // ni sur un terrain de sport, ni dans un bassin
  const interdits = areas.filter((a) => a.kind === 'pitch' || a.kind === 'water');
  for (const a of interdits) if (!a.box) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of a.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } a.box = [x0, z0, x1, z1]; }
  const parDalle = new Map();
  const st = { releves: vegetation.arbres.length, chaussee: 0, bati: 0, terrain: 0, doublon: 0 };
  for (const [x, z, r] of vegetation.arbres) {
    if (!inRect([x, z])) continue;
    // le tronc à 1,5 m au moins de la bordure : un arbre de jardin ne borne pas la chaussée
    const bord = bordProche(x, z, 40);
    if (onRoad(x, z) || (bord && bord.d < 1.5)) { st.chaussee++; continue; }
    if (dansBati(x, z)) { st.bati++; continue; }
    if (interdits.some((a) => x >= a.box[0] && x <= a.box[2] && z >= a.box[1] && z <= a.box[3] && SOL.dansAnneau(a.pts, x, z))) { st.terrain++; continue; }
    if (pres(x, z, 4)) { st.doublon++; continue; }
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let l = parDalle.get(k); if (!l) parDalle.set(k, (l = []));
    l.push({ x, z, r, route: bord ? bord.d : 40 });
  }
  let n = 0;
  for (const k of [...parDalle.keys()].sort()) {
    for (const a of SOL.choisirArbres(parDalle.get(k), QUOTA_ARBRES)) { trees.push([r2(a.x), r2(a.z), SOL.hauteurArbre(a.r), 0, '', 1]); n++; }
  }
  log(`arbres de la photo aérienne : ${n} plantés sur ${st.releves} houppiers relevés (quota de ${QUOTA_ARBRES} par dalle ; écartés : ${st.chaussee} sur la chaussée ou à sa bordure, ${st.bati} dans un bâtiment, ${st.terrain} sur un terrain ou un bassin, ${st.doublon} déjà cartographiés) ; ${trees.length} arbres en tout`);
}

// ───────────────────────── Commerces : rattachement à la façade ─────────────────────────
// Chaque commerce nommé reçoit le bâtiment (fb), le mur (fi) et la portion de mur [f0, f1] qui portent
// sa devanture. Les indices renvoient à la liste finale des bâtiments, dans l'ordre où elle est écrite.
{
  const vitrines = pois.filter((p) => p.k === 'shop' || p.k === 'pharmacy');
  const res = rattacher(
    vitrines,
    keptBuildings.map((b) => ({ pts: b.pts.map((p) => [r2(p[0]), r2(p[1])]), type: b.type })),
    // les rues piétonnes comptent aussi : on n'y roule pas, mais leurs devantures se voient des carrefours
    [...edges.map((e) => ({ pts: e.pts, half: e.width / 2 })), ...lines.filter((l) => l.kind === 'ped').map((l) => ({ pts: l.pts, half: 2 }))],
  );
  let n = 0;
  const r1 = (v) => Math.round(v * 10) / 10;
  vitrines.forEach((p, k) => {
    const r = res[k];
    if (!r) return;
    n++;
    p.fb = r.b; p.fi = r.i; p.f0 = r1(r.f0); p.f1 = r1(r.f1);
  });
  log(`commerces rattachés à une façade sur rue : ${n} sur ${vitrines.length} (${vitrines.filter((p) => p.n).length} nommés)`);
  log(`bouches de métro : ${pois.filter((p) => p.k === 'metro' && p.l).length} avec station et ligne sur ${pois.filter((p) => p.k === 'metro').length}`);
}

// ───────────────────────── Écriture ─────────────────────────
/** Mention de la photo aérienne du sol, si ses dalles sont livrées (tools/fetch-ortho.mjs), avec sa date de prise de vue. */
function mentionOrtho() {
  try {
    const ix = JSON.parse(readFileSync(new URL('../public/ortho/index.json', import.meta.url), 'utf8'));
    const dates = (ix.prises ?? []).map((d) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
    return ` · Photographies aériennes : IGN – BD ORTHO${dates.length ? ', prise de vue du ' + dates.join(' et du ') : ''} (Licence Ouverte Etalab 2.0)`;
  } catch { return ''; }
}
const flat = (pts) => { const a = []; for (const p of pts) a.push(r2(p[0]), r2(p[1])); return a; };
const out = {
  version: 1,
  name: 'Montreuil – Paris 20e',
  // la Licence Ouverte impose la mention de la source dès que les attributs IGN sont dans la carte
  attribution: (ignUsed
    ? '© les contributeurs d’OpenStreetMap (ODbL) · Bâtiments : IGN – BD TOPO (Licence Ouverte Etalab 2.0)'
    : '© les contributeurs d’OpenStreetMap (ODbL)') + mentionOrtho(),
  origin: { lat: LAT0, lon: LON0 },
  rect: { x0: r2(RECT.x0), z0: r2(RECT.z0), x1: r2(RECT.x1), z1: r2(RECT.z1) },
  chunk: CHUNK,
  vertices,
  edges: edges.map((e) => {
    const A = e.attr;
    const o = { a: e.ia, b: e.ib, n: A.name, c: A.cls, ow: A.ow ? 1 : 0, ms: A.ms, st: e.strips, p: flat(e.pts) };
    if (e.feat.length) o.f = e.feat;
    if (A.roundabout) o.rb = 1;
    if (A.link) o.lk = 1;
    if (A.dsc) o.dsc = 1;
    if (A.bridge) o.br = 1;
    if (A.surface !== 'asphalt') o.sf = A.surface;
    if (A.turn) o.tl = A.turn;
    if (e.paris) o.pa = 1;
    return o;
  }),
  restrictions,
  chunks,
  buildings: keptBuildings.map((b) => {
    const o = { p: flat(b.pts), h: b.h, l: b.lv, t: b.type };
    if (b.paris) o.pa = 1;
    if (b.name) o.n = b.name;
    // attributs IGN, en champs courts et facultatifs (voir RawBuilding dans src/map/roadnet.ts)
    if (b.ign) o.g = 1;
    if (b.mur) o.m = b.mur;
    if (b.mur2) o.m2 = b.mur2;
    if (b.toit) o.r = b.toit;
    if (b.dec) o.y = b.dec;
    if (b.u) o.u = b.u;
    if (b.u2) o.u2 = b.u2;
    if (b.leger) o.lg = 1;
    return o;
  }),
  barriers: barriers.map((b) => { const o = { k: b.kind, h: b.h, p: b.d ? flat(b.pts).map((v) => Math.round(v * 10) / 10) : flat(b.pts) }; if (b.c !== undefined) o.c = b.c; if (b.d) o.d = 1; return o; }),
  areas: areas.filter((a) => a.name).map((a) => { const c = G.ringCentroid(a.pts); return { k: a.kind, x: r2(c[0]), z: r2(c[1]), n: a.name }; }),
  lines: lines.map((l) => { const o = { k: l.kind, p: flat(l.pts), n: l.name }; if (l.w) o.w = l.w; if (l.s) o.s = l.s; return o; }),
  trees, lamps, pois,
};
mkdirSync(new URL('../public/maps', import.meta.url).pathname, { recursive: true });
const json = JSON.stringify(out);
writeFileSync(new URL('../public/maps/montreuil.json', import.meta.url).pathname, json);
log(`écrit public/maps/montreuil.json : ${(json.length / 1e6).toFixed(2)} Mo`);

// Statistiques utiles
const cnt = (f) => edges.reduce((s, e) => s + (f(e) ? 1 : 0), 0);
const featCount = {};
for (const e of edges) for (const f of e.feat) featCount[f.k] = (featCount[f.k] ?? 0) + 1;
console.log({
  longueurReseauKm: +(edges.reduce((s, e) => s + e.len, 0) / 1000).toFixed(1),
  sensUniques: cnt((e) => e.attr.ow), giratoires: cnt((e) => e.attr.roundabout),
  voiesBus: cnt((e) => e.attr.busF || e.attr.busB), bandesCyclables: cnt((e) => e.attr.cycL || e.attr.cycR),
  dsc: cnt((e) => e.attr.dsc), vitesses: Object.fromEntries([20, 30, 50, 0].map((v) => [v, cnt((e) => e.attr.ms === v)])),
  elements: featCount, sommetsFeux: vertices.filter((v) => v.sig).length, sorties: vertices.filter((v) => v.exit).length,
  impasses: vertices.filter((v) => v.dead).length, batiments: keptBuildings.length, espaces: areas.length,
});
