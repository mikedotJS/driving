// Façades procédurales : chaque « tuile » représente une travée (≈ 3,2 m) sur un étage (≈ 3 m).
// Les tuiles sont empilées dans une texture tableau ; le canal alpha sert de masque de vitrage
// (alpha = 0 → vitre réfléchissante).
//
// Styles inspirés du bâti de Paris 20e et de Montreuil : haussmannien, faubourg enduit,
// brique des HBM, pavillon de banlieue, barre moderne, contemporain, industriel, équipement public.

import * as THREE from 'three';
import { Rng } from '../core/math';

export const TILE = 512;
export const BAY_W = 3.2;   // m
export const FLOOR_H = 3.0; // m

export type FacadeStyle = 'haussmann' | 'faubourg' | 'brique' | 'pavillon' | 'moderne' | 'contemporain' | 'industriel' | 'public';
export const STYLES: FacadeStyle[] = ['haussmann', 'faubourg', 'brique', 'pavillon', 'moderne', 'contemporain', 'industriel', 'public'];
/** rôles des tuiles d'un style */
export type TileRole = 'upperA' | 'upperB' | 'ground' | 'door' | 'plain';
const ROLES: TileRole[] = ['upperA', 'upperB', 'ground', 'door', 'plain'];
export const SHOP_TILES = 6;

export interface FacadeSet {
  texture: THREE.DataArrayTexture;
  /** indice de couche pour (style, rôle) */
  layer(style: FacadeStyle, role: TileRole): number;
  /** indice de couche d'une vitrine de commerce (0..SHOP_TILES-1) */
  shop(i: number): number;
  layers: number;
}

type Ctx = CanvasRenderingContext2D;
interface Pair { c: Ctx; m: Ctx; rng: Rng }

const PX = TILE / BAY_W;       // px par mètre (horizontal)
const PY = TILE / FLOOR_H;     // px par mètre (vertical)

function makePair(seed: string): Pair & { color: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const color = document.createElement('canvas'); color.width = color.height = TILE;
  const mask = document.createElement('canvas'); mask.width = mask.height = TILE;
  const c = color.getContext('2d')!, m = mask.getContext('2d')!;
  m.fillStyle = '#fff'; m.fillRect(0, 0, TILE, TILE);
  return { c, m, rng: new Rng(seed), color, mask };
}

