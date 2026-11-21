// Génération du décor par dalles de 100 m : chaussée, trottoirs, bordures granit, caniveaux,
// marquages, immeubles (façades par travées, toits), murs et clôtures, espaces verts.
// Les tours et les barres sont dessinées à part, en permanence (silhouette lointaine).

import * as THREE from 'three';
import type { RoadNet, RawBuilding, RawPoly } from '../map/roadnet';
import type { MaterialLib } from '../render/materials';
import { GeoBuilder } from './geo';
import { buildMarkings, type MarkingSet } from './markings';
import { BAY_W } from './facades';
import { apparence, etages, toitEnPente, type Voisin } from './gabarit';
import { partager, vitrine } from './devantures';
import { Enseignes, cleCommerce, cleRepere, poseBandeau } from './enseignes';
import { hash32, Rng } from '../core/math';
import { POIDS, type Ortho } from './ortho';
import { TEINTE, TONS_MURET, habillage, poserAllee, poserMarches, poserMassif, teinteAllee, type RGB as Teinte } from './sol';

export const KERB_H = 0.14;
const CM = 0.01;

interface Chunk { group: THREE.Group; ci: number; cj: number }

type RGB = [number, number, number];
const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
// vertex colors : three.js les attend en espace linéaire
const lin = (c: RGB): RGB => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as RGB;
// Les immeubles d'au moins cette hauteur (tours, barres) sont sortis des dalles et dessinés en
// permanence, par grandes cases : ils se détachent ainsi à l'horizon bien au-delà du rayon de vue,
// comme la Cité de La Noue ou les tours de la porte de Bagnolet vues depuis la rue de Paris.
const HORIZON_H = 22;
const HORIZON_CELL = 500;
// Recherche du voisin renseigné : pas de la grille et distance maximale (m). 20 m, c'est la maison
// d'à côté ou celle d'en face ; à 35 m, une seule meulière connue habillait tout un pâté de maisons.
const VOISIN_CELL = 40;
const VOISIN_MAX = 20;
const gabaritDe = (l: number) => (l <= 2 ? 0 : l <= 5 ? 1 : 2);
// Haies taillées : une ligne fine à hauteur de poitrine. Les haies qui ferment un massif planté
// (Croix de Chavaux) ne sont plus des murs : la carte en fait des espaces « massif », bas et pleins.
const HAIE_H = 1.3;
const HAIE_EP = 0.45;
// Les espaces de la carte sont posés un peu au-dessus du trottoir qu'ils recouvrent par endroits ;
// entre eux ils ne se recouvrent pas (la carte les a découpés), donc une seule hauteur suffit.
const Y_ESPACE = KERB_H + 0.012;
const Y_ALLEE = KERB_H + 0.02;
// Plan de fond sous toute la ville : altitude et couleur (gris sombre d'un joint de bordure)
const Y_FOND = -0.12;
const FOND_SOL = 0x5f615f;
// En dessous de cette longueur, un mur ne reçoit pas de travée à fenêtre : la tuile de 3,2 m y
// serait comprimée au point de montrer des pierres et des fenêtres moitié moins larges qu'à côté.
const MUR_ETROIT = 2.3;

const COMMERCIAL = /^(primary|secondary|tertiary)$/;

/** Commerce rattaché à un mur par la carte : portion de mur, type, clé de son enseigne dans l'atlas. */
interface Devanture { i: number; f0: number; f1: number; t?: string; cle: string | null; graine: number }

export class City {
  readonly group = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private pending: [number, number][] = [];
  private lastCi = 1e9; private lastCj = 1e9;
  private markings: MarkingSet;
  private bBuckets = new Map<string, RawBuilding[]>();
  private barBuckets = new Map<string, { k: string; h: number; p: number[]; c?: number }[]>();
  /** allées et escaliers, rangés dans la dalle de leur premier point */
  private allees = new Map<string, { k: string; p: number[]; w?: number; s?: string }[]>();
  /** murs mitoyens : hauteur du plus bas des bâtiments qui se partagent le segment */
  private shared = new Map<string, number>();
  /** bâtiments d'habitation dont l'IGN connaît le matériau, rangés par cases de VOISIN_CELL */
  private connus = new Map<string, { x: number; z: number; g: number; v: Voisin }[]>();
  /** rang de chaque bâtiment dans la carte : c'est l'ordre des couleurs de toit relevées sur la photo */
  private rang = new Map<RawBuilding, number>();
  readonly size: number;
  /** nombre de dalles construites */
  built = 0;
  /**
   * Compléments de décor ajoutés à chaque dalle (mobilier, voitures garées…). `textes` est le lot de
   * la dalle pour tout ce qui s'écrit avec l'atlas des enseignes : y verser ses panneaux ne coûte
   * aucun appel de dessin de plus. De même `uni`, le lot à couleurs par sommet sans texture (massifs,
   * terre battue…), reçoit le petit mobilier.
   */
  decorators: ((key: string, group: THREE.Group, textes: GeoBuilder, uni: GeoBuilder) => void)[] = [];
  /** atlas des textes du décor (enseignes, arrêts, stations, plaques) */
  readonly enseignes: Enseignes;
  /** commerces de la carte, par bâtiment */
  private devantures = new Map<RawBuilding, Devanture[]>();
  /** textes des tours et des barres, dessinées à part : ils attendent la dalle où ils se trouvent */
  private textesEnAttente = new Map<string, GeoBuilder>();

