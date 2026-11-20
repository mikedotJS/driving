/**
 * Signalisation routière française dessinée en Canvas 2D (aucune image externe).
 *
 *  - `drawSign(code)`   : face d'un panneau de police, de localisation ou d'une plaque de rue ;
 *  - `drawRoadMark(k)`  : pictogramme de peinture routière (flèches, vélo, BUS, 30…).
 *
 * Les proportions suivent l'Instruction interministérielle sur la signalisation routière
 * (IISR) : listel blanc en rive, couronne rouge ≈ 10 % du diamètre, bordure des triangles
 * ≈ 10 % du côté, symboles noirs, bleu d'obligation / d'indication, etc.
 *
 * Tout est tracé en vectoriel dans un repère « 100 unités = largeur de la plaque » : le rendu
 * reste net quelle que soit la résolution demandée (256 px par défaut, 512 px conseillé pour
 * les panneaux vus de près).
 *
 * Note d'intégration : le canevas est transparent hors de la plaque. Pour éviter un liseré
 * sombre au filtrage, utiliser `alphaTest` (≈ 0.5) ou `premultiplyAlpha` côté texture.
 */

export type SignShape = 'triangle' | 'triangle-inv' | 'disc' | 'octagon' | 'square' | 'rect' | 'diamond';

export interface SignInfo {
  shape: SignShape;
  /** largeur et hauteur réelles en mètres (boîte englobante de la plaque) */
  w: number;
  h: number;
  /** nom français */
  label: string;
}

export type RoadMark =
  | 'arrow-straight'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-straight-left'
  | 'arrow-straight-right'
  | 'arrow-left-right'
  | 'bike'
  | 'bus'
  | 'zone30'
  | '30'
  | '20'
  | 'yield-triangle'
  | 'payant'
  | 'livraison';

type Ctx = CanvasRenderingContext2D;
/** Peint la face d'un panneau dans le repère 100 × H (H = 100 · h / w). */
type Painter = (g: Ctx, H: number, text?: string) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Couleurs et constantes
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  red: '#C1121C', // RAL 3020 rouge signalisation
  blue: '#0B4EA2', // RAL 5017 bleu signalisation
  yellow: '#F7B500',
  green: '#1F8A3C',
  white: '#FBFBF8', // film rétro-réfléchissant blanc
  black: '#141414',
  grey: '#8C8F93', // symboles « fin de prescription »
  rim: '#AEB3B8', // chant / bord tombé de la tôle
  enamel: '#1A3A7A', // émail des plaques parisiennes
  enamelGreen: '#2F6B3A',
  paint: '#F2F2EC', // peinture routière
} as const;

const FONT = "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SQ3 = Math.sqrt(3);

/** Dimensions normalisées (petite gamme, usage urbain). */
const TRI_W = 0.7;
const TRI_R = 5; // rayon d'angle de la plaque triangulaire (unités)
const TRI_H = (100 - 2 * TRI_R) * (SQ3 / 2) + 2 * TRI_R; // ≈ 87.94
const TRI_RHO = (100 - 2 * TRI_R) / (2 * SQ3) + TRI_R; // distance centre → côté ≈ 30.98
const TRI_CY = TRI_H - TRI_RHO; // ordonnée du centre de gravité (pointe en haut)
const TRI_HM = Math.round(((TRI_W * TRI_H) / 100) * 1000) / 1000; // 0.616 m
const DISC = 0.65;

// ─────────────────────────────────────────────────────────────────────────────
// Primitives de tracé
// ─────────────────────────────────────────────────────────────────────────────

function fill(g: Ctx, color: string, rule: CanvasFillRule = 'nonzero'): void {
  g.fillStyle = color;
  g.fill(rule);
}

/** Polygone fermé (sous-chemin) à partir de coordonnées à plat [x0, y0, x1, y1, …]. */
function poly(g: Ctx, p: readonly number[]): void {
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.closePath();
}

function fillPoly(g: Ctx, p: readonly number[], color: string): void {
  g.beginPath();
  poly(g, p);
  fill(g, color);
}

/** Polygone fermé à angles arrondis (sous-chemin). */
function roundPoly(g: Ctx, p: readonly number[], r: number): void {
  const n = p.length / 2;
  const lx = p[2 * (n - 1)];
  const ly = p[2 * (n - 1) + 1];
  g.moveTo((lx + p[0]) / 2, (ly + p[1]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    g.arcTo(p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1], r);
  }
  g.closePath();
}

function rrect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  roundPoly(g, [x, y, x + w, y, x + w, y + h, x, y + h], Math.max(0, Math.min(r, w / 2, h / 2)));
}

function fillRRect(g: Ctx, x: number, y: number, w: number, h: number, r: number, color: string): void {
  g.beginPath();
  rrect(g, x, y, w, h, r);
  fill(g, color);
}

function disc(g: Ctx, x: number, y: number, r: number, color: string): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  fill(g, color);
}

/** Ligne brisée tracée au trait (extrémités et jonctions selon le contexte courant). */
function polyline(g: Ctx, p: readonly number[]): void {
  g.beginPath();
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.stroke();
}

/** Flèche droite (sous-chemin fermé) de la queue (x0, y0) vers la pointe (x1, y1). */
function arrow(g: Ctx, x0: number, y0: number, x1: number, y1: number, shaft: number, headW: number, headL: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const bx = x1 - ux * headL;
  const by = y1 - uy * headL;
  const s = shaft / 2;
  const h = headW / 2;
  poly(g, [
    x0 + nx * s, y0 + ny * s,
    bx + nx * s, by + ny * s,
    bx + nx * h, by + ny * h,
    x1, y1,
    bx - nx * h, by - ny * h,
    bx - nx * s, by - ny * s,
    x0 - nx * s, y0 - ny * s,
  ]);
}

/**
 * Flèche coudée à angle droit (sous-chemin fermé) : fût vertical d'axe `xs` partant de `yBottom`,
 * branche horizontale d'axe `yTurn` jusqu'à la pointe `xTip` (à droite ou à gauche du fût).
 */
function bentArrow(g: Ctx, xs: number, yBottom: number, yTurn: number, xBase: number, xTip: number, t: number, headW: number): void {
  const s = Math.sign(xTip - xs);
  const h = t / 2;
  poly(g, [
    xs - s * h, yBottom,
    xs - s * h, yTurn - h,
    xBase, yTurn - h,
    xBase, yTurn - headW / 2,
    xTip, yTurn,
    xBase, yTurn + headW / 2,
    xBase, yTurn + h,
    xs + s * h, yTurn + h,
    xs + s * h, yBottom,
  ]);
}

/** Bande rectiligne centrée en (cx, cy), inclinée de `angle` degrés (sens horaire à l'écran). */
function band(g: Ctx, cx: number, cy: number, len: number, width: number, angle: number, color: string): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(angle * DEG);
  g.fillStyle = color;
  g.fillRect(-len / 2, -width / 2, len, width);
  g.restore();
}

