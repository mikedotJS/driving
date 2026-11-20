// Rattache chaque commerce (un point OpenStreetMap, souvent posé au milieu de la boutique) au mur
// d'immeuble qui porte sa devanture : le mur sur rue le plus proche. Calcul pur, sans DOM ni fichier,
// pour être testé seul (tests/enseignes.test.ts).
//
// Le rendu a besoin de trois choses : quel bâtiment, quel mur, et quelle portion de ce mur revient
// au commerce quand plusieurs se partagent la même façade.

/** Largeur maximale d'une devanture (m) : au-delà, un point isolé sur un long mur ferait une vitrine de 30 m. */
export const DEVANTURE_MAX = 6.4;
/** Un mur plus court que cela ne porte pas de vitrine (même seuil que les murs aveugles du rendu). */
const MUR_MIN = 1.7;
/** Distance maximale entre le point et le mur : à l'intérieur de son bâtiment, puis depuis le trottoir. */
const DIST_DEDANS = 14, DIST_DEHORS = 6;
/** Une rue « devant » le mur : axe à moins de cette distance du bord de chaussée (comme src/world/city.ts). */
const RUE_MAX = 9;
const CELL = 20;

// même clé que segKey de src/world/city.ts : deux bâtiments qui partagent un segment sont mitoyens
const cleSegment = (a, b) => {
  const ka = `${Math.round(a[0] * 4)},${Math.round(a[1] * 4)}`, kb = `${Math.round(b[0] * 4)},${Math.round(b[1] * 4)}`;
  return ka < kb ? ka + '|' + kb : kb + '|' + ka;
};

function dansPolygone(pts, x, z) {
  let c = false;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Projection de (x,z) sur le segment a→b : abscisse bornée, distance. */
function projeter(a, b, x, z) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  const px = a[0] + dx * t, pz = a[1] + dz * t;
  return { t, x: px, z: pz, d: Math.hypot(x - px, z - pz) };
}

class Grille {
  constructor() { this.m = new Map(); }
  ajouter(x0, z0, x1, z1, marge, v) {
    const i0 = Math.floor((Math.min(x0, x1) - marge) / CELL), i1 = Math.floor((Math.max(x0, x1) + marge) / CELL);
    const j0 = Math.floor((Math.min(z0, z1) - marge) / CELL), j1 = Math.floor((Math.max(z0, z1) + marge) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = i + ',' + j;
      let l = this.m.get(k);
      if (!l) this.m.set(k, (l = []));
      l.push(v);
    }
  }
  autour(x, z) { return this.m.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) ?? []; }
}

/**
 * @param points     [{ x, z }] commerces à rattacher
 * @param batiments  [{ pts: [[x,z],…], type }] dans l'ordre de la carte (l'indice sert de référence)
 * @param rues       [{ pts: [[x,z],…], half }] axes des rues et demi-largeur de chaussée
 * @returns pour chaque point, null ou { b, i, s, f0, f1 } : bâtiment, mur (du sommet i au suivant),
 *          abscisse de l'ancrage et portion [f0, f1] du mur attribuée au commerce (m depuis le sommet i)
 */
