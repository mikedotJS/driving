// Types de tools/lib/enseignes.mjs, pour les tests (tests/enseignes.test.ts).
export interface Rattachement { b: number; i: number; s: number; f0: number; f1: number }
export const DEVANTURE_MAX: number;
export function rattacher(
  points: { x: number; z: number }[],
  batiments: { pts: [number, number][]; type: string }[],
  rues: { pts: [number, number][]; half: number }[],
): (Rattachement | null)[];
export function stationsDeMetro(
  relations: Map<string, { tags: Record<string, string>; members: { type: string; ref: string; role?: string }[] }>,
): Map<string, { station: string; ligne?: string }>;
