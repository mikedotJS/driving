#!/usr/bin/env node
// Convertit les données OpenStreetMap brutes (data/osm-raw) en carte de jeu compacte
// (public/maps/montreuil.json) : graphe de rues avec profils en travers, signalisation,
// polygones de chaussée/trottoir par dalle, bâtiments, espaces verts, mobilier.
//
// Données © les contributeurs d'OpenStreetMap (ODbL).

import { writeFileSync, mkdirSync } from 'node:fs';
import { loadOsm } from './lib/osm-load.mjs';
import * as G from './lib/geom.mjs';
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
const KERB_R = 3.2; // rayon de raccordement des bordures aux carrefours (m)
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

/** Assemble les chemins "outer" d'une relation multipolygone en anneaux. */
function relationRings(rel) {
  const segs = [];
  for (const m of rel.members) {
    if (m.type !== 'way' || (m.role !== 'outer' && m.role !== '')) continue;
    const w = ways.get(m.ref);
    if (!w) continue;
    segs.push(w.nds.slice());
  }
  const rings = [];
  while (segs.length) {
    let cur = segs.pop();
    let guard = 0;
    while (cur[0] !== cur[cur.length - 1] && guard++ < 1000) {
      const tail = cur[cur.length - 1];
      const k = segs.findIndex((s) => s[0] === tail || s[s.length - 1] === tail);
      if (k < 0) break;
      const s = segs.splice(k, 1)[0];
      if (s[0] !== tail) s.reverse();
      cur = cur.concat(s.slice(1));
    }
    if (cur[0] === cur[cur.length - 1] && cur.length >= 4) {
      const pts = cur.slice(0, -1).map((id) => nodeXZ.get(id)).filter(Boolean);
      if (pts.length >= 3) rings.push(pts);
    }
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
  buildings.push({ id, pts, h: r2(h), lv: levels, type, paris, area, name: tags.name });
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
  barriers.push({ kind, pts, h: parseFloat(w.tags.height) || (kind === 'wall' ? 2.2 : kind === 'hedge' ? 1.5 : kind === 'rail' ? 0.8 : 1.7) });
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
  let nCyc = (A.cycR ? 1 : 0) + (A.cycL ? 1 : 0);
  const travel = () => lanesTotal * lw + nBus * busW + nCyc * cycW;

  let pL = A.parkL, pR = A.parkR;
  const noAuto = A.living || A.roundabout || A.link || A.bridge || A.cls === 'service' || e.len < 25;
  const contra = A.ow && (A.busB || A.cycL);
  let wL = pL && pL !== 'no' ? PARK_W[pL] : 0;
  let wR = pR && pR !== 'no' ? PARK_W[pR] : 0;
  const autoL = pL === undefined && !noAuto && !contra;
  const autoR = pR === undefined && !noAuto;

  if (A.width) {
    // largeur relevée : on répartit
    let rem = A.width - travel() - wL - wR;
    if (rem >= 1.9 && autoR && !wR) { wR = 2.0; rem -= 2.0; pR = 'parallel'; }
    if (rem >= 1.9 && autoL && !wL) { wL = 2.0; rem -= 2.0; pL = 'parallel'; }
    if (rem > 0) lw += Math.min(0.7, rem / lanesTotal);
    else if (rem < 0) lw = Math.max(2.5, lw + rem / lanesTotal);
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
    const maxW = Math.max(2 * H, lanesTotal * 2.5 + nBus * 3.0 + nCyc * 1.2);
    if (W > maxW && wL) { W -= wL; wL = 0; }
    if (W > maxW && wR) { W -= wR; wR = 0; }
    if (W > maxW) {
      const over = W - maxW;
      lw = Math.max(2.5, lw - over / lanesTotal);
    }
  }

  const strips = [];
  if (wL) strips.push(['P', r2(wL), 0, pL]);
  if (A.cycL) strips.push(['C', cycW, -1]);
  if (A.busB) strips.push(['B', busW, -1]);
  for (let i = 0; i < A.nB; i++) strips.push(['L', r2(lw), -1]);
  for (let i = 0; i < A.nF; i++) strips.push(['L', r2(lw), 1]);
  if (A.busF) strips.push(['B', busW, 1]);
  if (A.cycR) strips.push(['C', cycW, 1]);
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
  let U = boolOp(UNION, all, null);
  log(`union chaussée : ${U.length} anneaux, ${nVerts(U)} sommets, ${(areaM2(U) / 1e4).toFixed(1)} ha`);
  // fermeture morphologique limitée au voisinage des carrefours → bordures arrondies
  const closed = inflate(inflate(U, KERB_R), -KERB_R);
  log('fermeture morphologique calculée');
  const discs = [];
  const maxHalf = new Array(vertices.length).fill(0);
  for (const e of edges) { maxHalf[e.ia] = Math.max(maxHalf[e.ia], e.width / 2); maxHalf[e.ib] = Math.max(maxHalf[e.ib], e.width / 2); }
  vertices.forEach((v, i) => {
    if (deg[i] < 3) return;
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
let band;
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
  band = boolOp(UNION, inflate(road, SIDEWALK_BAND).concat(ped), null);
  band = C.Clipper.CleanPolygons(band, 3);
  log(`bande de trottoir : ${band.length} anneaux, ${nVerts(band)} sommets`);
}

const chunks = {};
let nRoadV = 0, nWalkV = 0, nInnerV = 0;
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
    const innerPolys = exToPolys(boolEx(DIFF, rect, cellBand), x0, z0);
    nRoadV += countV(roadPolys); nWalkV += countV(walkPolys); nInnerV += countV(innerPolys);
    const ck = { r: roadPolys, w: walkPolys };
    if (innerPolys.length) ck.g = innerPolys;
    chunks[`${ci},${cj}`] = ck;
  }
}
log(`dalles : ${Object.keys(chunks).length} (${nRoadV} sommets chaussée, ${nWalkV} trottoir, ${nInnerV} cœurs d'îlot)`);

// ───────────────────────── Espaces, points d'intérêt ─────────────────────────
function areaKind(t) {
  if (t.building) return null;
  if (t.leisure && /^(park|garden|playground|dog_park)$/.test(t.leisure)) return 'park';
  if (t.landuse && /^(grass|village_green|greenery|flowerbed|recreation_ground|meadow|allotments)$/.test(t.landuse)) return 'grass';
  if (t.natural && /^(scrub|grassland|heath)$/.test(t.natural)) return 'grass';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'wood';
  if (t.leisure === 'pitch' || t.leisure === 'track') return 'pitch';
  if (t.natural === 'water' || t.leisure === 'swimming_pool') return 'water';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey') return 'parking';
  if ((t.highway === 'pedestrian' && t.area === 'yes') || t.place === 'square') return 'plaza';
  if (t.landuse === 'construction' || t.landuse === 'brownfield') return 'dirt';
  return null;
}
const areas = [];
function addArea(kind, ring, tags) {
  let pts = G.simplifyRing(ring, 0.2);
  if (pts.length < 3) return;
  let a = G.ringArea(pts);
  if (Math.abs(a) < 12) return;
  if (a < 0) pts.reverse();
  if (!pts.some(inRect)) return;
  areas.push({ kind, pts, name: tags.name, sport: tags.sport });
}
for (const w of ways.values()) {
  const k = areaKind(w.tags);
  if (!k) continue;
  if (w.nds.length < 4 || w.nds[0] !== w.nds[w.nds.length - 1]) continue;
  addArea(k, wayRing(w), w.tags);
}
for (const rel of relations.values()) {
  if (rel.tags.type !== 'multipolygon') continue;
  const k = areaKind(rel.tags);
  if (!k) continue;
  for (const ring of relationRings(rel)) addArea(k, ring, rel.tags);
}

// Découpe des espaces (pelouses, places…) par dalle, chaussée retirée
{
  const order = { water: 0, park: 1, grass: 2, wood: 3, pitch: 4, cemetery: 5, plaza: 6, parking: 7, dirt: 8 };
  let n = 0;
  const byCell = new Map();
  for (const a of areas) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of a.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    a.path = toPath(a.pts);
    for (let ci = Math.floor(x0 / CHUNK); ci <= Math.floor(x1 / CHUNK); ci++) for (let cj = Math.floor(z0 / CHUNK); cj <= Math.floor(z1 / CHUNK); cj++) {
      const k = `${ci},${cj}`;
      if (!chunks[k]) continue;
      let l = byCell.get(k); if (!l) byCell.set(k, (l = [])); l.push(a);
    }
  }
  for (const [k, list] of byCell) {
    const [ci, cj] = k.split(',').map(Number);
    const x0 = ci * CHUNK, z0 = cj * CHUNK;
    const rect = rectPath(x0, z0, x0 + CHUNK, z0 + CHUNK);
    const roadHere = boolOp(INTER, road, rect);
    const out = [];
    for (const a of list) {
      let clip = boolOp(INTER, [a.path], rect);
      if (!clip.length) continue;
      if (roadHere.length) clip = boolOp(DIFF, clip, roadHere);
      if (!clip.length) continue;
      const polys = exToPolys(boolEx(UNION, clip, null), x0, z0);
      for (const poly of polys) { out.push({ k: a.kind, o: poly.o, h: poly.h }); n++; }
    }
    out.sort((p, q) => (order[p.k] ?? 9) - (order[q.k] ?? 9));
    if (out.length) chunks[k].a = out;
  }
  log(`espaces découpés par dalle : ${n} polygones`);
}