export function rattacher(points, batiments, rues) {
  // ── murs candidats : ni auvents, ni mitoyens, ni trop courts ──
  const vus = new Map();
  batiments.forEach((b) => {
    if (b.type === 'roof') return;
    const n = b.pts.length;
    for (let i = 0; i < n; i++) { const k = cleSegment(b.pts[i], b.pts[(i + 1) % n]); vus.set(k, (vus.get(k) ?? 0) + 1); }
  });
  const gRues = new Grille();
  for (const r of rues) for (let i = 0; i + 1 < r.pts.length; i++) {
    const a = r.pts[i], b = r.pts[i + 1];
    gRues.ajouter(a[0], a[1], b[0], b[1], RUE_MAX + r.half + 3, { a, b, half: r.half });
  }
  /** Y a-t-il une rue devant le point (x,z) du mur, du côté de la normale sortante (nx,nz) ? */
  const surRue = (x, z, nx, nz) => {
    const qx = x + nx * 3, qz = z + nz * 3;
    let best = null, bd = RUE_MAX;
    for (const s of gRues.autour(qx, qz)) {
      const p = projeter(s.a, s.b, qx, qz);
      const d = p.d - s.half;
      if (d < bd) { bd = d; best = p; }
    }
    return best !== null && (best.x - x) * nx + (best.z - z) * nz > 0;
  };
  const gMurs = new Grille();
  const boites = new Grille();
  batiments.forEach((bat, b) => {
    if (bat.type === 'roof') return;
    const pts = bat.pts, n = pts.length;
    let aire = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      aire += p[0] * q[1] - q[0] * p[1];
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
    }
    boites.ajouter(x0, z0, x1, z1, 0, b);
    const sgn = aire > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      if (len < MUR_MIN || vus.get(cleSegment(p, q)) > 1) continue;
      // normale sortante, même convention que le rendu
      gMurs.ajouter(p[0], p[1], q[0], q[1], DIST_DEDANS, { b, i, p, q, len, nx: (sgn * dz) / len, nz: (-sgn * dx) / len });
    }
  });

  // ── mur sur rue le plus proche de chaque point ──
  const res = points.map((pt) => {
    let dedans = -1;
    for (const b of boites.autour(pt.x, pt.z)) if (dansPolygone(batiments[b].pts, pt.x, pt.z)) { dedans = b; break; }
    // À défaut de mur sur rue (passage, dalle, rue hors du réseau du jeu), on se rabat sur le mur libre
    // le plus proche, mais seulement s'il est tout près : la devanture est alors presque sûrement là.
    let best = null, bd = Infinity, repli = null, rd = DIST_DEHORS;
    for (const m of gMurs.autour(pt.x, pt.z)) {
      // un point saisi dans un bâtiment reste sur ce bâtiment, même si le mur du voisin est plus près
      if (dedans >= 0 && m.b !== dedans) continue;
      const pr = projeter(m.p, m.q, pt.x, pt.z);
      if (pr.d > (dedans >= 0 ? DIST_DEDANS : DIST_DEHORS) || (pr.d >= bd && pr.d >= rd)) continue;
      // depuis le trottoir, le point doit être devant le mur, pas derrière l'immeuble
      if (dedans < 0 && (pt.x - pr.x) * m.nx + (pt.z - pr.z) * m.nz < -0.5) continue;
      const r = { b: m.b, i: m.i, s: Math.max(0.4, Math.min(m.len - 0.4, pr.t * m.len)), len: m.len };
      if (pr.d < bd && surRue(pr.x, pr.z, m.nx, m.nz)) { bd = pr.d; best = r; }
      else if (pr.d < rd) { rd = pr.d; repli = r; }
    }
    return best ?? repli;
  });

  // ── partage d'un même mur entre voisins ──
  const parMur = new Map();
  res.forEach((r, k) => {
    if (!r) return;
    const key = r.b + ':' + r.i;
    let l = parMur.get(key);
    if (!l) parMur.set(key, (l = []));
    l.push(k);
  });
  for (const l of parMur.values()) {
    l.sort((a, b) => res[a].s - res[b].s || a - b);
    l.forEach((k, j) => {
      const r = res[k];
      const gauche = j === 0 ? 0 : (res[l[j - 1]].s + r.s) / 2;
      const droite = j === l.length - 1 ? r.len : (r.s + res[l[j + 1]].s) / 2;
      r.f0 = Math.max(gauche, r.s - DEVANTURE_MAX / 2);
      r.f1 = Math.min(droite, r.s + DEVANTURE_MAX / 2);
    });
  }
  return res.map((r) => (r ? { b: r.b, i: r.i, s: r.s, f0: r.f0, f1: r.f1 } : null));
}

/**
 * Nom de station de chaque bouche de métro. Dans OpenStreetMap, le « name » d'une bouche est celui de
 * la sortie (« Rue de Paris ») ; la station se lit dans la relation stop_area qui contient la bouche,
 * et la ligne dans les relations d'itinéraire qui passent par un autre membre de cette stop_area.
 * @returns Map id du nœud → { station, ligne? }
 */
export function stationsDeMetro(relations) {
  const lignesParMembre = new Map();
  for (const r of relations.values()) {
    if (r.tags.type !== 'route' || r.tags.route !== 'subway' || !r.tags.ref) continue;
    for (const m of r.members) {
      let s = lignesParMembre.get(m.ref);
      if (!s) lignesParMembre.set(m.ref, (s = new Set()));
      s.add(r.tags.ref);
    }
  }
  // une station a parfois plusieurs stop_area (une par accès) : les lignes se cumulent par nom de station
  const aires = [], lignesParNom = new Map();
  for (const r of relations.values()) {
    if (r.tags.public_transport !== 'stop_area' || !r.tags.name) continue;
    aires.push(r);
    let lignes = lignesParNom.get(r.tags.name);
    if (!lignes) lignesParNom.set(r.tags.name, (lignes = new Set()));
    for (const m of r.members) for (const l of lignesParMembre.get(m.ref) ?? []) lignes.add(l);
  }
  const out = new Map();
  for (const r of aires) {
    const ligne = [...lignesParNom.get(r.tags.name)].sort((a, b) => parseFloat(a) - parseFloat(b) || (a < b ? -1 : 1)).join(',');
    for (const m of r.members) {
      if (m.type !== 'node' || out.has(m.ref)) continue;
      out.set(m.ref, ligne ? { station: r.tags.name, ligne } : { station: r.tags.name });
    }
  }
  return out;
}
