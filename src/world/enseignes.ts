// Textes du décor : bandeaux d'enseigne des commerces, noms des arrêts de bus et des stations de
// métro, plaques des bâtiments nommés. Tous les noms viennent d'OpenStreetMap.
//
// Un seul atlas et un seul matériau pour toute la carte, un seul lot de géométrie par dalle : un
// millier de textes ne coûtent ainsi qu'un appel de dessin par dalle visible. L'atlas est rempli une
// fois au chargement — le remplir au fil des dalles renverrait toute la texture au processeur
// graphique à chaque nouveau nom, d'où des à-coups en roulant.

import * as THREE from 'three';
import type { MapFile } from '../map/roadnet';
import type { GeoBuilder } from './geo';
import { drawText, splitTwo, textWidth } from './signs';
import { teinteEnseigne, texteEnseigne } from './devantures';

type Ctx = CanvasRenderingContext2D;
type Poi = MapFile['pois'][number];

/** Résolution des bandeaux (px par mètre) : lisible à une quinzaine de mètres sans peser sur la mémoire. */
const PX_M = 64;
/** Hauteur d'un bandeau d'enseigne (m) et de sa cellule (px). */
export const BANDEAU_H = 0.5;
const BANDEAU_PX = Math.round(BANDEAU_H * PX_M);
const ATLAS_W = 4096;
/** Marge entre deux cellules : évite qu'un texte bave sur son voisin dans les niveaux de mipmap. */
const GOUTTIERE = 3;

export interface Cellule { u0: number; v0: number; u1: number; v1: number; /** taille au sol (m) */ w: number; h: number; /** point de couleur de fond unie */ uf: number; vf: number }
interface Etiquette { cle: string; w: number; h: number; pxw: number; pxh: number; /** couleur du pourtour */ bord: string; dessin: (g: Ctx, w: number, h: number) => void }

// ───────────────────────── clés ─────────────────────────
// Deux commerces de même nom et de même famille partagent leur cellule (les onze Franprix n'en font qu'une).
export const cleCommerce = (p: Poi): string | null =>
  p.n && p.t !== 'vacant' ? `e|${p.k === 'pharmacy' ? 'pharmacy' : p.t ?? ''}|${p.b ?? ''}|${texteEnseigne(p.n)}` : null;
export const cleBus = (p: Poi): string | null => (p.n ? `b|${p.n}|${p.r ?? ''}` : null);
export const cleAbri = (p: Poi): string | null => (p.n ? `a|${p.n}` : null);
export const cleMetro = (p: Poi): string | null => (p.n ? `m|${p.n}|${p.l ?? ''}` : null);
/** Nom d'un édifice tel qu'il est gravé sur sa plaque. */
const texteRepere = (nom: string): string => texteEnseigne(nom, 44).toUpperCase();
export const cleRepere = (nom: string): string => `r|${texteRepere(nom)}`;
export const CLE_TREMIE = 't|';

// ───────────────────────── dessins ─────────────────────────
const mesure = (() => {
  let g: Ctx | null = null;
  return (): Ctx => (g ??= document.createElement('canvas').getContext('2d')!);
})();

/** Bandeau d'une ligne : texte centré sur fond uni, largeur réglée sur le texte. */
function bandeau(cle: string, texte: string, fond: string, encre: string, opts: { cadre?: string; hauteur?: number; croix?: boolean } = {}): Etiquette {
  const hm = opts.hauteur ?? BANDEAU_H;
  const pxh = Math.round(hm * PX_M);
  const cap = pxh * 0.46;
  const marge = Math.round(pxh * 0.45) + (opts.croix ? pxh : 0);
  const pxw = Math.min(900, Math.ceil(textWidth(mesure(), texte, cap, { ratio: 0.8 }) + 2 * marge));
  return {
    cle, w: pxw / PX_M, h: hm, pxw, pxh, bord: opts.cadre ?? fond,
    dessin: (g, w, h) => {
      g.fillStyle = fond; g.fillRect(0, 0, w, h);
      if (opts.cadre) { g.strokeStyle = opts.cadre; g.lineWidth = 1.5; g.strokeRect(2.5, 2.5, w - 5, h - 5); }
      if (opts.croix) {
        // croix verte de pharmacie, de part et d'autre du nom
        g.fillStyle = encre;
        for (const cx of [marge / 2 + 2, w - marge / 2 - 2]) {
          const r = h * 0.3, e = h * 0.11;
          g.fillRect(cx - e, h / 2 - r, 2 * e, 2 * r); g.fillRect(cx - r, h / 2 - e, 2 * r, 2 * e);
        }
      }
      drawText(g, texte, w / 2, h / 2 + 0.5, w - 2 * marge + 4, cap, { color: encre, ratio: 0.8 });
    },
  };
}

