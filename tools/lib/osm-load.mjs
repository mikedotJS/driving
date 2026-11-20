// Charge et fusionne les tuiles OSM XML brutes (data/osm-raw/*.osm).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export function loadOsm(dir) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    isArray: (name) => ['node', 'way', 'relation', 'tag', 'nd', 'member'].includes(name),
  });
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  const files = readdirSync(dir).filter((f) => f.endsWith('.osm')).sort();
  for (const f of files) {
    const xml = readFileSync(join(dir, f), 'utf8');
    const doc = parser.parse(xml);
    const osm = doc.osm;
    for (const n of osm.node ?? []) {
      if (nodes.has(n.id)) continue;
      const tags = {};
      for (const t of n.tag ?? []) tags[t.k] = t.v;
      nodes.set(n.id, { id: n.id, lat: +n.lat, lon: +n.lon, tags });
    }
    for (const w of osm.way ?? []) {
      if (ways.has(w.id)) continue;
      const tags = {};
      for (const t of w.tag ?? []) tags[t.k] = t.v;
      ways.set(w.id, { id: w.id, nds: (w.nd ?? []).map((x) => x.ref), tags });
    }
    for (const r of osm.relation ?? []) {
      if (relations.has(r.id)) continue;
      const tags = {};
      for (const t of r.tag ?? []) tags[t.k] = t.v;
      relations.set(r.id, {
        id: r.id,
        members: (r.member ?? []).map((m) => ({ type: m.type, ref: m.ref, role: m.role })),
        tags,
      });
    }
  }
  return { nodes, ways, relations, files: files.length };
}