/** Miroir gauche ↔ droite du repère 100 unités. */
function mirror(g: Ctx): void {
  g.translate(100, 0);
  g.scale(-1, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Texte
// ─────────────────────────────────────────────────────────────────────────────

interface TextOpts {
  color?: string;
  weight?: string;
  /**
   * Chasse voulue : avance du « H » rapportée à la hauteur de capitale (≈ 1 pour Arial gras,
   * ≈ 0.8 pour un caractère étroit). Rend le dessin indépendant de la police réellement
   * disponible (Arial Narrow, Helvetica Neue, Arial, Liberation Sans…).
   */
  ratio?: number;
  align?: 'center' | 'left' | 'right';
  /** compression horizontale maximale avant de réduire aussi la hauteur */
  minSqueeze?: number;
}

interface TextFit {
  k: number; // échelle verticale (px de police → unités)
  sx: number; // facteur de chasse
  w: number; // largeur d'encre finale
  h: number; // hauteur de capitale finale
  left: number; // débord gauche de l'encre (px de police)
}

const FONT_PX = 100;

function fitText(g: Ctx, text: string, maxW: number, capH: number, o: TextOpts): TextFit {
  g.font = `${o.weight ?? 'bold'} ${FONT_PX}px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const mH = g.measureText('H');
  const cap = mH.actualBoundingBoxAscent > 1 ? mH.actualBoundingBoxAscent : FONT_PX * 0.716;
  const fontRatio = mH.width / cap;
  const m = g.measureText(text);
  const ink = Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  let k = capH / cap;
  let sx = (o.ratio ?? 0.86) / fontRatio;
  let w = ink * k * sx;
  if (w > maxW) {
    const f = maxW / w;
    const minS = o.minSqueeze ?? 0.62;
    if (f < minS) {
      sx *= minS;
      k *= f / minS;
    } else {
      sx *= f;
    }
    w = maxW;
  }
  return { k, sx, w, h: cap * k, left: m.actualBoundingBoxLeft };
}

/**
 * Écrit `text` centré verticalement sur `cy` (hauteur de capitale `capH`), largeur d'encre
 * limitée à `maxW`. Renvoie la largeur effectivement occupée.
 */
function drawText(g: Ctx, text: string, x: number, cy: number, maxW: number, capH: number, o: TextOpts = {}): number {
  g.save();
  const f = fitText(g, text, maxW, capH, o);
  const x0 = o.align === 'left' ? x : o.align === 'right' ? x - f.w : x - f.w / 2;
  g.translate(x0, cy + f.h / 2);
  g.scale(f.k * f.sx, f.k);
  g.fillStyle = o.color ?? C.black;
  g.fillText(text, f.left, 0);
  g.restore();
  return f.w;
}

/** Texte étiré pour remplir exactement la boîte (x, y, w, h) — lettrages anamorphosés. */
function drawTextBox(g: Ctx, text: string, x: number, y: number, w: number, h: number, color: string): void {
  g.save();
  g.font = `bold ${FONT_PX}px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const m = g.measureText(text);
  const inkW = Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  const inkH = Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  g.translate(x, y);
  g.scale(w / inkW, h / inkH);
  g.fillStyle = color;
  g.fillText(text, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
  g.restore();
}

/** Coupe un libellé en deux lignes équilibrées (sur une espace ou un trait d'union). */
function splitTwo(text: string): [string, string] | null {
  let best = -1;
  let bestD = Infinity;
  for (let i = 1; i < text.length - 1; i++) {
    const ch = text[i];
    if (ch !== ' ' && ch !== '-') continue;
    const d = Math.abs(i - text.length / 2);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const a = text[best] === '-' ? text.slice(0, best + 1) : text.slice(0, best);
  return [a.trim(), text.slice(best + 1).trim()];
}

/** Lignes explicites d'un texte libre (« | » ou saut de ligne). */
function explicitLines(text: string): string[] {
  return text
    .split(/\||\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Libellé centré en (cx, cy) : une ligne de hauteur `cap1`, ou deux lignes de hauteur `cap2`
 * si le texte en fournit deux (« | ») ou s'il devrait être comprimé de plus de `squeeze`.
 * `lead` : interligne rapporté à `cap2`.
 */
function fitLabel(g: Ctx, text: string, cx: number, cy: number, maxW: number, cap1: number, cap2: number, lead: number, o: TextOpts, squeeze = 0.66): void {
  let lines = explicitLines(text);
  if (lines.length === 1) {
    g.save();
    const natural = fitText(g, lines[0], 1e6, cap1, o).w;
    g.restore();
    if (natural * squeeze > maxW) lines = splitTwo(lines[0]) ?? lines;
  }
  if (lines.length >= 2) {
    const d = (cap2 * lead) / 2;
    drawText(g, lines[0], cx, cy - d, maxW, cap2, o);
    drawText(g, lines.slice(1).join(' '), cx, cy + d, maxW, cap2, o);
  } else if (lines.length === 1) {
    drawText(g, lines[0], cx, cy, maxW, cap1, o);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plaques (fonds, bordures, listels)
// ─────────────────────────────────────────────────────────────────────────────

/** Triangle équilatéral arrondi, côtés rentrés de `d`, rayon d'angle `q`. */
function triPath(g: Ctx, d: number, q: number, inv: boolean): void {
  const rho = TRI_RHO - d;
  const top = TRI_CY - 2 * rho;
  const base = TRI_CY + rho;
  const hw = rho * SQ3;
  const f = (y: number): number => (inv ? TRI_H - y : y);
  g.beginPath();
  roundPoly(g, [50, f(top), 50 + hw, f(base), 50 - hw, f(base)], q);
}

/** Plaque triangulaire : chant, listel blanc, bordure rouge, fond blanc. */
function triPlate(g: Ctx, inv: boolean, border = 9.6): void {
  triPath(g, 0, TRI_R, inv);
  fill(g, C.rim);
  triPath(g, 0.7, TRI_R - 0.7, inv);
  fill(g, C.white);
  triPath(g, 2.2, TRI_R - 2.2, inv);
  fill(g, C.red);
  triPath(g, 2.2 + border, 2.2, inv);
  fill(g, C.white);
}

type DiscKind = 'ring' | 'red' | 'blue' | 'bluering' | 'end';

/** Rayon utile (fond) de chaque famille de disque. */
const DISC_INNER: Record<DiscKind, number> = { ring: 37.6, red: 47.8, blue: 47.4, bluering: 38.4, end: 46.4 };

function discPlate(g: Ctx, kind: DiscKind): void {
  disc(g, 50, 50, 50, C.rim);
  disc(g, 50, 50, 49.3, C.white);
  switch (kind) {
    case 'ring':
      disc(g, 50, 50, 48.2, C.red);
      disc(g, 50, 50, DISC_INNER.ring, C.white);
      break;
    case 'red':
      disc(g, 50, 50, DISC_INNER.red, C.red);
      break;
    case 'blue':
      disc(g, 50, 50, DISC_INNER.blue, C.blue);
      break;
    case 'bluering':
      disc(g, 50, 50, 48.2, C.red);
      disc(g, 50, 50, DISC_INNER.bluering, C.blue);
      break;
    case 'end':
      g.beginPath();
      g.arc(50, 50, 47.3, 0, TAU);
      g.strokeStyle = C.black;
      g.lineWidth = 1.7;
      g.stroke();
      break;
  }
}

/** Barre diagonale d'un disque, limitée au cercle de rayon `r`. `angle` : 45 = « \ », −45 = « / ». */
function discBar(g: Ctx, r: number, width: number, angle: number, color: string): void {
  g.save();
  g.beginPath();
  g.arc(50, 50, r, 0, TAU);
  g.clip();
  band(g, 50, 50, 2 * r + 4, width, angle, color);
  g.restore();
}

function octPath(g: Ctx, d: number, q: number): void {
  const k = (50 - d) / 50;
  const a = 50 * Math.tan(22.5 * DEG); // demi-côté
  const pts: number[] = [];
  const raw = [-a, -50, a, -50, 50, -a, 50, a, a, 50, -a, 50, -50, a, -50, -a];
  for (let i = 0; i < raw.length; i++) pts.push(50 + raw[i] * k);
  g.beginPath();
  roundPoly(g, pts, q);
}

/** Carré sur pointe arrondi dont les côtés sont rentrés de `d`. */
const DIA_Q = 4;
const DIA_E = (50 + DIA_Q * (Math.SQRT2 - 1)) / Math.SQRT2; // distance centre → côté de la plaque
function diamondPath(g: Ctx, d: number, q: number): void {
  const v = (DIA_E - d) * Math.SQRT2;
  g.beginPath();
  roundPoly(g, [50, 50 - v, 50 + v, 50, 50, 50 + v, 50 - v, 50], q);
}

/** Plaque rectangulaire : chant gris puis fond uni. */
function rectPlate(g: Ctx, H: number, r: number, ground: string): void {
  fillRRect(g, 0, 0, 100, H, r, C.rim);
  fillRRect(g, 0.7, 0.7, 98.6, H - 1.4, r - 0.7, ground);
}

/** Filet (listel) rectangulaire tracé à `inset` du bord. */
function rectLine(g: Ctx, H: number, inset: number, width: number, r: number, color: string): void {
  const c = inset + width / 2;
  g.beginPath();
  rrect(g, c, c, 100 - 2 * c, H - 2 * c, Math.max(0.2, r - c));
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}

/** Panneau carré ou rectangulaire bleu à listel blanc (type C, B52, B54). */
function bluePlate(g: Ctx, H: number, r = 6): void {
  rectPlate(g, H, r, C.white);
  fillRRect(g, 2.5, 2.5, 95, H - 5, r - 2.5, C.blue);
}

/** Panneau rectangulaire blanc à listel noir (B30, panonceaux, SR3). */
function whitePlate(g: Ctx, H: number, r: number, inset: number, line: number): void {
  rectPlate(g, H, r, C.white);
  rectLine(g, H, inset, line, r, C.black);
}

/** Léger modelé du film rétro-réfléchissant (reflet haut-gauche, ombre bas-droite). */
function sheen(g: Ctx, H: number): void {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, 55, H);
  gr.addColorStop(0, 'rgba(255,255,255,0.10)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.07)');
  g.fillStyle = gr;
  g.fillRect(-2, -2, 104, H + 4);
  g.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Pictogrammes
// ─────────────────────────────────────────────────────────────────────────────

/** Membre effilé : suite de points (x, y, épaisseur) reliés par des segments arrondis. */
type Limb = readonly number[];

interface Pose {
  head: readonly [number, number, number];
  torso: readonly number[];
  torsoR: number;
  legs: readonly Limb[];
  arms: readonly Limb[];
}

/** Piéton en marche (repère local : hauteur 100, sol en y = 100, regard vers +x). */
const WALK: Pose = {
  head: [4, 9, 8.6],
  torso: [-8.5, 20.5, 11.5, 20, 7.5, 56.5, -7.5, 55.5],
  torsoR: 5,
  legs: [
    [2.5, 52, 10.4, 10.5, 73.5, 8.8, 15.5, 93, 7.2, 23, 96.2, 6.4],
    [-2.5, 52, 10.4, -9.5, 74.5, 8.8, -21, 90.5, 7.2, -15.5, 96.4, 6.4],
  ],
  arms: [
    [8, 24.5, 6.8, 17, 38.5, 5.8, 25.5, 45, 5],
    [-5, 24.5, 6.8, -13.5, 37.5, 5.8, -17.5, 50, 5],
  ],
};

/** Enfant qui court (tête plus grosse, foulée ample, bras tendus). */
const RUN: Pose = {
  head: [7, 11.5, 10.8],
  torso: [-8.5, 25, 11, 23.5, 5.5, 60, -11, 57],
  torsoR: 5,
  legs: [
    [0.5, 56, 11, 15, 70.5, 9.4, 14.5, 91.5, 8, 23, 95.4, 7],
    [-6, 56, 11, -17.5, 73.5, 9.4, -32.5, 80, 8],
  ],
  arms: [
    [7, 28.5, 7.4, 19, 36, 6.4, 30, 32, 5.8],
    [-5, 28.5, 7.4, -17, 37, 6.4, -27, 33.5, 5.8],
  ],
};

function limb(g: Ctx, p: Limb): void {
  for (let i = 0; i + 5 < p.length; i += 3) {
    const x0 = p[i];
    const y0 = p[i + 1];
    const r0 = p[i + 2] / 2;
    const x1 = p[i + 3];
    const y1 = p[i + 4];
    const r1 = p[i + 5] / 2;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    g.beginPath();
    g.moveTo(x0 + nx * r0, y0 + ny * r0);
    g.lineTo(x1 + nx * r1, y1 + ny * r1);
    g.lineTo(x1 - nx * r1, y1 - ny * r1);
    g.lineTo(x0 - nx * r0, y0 - ny * r0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(x0, y0, r0, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(x1, y1, r1, 0, TAU);
    g.fill();
  }
}

/**
 * Silhouette humaine. (x, ground) : pied de l'axe du corps ; h : hauteur ; dir : +1 vers la
 * droite, −1 vers la gauche. `arms` remplace les bras de la pose (mains jointes, etc.).
 */
function figure(g: Ctx, pose: Pose, x: number, ground: number, h: number, dir: number, color: string, arms?: readonly Limb[]): void {
  const k = h / 100;
  g.save();
  g.translate(x, ground - h);
  g.scale(k * dir, k);
  g.fillStyle = color;
  disc(g, pose.head[0], pose.head[1], pose.head[2], color);
  g.beginPath();
  roundPoly(g, pose.torso, pose.torsoR);
  g.fill();
  for (const l of pose.legs) limb(g, l);
  for (const a of arms ?? pose.arms) limb(g, a);
  g.restore();
}

/** Coordonnées locales (dans le repère d'une silhouette) d'un point du panneau. */
function toLocal(px: number, py: number, x: number, ground: number, h: number, dir: number): [number, number] {
  const k = h / 100;
  return [(px - x) / (k * dir), (py - (ground - h)) / k];
}

/** Adulte et enfant se donnant la main (aire piétonne), marchant vers la gauche. */
function adultChild(g: Ctx, cx: number, ground: number, h: number, color: string): void {
  const ha = h;
  const hc = h * 0.62;
  const xa = cx - h * 0.2;
  const xc = cx + h * 0.27;
  const mx = cx + h * 0.06;
  const my = ground - h * 0.44;
  const [ax, ay] = toLocal(mx, my, xa, ground, ha, -1);
  const [bx, by] = toLocal(mx, my, xc, ground, hc, -1);
  figure(g, WALK, xa, ground, ha, -1, color, [WALK.arms[0], [-5, 24.5, 6.8, (ax - 5) / 2 - 2, (ay + 24.5) / 2 + 3, 5.8, ax, ay, 5.2]]);
  const child: Pose = {
    ...WALK,
    head: [4, 6.5, 11],
    legs: [
      [2.5, 52, 11.5, 10.5, 73.5, 10, 15.5, 93, 8.6, 23, 96, 7.6],
      [-2.5, 52, 11.5, -9.5, 74.5, 10, -21, 90.5, 8.6, -15.5, 96, 7.6],
    ],
  };
  figure(g, child, xc, ground, hc, -1, color, [
    [8, 26, 8, (bx + 8) / 2 + 1, (by + 26) / 2 + 4, 7.4, bx, by, 7.2],
    [-5, 26, 8, -11, 40, 7.2, -13, 52, 6.6],
  ]);
}

const BIKE_H = 60.7; // hauteur du vélo pour une largeur de 100
/**
 * Bicyclette de profil (boîte englobante centrée en (cx, cy), largeur `w`, hauteur 0.607·w).
 * dir = −1 : roue avant à gauche (sens des panneaux français).
 */
function bike(g: Ctx, cx: number, cy: number, w: number, color: string, dir = -1): void {
  const k = w / 100;
  g.save();
  g.translate(cx, cy);
  g.scale(dir < 0 ? k : -k, k);
  g.translate(-50, 9.25);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // roues
  g.lineWidth = 4.2;
  for (const x of [21.5, 78.5]) {
    g.beginPath();
    g.arc(x, 0, 19, 0, TAU);
    g.stroke();
  }
  // cadre : base, hauban, tube de selle, tube horizontal, tube diagonal
  g.lineWidth = 3.6;
  polyline(g, [78.5, 0, 52, 1, 61.5, -29.5]);
  polyline(g, [78.5, 0, 60, -25, 31, -26.5, 52, 1]);
  // fourche et potence
  polyline(g, [21.5, 0, 31.5, -29, 33, -35.5]);
  // cintre
  g.lineWidth = 3.8;
  g.beginPath();
  g.moveTo(37, -36.3);
  g.lineTo(27, -37.3);
  g.quadraticCurveTo(22.5, -37.3, 22.5, -33);
  g.stroke();
  // selle
  g.lineWidth = 4.6;
  polyline(g, [56, -31.5, 68.5, -31.5]);
  // pédalier
  disc(g, 52, 1, 3.6, color);
  g.lineWidth = 2.6;
  polyline(g, [47.5, 7, 56.5, -5]);
  g.restore();
}

/** Voiture vue de face (boîte 100 × 80 mise à l'échelle sur la largeur `w`, centrée). */
function carFront(g: Ctx, cx: number, cy: number, w: number, color: string): void {
  const k = w / 100;
  g.save();
  g.translate(cx - 50 * k, cy - 40 * k);
  g.scale(k, k);
  g.fillStyle = color;
  g.beginPath();
  rrect(g, 9, 56, 19, 24, 4.5);
  rrect(g, 72, 56, 19, 24, 4.5);
  g.fill();
  g.beginPath();
  roundPoly(g, [27, 1, 73, 1, 82, 31, 96, 36, 96, 68, 4, 68, 4, 36, 18, 31], 6);
  // pare-brise et phares évidés
  roundPoly(g, [31.5, 9, 68.5, 9, 75, 29, 25, 29], 2.5);
  g.moveTo(26, 50);
  g.arc(19.5, 50, 6.5, 0, TAU);
  g.moveTo(87, 50);
  g.arc(80.5, 50, 6.5, 0, TAU);
  g.fill('evenodd');
  g.restore();
}

/** Voiture de profil roulant vers la gauche (boîte 100 × 40, centrée en (cx, cy)). */
function carSide(g: Ctx, cx: number, cy: number, w: number, color: string, dir = -1): void {
  const k = w / 100;
  g.save();
  g.translate(cx, cy);
  g.scale(dir < 0 ? k : -k, k);
  g.translate(-50, -20);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(2.5, 28);
  g.lineTo(2.5, 23);
  g.quadraticCurveTo(2.5, 18.5, 9, 17.5);
  g.lineTo(26.5, 14.5);
  g.lineTo(37.5, 4);
  g.quadraticCurveTo(40.5, 1.2, 45, 1.2);
  g.lineTo(68, 1.2);
  g.quadraticCurveTo(73, 1.2, 76, 4.5);
  g.lineTo(86, 14);
  g.lineTo(93, 15.3);
  g.quadraticCurveTo(98, 16.3, 98, 21);
  g.lineTo(98, 28);
  g.quadraticCurveTo(98, 31.5, 94.5, 31.5);
  g.lineTo(6, 31.5);
  g.quadraticCurveTo(2.5, 31.5, 2.5, 28);
  g.closePath();
  // vitres latérales
  poly(g, [41, 5.5, 54.5, 5.5, 54.5, 14, 32, 14]);
  poly(g, [58, 5.5, 71.5, 5.5, 80, 14, 58, 14]);
  g.fill('evenodd');
  disc(g, 23, 31, 8.4, color);
  disc(g, 78, 31, 8.4, color);
  g.restore();
}

/** Autobus vu de face (boîte 100 × 100, centrée en (cx, cy), largeur `w`). */
function busFront(g: Ctx, cx: number, cy: number, w: number, color: string): void {
  const k = w / 100;
  g.save();
  g.translate(cx - 50 * k, cy - 50 * k);
  g.scale(k, k);
  g.fillStyle = color;
  g.strokeStyle = color;
  // roues
  g.beginPath();
  rrect(g, 19, 84, 15, 16, 3);
  rrect(g, 66, 84, 15, 16, 3);
  g.fill();
  // rétroviseurs
  g.lineWidth = 2.6;
  g.lineCap = 'round';
  polyline(g, [14, 20, 6, 22]);
  polyline(g, [86, 20, 94, 22]);
  g.beginPath();
  rrect(g, 1.5, 21, 7, 16, 2.5);
  rrect(g, 91.5, 21, 7, 16, 2.5);
  g.fill();
  // caisse, girouette, pare-brise, calandre et phares évidés
  g.beginPath();
  rrect(g, 13, 0, 74, 89, 9);
  rrect(g, 27, 6.5, 46, 9, 2.5);
  rrect(g, 19.5, 21.5, 61, 34, 4);
  rrect(g, 39, 67.5, 22, 6.5, 2);
  g.moveTo(31.5, 71);
  g.arc(26, 71, 5.5, 0, TAU);
  g.moveTo(79.5, 71);
  g.arc(74, 71, 5.5, 0, TAU);
  g.fill('evenodd');
  g.restore();
}

/** Piéton sur passage zébré, tel que dans le triangle A13b (repère du triangle de danger). */
function crossingSymbol(g: Ctx, color: string): void {
  // bandes du passage vues en perspective
  g.beginPath();
  for (let i = -2; i <= 2; i++) {
    const xt = 50 + i * 7.3;
    const xb = 50 + i * 10.3;
    poly(g, [xt - 2.2, 64.8, xt + 2.2, 64.8, xb + 3.3, 74.2, xb - 3.3, 74.2]);
  }
  fill(g, color);
  figure(g, WALK, 50.5, 66.3, 31.5, -1, color);
}

/** Petit disque de limitation (B14) inscrit dans les panneaux de zone. */
function roundel(g: Ctx, cx: number, cy: number, d: number, num: string, ring: string, ink: string): void {
  disc(g, cx, cy, d / 2, ring);
  disc(g, cx, cy, (d / 2) * 0.775, C.white);
  drawText(g, num, cx, cy + d * 0.005, d * 0.5, d * 0.31, { color: ink, ratio: 1.0, minSqueeze: 0.8 });
}

/** Bosse à plateau (ralentisseur, surélévation) posée sur une ligne de chaussée. */
function hump(g: Ctx, cx: number, baseY: number, w: number, h: number, color: string, flat: boolean): void {
  const hw = w / 2;
  g.beginPath();
  if (flat) {
    poly(g, [cx - hw * 0.72, baseY, cx - hw * 0.36, baseY - h, cx + hw * 0.36, baseY - h, cx + hw * 0.72, baseY]);
  } else {
    g.moveTo(cx - hw * 0.8, baseY);
    g.bezierCurveTo(cx - hw * 0.42, baseY, cx - hw * 0.4, baseY - h, cx, baseY - h);
    g.bezierCurveTo(cx + hw * 0.4, baseY - h, cx + hw * 0.42, baseY, cx + hw * 0.8, baseY);
    g.closePath();
  }
  g.rect(cx - hw, baseY - 0.2, w, h * 0.3);
  fill(g, color);
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue
// ─────────────────────────────────────────────────────────────────────────────

const PAINTERS: Record<string, Painter | undefined> = {};

/** Tous les panneaux disponibles, indexés par code (ex. 'AB4', 'B14_30'). */
export const SIGNS: Record<string, SignInfo> = {};

function def(code: string, shape: SignShape, w: number, h: number, label: string, paint: Painter): void {
  SIGNS[code] = { shape, w, h, label };
  PAINTERS[code] = paint;
}

// ── Danger (type A) et intersections (AB) ────────────────────────────────────

function danger(code: string, label: string, symbol: (g: Ctx) => void): void {
  def(code, 'triangle', TRI_W, TRI_HM, label, (g) => {
    triPlate(g, false);
    symbol(g);
  });
}

danger('AB1', 'Intersection à priorité à droite', (g) => {
  const cy = 58.5;
  const a = 10.5;
  const b = 13;
  const t = 3.3;
  g.beginPath();
  poly(g, [50 - a - t, cy - b, 50 - a + t, cy - b, 50 + a + t, cy + b, 50 + a - t, cy + b]);
  poly(g, [50 + a - t, cy - b, 50 + a + t, cy - b, 50 - a + t, cy + b, 50 - a - t, cy + b]);
  fill(g, C.black);
});

danger('AB2', 'Intersection avec une route non prioritaire', (g) => {
  g.beginPath();
  arrow(g, 50, 72.5, 50, 29, 7.6, 17.5, 13.5);
  fill(g, C.black);
  g.fillRect(32.5, 55.4, 35, 3.9);
});

danger('AB25', 'Carrefour à sens giratoire', (g) => {
  const cx = 50;
  const cy = 57.8;
  const r = 11.4;
  const t = 5;
  // trois flèches tournant dans le sens inverse des aiguilles d'une montre
  for (const tip of [78, 198, 318]) {
    const a0 = -(tip - 96) * DEG;
    const a1 = -(tip - 30) * DEG;
    g.beginPath();
    g.arc(cx, cy, r, a0, a1, true);
    g.strokeStyle = C.black;
    g.lineWidth = t;
    g.lineCap = 'butt';
    g.stroke();
    const at = -tip * DEG;
    const ab = -(tip - 32) * DEG;
    fillPoly(
      g,
      [
        cx + (r + 5.8) * Math.cos(ab), cy + (r + 5.8) * Math.sin(ab),
        cx + (r + 0.6) * Math.cos(at), cy + (r + 0.6) * Math.sin(at),
        cx + (r - 5.8) * Math.cos(ab), cy + (r - 5.8) * Math.sin(ab),
      ],
      C.black,
    );
  }
});

danger('A13b', 'Passage pour piétons', (g) => crossingSymbol(g, C.black));

danger('A13a', 'Endroit fréquenté par les enfants', (g) => {
  // deux enfants courant vers la gauche, main dans la main
  const ground = 73;
  const xa = 58.5;
  const ha = 30;
  const xb = 41.5;
  const hb = 23.5;
  const mx = 49.2;
  const my = 56.5;
  const [ax, ay] = toLocal(mx, my, xa, ground, ha, -1);
  const [bx, by] = toLocal(mx, my, xb, ground, hb, -1);
  figure(g, RUN, xa, ground, ha, -1, C.black, [[7, 28.5, 7.4, (ax + 7) / 2, (ay + 28.5) / 2 + 2, 6.4, ax, ay, 5.8], RUN.arms[1]]);
  figure(g, RUN, xb, ground, hb, -1, C.black, [RUN.arms[0], [-5, 28.5, 7.4, (bx - 5) / 2, (by + 28.5) / 2 + 2, 6.6, bx, by, 6.2]]);
});

danger('A2b', "Ralentisseur de type dos-d'âne", (g) => hump(g, 50, 66.5, 46, 15.5, C.black, false));

danger('A17', 'Annonce de feux tricolores', (g) => {
  disc(g, 50, 37, 6.3, C.red);
  disc(g, 50, 51.7, 6.3, C.yellow);
  disc(g, 50, 66.4, 6.3, C.green);
});

danger('A21', 'Débouché de cyclistes', (g) => bike(g, 50, 60.5, 39, C.black));

danger('A14', 'Autres dangers', (g) => {
  fillPoly(g, [46.3, 33.5, 53.7, 33.5, 52.6, 60.5, 47.4, 60.5], C.black);
  disc(g, 50, 68.3, 3.8, C.black);
});

danger('A3', 'Chaussée rétrécie', (g) => {
  g.strokeStyle = C.black;
  g.lineWidth = 5.2;
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  polyline(g, [36.5, 73.5, 36.5, 63.5, 44.2, 51, 44.2, 38]);
  polyline(g, [63.5, 73.5, 63.5, 63.5, 55.8, 51, 55.8, 38]);
});

function bendSymbol(g: Ctx): void {
  g.strokeStyle = C.black;
  g.lineWidth = 6.8;
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(41.5, 73.5);
  g.lineTo(41.5, 61);
  g.quadraticCurveTo(41.5, 50, 49.5, 44);
  g.lineTo(57, 38.4);
  g.stroke();
}

danger('A1a', 'Virage à droite', (g) => bendSymbol(g));
danger('A1b', 'Virage à gauche', (g) => {
  mirror(g);
  bendSymbol(g);
});

// ── Priorité ─────────────────────────────────────────────────────────────────

def('AB3a', 'triangle-inv', TRI_W, TRI_HM, 'Cédez le passage', (g) => triPlate(g, true, 10.6));

def('AB4', 'octagon', 0.6, 0.6, 'Arrêt à l’intersection (STOP)', (g) => {
  octPath(g, 0, 2.6);
  fill(g, C.rim);
  octPath(g, 0.7, 2.2);
  fill(g, C.white);
  octPath(g, 3.9, 1.4);
  fill(g, C.red);
  // lettres « STOP » tracées au trait d'épaisseur constante (caractères L1 étroits)
  const t = 5.3;
  const lw = 15.9;
  const gap = 3.5;
  const y0 = 34.3;
  const y1 = 65.7;
  const yt = y0 + t / 2;
  const yb = y1 - t / 2;
  const x0 = 50 - (4 * lw + 3 * gap) / 2;
  g.strokeStyle = C.white;
  g.lineWidth = t;
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  const box = (i: number): [number, number] => {
    const l = x0 + i * (lw + gap);
    return [l + t / 2, l + lw - t / 2];
  };
  // S
  {
    const [xl, xr] = box(0);
    const cx = (xl + xr) / 2;
    const rx = (xr - xl) / 2;
    const ry = (yb - yt) / 4;
    g.beginPath();
    g.ellipse(cx, yt + ry, rx, ry, 0, -22 * DEG, 90 * DEG, true);
    g.ellipse(cx, yb - ry, rx, ry, 0, -90 * DEG, 202 * DEG, false);
    g.stroke();
  }
  // T
  {
    const [xl, xr] = box(1);
    polyline(g, [xl - t / 2, yt, xr + t / 2, yt]);
    polyline(g, [(xl + xr) / 2, yt, (xl + xr) / 2, y1]);
  }
  // O
  {
    const [xl, xr] = box(2);
    g.beginPath();
    rrect(g, xl, yt, xr - xl, yb - yt, (xr - xl) / 2);
    g.stroke();
  }
  // P
  {
    const [xl, xr] = box(3);
    const rb = 7.3;
    g.beginPath();
    g.moveTo(xl, y1);
    g.lineTo(xl, yt);
    g.lineTo(xr - rb, yt);
    g.arc(xr - rb, yt + rb, rb, -90 * DEG, 90 * DEG, false);
    g.lineTo(xl, yt + 2 * rb);
    g.stroke();
  }
});

function priorityRoad(g: Ctx): void {
  diamondPath(g, 0, DIA_Q);
  fill(g, '#4A4D50');
  diamondPath(g, 0.8, DIA_Q - 0.8);
  fill(g, C.white);
  diamondPath(g, 9.4, 2);
  fill(g, C.yellow);
}

def('AB6', 'diamond', 0.7, 0.7, 'Route prioritaire', (g) => priorityRoad(g));
def('AB7', 'diamond', 0.7, 0.7, 'Fin de route prioritaire', (g) => {
  priorityRoad(g);
  g.save();
  diamondPath(g, 0.8, DIA_Q - 0.8);
  g.clip();
  band(g, 50, 50, 90, 7.6, -45, C.black);
  g.restore();
});

// ── Interdiction (type B, disques) ───────────────────────────────────────────

function discSign(code: string, label: string, kind: DiscKind, symbol?: (g: Ctx) => void): void {
  def(code, 'disc', DISC, DISC, label, (g) => {
    discPlate(g, kind);
    symbol?.(g);
  });
}

discSign('B0', 'Circulation interdite à tout véhicule dans les deux sens', 'ring');

discSign('B1', 'Sens interdit', 'red', (g) => fillRRect(g, 14.5, 41.6, 71, 16.8, 0.6, C.white));

function noLeftTurn(g: Ctx): void {
  g.beginPath();
  bentArrow(g, 58, 73.5, 45.5, 40, 24.5, 8.8, 21.5);
  fill(g, C.black);
  discBar(g, DISC_INNER.ring + 0.5, 8.4, 45, C.red);
}

discSign('B2a', 'Interdiction de tourner à gauche à la prochaine intersection', 'ring', noLeftTurn);
discSign('B2b', 'Interdiction de tourner à droite à la prochaine intersection', 'ring', (g) => {
  mirror(g);
  noLeftTurn(g);
});

discSign('B2c', 'Interdiction de faire demi-tour', 'ring', (g) => {
  g.strokeStyle = C.black;
  g.lineWidth = 8.2;
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(63.5, 74);
  g.lineTo(63.5, 45);
  g.arc(51.5, 45, 12, 0, Math.PI, true);
  g.lineTo(39.5, 58);
  g.stroke();
  fillPoly(g, [29, 56.5, 50, 56.5, 39.5, 72.5], C.black);
  discBar(g, DISC_INNER.ring + 0.5, 8.4, 45, C.red);
});

discSign('B3', 'Interdiction de dépasser', 'ring', (g) => {
  carFront(g, 33.2, 51, 30, C.red);
  carFront(g, 66.8, 51, 30, C.black);
});

discSign('B6a1', 'Stationnement interdit', 'bluering', (g) => discBar(g, DISC_INNER.bluering + 0.5, 9.6, 45, C.red));
discSign('B6d', 'Arrêt et stationnement interdits', 'bluering', (g) => {
  discBar(g, DISC_INNER.bluering + 0.5, 9.6, 45, C.red);
  discBar(g, DISC_INNER.bluering + 0.5, 9.6, -45, C.red);
});

function speedNumber(g: Ctx, n: string, color: string): void {
  drawText(g, n, 50, 50.4, 57, 33.5, { color, ratio: 1.0, minSqueeze: 0.8 });
}

function speedLimit(g: Ctx, v: string): void {
  discPlate(g, 'ring');
  speedNumber(g, v, C.black);
}

function speedLimitEnd(g: Ctx, v: string): void {
  discPlate(g, 'end');
  speedNumber(g, v, C.grey);
  discBar(g, DISC_INNER.end, 7.6, -45, C.black);
}

for (const v of ['20', '30', '50', '70', '10', '15', '40', '60', '80', '90', '110']) {
  def(`B14_${v}`, 'disc', DISC, DISC, `Limitation de vitesse à ${v} km/h`, (g) => speedLimit(g, v));
}
for (const v of ['30', '50', '20', '70']) {
  def(`B33_${v}`, 'disc', DISC, DISC, `Fin de limitation de vitesse à ${v} km/h`, (g) => speedLimitEnd(g, v));
}

// ── Obligation (disques bleus) ───────────────────────────────────────────────

function blueArrow(code: string, label: string, x0: number, y0: number, x1: number, y1: number): void {
  discSign(code, label, 'blue', (g) => {
    g.beginPath();
    arrow(g, x0, y0, x1, y1, 12.5, 35, 27);
    fill(g, C.white);
  });
}

blueArrow('B21-1', 'Obligation de tourner à droite avant le panneau', 16.5, 50, 85, 50);
blueArrow('B21-2', 'Obligation de tourner à gauche avant le panneau', 83.5, 50, 15, 50);
blueArrow('B21a1', 'Contournement obligatoire par la droite', 26, 26, 75.5, 75.5);
blueArrow('B21a2', 'Contournement obligatoire par la gauche', 74, 26, 24.5, 75.5);
blueArrow('B21b', 'Direction obligatoire à la prochaine intersection : tout droit', 50, 83.5, 50, 15);

function turnAhead(g: Ctx): void {
  g.beginPath();
  bentArrow(g, 36.5, 80.5, 41, 58, 83.5, 12.5, 33);
  fill(g, C.white);
}

discSign('B21c1', 'Direction obligatoire à la prochaine intersection : à droite', 'blue', turnAhead);
discSign('B21c2', 'Direction obligatoire à la prochaine intersection : à gauche', 'blue', (g) => {
  mirror(g);
  turnAhead(g);
});

discSign('B22a', 'Piste ou bande cyclable obligatoire', 'blue', (g) => bike(g, 50, 50.5, 66, C.white));
discSign('B27a', 'Voie réservée aux véhicules de transport en commun', 'blue', (g) => busFront(g, 50, 50, 54, C.white));

// ── Zones ────────────────────────────────────────────────────────────────────

const ZONE_W = 0.7;
const ZONE_H = 0.9;

function zone30(g: Ctx, H: number, ended: boolean): void {
  whitePlate(g, H, 5.5, 2.3, 1.3);
  roundel(g, 50, 48, 73, '30', ended ? C.grey : C.red, ended ? C.grey : C.black);
  drawText(g, 'ZONE', 50, 105.5, 60, 15.5, { ratio: 0.92 });
  if (ended) {
    g.save();
    g.beginPath();
    rrect(g, 3.6, 3.6, 92.8, H - 7.2, 2);
    g.clip();
    const ang = Math.atan2(-(H - 16), 84) / DEG;
    band(g, 50, H / 2, 170, 7.2, ang, C.black);
    g.restore();
  }
}

def('B30', 'rect', ZONE_W, ZONE_H, 'Entrée de zone 30', (g, H) => zone30(g, H, false));
def('B51', 'rect', ZONE_W, ZONE_H, 'Sortie de zone 30', (g, H) => zone30(g, H, true));

function meetingZone(g: Ctx, H: number, ended: boolean): void {
  const ink = ended ? C.grey : C.white;
  if (ended) whitePlate(g, H, 5.5, 2.3, 1.3);
  else bluePlate(g, H, 5.5);
  // piéton (prioritaire, le plus grand), vélo puis voiture
  figure(g, WALK, 27.5, 115, 88, 1, ink);
  roundel(g, 72.5, 29.5, 37, '20', ended ? C.grey : C.red, ended ? C.grey : C.black);
  bike(g, 74, 71, 38, ink);
  carSide(g, 73.5, 105.5, 38, ink);
  if (ended) {
    g.save();
    g.beginPath();
    rrect(g, 3.6, 3.6, 92.8, H - 7.2, 2);
    g.clip();
    const ang = Math.atan2(-(H - 16), 84) / DEG;
    band(g, 50, H / 2, 170, 7.2, ang, C.black);
    g.restore();
  }
}

def('B52', 'rect', ZONE_W, ZONE_H, 'Entrée de zone de rencontre', (g, H) => meetingZone(g, H, false));
def('B53', 'rect', ZONE_W, ZONE_H, 'Sortie de zone de rencontre', (g, H) => meetingZone(g, H, true));

def('B54', 'square', 0.7, 0.7, "Entrée d'aire piétonne", (g, H) => {
  bluePlate(g, H, 5.5);
  adultChild(g, 50, 73, 60, C.white);
  drawText(g, 'AIRE PIÉTONNE', 50, 86.3, 80, 8.2, { color: C.white, ratio: 0.9 });
});

// ── Indication (type C, carrés bleus) ────────────────────────────────────────

function blueSquare(code: string, label: string, symbol: (g: Ctx) => void): void {
  def(code, 'square', 0.5, 0.5, label, (g, H) => {
    bluePlate(g, H);
    symbol(g);
  });
}

blueSquare('C12', 'Circulation à sens unique', (g) => {
  g.beginPath();
  arrow(g, 50, 85, 50, 14, 15, 41, 30);
  fill(g, C.white);
});

blueSquare('C1a', 'Lieu aménagé pour le stationnement', (g) => {
  drawText(g, 'P', 50.5, 50, 60, 60, { color: C.white, ratio: 1.0 });
});

blueSquare('C20a', 'Passage pour piétons', (g) => {
  const rho = 21.6;
  const cy = 57.5;
  g.beginPath();
  roundPoly(g, [50, cy - 2 * rho, 50 + rho * SQ3, cy + rho, 50 - rho * SQ3, cy + rho], 2.6);
  fill(g, C.white);
  g.save();
  const k = 1.06;
  g.translate(50, cy);
  g.scale(k, k);
  g.translate(-50, -TRI_CY);
  crossingSymbol(g, C.black);
  g.restore();
});

blueSquare('C13a', 'Impasse', (g) => {
  g.fillStyle = C.white;
  g.fillRect(41, 30, 18, 57);
  g.fillRect(23, 14.5, 54, 22);
  g.fillStyle = C.red;
  g.fillRect(25.6, 17.1, 48.8, 16.8);
});

blueSquare('C24a_dsc', 'Double-sens cyclable', (g) => {
  // voie générale : grande flèche montante à droite
  g.beginPath();
  arrow(g, 69, 87, 69, 13, 12.5, 32, 25);
  fill(g, C.white);
  // séparation en pointillés
  g.fillStyle = C.white;
  for (let y = 12; y < 86; y += 13.4) g.fillRect(41.4, y, 2.6, 8.6);
  // contresens cyclable : vélo et petite flèche descendante à gauche
  bike(g, 22.5, 28, 29, C.white);
  g.beginPath();
  arrow(g, 22.5, 46, 22.5, 86, 6.2, 16, 14);
  fill(g, C.white);
});

blueSquare('C27', 'Surélévation de chaussée', (g) => hump(g, 50, 62, 70, 19, C.white, true));

blueSquare('C113', 'Piste ou bande cyclable conseillée', (g) => bike(g, 50, 50.5, 70, C.white));

// ── Panonceaux (type M) ──────────────────────────────────────────────────────

function panonceau(code: string, label: string, paint: (g: Ctx, H: number, text?: string) => void): void {
  def(code, 'rect', 0.5, 0.2, label, (g, H, text) => {
    whitePlate(g, H, 3.2, 1.5, 1.5);
    paint(g, H, text);
  });
}

panonceau('M9v', 'Sauf cyclistes', (g, H) => {
  drawText(g, 'SAUF', 30, H / 2, 38, 15, { ratio: 0.9 });
  bike(g, 72, H / 2, 37, C.black);
});
panonceau('M9z', 'Panonceau d’indications diverses', (g, H, text) =>
  fitLabel(g, text ?? 'Sauf riverains', 50, H / 2 + 0.2, 88, 11.5, 8.6, 1.62, { ratio: 0.9 }),
);
panonceau('M1', 'Panonceau de distance', (g, H, text) => fitLabel(g, text ?? '50 m', 50, H / 2 + 0.2, 86, 17, 9.5, 1.6, { ratio: 0.9 }));

function m12(code: string, label: string, straight: boolean): void {
  def(code, 'triangle-inv', 0.3, Math.round(((0.3 * TRI_H) / 100) * 1000) / 1000, label, (g) => {
    triPlate(g, true, 7.8);
    bike(g, 50, 24.5, 37, C.yellow);
    g.beginPath();
    if (straight) arrow(g, 50, 63, 50, 40.5, 5, 13, 10);
    else arrow(g, 38, 49, 62, 49, 5, 13, 10);
    fill(g, C.yellow);
  });
}

m12('M12', 'Cédez-le-passage cycliste au feu (à droite)', false);
m12('M12_right', 'Cédez-le-passage cycliste au feu : tourner à droite', false);
m12('M12_straight', 'Cédez-le-passage cycliste au feu : tout droit', true);

// ── Localisation et plaques de rue ───────────────────────────────────────────

function townName(g: Ctx, H: number, text: string): void {
  fitLabel(g, text.toUpperCase(), 50, H / 2 + 0.2, 83, 14, 8.6, 1.47, { ratio: 0.84 }, 0.6);
}

def('EB10', 'rect', 1.3, 0.45, "Entrée d'agglomération", (g, H, text) => {
  rectPlate(g, H, 3.4, C.white);
  fillRRect(g, 1.5, 1.5, 97, H - 3, 2.4, C.red);
  fillRRect(g, 4.3, 4.3, 91.4, H - 8.6, 1.3, C.white);
  townName(g, H, text ?? 'MONTREUIL');
});

def('EB20', 'rect', 1.3, 0.45, "Sortie d'agglomération", (g, H, text) => {
  rectPlate(g, H, 3.4, C.white);
  rectLine(g, H, 1.5, 1.2, 3.4, C.black);
  townName(g, H, text ?? 'MONTREUIL');
  g.save();
  g.beginPath();
  rrect(g, 2.7, 2.7, 94.6, H - 5.4, 1);
  g.clip();
  const ang = Math.atan2(-(H - 5.4), 94.6) / DEG;
  band(g, 50, H / 2, 120, 5.4, ang, C.red);
  g.restore();
});

const PP_TOP = 14; // haut du rectangle de la plaque parisienne
const PP_ARC = 19; // rayon du cartouche

function plaqueParisPath(g: Ctx, H: number, d: number): void {
  const top = PP_TOP + d;
  const R = PP_ARC - d;
  const dy = top - PP_ARC;
  const hc = Math.sqrt(Math.max(0, R * R - dy * dy));
  g.beginPath();
  g.moveTo(d, top);
  g.lineTo(50 - hc, top);
  g.arc(50, PP_ARC, R, Math.atan2(dy, -hc), Math.atan2(dy, hc), false);
  g.lineTo(100 - d, top);
  g.lineTo(100 - d, H - d);
  g.lineTo(d, H - d);
  g.closePath();
}

def('PLAQUE_PARIS', 'rect', 0.6, 0.4, 'Plaque de rue parisienne', (g, H, text) => {
  const raw = text ?? "20|RUE D'AVRON";
  const sep = raw.indexOf('|');
  const arr = sep >= 0 ? raw.slice(0, sep).trim() : '';
  const name = (sep >= 0 ? raw.slice(sep + 1) : raw).trim().toUpperCase();

  // cadre vert, filet blanc, émail bleu
  g.lineJoin = 'round';
  plaqueParisPath(g, H, 0);
  fill(g, '#1F4A28');
  plaqueParisPath(g, H, 0.6);
  fill(g, C.enamelGreen);
  plaqueParisPath(g, H, 3.9);
  fill(g, '#EDEFE8');
  plaqueParisPath(g, H, 4.6);
  fill(g, C.enamel);
  // reflet de l'émail
  g.save();
  plaqueParisPath(g, H, 4.6);
  g.clip();
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(255,255,255,0.13)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 100, H);
  g.restore();

  // cartouche : numéro d'arrondissement
  if (arr) {
    const ord = arr === '1' ? 'er' : 'e';
    g.save();
    drawText(g, arr, 50.6, 10.6, 14, 6.6, { color: C.white, ratio: 0.8, align: 'right' });
    drawText(g, ord, 51.4, 8.9, 6, 2.9, { color: C.white, ratio: 0.9, align: 'left' });
    drawText(g, 'Arr.', 50, 18.3, 14, 3.4, { color: C.white, ratio: 0.9 });
    g.restore();
  }

  // nom de la voie : type de voie sur la première ligne, nom en plus gros dessous
  const opts: TextOpts = { color: C.white, ratio: 0.74 };
  const lines = explicitLines(name);
  let l1 = '';
  let l2 = '';
  if (lines.length >= 2) {
    l1 = lines[0];
    l2 = lines.slice(1).join(' ');
  } else {
    const words = name.split(/\s+/);
    if (words.length >= 2) {
      l1 = words[0];
      l2 = words.slice(1).join(' ');
    } else {
      l2 = name;
    }
  }
  if (l1) {
    drawText(g, l1, 50, 32.5, 60, 7.6, opts);
    drawText(g, l2, 50, 49.8, 82, 12.5, opts);
  } else {
    drawText(g, l2, 50, 43.5, 82, 14, opts);
  }
});

def('PLAQUE_BANLIEUE', 'rect', 0.6, 0.25, 'Plaque de rue', (g, H, text) => {
  rectPlate(g, H, 2.6, '#12448F');
  rectLine(g, H, 2.2, 1.2, 2.6, C.white);
  fitLabel(g, text ?? 'Rue de Paris', 50, H / 2 + 0.3, 84, 13, 8.5, 1.76, { color: C.white, ratio: 0.9 }, 0.72);
});

def('RADAR', 'rect', 0.7, 0.9, 'Signalisation de contrôles automatiques (SR3)', (g, H) => {
  whitePlate(g, H, 5.5, 2.3, 1.3);
  // cabine radar, ondes et véhicule contrôlé
  fillRRect(g, 12, 28, 13, 30, 2.5, C.black);
  fillRRect(g, 15, 33, 7, 7, 1.2, C.white);
  g.fillStyle = C.black;
  g.fillRect(16.5, 58, 4, 6);
  g.strokeStyle = C.black;
  g.lineWidth = 3.1;
  g.lineCap = 'round';
  for (const r of [8, 15.5, 23]) {
    g.beginPath();
    g.arc(25, 37, r, -38 * DEG, 38 * DEG, false);
    g.stroke();
  }
  carSide(g, 71, 47.5, 40, C.black);
  g.fillStyle = C.black;
  g.fillRect(9, 65.5, 82, 1.6);
  const o: TextOpts = { ratio: 0.9 };
  drawText(g, 'Pour votre', 50, 78.5, 80, 8.2, o);
  drawText(g, 'sécurité', 50, 91, 80, 8.2, o);
  drawText(g, 'contrôles', 50, 104.5, 80, 8.2, o);
  drawText(g, 'automatiques', 50, 117, 80, 8.2, o);
});

// ─────────────────────────────────────────────────────────────────────────────
// Rendu des panneaux
// ─────────────────────────────────────────────────────────────────────────────

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

function context(cv: HTMLCanvasElement): Ctx {
  const g = cv.getContext('2d');
  if (!g) throw new Error('signs: contexte Canvas 2D indisponible');
  return g;
}

const UNKNOWN: SignInfo = { shape: 'rect', w: 0.5, h: 0.5, label: 'Panneau inconnu' };
const ANY_DISC: SignInfo = { shape: 'disc', w: DISC, h: DISC, label: 'Limitation de vitesse' };

/** Limitations hors catalogue (ex. 'B14_45', 'B33_90') : même dessin, valeur quelconque. */
function dynamicPainter(code: string): Painter | undefined {
  const m = /^B(14|33)_(\d{1,3})$/.exec(code);
  if (!m) return undefined;
  const v = m[2];
  return m[1] === '14' ? (g) => speedLimit(g, v) : (g) => speedLimitEnd(g, v);
}

/**
 * Dessine la face d'un panneau sur un canevas transparent. Le grand côté mesure `size` px
 * (256 par défaut), l'autre respecte le rapport w/h de `SIGNS[code]` ; la plaque occupe tout
 * le canevas à 2 px près. `text` sert aux panneaux à texte libre (EB10, EB20, plaques de rue,
 * M1, M9z) ; « | » sépare les lignes, et pour `PLAQUE_PARIS` le numéro d'arrondissement.
 */
export function drawSign(code: string, size = 256, text?: string): HTMLCanvasElement {
  const paint = PAINTERS[code] ?? dynamicPainter(code);
  const known: SignInfo | undefined = SIGNS[code];
  const info = known ?? (paint ? ANY_DISC : UNKNOWN);
  const long = Math.max(info.w, info.h);
  const wpx = Math.max(8, Math.round((size * info.w) / long));
  const hpx = Math.max(8, Math.round((size * info.h) / long));
  const cv = makeCanvas(wpx, hpx);
  const g = context(cv);
  const H = (100 * info.h) / info.w;
  const m = 2;
  g.translate(m, m);
  g.scale((wpx - 2 * m) / 100, (hpx - 2 * m) / H);
  g.save();
  if (paint) {
    paint(g, H, text);
  } else {
    // code inconnu : plaque neutre portant le code, pour repérer l'oubli sans planter le jeu
    whitePlate(g, H, 5, 2.2, 1.4);
    drawText(g, code, 50, H / 2, 80, 14);
  }
  g.restore();
  sheen(g, H);
  return cv;
}

// ─────────────────────────────────────────────────────────────────────────────
// Marquages au sol
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dimensions réelles des pictogrammes sur la chaussée, en mètres. `h` est mesuré le long de
 * la route : le haut du canevas est le côté le plus éloigné du conducteur (pointe des flèches,
 * haut des lettres) ; les formes sont allongées (anamorphose) comme la peinture réelle.
 */
export const ROAD_MARKS: Record<RoadMark, { w: number; h: number }> = {
  'arrow-straight': { w: 0.75, h: 4 },
  'arrow-left': { w: 1.2, h: 4 },
  'arrow-right': { w: 1.2, h: 4 },
  'arrow-straight-left': { w: 1.6, h: 4 },
  'arrow-straight-right': { w: 1.6, h: 4 },
  'arrow-left-right': { w: 1.8, h: 4 },
  bike: { w: 1.2, h: 2 },
  bus: { w: 1.6, h: 3 },
  zone30: { w: 1.8, h: 3.6 },
  '30': { w: 1.2, h: 3 },
  '20': { w: 1.2, h: 3 },
  'yield-triangle': { w: 0.5, h: 0.7 },
  payant: { w: 1.5, h: 1 },
  livraison: { w: 1.8, h: 1 },
};

type MarkPainter = (g: Ctx, w: number, h: number) => void;

const SHAFT = 0.18; // largeur du fût des flèches directionnelles (m)

/** Flèche « tourne à gauche » : fût à droite, branche transversale et pointe vers la gauche. */
function markTurnLeft(g: Ctx, w: number, h: number): void {
  const xr = w;
  const xl = w - SHAFT;
  g.beginPath();
  g.moveTo(xr, h);
  g.lineTo(xr, 1.32);
  g.quadraticCurveTo(xr, 0.62, xr - 0.24, 0.62);
  g.lineTo(0.55, 0.62);
  g.lineTo(0.55, 0);
  g.lineTo(0, 0.87);
  g.lineTo(0.55, 1.74);
  g.lineTo(0.55, 1.12);
  g.lineTo(xl - 0.06, 1.12);
  g.quadraticCurveTo(xl, 1.12, xl, 1.36);
  g.lineTo(xl, h);
  g.closePath();
  g.fill();
}

/** Flèche bifide « tout droit ou à gauche » : flèche droite à droite, branche vers la gauche. */
function markStraightLeft(g: Ctx, w: number, h: number): void {
  const ax = w - 0.375;
  g.beginPath();
  poly(g, [ax, 0, w, 1.6, w - 0.75, 1.6]);
  g.rect(ax - SHAFT / 2, 1.55, SHAFT, h - 1.55);
  g.fill();
  // branche transversale (raccordée au fût par un congé) et pointe vers la gauche
  const xs = ax - SHAFT / 2 + 0.02;
  g.beginPath();
  g.moveTo(0.5, 2.05);
  g.lineTo(xs, 2.05);
  g.lineTo(xs, 3.0);
  g.quadraticCurveTo(xs - 0.02, 2.55, xs - 0.3, 2.55);
  g.lineTo(0.5, 2.55);
  g.closePath();
  poly(g, [0.5, 1.45, 0, 2.3, 0.5, 3.15]);
  g.fill();
}

function markLeftRight(g: Ctx, w: number, h: number): void {
  const ax = w / 2;
  const s = SHAFT / 2;
  g.beginPath();
  // barre transversale et fût raccordés par des congés
  g.moveTo(0.55, 0.62);
  g.lineTo(w - 0.55, 0.62);
  g.lineTo(w - 0.55, 1.12);
  g.lineTo(ax + s + 0.28, 1.12);
  g.quadraticCurveTo(ax + s, 1.12, ax + s, 1.6);
  g.lineTo(ax + s, h);
  g.lineTo(ax - s, h);
  g.lineTo(ax - s, 1.6);
  g.quadraticCurveTo(ax - s, 1.12, ax - s - 0.28, 1.12);
  g.lineTo(0.55, 1.12);
  g.closePath();
  g.fill();
  g.beginPath();
  poly(g, [0.55, 0, 0, 0.87, 0.55, 1.74]);
  poly(g, [w - 0.55, 0, w, 0.87, w - 0.55, 1.74]);
  g.fill();
}

const MARK_PAINTERS: Record<RoadMark, MarkPainter> = {
  'arrow-straight': (g, w, h) => {
    g.beginPath();
    poly(g, [w / 2, 0, w, 1.6, 0, 1.6]);
    g.rect(w / 2 - SHAFT / 2, 1.55, SHAFT, h - 1.55);
    g.fill();
  },
  'arrow-left': markTurnLeft,
  'arrow-right': (g, w, h) => {
    g.translate(w, 0);
    g.scale(-1, 1);
    markTurnLeft(g, w, h);
  },
  'arrow-straight-left': markStraightLeft,
  'arrow-straight-right': (g, w, h) => {
    g.translate(w, 0);
    g.scale(-1, 1);
    markStraightLeft(g, w, h);
  },
  'arrow-left-right': markLeftRight,
  bike: (g, w, h) => {
    g.save();
    g.scale(w / 100, h / BIKE_H);
    bike(g, 50, BIKE_H / 2, 100, '#fff');
    g.restore();
  },
  bus: (g, w, h) => drawTextBox(g, 'BUS', 0, 0, w, h, '#fff'),
  zone30: (g, w, h) => {
    g.beginPath();
    g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, TAU);
    g.ellipse(w / 2, h / 2, w / 2 - 0.14, h / 2 - 0.3, 0, 0, TAU);
    g.fill('evenodd');
    drawTextBox(g, '30', w / 2 - 0.56, h / 2 - 0.85, 1.12, 1.7, '#fff');
  },
  '30': (g, w, h) => drawTextBox(g, '30', 0, 0, w, h, '#fff'),
  '20': (g, w, h) => drawTextBox(g, '20', 0, 0, w, h, '#fff'),
  'yield-triangle': (g, w, h) => {
    // pointe tournée vers le conducteur qui doit céder le passage (bas du canevas)
    g.beginPath();
    poly(g, [0, 0, w, 0, w / 2, h]);
    g.fill();
  },
  payant: (g, w, h) => drawTextBox(g, 'PAYANT', 0, 0, w, h, '#fff'),
  livraison: (g, w, h) => drawTextBox(g, 'LIVRAISON', 0, 0, w, h, '#fff'),
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bruit de valeur lissé, échantillonné sur toute l'image (valeurs dans [0, 1]). */
function valueNoise(rnd: () => number, w: number, h: number, cell: number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const lat = new Float32Array(gw * gh);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / cell;
    const iy = Math.floor(fy);
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const ix = Math.floor(fx);
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const i0 = iy * gw + ix;
      const a = lat[i0] + (lat[i0 + 1] - lat[i0]) * tx;
      const b = lat[i0 + gw] + (lat[i0 + gw + 1] - lat[i0 + gw]) * tx;
      out[y * w + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/** Flou en boîte séparable (une passe horizontale, une passe verticale). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * Vieillit la peinture : bords légèrement irréguliers (seuil bruité sur l'alpha flouté),
 * plages usées par le passage des roues et grain de l'enrobé.
 */
function wearPaint(cv: HTMLCanvasElement, seed: number): void {
  const g = context(cv);
  const w = cv.width;
  const h = cv.height;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = d[i * 4 + 3] / 255;
  const s = Math.max(w, h);
  const blurred = boxBlur(alpha, w, h, Math.max(1, Math.round(s / 200)));
  const rnd = mulberry32(seed);
  const fine = valueNoise(rnd, w, h, Math.max(1.6, s / 110));
  const mid = valueNoise(rnd, w, h, Math.max(3, s / 26));
  const large = valueNoise(rnd, w, h, Math.max(6, s / 7));
  const chipA = valueNoise(rnd, w, h, Math.max(2.2, s / 75));
  const chipB = valueNoise(rnd, w, h, Math.max(3.4, s / 41));
  const pr = Math.round(parseInt(C.paint.slice(1, 3), 16));
  const pg = Math.round(parseInt(C.paint.slice(3, 5), 16));
  const pb = Math.round(parseInt(C.paint.slice(5, 7), 16));
  for (let i = 0; i < n; i++) {
    const e = fine[i] * 0.55 + mid[i] * 0.45;
    let v = (blurred[i] - 0.5 + (e - 0.5) * 0.42) * 2.8 + 0.5;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    // usure : plages éclaircies et grain
    let p = (large[i] * 0.7 + mid[i] * 0.3 - 0.5) / 0.3;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    let wear = 1 - 0.2 * p * p * (3 - 2 * p) - 0.06 * rnd();
    // petits éclats de peinture
    let chip = (0.27 - (chipA[i] + chipB[i]) / 2) / 0.08;
    chip = chip < 0 ? 0 : chip > 1 ? 1 : chip;
    wear *= 1 - 0.4 * chip;
    const a = v * wear;
    d[i * 4] = pr;
    d[i * 4 + 1] = pg;
    d[i * 4 + 2] = pb;
    d[i * 4 + 3] = Math.round(255 * a);
  }
  g.putImageData(img, 0, 0);
}

/**
 * Pictogramme de peinture routière blanche sur fond transparent, aux bords légèrement usés.
 * Le grand côté mesure `size` px ; le rapport d'aspect est celui de `ROAD_MARKS[kind]`.
 */
export function drawRoadMark(kind: RoadMark, size = 256): HTMLCanvasElement {
  const info = ROAD_MARKS[kind];
  const long = Math.max(info.w, info.h);
  const wpx = Math.max(8, Math.round((size * info.w) / long));
  const hpx = Math.max(8, Math.round((size * info.h) / long));
  const cv = makeCanvas(wpx, hpx);
  const g = context(cv);
  const m = Math.max(2, Math.round(size / 128));
  g.translate(m, m);
  g.scale((wpx - 2 * m) / info.w, (hpx - 2 * m) / info.h);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  MARK_PAINTERS[kind](g, info.w, info.h);
  wearPaint(cv, hashString(kind));
  return cv;
}
