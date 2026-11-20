// Page de contrôle visuel des panneaux et marquages au sol (voir dev/README.md).
import { SIGNS, drawSign, drawRoadMark, ROAD_MARKS } from '../src/world/signs';
import type { RoadMark } from '../src/world/signs';

const q = new URLSearchParams(location.search);
const only = (q.get('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const cell = Number(q.get('cell') ?? 150);
const size = Number(q.get('size') ?? 256);
const text = q.get('text') ?? undefined;
const showSigns = q.get('signs') !== '0';
const showMarks = q.get('marks') !== '0';

const app = document.getElementById('app') as HTMLElement;

function section(title: string, asphalt: boolean): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  app.appendChild(h);
  const grid = document.createElement('div');
  grid.className = asphalt ? 'grid asphalt' : 'grid';
  app.appendChild(grid);
  return grid;
}

function addCell(grid: HTMLElement, cv: HTMLCanvasElement, code: string, label: string, w: number, h: number, boxPx: number, boxH = boxPx): void {
  const fig = document.createElement('figure');
  const k = Math.min(boxPx / cv.width, boxH / cv.height);
  cv.style.width = `${Math.round(cv.width * k)}px`;
  cv.style.height = `${Math.round(cv.height * k)}px`;
  fig.style.width = `${Math.max(boxPx, 96)}px`;
  const box = document.createElement('div');
  box.className = 'box';
  box.style.height = `${boxH}px`;
  box.appendChild(cv);
  fig.appendChild(box);
  const cap = document.createElement('figcaption');
  const b = document.createElement('b');
  b.textContent = code;
  const s = document.createElement('span');
  s.textContent = label;
  const m = document.createElement('span');
  m.className = 'meta';
  m.textContent = `${w} × ${h} m · ${cv.width}×${cv.height} px`;
  cap.append(b, s, m);
  fig.appendChild(cap);
  grid.appendChild(fig);
}

/** Regroupe les codes par famille pour faciliter la lecture de la planche. */
function family(code: string): string {
  if (/^(PLAQUE|EB|RADAR)/.test(code)) return 'Localisation, plaques de rue, radar';
  if (/^M/.test(code)) return 'Panonceaux';
  if (/^AB(3a|4|6|7)$/.test(code)) return 'Priorité';
  if (/^A/.test(code)) return 'Danger';
  if (/^B(30|51|52|53|54)$/.test(code)) return 'Zones';
  if (/^B(21|22|27)/.test(code)) return 'Obligation';
  if (/^B/.test(code)) return 'Interdiction et fin d’interdiction';
  if (/^C/.test(code)) return 'Indication';
  return 'Divers';
}

if (showSigns) {
  const groups = new Map<string, string[]>();
  for (const code of Object.keys(SIGNS)) {
    if (only.length > 0 && !only.includes(code)) continue;
    const f = family(code);
    const list = groups.get(f) ?? [];
    list.push(code);
    groups.set(f, list);
  }
  for (const [title, codes] of groups) {
    const grid = section(title, false);
    for (const code of codes) {
      const info = SIGNS[code];
      addCell(grid, drawSign(code, size, text), code, info.label, info.w, info.h, cell);
    }
  }
}

// Exemples de textes libres (noms de communes, plaques de rue, panonceaux).
const SAMPLES: [string, string][] = [
  ['EB10', 'PARIS'],
  ['EB10', 'FONTENAY-SOUS-BOIS'],
  ['EB20', 'BAGNOLET'],
  ['EB20', 'ROSNY-SOUS-BOIS'],
  ['PLAQUE_PARIS', '11|BOULEVARD VOLTAIRE'],
  ['PLAQUE_PARIS', '12|PLACE DE LA NATION'],
  ['PLAQUE_PARIS', '1|RUE DE RIVOLI'],
  ['PLAQUE_PARIS', '20|PASSAGE'],
  ['PLAQUE_BANLIEUE', 'Avenue du Président Wilson'],
  ['PLAQUE_BANLIEUE', 'Rue|Étienne Marcel'],
  ['M9z', 'Sauf livraisons|7 h - 11 h'],
  ['M9z', 'Rappel'],
  ['M1', '150 m'],
];

if (showSigns && text === undefined) {
  const samples = SAMPLES.filter(([code]) => only.length === 0 || only.includes(code));
  if (samples.length > 0) {
    const grid = section('Textes libres (exemples)', false);
    for (const [code, t] of samples) {
      const info = SIGNS[code];
      addCell(grid, drawSign(code, size, t), code, `« ${t} »`, info.w, info.h, cell);
    }
  }
}

if (showMarks) {
  const kinds = (Object.keys(ROAD_MARKS) as RoadMark[]).filter((k) => only.length === 0 || only.includes(k));
  if (kinds.length > 0) {
    const grid = section('Marquages au sol (haut = côté éloigné du conducteur)', true);
    for (const k of kinds) {
      const info = ROAD_MARKS[k];
      addCell(grid, drawRoadMark(k, size), k, 'peinture routière', info.w, info.h, cell, cell * 1.7);
    }
  }
}

(window as unknown as { __ready: boolean }).__ready = true;
