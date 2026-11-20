import { loadOsm } from './lib/osm-load.mjs';
const { nodes, ways, relations, files } = loadOsm(new URL('../data/osm-raw', import.meta.url).pathname);
console.log({ files, nodes: nodes.size, ways: ways.size, relations: relations.size });
const count = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m, n = 40) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}=${v}`).join('  ');
const hw = new Map(), hwTags = new Map(), nodeHw = new Map(), bTags = new Map(), keys = new Map();
let buildings = 0;
for (const w of ways.values()) {
  if (w.tags.highway) {
    count(hw, w.tags.highway);
    for (const k of Object.keys(w.tags)) count(hwTags, k);
  }
  if (w.tags.building) { buildings++; for (const k of Object.keys(w.tags)) count(bTags, k); }
  for (const k of Object.keys(w.tags)) count(keys, k);
}
const nodeKeys = new Map(), crossing = new Map(), natural = new Map(), amenity = new Map(), barrier = new Map();
for (const n of nodes.values()) {
  if (n.tags.highway) count(nodeHw, n.tags.highway);
  if (n.tags.crossing) count(crossing, n.tags.crossing);
  if (n.tags.natural) count(natural, n.tags.natural);
  if (n.tags.amenity) count(amenity, n.tags.amenity);
  if (n.tags.barrier) count(barrier, n.tags.barrier);
  for (const k of Object.keys(n.tags)) count(nodeKeys, k);
}
console.log('\nhighway ways:', top(hw));
console.log('\nhighway way tag keys:', top(hwTags, 90));
console.log('\nbuildings:', buildings, top(bTags, 40));
console.log('\nway keys:', top(keys, 60));
console.log('\nnode highway:', top(nodeHw));
console.log('\nnode crossing:', top(crossing));
console.log('\nnode natural:', top(natural), '\nnode barrier:', top(barrier, 15), '\nnode amenity:', top(amenity, 30));
console.log('\nnode keys:', top(nodeKeys, 70));
const vals = (key, filter = () => true) => { const m = new Map(); for (const w of ways.values()) if (w.tags.highway && filter(w) && w.tags[key] != null) count(m, w.tags[key]); return top(m, 30); };
for (const k of ['maxspeed', 'lanes', 'oneway', 'surface', 'width', 'junction', 'busway', 'cycleway', 'cycleway:right', 'cycleway:left', 'cycleway:both', 'sidewalk', 'parking:both', 'parking:left', 'parking:right', 'parking:lane:both', 'parking:lane:right', 'parking:lane:left', 'zone:maxspeed', 'source:maxspeed', 'maxspeed:type', 'tunnel', 'bridge', 'layer', 'lanes:psv', 'bus:lanes', 'lanes:bus', 'access', 'motor_vehicle', 'vehicle', 'service', 'turn:lanes', 'priority_road', 'lit', 'oneway:bicycle', 'psv', 'bus', 'traffic_calming', 'living_street', 'placement']) console.log(`\n${k}:`, vals(k));
const rel = new Map(); for (const r of relations.values()) count(rel, `${r.tags.type}/${r.tags.restriction ?? r.tags.route ?? r.tags.boundary ?? ''}`); console.log('\nrelations:', top(rel, 30));