// couleurs officielles des lignes du métro parisien (celles qui desservent la carte)
const LIGNES: Record<string, [string, string]> = { '3': ['#6e6e00', '#ffffff'], '9': ['#b6bd00', '#1d1d1b'], '11': ['#704b1c', '#ffffff'], '3bis': ['#6ec4e8', '#1d1d1b'] };

/** Totem de station : « M » jaune cerclé, nom de la station, pastille de la ligne. */
function metro(cle: string, station: string, ligne: string): Etiquette {
  const w = 1.8, h = 0.52, pxw = Math.round(w * 160), pxh = Math.round(h * 160);
  return {
    cle, w, h, pxw, pxh, bord: '#14213d',
    dessin: (g, W, H) => {
      g.fillStyle = '#14213d'; g.fillRect(0, 0, W, H);
      const r = H * 0.36, cx = H * 0.5;
      g.fillStyle = '#ffcd00'; g.beginPath(); g.arc(cx, H / 2, r, 0, Math.PI * 2); g.fill();
      drawText(g, 'M', cx, H / 2, r * 1.25, r * 1.05, { color: '#14213d', ratio: 1 });
      const lignes = ligne ? ligne.split(',') : [];
      const pr = H * 0.24;
      let droite = W - H * 0.14;
      for (const l of lignes.slice(0, 2).reverse()) {
        const [fond, encre] = LIGNES[l] ?? ['#ffffff', '#14213d'];
        g.fillStyle = fond; g.beginPath(); g.arc(droite - pr, H / 2, pr, 0, Math.PI * 2); g.fill();
        drawText(g, l, droite - pr, H / 2, pr * 1.4, pr * 0.95, { color: encre, ratio: 0.9 });
        droite -= 2 * pr + H * 0.08;
      }
      const x0 = cx + r + H * 0.16, larg = droite - x0 - H * 0.04;
      const deux = textWidth(g, station, H * 0.26, { ratio: 0.8 }) * 0.7 > larg ? splitTwo(station) : null;
      if (deux) {
        drawText(g, deux[0], x0 + larg / 2, H * 0.32, larg, H * 0.2, { color: '#ffffff', ratio: 0.8 });
        drawText(g, deux[1], x0 + larg / 2, H * 0.68, larg, H * 0.2, { color: '#ffffff', ratio: 0.8 });
      } else drawText(g, station, x0 + larg / 2, H / 2, larg, H * 0.26, { color: '#ffffff', ratio: 0.8 });
    },
  };
}

/** Tête de poteau d'arrêt : bandeau « BUS », nom de l'arrêt, numéros des lignes. */
function bus(cle: string, nom: string, lignes: string): Etiquette {
  const w = 0.64, h = 0.8, pxw = Math.round(w * 220), pxh = Math.round(h * 220);
  return {
    cle, w, h, pxw, pxh, bord: '#3c4146',
    dessin: (g, W, H) => {
      g.fillStyle = '#f6f6f2'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#00a88f'; g.fillRect(0, 0, W, H * 0.2);
      drawText(g, 'BUS', W / 2, H * 0.105, W * 0.6, H * 0.11, { color: '#ffffff', ratio: 0.95 });
      const deux = textWidth(g, nom, H * 0.13, { ratio: 0.8 }) > W * 0.88 ? splitTwo(nom) : null;
      if (deux) {
        drawText(g, deux[0], W / 2, H * 0.34, W * 0.9, H * 0.11, { color: '#1d1d1b', ratio: 0.8 });
        drawText(g, deux[1], W / 2, H * 0.54, W * 0.9, H * 0.11, { color: '#1d1d1b', ratio: 0.8 });
      } else drawText(g, nom, W / 2, H * 0.44, W * 0.9, H * 0.13, { color: '#1d1d1b', ratio: 0.8 });
      // numéros de ligne en cartouches, comme sur les poteaux de la RATP
      const refs = lignes.split(/[;,]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
      if (refs.length) {
        const cw = Math.min(W * 0.26, (W * 0.9) / refs.length - 3), ch = H * 0.17, y = H * 0.72;
        let x = (W - refs.length * (cw + 3) + 3) / 2;
        for (const r of refs) {
          g.fillStyle = '#1c3f94'; g.fillRect(x, y, cw, ch);
          drawText(g, r, x + cw / 2, y + ch / 2, cw * 0.84, ch * 0.5, { color: '#ffffff', ratio: 0.85 });
          x += cw + 3;
        }
      }
      g.strokeStyle = '#3c4146'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
    },
  };
}

/** Escalier de bouche de métro vu de dessus : posé à plat sur le trottoir, il suggère la trémie. */
function tremie(): Etiquette {
  return {
    cle: CLE_TREMIE, w: 1.4, h: 3.2, pxw: 56, pxh: 128, bord: '#55555a',
    dessin: (g, W, H) => {
      const marches = 12;
      for (let i = 0; i < marches; i++) {
        // de plus en plus sombre en descendant
        const k = 1 - i / marches;
        g.fillStyle = `rgb(${Math.round(30 + 110 * k)},${Math.round(30 + 108 * k)},${Math.round(32 + 104 * k)})`;
        g.fillRect(0, (i * H) / marches, W, H / marches + 1);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, ((i + 1) * H) / marches - 1.5, W, 1.5);
      }
    },
  };
}