  /**
   * `ortho` : photo aérienne du sol (facultative). Les lots de sol et de toit d'une dalle prennent alors
   * les matériaux de la dalle de photo qui la couvre ; sans elle, le sol reste procédural.
   */
  constructor(readonly net: RoadNet, readonly mats: MaterialLib, readonly ortho: Ortho | null = null) {
    this.size = net.map.chunk;
    this.markings = buildMarkings(net);
    mats.roof.vertexColors = true;
    const C = this.size;
    this.enseignes = new Enseignes(net.map);
    for (const p of net.map.pois) {
      if (p.fb === undefined || p.fi === undefined || p.f0 === undefined || p.f1 === undefined) continue;
      const b = net.map.buildings[p.fb];
      if (!b) continue;
      let l = this.devantures.get(b);
      if (!l) this.devantures.set(b, (l = []));
      l.push({ i: p.fi, f0: p.f0, f1: p.f1, t: p.k === 'pharmacy' ? 'pharmacy' : p.t, cle: cleCommerce(p), graine: hash32(`${p.x}|${p.z}`) });
    }
    // répartition des bâtiments par dalle + repérage des murs mitoyens
    const seen = new Map<string, [number, number]>();
    const tall = new Map<string, RawBuilding[]>();
    net.map.buildings.forEach((b, i) => this.rang.set(b, i));
    for (const b of net.map.buildings) {
      let cx = 0, cz = 0;
      const n = b.p.length / 2;
      for (let i = 0; i < n; i++) { cx += b.p[i * 2]; cz += b.p[i * 2 + 1]; }
      cx /= n; cz /= n;
      const far = b.h >= HORIZON_H && b.t !== 'roof';
      const map = far ? tall : this.bBuckets;
      const key = far ? `${Math.floor(cx / HORIZON_CELL)},${Math.floor(cz / HORIZON_CELL)}` : `${Math.floor(cx / C)},${Math.floor(cz / C)}`;
      let l = map.get(key);
      if (!l) map.set(key, (l = []));
      l.push(b);
      if (b.m !== undefined && (b.t === 'res' || b.t === 'house')) {
        const k = `${Math.floor(cx / VOISIN_CELL)},${Math.floor(cz / VOISIN_CELL)}`;
        let c = this.connus.get(k);
        if (!c) this.connus.set(k, (c = []));
        c.push({ x: cx, z: cz, g: gabaritDe(b.l), v: { m: b.m, r: b.r, y: b.y } });
      }
      // les auvents ne masquent pas le mur contre lequel ils s'appuient
      if (b.t === 'roof') continue;
      for (let i = 0; i < n; i++) {
        const k = segKey(b.p[i * 2], b.p[i * 2 + 1], b.p[((i + 1) % n) * 2], b.p[((i + 1) % n) * 2 + 1]);
        const e = seen.get(k);
        if (!e) seen.set(k, [1, b.h]); else { e[0]++; e[1] = Math.min(e[1], b.h); }
      }
    }
    for (const [k, e] of seen) if (e[0] > 1) this.shared.set(k, e[1]);
    for (const b of net.map.barriers) {
      const key = `${Math.floor(b.p[0] / C)},${Math.floor(b.p[1] / C)}`;
      let l = this.barBuckets.get(key);
      if (!l) this.barBuckets.set(key, (l = []));
      l.push(b);
    }
    for (const l of net.map.lines) {
      if (l.k !== 'allee' && l.k !== 'marches') continue;
      const key = `${Math.floor(l.p[0] / C)},${Math.floor(l.p[1] / C)}`;
      let a = this.allees.get(key);
      if (!a) this.allees.set(key, (a = []));
      a.push(l);
    }
    // Fond sous la ville : un seul plan sombre, 12 cm sous la chaussée. Entre deux polygones de sol
    // voisins, une fente d'un pixel laissait voir le ciel (traits bleus en vue rasante) ; elle montre
    // maintenant ce fond, de la teinte d'un joint.
    {
      const r = net.map.rect, marge = 50;
      const fond = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0 + 2 * marge, r.z1 - r.z0 + 2 * marge), new THREE.MeshBasicMaterial({ color: FOND_SOL }));
      fond.name = 'fond du sol';
      fond.rotation.x = -Math.PI / 2;
      fond.position.set((r.x0 + r.x1) / 2, Y_FOND, (r.z0 + r.z1) / 2);
      fond.matrixAutoUpdate = false; fond.updateMatrix();
      this.group.add(fond);
    }
    // silhouette lointaine : un seul maillage par case, façades et toits confondus (le toit prend la
    // tuile de béton uni), pour ne coûter qu'un appel de dessin par case en vue
    const toitLointain = mats.facades.layer('moderne', 'plain');
    for (const [key, list] of tall) {
      const g = new GeoBuilder(true, 3, 'facade');
      g.label = 'horizon ' + key;
      for (const b of list) this.building(b, g, g, this.enAttente, toitLointain);
      if (g.empty) continue;
      const mesh = new THREE.Mesh(g.build(), mats.facade);
      mesh.name = g.label;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
  }

  /** Lot de textes en attente pour la dalle qui contient (x, z). */
  private enAttente = (x: number, z: number): GeoBuilder => {
    const key = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let g = this.textesEnAttente.get(key);
    if (!g) this.textesEnAttente.set(key, (g = new GeoBuilder()));
    return g;
  };

  /** Construit immédiatement toutes les dalles dans un rayon donné. */
  ensureAround(x: number, z: number, radius: number) {
    const C = this.size;
    for (let ci = Math.floor((x - radius) / C); ci <= Math.floor((x + radius) / C); ci++) {
      for (let cj = Math.floor((z - radius) / C); cj <= Math.floor((z + radius) / C); cj++) this.buildChunk(ci, cj);
    }
  }

  /** Planifie les dalles proches et en construit quelques-unes (budget en millisecondes). */
  update(x: number, z: number, radius: number, budgetMs = 5) {
    const C = this.size;
    const ci0 = Math.floor(x / C), cj0 = Math.floor(z / C);
    const r = Math.ceil(radius / C);
    if (!this.pending.length || ci0 !== this.lastCi || cj0 !== this.lastCj) {
      // nouvelle dalle centrale : on replanifie du plus proche au plus lointain
      this.lastCi = ci0; this.lastCj = cj0;
      this.pending.length = 0;
      for (let d = 0; d <= r; d++) {
        for (let i = -d; i <= d; i++) for (let j = -d; j <= d; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== d) continue;
          const key = `${ci0 + i},${cj0 + j}`;
          if (!this.chunks.has(key) && this.net.map.chunks[key]) this.pending.push([ci0 + i, cj0 + j]);
        }
      }
    }
    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < budgetMs) {
      const [ci, cj] = this.pending.shift()!;
      this.buildChunk(ci, cj);
    }
    // visibilité selon la distance
    for (const c of this.chunks.values()) {
      const dx = (c.ci + 0.5) * C - x, dz = (c.cj + 0.5) * C - z;
      c.group.visible = dx * dx + dz * dz < (radius + C) * (radius + C);
    }
    // photo du sol : chargée jusqu'aux dalles visibles les plus lointaines, libérée au-delà
    this.ortho?.update(x, z, radius + C / 2);
    return this.pending.length;
  }

  private buildChunk(ci: number, cj: number) {
    const key = `${ci},${cj}`;
    if (this.chunks.has(key)) return;
    const raw = this.net.map.chunks[key];
    const group = new THREE.Group();
    group.name = 'dalle ' + key;
    this.chunks.set(key, { group, ci, cj });
    if (!raw) { this.group.add(group); return; }
    const C = this.size, ox = ci * C, oz = cj * C;
    const m = this.mats;
    const add = (g: GeoBuilder, mat: THREE.Material, cast = false, receive = true) => {
      if (g.empty) return;
      if (!g.label) g.label = `${key} ${mat.name || mat.type}`;
      const mesh = new THREE.Mesh(g.build(), mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };

    // ── chaussée ──
    const road = new GeoBuilder();
    road.label = key + ' chaussée';
    for (const p of raw.r) road.polygon(p.o, p.h, 0, 1 / 3.2, ox, oz, CM);
    // photo aérienne : matériaux de la dalle de photo qui couvre cette dalle (null si elle n'existe pas)
    const mo = this.ortho?.materiaux(ci, cj, C) ?? null;
    add(road, mo?.chaussee ?? m.road);
    // ── sol hors chaussée : un lot par matériau, teinté par sommet ──
    // minéral (trottoirs, cours, enrobé, béton, allées), végétal (jardins, parcs, pelouses), pavés,
    // uni (terre, sable, sol souple, massifs, haies, mobilier), eau
    // avec la photo, chaque sommet porte son poids (attribut « photo ») : nul sur les trottoirs, le mobilier, les massifs
    const ex = mo ? 1 : 0;
    const mineral = new GeoBuilder(true, ex, 'photo'), vegetal = new GeoBuilder(true, ex, 'photo'), pave = new GeoBuilder(), uni = new GeoBuilder(true, ex, 'photo'), eau = new GeoBuilder();
    mineral.label = key + ' sol minéral'; vegetal.label = key + ' sol végétal'; pave.label = key + ' pavés'; uni.label = key + ' uni'; eau.label = key + ' eau';
    const UV_MIN = 1 / 2.6, UV_VEG = 1 / 4;
    const lim = C / CM;
    for (const p of raw.w) mineral.polygon(p.o, p.h, KERB_H, UV_MIN, ox, oz, CM, 1, 1, 1, POIDS.trottoir);
    // cœurs d'îlot : cours au même niveau et dans la même matière que le trottoir, jardins en herbe
    if (raw.c) for (const p of raw.c) mineral.polygon(p.o, p.h, KERB_H, UV_MIN, ox, oz, CM, ...TEINTE.cour, POIDS.cour);
    if (raw.g) for (const p of raw.g) vegetal.polygon(p.o, p.h, KERB_H, UV_VEG, ox, oz, CM, ...TEINTE.jardin, POIDS.jardin);
    if (raw.a) {
      for (const a of raw.a) {
        if (a.k === 'massif') { poserMassif(vegetal, uni, a.o, a.h, KERB_H, (a.e ?? 4) / 10, ox, oz, CM, lim); continue; }
        const { lot, teinte: t } = habillage(a.k, a.s);
        if (lot === 'mineral') mineral.polygon(a.o, a.h, Y_ESPACE, UV_MIN, ox, oz, CM, ...t, POIDS.espace);
        else if (lot === 'vegetal') vegetal.polygon(a.o, a.h, Y_ESPACE, UV_VEG, ox, oz, CM, ...t, POIDS.espace);
        else if (lot === 'uni') uni.polygon(a.o, a.h, Y_ESPACE, 1, ox, oz, CM, ...t, POIDS.espace);
        else (lot === 'pave' ? pave : eau).polygon(a.o, a.h, Y_ESPACE, 1 / 3, ox, oz, CM);
      }
    }
    // allées des parcs et des jardins : rubans posés sur l'herbe
    const allees = this.allees.get(key);
    if (allees) {
      // un lot à part, décalé en profondeur : à 2 cm de l'herbe, les rubans scintilleraient de loin
      const ruban = new GeoBuilder(true);
      ruban.label = key + ' allées';
      for (const l of allees) {
        const larg = (l.w ?? 20) / 10;
        if (l.k === 'marches') poserMarches(ruban, l.p, larg, Y_ALLEE, UV_MIN);
        else poserAllee(ruban, l.p, larg, Y_ALLEE, UV_MIN, teinteAllee(l.s));
      }
      add(ruban, m.allee);
    }
    add(vegetal, mo?.vegetal ?? m.grass); add(pave, mo?.pave ?? m.plaza); add(eau, m.water);

    // ── bordures et caniveaux ──
    const kerb = new GeoBuilder(), gutter = new GeoBuilder();
    kerb.label = key + ' bordure'; gutter.label = key + ' caniveau';
    const ring = (r: number[], isHole: boolean) => {
      const n = r.length / 2;
      let area = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; }
      // côté chaussée : intérieur de l'anneau extérieur, extérieur des trous
      const insideLeft = area > 0;
      const roadLeft = isHole ? !insideLeft : insideLeft;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        // segments artificiels sur le bord de la dalle
        if ((ax <= 1 && bx <= 1) || (ax >= lim - 1 && bx >= lim - 1) || (az <= 1 && bz <= 1) || (az >= lim - 1 && bz >= lim - 1)) continue;
        const x0 = ox + ax * CM, z0 = oz + az * CM, x1 = ox + bx * CM, z1 = oz + bz * CM;
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
        if (l < 0.01) continue;
        // normale unitaire pointant vers la chaussée
        let nx = -dz / l, nz = dx / l;
        if (!roadLeft) { nx = -nx; nz = -nz; }
        const u0 = (x0 + z0) * 0.8, u1 = u0 + l * 0.8;
        // face verticale
        let a = kerb.vertex(x0, 0, z0, nx, 0, nz, u0, 0), b = kerb.vertex(x1, 0, z1, nx, 0, nz, u1, 0);
        let c = kerb.vertex(x1, KERB_H, z1, nx, 0, nz, u1, 0.12), d = kerb.vertex(x0, KERB_H, z0, nx, 0, nz, u0, 0.12);
        orient(kerb, a, b, c, d, nx, 0, nz);
        // dessus en granit (16 cm) côté trottoir
        const w = 0.16, y = KERB_H + 0.003;
        a = kerb.vertex(x0, y, z0, 0, 1, 0, u0, 0.12); b = kerb.vertex(x1, y, z1, 0, 1, 0, u1, 0.12);
        c = kerb.vertex(x1 - nx * w, y, z1 - nz * w, 0, 1, 0, u1, 0.26); d = kerb.vertex(x0 - nx * w, y, z0 - nz * w, 0, 1, 0, u0, 0.26);
        orient(kerb, a, b, c, d, 0, 1, 0);
        // caniveau (28 cm) côté chaussée
        const gw = 0.28, gy = 0.004;
        a = gutter.vertex(x0, gy, z0, 0, 1, 0, u0, 0); b = gutter.vertex(x1, gy, z1, 0, 1, 0, u1, 0);
        c = gutter.vertex(x1 + nx * gw, gy, z1 + nz * gw, 0, 1, 0, u1, 0.3); d = gutter.vertex(x0 + nx * gw, gy, z0 + nz * gw, 0, 1, 0, u0, 0.3);
        orient(gutter, a, b, c, d, 0, 1, 0);
      }
    };
    for (const p of raw.r) { ring(p.o, false); for (const h of p.h) ring(h, true); }
    add(kerb, m.kerb); add(gutter, m.gutter);

    // ── marquages ──
    const mk = this.markings.white.get(key);
    if (mk) { mk.label = key + ' marquage'; add(mk, m.paint); }

    // ── bâtiments ──
    // enseignes, plaques, noms d'arrêts : un seul lot par dalle, sur l'atlas commun
    const textes = this.textesEnAttente.get(key) ?? new GeoBuilder();
    this.textesEnAttente.delete(key);
    textes.label = key + ' enseignes';
    const list = this.bBuckets.get(key);
    if (list) {
      const walls = new GeoBuilder(true, 3, 'facade'), roofs = new GeoBuilder(true);
      walls.label = key + ' façades'; roofs.label = key + ' toits';
      for (const b of list) this.building(b, walls, roofs, () => textes);
      add(walls, m.facade, true); add(roofs, m.roof, true);
    }

    // ── murs, clôtures, haies ──
    const bars = this.barBuckets.get(key);
    if (bars) {
      const wall = new GeoBuilder(), fence = new GeoBuilder();
      wall.label = key + ' murs'; fence.label = key + ' clôtures';
      for (const b of bars) {
        // contour d'un massif : obstacle pour les collisions (Ground), dessiné comme un espace plein
        if (b.k === 'massif') continue;
        // muret de clôture d'un jardin sur rue : dans le lot minéral (texture du trottoir, teintée), sans appel de dessin de plus
        if (b.k === 'muret') {
          const ton = TONS_MURET[(b.c ?? 0) % TONS_MURET.length];
          for (let i = 0; i + 3 < b.p.length; i += 2) boxWall(mineral, b.p[i], b.p[i + 1], b.p[i + 2], b.p[i + 3], KERB_H, KERB_H + b.h, 0.2, ton);
          continue;
        }
        const haie = b.k === 'hedge';
        const g = haie ? uni : b.k === 'wall' ? wall : fence;
        const t = haie ? HAIE_EP : b.k === 'wall' ? 0.24 : 0.05;
        const h = haie ? Math.min(b.h, HAIE_H) : b.h;
        for (let i = 0; i + 3 < b.p.length; i += 2) boxWall(g, b.p[i], b.p[i + 1], b.p[i + 2], b.p[i + 3], KERB_H, KERB_H + h, t, haie ? TEINTE.haie : undefined);
      }
      // un grillage ne porte pas d'ombre pleine
      add(wall, m.wall, true); add(fence, m.fence, false);
    }

    for (const d of this.decorators) d(key, group, textes, uni);
    // le lot minéral est ajouté ici : les murets de clôture viennent d'y être versés
    add(mineral, mo?.mineral ?? m.sidewalk);
    add(uni, mo?.uni ?? m.uni);
    // sans ombre portée : un panneau plaqué au mur n'en projette pas de visible, et la passe d'ombre
    // redessine chaque lot jusqu'à trois fois
    add(textes, this.enseignes.material);
    group.updateMatrixWorld(true);
    this.group.add(group);
    this.built++;
  }

  /** Bâtiment renseigné le plus proche, de même gabarit, pour deviner le matériau d'un bâtiment sans donnée. */
  private voisin(b: RawBuilding, cx: number, cz: number): Voisin | undefined {
    if (b.m !== undefined || (b.t !== 'res' && b.t !== 'house') || b.lg) return undefined;
    const gab = gabaritDe(b.l);
    const ci = Math.floor(cx / VOISIN_CELL), cj = Math.floor(cz / VOISIN_CELL);
    let best: Voisin | undefined, bd = VOISIN_MAX * VOISIN_MAX;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const l = this.connus.get(`${i},${j}`);
      if (!l) continue;
      for (const c of l) {
        if (c.g !== gab) continue;
        const d = (c.x - cx) * (c.x - cx) + (c.z - cz) * (c.z - cz);
        if (d < bd) { bd = d; best = c.v; }
      }
    }
    return best;
  }

  /**
   * Verse un bâtiment dans les lots : murs dans `g`, toit dans `roofs`, enseignes et plaque dans le lot
   * de textes de la dalle où elles se trouvent (`textes`). Pour la silhouette lointaine, `roofs` est le
   * lot de façades lui-même et `roofLayer` la couche de la texture tableau à y mettre.
   */
  private building(b: RawBuilding, g: GeoBuilder, roofs: GeoBuilder, textes: (x: number, z: number) => GeoBuilder, roofLayer = 0) {
    const p = b.p, n = p.length / 2;
    const seed = hash32(`${p[0]}|${p[1]}|${n}`);
    const rng = new Rng(seed);
    // sens de parcours → normale sortante
    let area = 0, cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; cx += p[i * 2]; cz += p[i * 2 + 1]; }
    cx /= n; cz /= n;
    const sgn = area > 0 ? 1 : -1;
    const look = apparence(b, Math.abs(area) / 2, rng.next(), this.voisin(b, cx, cz));
    const style = look.style;
    const tint = lin(hex(rng.pick(look.murs)));
    let roofTint = lin(hex(rng.pick(look.toit)));
    // couleur du toit relevée sur la photo aérienne ; la silhouette lointaine (autre texture) garde la sienne
    const vu = roofs !== g ? this.ortho?.teinteToit(this.rang.get(b) ?? -1) : undefined;
    if (vu) roofTint = vu;
    const F = this.mats.facades;
    const top = KERB_H + b.h;
    const open = b.t === 'roof';
    const lPlain = F.layer(style, 'plain');

    // toit
    if (open) {
      roofs.polygon(p, [], top, 1 / 3, 0, 0, 1, roofTint[0], roofTint[1], roofTint[2], roofLayer);
      roofs.polygon(p, [], top - 0.25, 1 / 3, 0, 0, 1, roofTint[0] * 0.6, roofTint[1] * 0.6, roofTint[2] * 0.6, roofLayer);
      return;
    }
    const pans = look.pente > 0 ? toitEnPente(p, look.pente, look.faitage, look.largeurMax, look.monument) : null;
    if (pans) {
      // la texture de couverture est sombre : sans ce coup de clair, la tuile en pente vire au brun
      if (!vu) for (let i = 0; i < 3; i++) roofTint[i] *= 1.7;
      // la hauteur de la carte est celle de l'égout : le faîtage monte au-dessus
      const [ax, az] = pans.axe;
      for (const f of pans.versants) {
        const [nx, ny, nz] = faceNormal(f, 0, 1, 0);
        const ids = f.map((q) => {
          const u = (q[0] * ax + q[2] * az) / 2.4, v = (q[2] * ax - q[0] * az) / 2 + q[1] / 2;
          return roofs.vertex(q[0], top + q[1], q[2], nx, ny, nz, u, v, roofTint[0], roofTint[1], roofTint[2], u, v, roofLayer);
        });
        face(roofs, ids, nx, ny, nz);
      }
      for (const f of pans.pignons) {
        // le pignon regarde vers l'extérieur : à l'opposé du centre de l'emprise
        const [nx, ny, nz] = faceNormal(f, f[0][0] - cx, 0, f[0][2] - cz);
        const ids = f.map((q) => {
          const u = (q[2] * ax - q[0] * az) / BAY_W, v = -q[1] / 3;
          return g.vertex(q[0], top + q[1], q[2], nx, ny, nz, u, v, tint[0] * 0.95, tint[1] * 0.95, tint[2] * 0.95, u, v, lPlain);
        });
        face(g, ids, nx, ny, nz);
      }
      // sous-face : là où le toit déborde de l'emprise (décrochement, angle rentrant), on ferme le
      // dessous à hauteur d'égout, sinon on voit le ciel entre les murs et les tuiles
      if (pans.sousFace) {
        const ids = pans.sousFace.map((q) => {
          const u = q[0] / BAY_W, v = q[1] / 3;
          return g.vertex(q[0], top, q[1], 0, -1, 0, u, v, tint[0] * 0.7, tint[1] * 0.7, tint[2] * 0.7, u, v, lPlain);
        });
        for (let i = 1; i + 1 < ids.length; i++) face(g, [ids[0], ids[i], ids[i + 1]], 0, -1, 0);
      }
    } else {
      roofs.polygon(p, [], top, 1 / 3, 0, 0, 1, roofTint[0], roofTint[1], roofTint[2], roofLayer);
    }

    // rez-de-chaussée plus bas pour les maisons, plus haut pour les halls d'ateliers et de bureaux
    const maison = style === 'pavillon' || (style === 'meuliere' && b.l <= 3);
    const groundH = Math.min(b.h, maison ? 2.9 : style === 'industriel' || style === 'civique' ? 4.2 : style === 'verre' ? 4 : 3.5);
    const et = etages(b.h, b.l, groundH, look.etage);
    const yG = KERB_H + groundH;
    const yU = yG + et.n * et.h;
    const upRole = rng.next() < 0.5 ? 'upperA' : 'upperB';
    const lUpper = F.layer(style, upRole), lUpper2 = F.layer(style, upRole === 'upperA' ? 'upperB' : 'upperA');
    const lGround = F.layer(style, 'ground');
    // garages et remises : la « porte » est la porte basculante du pavillon
    const lDoor = look.aveugle && style === 'pavillon' ? lGround : F.layer(style, 'door');
    // Commerces en pied d'immeuble : d'abord ceux de la carte, chacun sur son mur. Le tirage ne sert
    // plus qu'à meubler les grands axes là où OpenStreetMap n'a rien : il est rare, et pèse selon
    // l'usage relevé par l'IGN, pour ne pas inventer de boutiques sans nom à côté des vraies.
    const dev = this.devantures.get(b);
    const shopP = dev ? 0 : b.u === undefined ? 0.3 : b.u === 'c' || b.u2 === 'c' ? 0.5 : 0.1;
    const shopOk = b.t === 'res' && b.l >= 2 && !look.aveugle && style !== 'pavillon' && style !== 'verre' && style !== 'industriel';
    const shopBuilding = rng.next() < shopP && shopOk;
    const shopBase = rng.int(0, 5);

    // mur le plus long donnant sur une rue → porte d'entrée
    interface Wall { i: number; len: number; facing: boolean; commercial: boolean; nx: number; nz: number; party: boolean; low: number }
    const wallsInfo: Wall[] = [];
    let doorWall = -1, doorLen = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      const nx = (sgn * dz) / (len || 1), nz = (-sgn * dx) / (len || 1);
      const low = this.shared.get(segKey(x0, z0, x1, z1));
      const party = low !== undefined;
      let facing = false, commercial = false;
      if (!party && len > 1.6) {
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const loc = this.net.locate(mx + nx * 3, mz + nz * 3);
        if (loc && loc.dist < 9) {
          const pt = loc.edge.line.at(loc.s);
          if ((pt.x - mx) * nx + (pt.z - mz) * nz > 0) {
            facing = true;
            commercial = COMMERCIAL.test(loc.edge.cls) || /^Rue (de Paris|du Capitaine Dreyfus|d'Avron|de Bagnolet|des Pyrénées)$/.test(loc.edge.name);
          }
        }
      }
      if (facing && len > doorLen) { doorLen = len; doorWall = i; }
      wallsInfo.push({ i, len, facing, commercial, nx, nz, party, low: low ?? 0 });
    }

    // Mur de l'entrée, qui reçoit la porte, la plaque et le clocher ou le beffroi. Sur rue, c'est le
    // plus long mur sur rue. Un édifice en retrait (mairie sur sa place, église sur son parvis) n'en
    // a pas : on prend celui qui regarde la rue la plus proche. Pour un édifice public ou une église
    // on ne se fie pas au seul mur sur rue, qui est souvent le pignon d'une aile : la façade d'honneur
    // est dans l'axe du bâtiment, et elle donne sur une vraie rue plutôt que sur une venelle.
    const plaque = b.n ? this.enseignes.get(cleRepere(b.n)) : undefined;
    const edifice = b.t === 'pub' || b.t === 'church';
    let entree = doorWall, recul = 0;
    if ((plaque && entree < 0) || edifice) {
      let mieux = Infinity;
      for (const w of wallsInfo) {
        if (w.party || w.len < 4) continue;
        const j = (w.i + 1) % n;
        const mx = (p[w.i * 2] + p[j * 2]) / 2, mz = (p[w.i * 2 + 1] + p[j * 2 + 1]) / 2;
        const loc = this.net.locate(mx + w.nx * 3, mz + w.nz * 3);
        if (!loc || loc.dist > 60) continue;
        const pt = loc.edge.line.at(loc.s);
        if ((pt.x - mx) * w.nx + (pt.z - mz) * w.nz <= 0) continue;
        // à recul comparable, le mur le plus long : la façade principale plutôt qu'un retour
        let note = loc.dist - Math.min(w.len, edifice ? 16 : 30) / 2;
        if (edifice) {
          // écart du milieu du mur à l'axe du bâtiment, de 0 (dans l'axe) à 1 (en bout d'aile)
          const ux = -w.nz, uz = w.nx;
          let lo = Infinity, hi = -Infinity;
          for (let k = 0; k < n; k++) { const v = p[k * 2] * ux + p[k * 2 + 1] * uz; if (v < lo) lo = v; if (v > hi) hi = v; }
          note += (30 * Math.abs(mx * ux + mz * uz - (lo + hi) / 2)) / Math.max(1, (hi - lo) / 2);
          if (/^(living_street|pedestrian|service|footway)$/.test(loc.edge.cls)) note += 10;
        }
        if (note < mieux) { mieux = note; entree = w.i; recul = loc.dist; }
      }
      if (entree < 0) entree = doorWall;
    }

    for (const w of wallsInfo) {
      const i = w.i, j = (i + 1) % n;
      const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
      if (w.len < 0.05) continue;
      const pignon = w.party || w.len < 1.7;
      const blind = pignon || (w.len < MUR_ETROIT && i !== entree && !dev?.some((d) => d.i === i));
      // teinte légèrement plus sombre pour les pignons aveugles et les façades sur cour
      const k = pignon ? 0.86 : w.facing ? 1 : 0.93;
      const r = tint[0] * k, gg = tint[1] * k, bb = tint[2] * k;
      const nb = Math.max(1, Math.round(w.len / BAY_W));
      const q = (xa: number, za: number, xb: number, zb: number, yb: number, yt: number, ua: number, ub: number, vt: number, vb: number, layer: number, s = 1) => {
        const a = g.vertex(xa, yb, za, w.nx, 0, w.nz, ua, vb, r * s, gg * s, bb * s, ua, vb, layer);
        const b2 = g.vertex(xb, yb, zb, w.nx, 0, w.nz, ub, vb, r * s, gg * s, bb * s, ub, vb, layer);
        const c = g.vertex(xb, yt, zb, w.nx, 0, w.nz, ub, vt, r * s, gg * s, bb * s, ub, vt, layer);
        const d = g.vertex(xa, yt, za, w.nx, 0, w.nz, ua, vt, r * s, gg * s, bb * s, ua, vt, layer);
        orient(g, a, b2, c, d, w.nx, 0, w.nz);
      };
      const lay = (i % 3 === 2 && nb > 1) ? lUpper2 : lUpper;
      if (blind) {
        // mitoyen nettement plus haut que son voisin (tour sur un socle, immeuble contre un pavillon) :
        // les étages qui dépassent ont des fenêtres, calées sur les planchers du reste de l'immeuble
        const k0 = w.party && et.n > 0 && w.len >= 1.7 && b.h > w.low + 5 ? Math.max(0, Math.ceil((KERB_H + w.low - yG) / et.h)) : et.n;
        if (k0 < et.n && !look.aveugle) {
          const yS = yG + k0 * et.h;
          q(x0, z0, x1, z1, KERB_H, yS, w.len / BAY_W, 0, 0, (yS - KERB_H) / 3, lPlain);
          q(x0, z0, x1, z1, yS, yU, nb, 0, 0, et.n - k0, lay);
          if (et.bandeau > 0.05) q(x0, z0, x1, z1, yU, top, w.len / BAY_W, 0, 0, et.bandeau / 3, lPlain, 0.9);
          continue;
        }
        // mur aveugle : enduit uni sur toute la hauteur
        q(x0, z0, x1, z1, KERB_H, top, w.len / BAY_W, 0, 0, b.h / 3, lPlain);
        continue;
      }
      // rez-de-chaussée, travée par travée (u décroissant le long du mur : texture non inversée vue de la rue)
      const shop = shopBuilding && w.commercial;
      const doorBay = i === entree ? Math.floor(nb / 2) : -1;
      // vrais commerces de ce mur : leurs travées prennent une vitrine, et leur nom le bandeau au-dessus
      const ici = dev?.filter((d) => d.i === i);
      const part = ici?.length ? partager(w.len, nb, ici) : null;
      if (ici && part) {
        // le bandeau recouvre celui de la tuile de vitrine : les 0,62 m du haut d'une tuile de 3 m
        const hb = (0.62 * groundH) / 3;
        const ux = (x1 - x0) / w.len, uz = (z1 - z0) / w.len;
        ici.forEach((d, k) => {
          const c = this.enseignes.get(d.cle);
          const { a, b: fin } = part.bandeaux[k];
          const larg = fin - a - 0.16;
          if (!c || larg < 0.7) return;
          const mx = x0 + ux * (a + fin) / 2, mz = z0 + uz * (a + fin) / 2;
          poseBandeau(textes(mx, mz), c, mx, yG - hb / 2, mz, w.nx, w.nz, larg, Math.min(hb - 0.08, 0.56));
        });
      }
      for (let k2 = 0; k2 < nb; k2++) {
        const ta = k2 / nb, tb = (k2 + 1) / nb;
        let layer = lGround;
        const qui = part ? part.travees[k2] : -1;
        if (qui >= 0) layer = F.shop(vitrine(ici![qui].t, ici![qui].graine));
        else if (shop) layer = k2 === doorBay && nb > 2 ? lDoor : F.shop(shopBase + Math.floor(k2 / 2) + i);
        else if (k2 === doorBay) layer = lDoor;
        else if (look.aveugle) layer = lPlain;
        else if (style === 'pavillon' && (k2 + seed) % 3 !== 0) layer = F.layer(style, 'upperA');
        else if (!w.facing && style !== 'industriel' && style !== 'verre') layer = (k2 + i) % 2 ? lGround : lPlain;
        q(x0 + (x1 - x0) * ta, z0 + (z1 - z0) * ta, x0 + (x1 - x0) * tb, z0 + (z1 - z0) * tb, KERB_H, yG, 1, 0, 0, 1, layer);
      }
      // étages : une tuile par étage, quelle que soit leur hauteur réelle
      if (et.n > 0) {
        q(x0, z0, x1, z1, yG, yU, nb, 0, 0, et.n, !look.aveugle && (w.facing || nb > 1) ? lay : lPlain);
        // bandeau de couronnement
        if (et.bandeau > 0.05) q(x0, z0, x1, z1, yU, top, w.len / BAY_W, 0, 0, et.bandeau / 3, lPlain, 0.9);
      } else if (top > yG + 0.02) {
        q(x0, z0, x1, z1, yG, top, w.len / BAY_W, 0, 0, (top - yG) / 3, lPlain, 0.95);
      }
    }

    // bâtiment nommé (mairie, église, théâtre, tour, résidence…) : son nom sur une plaque, au-dessus
    // de l'entrée ; les lettres grandissent avec le recul pour rester lisibles depuis la chaussée
    const w = entree >= 0 ? wallsInfo[entree] : null, j = (entree + 1) % n;
    if (plaque && w && w.len > 3) {
      const c = plaque;
      const mx = (p[entree * 2] + p[j * 2]) / 2, mz = (p[entree * 2 + 1] + p[j * 2 + 1]) / 2;
      const h = Math.min(0.6 + Math.min(recul, 36) / 40, Math.max(0.3, top - yG - 0.1), ((w.len - 0.8) / c.w) * c.h);
      // sous les appuis de fenêtre du premier étage (à cheval sur le plancher quand la plaque est
      // grande) ; sur un bâtiment sans étage, sous la corniche
      const y = et.n > 0 ? yG + (h > 0.62 ? 0 : 0.08 + h / 2) : Math.max(KERB_H + h / 2 + 0.2, top - 0.15 - h / 2);
      poseBandeau(textes(mx, mz), c, mx, y, mz, w.nx, w.nz, (c.w * h) / c.h, h);
    }

    // Clocher ou beffroi : une tour carrée derrière la façade d'entrée, dans les mêmes lots que le
    // bâtiment (une vingtaine de triangles). C'est ce qui fait reconnaître l'église ou la mairie de
    // loin, bien avant qu'on puisse lire la plaque.
    if (look.tour && w && w.len >= 4) {
      const clocher = look.tour === 'clocher';
      const cote = Math.min(clocher ? 6.5 : 9, Math.max(clocher ? 4 : 6, Math.sqrt(Math.abs(area) / 2) * 0.2), w.len);
      const mx = (p[entree * 2] + p[j * 2]) / 2, mz = (p[entree * 2 + 1] + p[j * 2 + 1]) / 2;
      const ux = -w.nz, uz = w.nx, d = cote / 2;
      const ox = mx - w.nx * (d + 0.4), oz = mz - w.nz * (d + 0.4);
      // coins dans l'ordre : avant gauche, avant droit, arrière droit, arrière gauche
      const coins: [number, number][] = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, f]) => [ox + ux * d * a + w.nx * d * f, oz + uz * d * a + w.nz * d * f]);
      // la tour doit tomber dans l'emprise : derrière une façade en biais ou trop mince, on s'en passe
      if (coins.every(([x, z]) => dedans(p, ox + (x - ox) * 0.9, oz + (z - oz) * 0.9))) {
        const fut = top + (pans?.faite ?? 0) + (clocher ? 2 : 5);
        const chambre = fut + (clocher ? 4.5 : 4);
        const lBaie = F.layer(style, 'upperA');
        for (let k = 0; k < 4; k++) {
          const [xa, za] = coins[k], [xb, zb] = coins[(k + 1) % 4];
          const fnx = (xa + xb) / 2 - ox, fnz = (za + zb) / 2 - oz, fl = Math.hypot(fnx, fnz);
          const nx = fnx / fl, nz = fnz / fl;
          const pan = (yb: number, yt: number, u1: number, v1: number, layer: number) => {
            const ids = [g.vertex(xa, yb, za, nx, 0, nz, u1, v1, tint[0], tint[1], tint[2], u1, v1, layer), g.vertex(xb, yb, zb, nx, 0, nz, 0, v1, tint[0], tint[1], tint[2], 0, v1, layer),
              g.vertex(xb, yt, zb, nx, 0, nz, 0, 0, tint[0], tint[1], tint[2], 0, 0, layer), g.vertex(xa, yt, za, nx, 0, nz, u1, 0, tint[0], tint[1], tint[2], u1, 0, layer)];
            face(g, ids, nx, 0, nz);
          };
          // fût nu, puis la chambre des cloches (ou la salle haute du beffroi) : une baie par face
          pan(top, fut, cote / BAY_W, (fut - top) / 3, lPlain);
          pan(fut, chambre, 1, 1, lBaie);
          if (clocher) {
            // flèche à quatre pans
            const fl2 = cote * 1.3, sx = ox, sz = oz;
            const q: V3[] = [[xa, chambre, za], [xb, chambre, zb], [sx, chambre + fl2, sz]];
            const [tx, ty, tz] = faceNormal(q, nx, 0, nz);
            const ids = q.map((v, m) => roofs.vertex(v[0], v[1], v[2], tx, ty, tz, m === 2 ? 0.5 : m, m === 2 ? 1 : 0, roofTint[0], roofTint[1], roofTint[2], m === 2 ? 0.5 : m, m === 2 ? 1 : 0, roofLayer));
            face(roofs, ids, tx, ty, tz);
          }
        }
        if (!clocher) {
          // terrasse du beffroi
          const ids = coins.map(([x, z]) => roofs.vertex(x, chambre, z, 0, 1, 0, x / 3, z / 3, roofTint[0], roofTint[1], roofTint[2], x / 3, z / 3, roofLayer));
          face(roofs, ids, 0, 1, 0);
        }
      }
    }
  }
}