// ── primitives (coordonnées en mètres, origine en haut à gauche de la tuile) ──
function R(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.fillRect(x * PX, y * PY, w * PX, h * PY);
}
function shade(ctx: Ctx, x: number, y: number, w: number, h: number, a0: number, a1: number, vertical = true, rgb = '0,0,0') {
  const g = vertical ? ctx.createLinearGradient(0, y * PY, 0, (y + h) * PY) : ctx.createLinearGradient(x * PX, 0, (x + w) * PX, 0);
  g.addColorStop(0, `rgba(${rgb},${a0})`); g.addColorStop(1, `rgba(${rgb},${a1})`);
  ctx.fillStyle = g; ctx.fillRect(x * PX, y * PY, w * PX, h * PY);
}
function grain(p: Pair, amount: number, scale = 1) {
  const { c, rng } = p;
  const n = Math.floor(2600 * amount);
  for (let i = 0; i < n; i++) {
    const v = rng.next();
    c.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.02 + rng.next() * 0.05})` : `rgba(255,255,255,${0.02 + rng.next() * 0.04})`;
    const s = (1 + rng.next() * 3) * scale;
    c.fillRect(rng.next() * TILE, rng.next() * TILE, s, s);
  }
}
/** coulures de salissure sous une arête horizontale */
function streaks(p: Pair, x: number, y: number, w: number, len: number, alpha = 0.1) {
  const { c, rng } = p;
  for (let i = 0; i < w * 14; i++) {
    const sx = x + rng.next() * w, l = len * (0.3 + rng.next() * 0.7);
    const g = c.createLinearGradient(0, y * PY, 0, (y + l) * PY);
    g.addColorStop(0, `rgba(40,36,30,${alpha * (0.4 + rng.next() * 0.6)})`); g.addColorStop(1, 'rgba(40,36,30,0)');
    c.fillStyle = g; c.fillRect(sx * PX, y * PY, (0.01 + rng.next() * 0.03) * PX, l * PY);
  }
}
function tileImage(p: Pair, img: HTMLImageElement | null, base: string, metres: number, tint?: string) {
  const { c } = p;
  c.fillStyle = base; c.fillRect(0, 0, TILE, TILE);
  if (img && img.width) {
    const s = metres * PX;
    c.save();
    c.globalAlpha = 1;
    for (let y = 0; y < TILE; y += s) for (let x = 0; x < TILE; x += s) c.drawImage(img, x, y, s, s);
    if (tint) { c.globalCompositeOperation = 'multiply'; c.fillStyle = tint; c.fillRect(0, 0, TILE, TILE); }
    c.restore();
  }
}

interface WinOpts {
  frame: string; glassTop: string; glassBot: string;
  mullions: number; transom?: number; recess?: number;
  curtain?: number; sill?: string; divided?: boolean;
}
/** fenêtre vitrée avec embrasure ombrée, menuiseries, reflet et masque de vitrage */
function windowAt(p: Pair, x: number, y: number, w: number, h: number, o: WinOpts) {
  const { c, m, rng } = p;
  const rec = o.recess ?? 0.07;
  // embrasure (ombre portée du linteau et du tableau)
  R(c, x - rec, y - rec, w + 2 * rec, h + 2 * rec, 'rgba(0,0,0,0.38)');
  R(c, x, y, w, h, o.frame);
  const f = 0.055; // largeur du dormant
  const gx = x + f, gy = y + f, gw = w - 2 * f, gh = h - 2 * f;
  const g = c.createLinearGradient(0, gy * PY, 0, (gy + gh) * PY);
  g.addColorStop(0, o.glassTop); g.addColorStop(1, o.glassBot);
  c.fillStyle = g; c.fillRect(gx * PX, gy * PY, gw * PX, gh * PY);
  m.fillStyle = '#000'; m.fillRect(gx * PX, gy * PY, gw * PX, gh * PY);
  // rideaux / voilages (zones mates derrière la vitre)
  if ((o.curtain ?? 0.5) > rng.next()) {
    const cw = gw * (0.18 + rng.next() * 0.2);
    const col = rng.pick(['rgba(235,230,220,0.75)', 'rgba(210,205,198,0.7)', 'rgba(190,180,170,0.6)', 'rgba(225,215,200,0.8)']);
    R(c, gx, gy, cw, gh, col); R(c, gx + gw - cw, gy, cw, gh, col);
    m.fillStyle = '#777'; m.fillRect(gx * PX, gy * PY, cw * PX, gh * PY); m.fillRect((gx + gw - cw) * PX, gy * PY, cw * PX, gh * PY);
  }
  // ombre du linteau sur la vitre
  shade(c, gx, gy, gw, gh * 0.22, 0.35, 0);
  // menuiseries
  const bar = 0.04;
  for (let i = 1; i <= o.mullions; i++) {
    const mx = gx + (gw * i) / (o.mullions + 1) - bar / 2;
    R(c, mx, gy, bar, gh, o.frame); m.fillStyle = '#fff'; m.fillRect(mx * PX, gy * PY, bar * PX, gh * PY);
  }
  if (o.transom) {
    const ty = gy + gh * o.transom - bar / 2;
    R(c, gx, ty, gw, bar, o.frame); m.fillStyle = '#fff'; m.fillRect(gx * PX, ty * PY, gw * PX, bar * PY);
  }
  if (o.divided) {
    for (let i = 1; i < 3; i++) {
      const ty = gy + (gh * i) / 3;
      R(c, gx, ty - 0.012, gw, 0.024, o.frame); m.fillStyle = '#fff'; m.fillRect(gx * PX, (ty - 0.012) * PY, gw * PX, 0.024 * PY);
    }
  }
  if (o.sill) {
    R(c, x - 0.1, y + h, w + 0.2, 0.07, o.sill);
    shade(c, x - 0.1, y + h + 0.07, w + 0.2, 0.09, 0.3, 0);
  }
}
/** persiennes ouvertes de part et d'autre d'une fenêtre */
function shutters(p: Pair, x: number, y: number, w: number, h: number, col: string) {
  const { c } = p;
  const sw = w * 0.48;
  for (const sx of [x - sw - 0.02, x + w + 0.02]) {
    R(c, sx, y, sw, h, col);
    for (let ly = y + 0.05; ly < y + h - 0.03; ly += 0.07) R(c, sx + 0.03, ly, sw - 0.06, 0.02, 'rgba(0,0,0,0.22)');
    shade(c, sx, y, sw, h, 0.0, 0.18, false);
    R(c, sx, y + h, sw, 0.02, 'rgba(0,0,0,0.25)');
  }
}
/** garde-corps en ferronnerie */
function ironRail(p: Pair, x: number, y: number, w: number, h: number, col = '#1b1b1d', ornate = true) {
  const { c } = p;
  c.strokeStyle = col; c.lineWidth = 0.025 * PX; c.lineCap = 'butt';
  R(c, x, y, w, 0.035, col); R(c, x, y + h - 0.03, w, 0.03, col);
  const n = Math.max(4, Math.round(w / 0.11));
  for (let i = 0; i <= n; i++) R(c, x + (w * i) / n - 0.008, y, 0.016, h, col);
  if (ornate) {
    c.lineWidth = 0.014 * PX;
    const k = Math.max(2, Math.round(w / 0.45));
    for (let i = 0; i < k; i++) {
      const cx = (x + (w * (i + 0.5)) / k) * PX, cy = (y + h * 0.52) * PY;
      c.beginPath(); c.ellipse(cx, cy, (w / k) * 0.36 * PX, h * 0.3 * PY, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(cx, cy, h * 0.1 * PY, 0, Math.PI * 2); c.stroke();
    }
  }
}
function finish(p: ReturnType<typeof makePair>): ImageData {
  const cd = p.c.getImageData(0, 0, TILE, TILE);
  const md = p.m.getImageData(0, 0, TILE, TILE).data;
  for (let i = 0; i < cd.data.length; i += 4) cd.data[i + 3] = md[i];
  return cd;
}

const GLASS_DAY = ['#5d7186', '#2c3a47'];
const GLASS_DARK = ['#48596a', '#1d262f'];

export interface WallImages { plaster: HTMLImageElement | null; brick: HTMLImageElement | null; concrete: HTMLImageElement | null; stone: HTMLImageElement | null; beige: HTMLImageElement | null }

// ── styles ──
function drawStyle(style: FacadeStyle, role: TileRole, im: WallImages): ImageData {
  const p = makePair(style + role);
  const { c, rng } = p;
  const W = BAY_W, H = FLOOR_H;
  const upper = role === 'upperA' || role === 'upperB';

  switch (style) {
    case 'haussmann': {
      // pierre de taille blonde, refends, hautes fenêtres à garde-corps
      tileImage(p, im.stone, '#d8cdb4', 3.2, '#efe4cc');
      shade(c, 0, 0, W, H, 0.0, 0.06);
      for (let y = 0; y < H; y += 0.42) R(c, 0, y, W, 0.012, 'rgba(70,58,40,0.22)');
      if (role === 'plain') { for (let y = 0.21; y < H; y += 0.84) R(c, W / 2, y, 0.01, 0.42, 'rgba(70,58,40,0.2)'); break; }
      if (role === 'door') {
        // porte cochère
        const dw = 2.1, dx = (W - dw) / 2;
        R(c, dx - 0.16, 0.25, dw + 0.32, H - 0.25, '#cfc4aa');
        c.fillStyle = '#20352b';
        c.beginPath(); c.moveTo(dx * PX, H * PY); c.lineTo(dx * PX, 1.0 * PY); c.arc((dx + dw / 2) * PX, 1.0 * PY, (dw / 2) * PX, Math.PI, 0); c.lineTo((dx + dw) * PX, H * PY); c.fill();
        R(c, dx + dw / 2 - 0.012, 0.5, 0.024, H - 0.5, 'rgba(0,0,0,0.5)');
        for (const px of [dx + 0.2, dx + dw / 2 + 0.14]) { R(c, px, 1.2, dw / 2 - 0.34, 0.75, 'rgba(255,255,255,0.05)'); R(c, px, 2.1, dw / 2 - 0.34, 0.7, 'rgba(0,0,0,0.16)'); }
        shade(c, dx, 0.3, dw, 0.5, 0.45, 0);
        R(c, 0, H - 0.5, dx - 0.16, 0.5, '#bdb39c'); R(c, dx + dw + 0.16, H - 0.5, W, 0.5, '#bdb39c');
        break;
      }
      if (role === 'ground') {
        windowAt(p, 0.85, 0.5, 1.5, 1.85, { frame: '#e9e4d8', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 1, transom: 0.28, sill: '#c9bfa6', curtain: 0.8 });
        for (let i = 0; i < 9; i++) R(c, 0.9 + i * 0.17, 0.55, 0.02, 1.8, '#1c1c1e');
        R(c, 0, H - 0.55, W, 0.55, '#bdb39c'); shade(c, 0, H - 0.55, W, 0.06, 0.25, 0);
        break;
      }
      const wx = 0.95, ww = 1.3, wy = role === 'upperA' ? 0.42 : 0.5, wh = role === 'upperA' ? 2.3 : 2.15;
      R(c, wx - 0.2, wy - 0.22, ww + 0.4, wh + 0.3, '#e2d8c0');
      R(c, wx - 0.26, wy - 0.3, ww + 0.52, 0.1, '#cabfa5'); shade(c, wx - 0.26, wy - 0.2, ww + 0.52, 0.08, 0.3, 0);
      windowAt(p, wx, wy, ww, wh, { frame: '#f1ede4', glassTop: GLASS_DAY[0], glassBot: GLASS_DAY[1], mullions: 1, transom: 0.2, curtain: 0.7 });
      if (role === 'upperA') {
        // balcon filant
        R(c, 0, H - 0.2, W, 0.2, '#c5baa0'); shade(c, 0, H - 0.2, W, 0.05, 0, 0.25);
        ironRail(p, 0, H - 1.12, W, 0.92);
      } else ironRail(p, wx - 0.05, wy + wh - 0.95, ww + 0.1, 0.9);
      streaks(p, 0, 0, W, 0.5, 0.05);
      break;
    }
    case 'faubourg': {
      tileImage(p, im.plaster, '#e3ddd0', 3.2, '#f2ece0');
      if (role === 'plain') { streaks(p, 0, 0, W, 1.4, 0.07); break; }
      if (upper) { R(c, 0, H - 0.16, W, 0.1, '#cfc8b9'); shade(c, 0, H - 0.06, W, 0.06, 0.2, 0); }
      if (role === 'door') {
        const dx = 1.05, dw = 1.1;
        R(c, dx - 0.1, 0.55, dw + 0.2, H - 0.55, '#d2cbbb');
        R(c, dx, 0.65, dw, H - 0.65, rng.pick(['#2f4a5a', '#5a2f2f', '#34452f', '#3b3b3f']));
        R(c, dx + 0.12, 0.8, dw - 0.24, 0.75, 'rgba(255,255,255,0.07)'); R(c, dx + 0.12, 1.75, dw - 0.24, 1.0, 'rgba(0,0,0,0.14)');
        R(c, dx + dw - 0.2, 1.75, 0.05, 0.14, '#c9a94e');
        shade(c, dx, 0.65, dw, 0.3, 0.4, 0);
        R(c, 0.35, 1.1, 0.22, 0.3, '#b9b9b9'); // digicode / boîte
        R(c, 0, H - 0.45, W, 0.45, '#b9b2a4');
        break;
      }
      if (role === 'ground') {
        windowAt(p, 1.0, 0.7, 1.2, 1.5, { frame: '#f3f1ec', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 1, sill: '#cfc8b9', curtain: 0.9 });
        for (let i = 0; i < 8; i++) R(c, 1.04 + i * 0.16, 0.74, 0.018, 1.44, '#2a2a2c');
        R(c, 0, H - 0.45, W, 0.45, '#b9b2a4');
        break;
      }
      const wx = 1.05, ww = 1.1, wy = 0.55, wh = role === 'upperA' ? 1.75 : 1.6;
      R(c, wx - 0.1, wy - 0.12, ww + 0.2, wh + 0.16, '#ece6da');
      windowAt(p, wx, wy, ww, wh, { frame: '#f6f4ef', glassTop: GLASS_DAY[0], glassBot: GLASS_DAY[1], mullions: 1, sill: '#cfc8b9', curtain: 0.7 });
      shutters(p, wx, wy, ww, wh, role === 'upperA' ? '#d9d6ce' : '#c7ccd1');
      R(c, wx - 0.02, wy + wh - 0.42, ww + 0.04, 0.03, '#3a3a3c'); R(c, wx - 0.02, wy + wh - 0.2, ww + 0.04, 0.02, '#3a3a3c');
      streaks(p, wx - 0.1, wy + wh + 0.07, ww + 0.2, 0.5, 0.09);
      break;
    }
    case 'brique': {
      tileImage(p, im.brick, '#a4583c', 1.6, '#f0b79a');
      if (role === 'plain') break;
      R(c, 0, H - 0.2, W, 0.2, '#d9d2c2'); shade(c, 0, H - 0.2, W, 0.04, 0, 0.2);
      if (role === 'door') {
        const dx = 0.95, dw = 1.3;
        R(c, dx - 0.14, 0.4, dw + 0.28, H - 0.4, '#d9d2c2');
        R(c, dx, 0.52, dw, H - 0.52, '#1f2a33');
        windowAt(p, dx + 0.12, 0.65, dw - 0.24, 0.5, { frame: '#1f2a33', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 1, curtain: 0 });
        R(c, dx + dw / 2 - 0.01, 1.2, 0.02, H - 1.2, 'rgba(255,255,255,0.12)');
        break;
      }
      const two = role === 'upperB';
      const lint = '#d9d2c2';
      if (role === 'ground') {
        R(c, 0.7, 0.55, 1.8, 0.14, lint);
        windowAt(p, 0.8, 0.69, 1.6, 1.4, { frame: '#f2f2ee', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 2, sill: lint, curtain: 0.9 });
        break;
      }
      if (two) {
        for (const wx of [0.4, 1.85]) {
          R(c, wx - 0.08, 0.5, 1.11, 0.14, lint);
          windowAt(p, wx, 0.64, 0.95, 1.55, { frame: '#f2f2ee', glassTop: GLASS_DAY[0], glassBot: GLASS_DAY[1], mullions: 1, sill: lint, curtain: 0.7 });
        }
      } else {
        R(c, 0.72, 0.5, 1.76, 0.14, lint);
        windowAt(p, 0.8, 0.64, 1.6, 1.6, { frame: '#f2f2ee', glassTop: GLASS_DAY[0], glassBot: GLASS_DAY[1], mullions: 2, sill: lint, curtain: 0.7, transom: 0.25 });
        ironRail(p, 0.78, 1.5, 1.64, 0.74, '#232325', false);
      }
      break;
    }
    case 'pavillon': {
      tileImage(p, im.beige ?? im.plaster, '#e6dcc6', 3.2, '#f4ecd9');
      grain(p, 0.5);
      if (role === 'plain') { streaks(p, 0, 0, W, 1.0, 0.06); break; }
      if (role === 'door') {
        const dx = 1.15, dw = 0.95;
        R(c, dx - 0.08, 0.72, dw + 0.16, H - 0.72, '#d6ccb5');
        R(c, dx, 0.8, dw, H - 0.8, rng.pick(['#5b3a29', '#2e4d3c', '#7a1f1f', '#f0f0f0']));
        windowAt(p, dx + 0.2, 0.95, dw - 0.4, 0.5, { frame: '#333', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 0, curtain: 0 });
        R(c, dx + 0.1, 1.65, dw - 0.2, 1.1, 'rgba(0,0,0,0.12)');
        R(c, 0, H - 0.4, W, 0.4, '#a79f90');
        break;
      }
      if (role === 'ground') {
        // porte de garage basculante
        R(c, 0.4, 0.75, 2.4, H - 0.75, '#eceae4');
        for (let y = 0.85; y < H - 0.05; y += 0.24) R(c, 0.44, y, 2.32, 0.02, 'rgba(0,0,0,0.2)');
        shade(c, 0.4, 0.75, 2.4, 0.3, 0.35, 0);
        R(c, 0, H - 0.12, W, 0.12, '#a79f90');
        break;
      }
      const wx = 1.0, ww = 1.2, wy = 0.75, wh = 1.35;
      windowAt(p, wx, wy, ww, wh, { frame: '#f4f4f0', glassTop: GLASS_DAY[0], glassBot: GLASS_DAY[1], mullions: 1, sill: '#cfc5ad', curtain: 0.85 });
      shutters(p, wx, wy, ww, wh, role === 'upperA' ? '#7b8f6a' : '#8d5a44');
      streaks(p, wx, wy + wh + 0.07, ww, 0.4, 0.08);
      break;
    }
    case 'moderne': {
      // barre des années 60-70 : panneaux béton, fenêtres en bande, allèges colorées
      tileImage(p, im.concrete, '#c9c7c0', 3.2, '#e8e6e0');
      R(c, 0, 0, 0.03, H, 'rgba(0,0,0,0.25)'); R(c, 0, H - 0.03, W, 0.03, 'rgba(0,0,0,0.3)');
      if (role === 'plain') { streaks(p, 0, 0, W, 1.6, 0.1); break; }
      if (role === 'door') {
        R(c, 0.3, 0.3, 2.6, H - 0.3, '#2a2d31');
        windowAt(p, 0.4, 0.4, 2.4, H - 0.5, { frame: '#2a2d31', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 2, curtain: 0, recess: 0.03 });
        R(c, 0.2, 0.15, 2.8, 0.18, '#b5b3ac');
        break;
      }
      if (role === 'ground') {
        windowAt(p, 0.3, 1.0, 2.6, 1.0, { frame: '#d8d8d4', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 2, curtain: 0.9, recess: 0.04 });
        streaks(p, 0.3, 2.07, 2.6, 0.7, 0.12);
        break;
      }
      const sp = role === 'upperA' ? '#9fb3bf' : '#c9b39a';
      R(c, 0.12, 1.95, W - 0.24, 0.85, sp); shade(c, 0.12, 1.95, W - 0.24, 0.85, 0.12, 0);
      windowAt(p, 0.12, 0.6, W - 0.24, 1.35, { frame: '#e8e8e4', glassTop: GLASS_DAY[0], glassBot: GLASS_DAY[1], mullions: 2, curtain: 0.75, recess: 0.04 });
      if (role === 'upperB') { R(c, 0, 1.5, W, 0.05, '#55585c'); for (let i = 0; i <= 12; i++) R(c, (W * i) / 12 - 0.01, 1.5, 0.02, 1.3, '#55585c'); R(c, 0, 2.75, W, 0.1, '#b9b7b0'); }
      streaks(p, 0, 2.8, W, 0.3, 0.1);
      break;
    }
    case 'contemporain': {
      // logements récents : enduit clair, grandes baies, bardage bois, garde-corps vitrés
      tileImage(p, im.plaster, '#ecebe7', 3.2, '#f7f6f2');
      if (role === 'plain') { R(c, 0, 0, W, H, 'rgba(120,110,95,0.10)'); break; }
      if (role === 'door') {
        R(c, 0.5, 0.45, 2.2, H - 0.45, '#3a3d42');
        windowAt(p, 0.6, 0.55, 2.0, H - 0.65, { frame: '#3a3d42', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 1, curtain: 0, recess: 0.03 });
        break;
      }
      if (role === 'ground') {
        for (let x = 0; x < W; x += 0.14) R(c, x, 0.3, 0.12, H - 0.3, rng.next() > 0.5 ? '#9a7653' : '#8c6a49');
        windowAt(p, 0.9, 0.95, 1.4, 1.2, { frame: '#3a3d42', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 0, curtain: 0.9, recess: 0.04 });
        break;
      }
      if (role === 'upperA') {
        windowAt(p, 0.5, 0.45, 2.2, 2.3, { frame: '#3a3d42', glassTop: GLASS_DAY[0], glassBot: GLASS_DAY[1], mullions: 1, curtain: 0.6, recess: 0.05 });
        R(c, 0.4, 1.75, 2.4, 1.05, 'rgba(190,215,225,0.28)'); R(c, 0.4, 1.72, 2.4, 0.04, '#6c7075'); R(c, 0.38, 2.78, 2.44, 0.1, '#d5d4cf');
      } else {
        for (let x = 1.9; x < W; x += 0.14) R(c, x, 0.2, 0.12, H - 0.3, rng.next() > 0.5 ? '#9a7653' : '#8c6a49');
        windowAt(p, 0.45, 0.6, 1.2, 1.9, { frame: '#3a3d42', glassTop: GLASS_DAY[0], glassBot: GLASS_DAY[1], mullions: 0, curtain: 0.6, recess: 0.05 });
      }
      break;
    }
    case 'industriel': {
      // ateliers et entrepôts : bardage métallique nervuré, portes sectionnelles
      R(c, 0, 0, W, H, role === 'plain' ? '#9aa0a3' : '#a7adb0');
      for (let x = 0; x < W; x += 0.2) { shade(c, x, 0, 0.1, H, 0.12, 0, false); shade(c, x + 0.1, 0, 0.1, H, 0, 0.1, false, '255,255,255'); }
      grain(p, 0.6);
      streaks(p, 0, 0, W, 2.0, 0.08);
      if (role === 'ground' || role === 'door') {
        const dw = role === 'door' ? 1.0 : 2.6, dx = (W - dw) / 2;
        R(c, dx, 0.5, dw, H - 0.5, role === 'door' ? '#4d5560' : '#d7d9d6');
        if (role === 'ground') for (let y = 0.62; y < H; y += 0.42) R(c, dx, y, dw, 0.025, 'rgba(0,0,0,0.25)');
        shade(c, dx, 0.5, dw, 0.25, 0.4, 0);
      } else if (upper && role === 'upperA') {
        windowAt(p, 0.5, 0.9, 2.2, 0.9, { frame: '#5a6068', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 3, curtain: 0, recess: 0.03 });
      }
      break;
    }
    case 'public': {
      // écoles, gymnases, équipements : brique claire / béton, grandes fenêtres
      tileImage(p, im.brick, '#b98a64', 1.6, '#ffe4c4');
      R(c, 0, 0, W, 0.18, '#d8d2c4'); R(c, 0, H - 0.12, W, 0.12, '#d8d2c4');
      if (role === 'plain') break;
      if (role === 'door') {
        R(c, 0.6, 0.35, 2.0, H - 0.35, '#d8d2c4');
        R(c, 0.75, 0.5, 1.7, H - 0.5, '#27455c');
        windowAt(p, 0.9, 0.65, 1.4, 0.9, { frame: '#27455c', glassTop: GLASS_DARK[0], glassBot: GLASS_DARK[1], mullions: 1, curtain: 0, recess: 0.02 });
        R(c, 1.59, 1.6, 0.02, H - 1.6, 'rgba(0,0,0,0.4)');
        break;
      }
      windowAt(p, 0.35, 0.5, 2.5, role === 'ground' ? 1.7 : 1.9, { frame: '#f0efe9', glassTop: (role === 'ground' ? GLASS_DARK : GLASS_DAY)[0], glassBot: (role === 'ground' ? GLASS_DARK : GLASS_DAY)[1], mullions: 3, transom: 0.3, sill: '#d8d2c4', curtain: 0.3, recess: 0.06 });
      break;
    }
  }
  if (style !== 'industriel') grain(p, 0.35);
  // assombrissement léger en pied de tuile de rez-de-chaussée (salissures)
  if (role === 'ground' || role === 'door') shade(c, 0, H - 0.5, W, 0.5, 0, 0.12);
  return finish(p);
}

/** Vitrines : devanture, store banne, rideau métallique baissé… (sans texte : les enseignes sont posées à part) */
function drawShop(i: number): ImageData {
  const p = makePair('shop' + i);
  const { c, rng } = p;
  const W = BAY_W, H = FLOOR_H;
  const frames = ['#1f2a24', '#2a2320', '#1d2733', '#3a3a3c', '#5a1f1f', '#e8e6e0'];
  const frame = frames[i % frames.length];
  R(c, 0, 0, W, H, frame);
  // bandeau d'enseigne (l'enseigne elle-même est un panneau séparé)
  R(c, 0, 0, W, 0.62, frame); shade(c, 0, 0.56, W, 0.1, 0.35, 0);
  if (i % 6 === 3) {
    // rideau métallique baissé
    R(c, 0.12, 0.7, W - 0.24, H - 0.82, '#9ea3a6');
    for (let y = 0.72; y < H - 0.14; y += 0.085) { R(c, 0.12, y, W - 0.24, 0.02, 'rgba(0,0,0,0.25)'); R(c, 0.12, y + 0.03, W - 0.24, 0.02, 'rgba(255,255,255,0.12)'); }
    // un peu de graffiti
    c.strokeStyle = 'rgba(40,60,160,0.35)'; c.lineWidth = 5; c.beginPath();
    c.moveTo(0.6 * PX, 2.2 * PY); c.bezierCurveTo(1.0 * PX, 1.5 * PY, 1.5 * PX, 2.6 * PY, 2.5 * PX, 1.8 * PY); c.stroke();
  } else {
    const split = i % 2 === 0;
    const base = 0.42;
    windowAt(p, 0.12, 0.72, split ? 1.9 : W - 0.24, H - 0.72 - base, { frame, glassTop: '#6b7d8c', glassBot: '#27323c', mullions: split ? 0 : 1, curtain: 0, recess: 0.02 });
    // intérieur du commerce deviné : étagères / lumière chaude
    const gx = 0.2, gw = split ? 1.75 : W - 0.4;
    for (let k = 0; k < 3; k++) R(c, gx, 1.25 + k * 0.42, gw, 0.03, 'rgba(255,230,180,0.16)');
    for (let k = 0; k < 14; k++) R(c, gx + rng.next() * gw, 1.3 + Math.floor(rng.next() * 3) * 0.42 - 0.24, 0.12, 0.2, `hsla(${Math.floor(rng.next() * 360)},45%,55%,0.28)`);
    if (split) {
      // porte vitrée
      windowAt(p, 2.12, 0.72, 0.96, H - 0.78, { frame, glassTop: '#62747f', glassBot: '#232d36', mullions: 0, curtain: 0, recess: 0.02 });
      R(c, 2.2, 1.9, 0.04, 0.3, '#c9c9c9');
    }
    R(c, 0, H - base, split ? 2.06 : W, base, frame); shade(c, 0, H - base, W, base, 0, 0.2);
    if (i % 3 === 1) {
      // store banne
      const col = ['#8c1c13', '#1d4e3a', '#1c3557', '#c9a227'][i % 4];
      c.fillStyle = col; c.beginPath(); c.moveTo(0, 0.62 * PY); c.lineTo(TILE, 0.62 * PY); c.lineTo(TILE, 1.05 * PY); c.lineTo(0, 1.05 * PY); c.fill();
      for (let x = 0; x < W; x += 0.4) R(c, x, 0.62, 0.2, 0.43, 'rgba(255,255,255,0.16)');
      shade(c, 0, 1.05, W, 0.3, 0.4, 0);
      p.m.fillStyle = '#fff'; p.m.fillRect(0, 0.62 * PY, TILE, 0.45 * PY);
    }
  }
  grain(p, 0.25);
  return finish(p);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function buildFacades(base = 'textures/'): Promise<FacadeSet> {
  const [plaster, brick, concrete, stone, beige] = await Promise.all([
    loadImage(base + 'painted_plaster_wall_diff.jpg'), loadImage(base + 'red_brick_03_diff.jpg'),
    loadImage(base + 'concrete_wall_003_diff.jpg'), loadImage(base + 'plastered_stone_wall_diff.jpg'), loadImage(base + 'beige_wall_001_diff.jpg'),
  ]);
  const im: WallImages = { plaster, brick, concrete, stone, beige };
  const layers = STYLES.length * ROLES.length + SHOP_TILES;
  const data = new Uint8Array(TILE * TILE * 4 * layers);
  let k = 0;
  for (const style of STYLES) for (const role of ROLES) { data.set(drawStyle(style, role, im).data, k * TILE * TILE * 4); k++; }
  for (let i = 0; i < SHOP_TILES; i++) { data.set(drawShop(i).data, k * TILE * TILE * 4); k++; }
  const texture = new THREE.DataArrayTexture(data, TILE, TILE, layers);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return {
    texture, layers,
    layer: (style, role) => STYLES.indexOf(style) * ROLES.length + ROLES.indexOf(role),
    shop: (i) => STYLES.length * ROLES.length + (((i % SHOP_TILES) + SHOP_TILES) % SHOP_TILES),
  };
}