// ───────────────────────── atlas ─────────────────────────
export class Enseignes {
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshStandardMaterial;
  private cellules = new Map<string, Cellule>();
  /** dimensions de l'atlas (px) et nombre de textes, pour le journal et les mesures */
  readonly largeur: number; readonly hauteur: number;
  get nombre() { return this.cellules.size; }

  constructor(map: MapFile) {
    // ── inventaire : tout ce qui portera un texte, dédoublonné par clé ──
    const liste = new Map<string, Etiquette>();
    const ajouter = (cle: string | null, creer: (cle: string) => Etiquette) => { if (cle && !liste.has(cle)) liste.set(cle, creer(cle)); };
    for (const p of map.pois) {
      if ((p.k === 'shop' || p.k === 'pharmacy') && p.fb !== undefined && p.n) {
        ajouter(cleCommerce(p), (cle) => {
          const pharmacie = p.k === 'pharmacy';
          const t = teinteEnseigne(pharmacie ? 'pharmacy' : p.t, p.n!, p.b);
          return bandeau(cle, texteEnseigne(p.n!), t.fond, t.texte, { croix: pharmacie });
        });
      } else if (p.k === 'bus' && p.n) {
        ajouter(cleBus(p), (cle) => bus(cle, p.n!, p.r ?? ''));
        if (p.sh) ajouter(cleAbri(p), (cle) => bandeau(cle, p.n!, '#3c4146', '#ffffff', { hauteur: 0.26 }));
      } else if (p.k === 'metro' && p.n) {
        ajouter(cleMetro(p), (cle) => metro(cle, p.n!, p.l ?? ''));
        ajouter(CLE_TREMIE, tremie);
      }
    }
    // plaques des bâtiments nommés : lettres claires sur fond sombre, comme une plaque de bronze
    for (const b of map.buildings) {
      if (b.n && b.t !== 'roof') ajouter(cleRepere(b.n), (cle) => bandeau(cle, texteRepere(b.n!), '#2a2723', '#e6d6a8', { cadre: '#8f7f52', hauteur: 0.6 }));
    }

    // ── rangement par étagères, des plus hautes aux plus basses ──
    const items = [...liste.values()].sort((a, b) => b.pxh - a.pxh || b.pxw - a.pxw || (a.cle < b.cle ? -1 : 1));
    const places: { e: Etiquette; x: number; y: number }[] = [];
    let x = GOUTTIERE, y = GOUTTIERE, rang = 0;
    for (const e of items) {
      if (x + e.pxw + GOUTTIERE > ATLAS_W) { x = GOUTTIERE; y += rang + GOUTTIERE; rang = 0; }
      places.push({ e, x, y });
      x += e.pxw + GOUTTIERE; rang = Math.max(rang, e.pxh);
    }
    const W = ATLAS_W, H = Math.max(64, Math.ceil((y + rang + GOUTTIERE) / 64) * 64);
    this.largeur = W; this.hauteur = H;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#2e3138'; g.fillRect(0, 0, W, H);
    for (const { e, x: ex, y: ey } of places) {
      // la couleur du pourtour déborde d'un pixel dans la gouttière, pour que le filtrage n'y ramène
      // pas le fond de l'atlas
      g.fillStyle = e.bord; g.fillRect(ex - 1, ey - 1, e.pxw + 2, e.pxh + 2);
      g.save();
      g.beginPath(); g.rect(ex, ey, e.pxw, e.pxh); g.clip();
      g.translate(ex, ey);
      e.dessin(g, e.pxw, e.pxh);
      g.restore();
      this.cellules.set(e.cle, {
        u0: ex / W, u1: (ex + e.pxw) / W, v0: 1 - (ey + e.pxh) / H, v1: 1 - ey / H, w: e.w, h: e.h,
        // un point du fond, près du bord gauche : il sert à peindre le reste du bandeau de la même couleur
        uf: (ex + 1.5) / W, vf: 1 - (ey + e.pxh * 0.5) / H,
      });
    }
    this.texture = new THREE.CanvasTexture(cv);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    // mêmes réglages de shader que les plaques de rue (texture + seuil alpha) : le programme est partagé
    this.material = new THREE.MeshStandardMaterial({ map: this.texture, alphaTest: 0.5, roughness: 0.6, metalness: 0.02 });
    this.material.name = 'enseignes';
  }