/** Le point (x, z) est-il dans le polygone p (x0, z0, x1, z1…) ? Règle pair-impair. */
function dedans(p: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

type V3 = readonly [number, number, number];
/** Normale unitaire d'une face plane, retournée s'il le faut pour regarder vers (dx,dy,dz). */
function faceNormal(f: readonly V3[], dx: number, dy: number, dz: number): [number, number, number] {
  const a = f[0], b = f[1], c = f[2];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  return nx * dx + ny * dy + nz * dz >= 0 ? [nx, ny, nz] : [-nx, -ny, -nz];
}

/** Indexe un triangle ou un quadrilatère de façon que sa face avant regarde vers (nx,ny,nz). */
function face(g: GeoBuilder, ids: number[], nx: number, ny: number, nz: number) {
  if (ids.length === 4) { orient(g, ids[0], ids[1], ids[2], ids[3], nx, ny, nz); return; }
  const P = g.pos, [a, b, c] = ids;
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
  if (d >= 0) g.tri(a, b, c); else g.tri(a, c, b);
}

function segKey(x0: number, z0: number, x1: number, z1: number): string {
  const a = `${Math.round(x0 * 4)},${Math.round(z0 * 4)}`, b = `${Math.round(x1 * 4)},${Math.round(z1 * 4)}`;
  return a < b ? a + '|' + b : b + '|' + a;
}

/** Indexe le quadrilatère a,b,c,d de façon que sa face avant regarde vers (nx,ny,nz). */
function orient(g: GeoBuilder, a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number) {
  const P = g.pos;
  const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
  const vx = P[d * 3] - P[a * 3], vy = P[d * 3 + 1] - P[a * 3 + 1], vz = P[d * 3 + 2] - P[a * 3 + 2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  if (cx * nx + cy * ny + cz * nz >= 0) g.quadIdx(a, b, c, d); else g.quadIdx(a, d, c, b);
}

/** Mur épais (deux faces + dessus) entre deux points. */
function boxWall(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, yb: number, yt: number, t: number, col: Teinte = [1, 1, 1]) {
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
  if (l < 0.05) return;
  const nx = -dz / l, nz = dx / l, h = t / 2;
  const us = l / 2.5, vs = (yt - yb) / 2.5;
  for (const s of [1, -1]) {
    const ox = nx * h * s, oz = nz * h * s;
    const a = g.vertex(x0 + ox, yb, z0 + oz, nx * s, 0, nz * s, 0, 0, col[0] * 0.85, col[1] * 0.85, col[2] * 0.85), b = g.vertex(x1 + ox, yb, z1 + oz, nx * s, 0, nz * s, us, 0, col[0] * 0.85, col[1] * 0.85, col[2] * 0.85);
    const c = g.vertex(x1 + ox, yt, z1 + oz, nx * s, 0, nz * s, us, vs, col[0] * 0.85, col[1] * 0.85, col[2] * 0.85), d = g.vertex(x0 + ox, yt, z0 + oz, nx * s, 0, nz * s, 0, vs, col[0] * 0.85, col[1] * 0.85, col[2] * 0.85);
    orient(g, a, b, c, d, nx * s, 0, nz * s);
  }
  const a = g.vertex(x0 + nx * h, yt, z0 + nz * h, 0, 1, 0, 0, 0, col[0], col[1], col[2]), b = g.vertex(x1 + nx * h, yt, z1 + nz * h, 0, 1, 0, us, 0, col[0], col[1], col[2]);
  const c = g.vertex(x1 - nx * h, yt, z1 - nz * h, 0, 1, 0, us, 0.1, col[0], col[1], col[2]), d = g.vertex(x0 - nx * h, yt, z0 - nz * h, 0, 1, 0, 0, 0.1, col[0], col[1], col[2]);
  orient(g, a, b, c, d, 0, 1, 0);
}
