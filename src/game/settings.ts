// Réglages du jeu, conservés dans le navigateur.

import type { TransmissionMode } from '../vehicle/car';

export interface Settings {
  transmission: TransmissionMode;
  traffic: 'faible' | 'normal' | 'dense';
  quality: 'basse' | 'moyenne' | 'haute';
  mirrors: boolean;
  fov: number;
  lookIntoTurns: number;
  volume: number;
  voice: boolean;
  hud: boolean;
  minimap: boolean;
  /** rigueur du moniteur : relève aussi les contrôles visuels oubliés */
  strict: boolean;
  wheelRange: number;
  brakeGamma: number;
  hShifter: boolean;
  /** scores des leçons : identifiant → étoiles */
  progress: Record<string, number>;
}

export const DEFAULTS: Settings = {
  transmission: 'manual', traffic: 'normal', quality: 'moyenne', mirrors: true, fov: 60, lookIntoTurns: 0.55,
  volume: 0.8, voice: true, hud: true, minimap: true, strict: false, wheelRange: 900, brakeGamma: 1, hShifter: false, progress: {},
};

const KEY = 'conduite.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* stockage indisponible */ }
  return { ...DEFAULTS, progress: {} };
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export const TRANSMISSION_LABELS: Record<TransmissionMode, string> = {
  manual: 'Manuelle (pédale d’embrayage)',
  autoclutch: 'Manuelle, embrayage piloté',
  auto: 'Automatique',
};
export const TRAFFIC_COUNTS = { faible: { vehicles: 14, pedestrians: 12 }, normal: { vehicles: 30, pedestrians: 24 }, dense: { vehicles: 48, pedestrians: 36 } };