  get(cle: string | null): Cellule | undefined { return cle ? this.cellules.get(cle) : undefined; }
}

// ───────────────────────── géométrie ─────────────────────────
/**
 * Panneau vertical centré en (cx, cy, cz), tourné vers (nx, nz). Vu de face, la gauche de l'image
 * est du côté −(nz, −nx), comme pour les panneaux de signalisation.
 */
export function panneau(g: GeoBuilder, c: Cellule, cx: number, cy: number, cz: number, nx: number, nz: number, w: number, h: number): void {
  const rx = nz, rz = -nx;
  const a = g.vertex(cx - rx * w / 2, cy - h / 2, cz - rz * w / 2, nx, 0, nz, c.u0, c.v0);
  const b = g.vertex(cx + rx * w / 2, cy - h / 2, cz + rz * w / 2, nx, 0, nz, c.u1, c.v0);
  const d = g.vertex(cx - rx * w / 2, cy + h / 2, cz - rz * w / 2, nx, 0, nz, c.u0, c.v1);
  const e = g.vertex(cx + rx * w / 2, cy + h / 2, cz + rz * w / 2, nx, 0, nz, c.u1, c.v1);
  g.quadIdx(a, b, e, d);
}

/** Aplat de la couleur de fond de la cellule : mêmes sommets qu'un panneau, mais un seul point de texture. */
function fond(g: GeoBuilder, c: Cellule, cx: number, cy: number, cz: number, nx: number, nz: number, w: number, h: number): void {
  const rx = nz, rz = -nx;
  const a = g.vertex(cx - rx * w / 2, cy - h / 2, cz - rz * w / 2, nx, 0, nz, c.uf, c.vf);
  const b = g.vertex(cx + rx * w / 2, cy - h / 2, cz + rz * w / 2, nx, 0, nz, c.uf, c.vf);
  const d = g.vertex(cx - rx * w / 2, cy + h / 2, cz - rz * w / 2, nx, 0, nz, c.uf, c.vf);
  const e = g.vertex(cx + rx * w / 2, cy + h / 2, cz + rz * w / 2, nx, 0, nz, c.uf, c.vf);
  g.quadIdx(a, b, e, d);
}

/**
 * Bandeau d'enseigne de largeur `w` et de hauteur `h` plaqué sur un mur : un aplat sur toute la
 * largeur de la devanture, et le nom centré par-dessus. Le texte n'est jamais étiré ; s'il est trop
 * long pour la devanture, on le resserre jusqu'à 62 % puis on le réduit, sans qu'il déborde.
 */
export function poseBandeau(g: GeoBuilder, c: Cellule, cx: number, cy: number, cz: number, nx: number, nz: number, w: number, h: number): void {
  fond(g, c, cx + nx * 0.05, cy, cz + nz * 0.05, nx, nz, w, h);
  const k0 = h / c.h;
  const naturel = c.w * k0;
  let tw = naturel, th = h;
  if (naturel > w) {
    const f = w / naturel;
    if (f < 0.62) { const k = f / 0.62; tw = naturel * 0.62 * k; th = h * k; } else tw = w;
  }
  panneau(g, c, cx + nx * 0.062, cy, cz + nz * 0.062, nx, nz, tw, th);
}

/** Rectangle horizontal posé au sol (trémie de métro), grand axe selon (tx, tz). */
export function auSol(g: GeoBuilder, c: Cellule, cx: number, y: number, cz: number, tx: number, tz: number): void {
  const hx = -tz * c.w / 2, hz = tx * c.w / 2, lx = tx * c.h / 2, lz = tz * c.h / 2;
  const P: [number, number, number, number][] = [
    [cx - hx - lx, cz - hz - lz, c.u0, c.v0], [cx + hx - lx, cz + hz - lz, c.u1, c.v0],
    [cx + hx + lx, cz + hz + lz, c.u1, c.v1], [cx - hx + lx, cz - hz + lz, c.u0, c.v1],
  ];
  const ids = P.map((p) => g.vertex(p[0], y, p[1], 0, 1, 0, p[2], p[3]));
  // face vers le haut quel que soit le sens de (tx, tz)
  const ux = P[1][0] - P[0][0], uz = P[1][1] - P[0][1], vx = P[3][0] - P[0][0], vz = P[3][1] - P[0][1];
  if (uz * vx - ux * vz >= 0) g.quadIdx(ids[0], ids[1], ids[2], ids[3]); else g.quadIdx(ids[0], ids[3], ids[2], ids[1]);
}