// voies piétonnes linéaires et voies de tram (décor)
const lines = [];
for (const w of ways.values()) {
  const t = w.tags;
  let kind = null;
  if (t.highway === 'pedestrian' && t.area !== 'yes') kind = 'ped';
  else if (t.railway === 'tram') kind = 'tram';
  if (!kind) continue;
  if (t.tunnel && t.tunnel !== 'no') continue;
  let pts = w.nds.map((id) => nodeXZ.get(id)).filter(Boolean);
  if (pts.length < 2 || !pts.some(inRect)) continue;
  lines.push({ kind, pts: G.simplifyDP(pts, 0.1), name: t.name });
}

const trees = [], lamps = [], pois = [];
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
    else if (t.shop || (t.amenity && /^(restaurant|cafe|bar|fast_food|bank|driving_school|pub)$/.test(t.amenity))) k = 'shop';
    if (!k) continue;
    const o = { k, x: r2(p[0]), z: r2(p[1]) };
    if (t.name) o.n = t.name;
    if (k === 'shop') o.t = t.shop ?? t.amenity;
    if (k === 'bus' && t.shelter === 'yes') o.sh = 1;
    pois.push(o);
  }
}
for (const w of ways.values()) {
  if (w.tags.natural !== 'tree_row') continue;
  const pts = w.nds.map((id) => nodeXZ.get(id)).filter(Boolean);
  const len = G.polyLen(pts);
  for (let s = 0; s <= len; s += 9) {
    const p = G.pointAt(pts, s);
    if (inRect([p.x, p.z])) trees.push([r2(p.x), r2(p.z), 0, 0, '']);
  }
}
// arbres plantés sur la chaussée (imprécision de saisie) : on les retire
{
  const before = trees.length;
  const onRoad = (x, z) => {
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
  };
  for (let i = trees.length - 1; i >= 0; i--) if (onRoad(trees[i][0], trees[i][1])) trees.splice(i, 1);
  log(`arbres : ${trees.length} (${before - trees.length} retirés de la chaussée), lampadaires : ${lamps.length}, points : ${pois.length}`);
}

// ───────────────────────── Écriture ─────────────────────────
const flat = (pts) => { const a = []; for (const p of pts) a.push(r2(p[0]), r2(p[1])); return a; };
const out = {
  version: 1,
  name: 'Montreuil – Paris 20e',
  attribution: '© les contributeurs d’OpenStreetMap (ODbL)',
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
    return o;
  }),
  barriers: barriers.map((b) => ({ k: b.kind, h: b.h, p: flat(b.pts) })),
  areas: areas.filter((a) => a.name).map((a) => { const c = G.ringCentroid(a.pts); return { k: a.kind, x: r2(c[0]), z: r2(c[1]), n: a.name }; }),
  lines: lines.map((l) => ({ k: l.kind, p: flat(l.pts), n: l.name })),
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
