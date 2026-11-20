// Types de tools/lib/ign.mjs, pour les tests (tests/ign.test.ts).
export interface IgnBatiment {
  id: string; paths: { X: number; Y: number }[][]; area: number; box: [number, number, number, number];
  h: number; etages: number; mur: number; mur2: number; toit: number; an: number; u1: string; u2: string; leger: boolean;
}
export interface Appariement {
  couv: number; n: number; h?: number; etages?: number; mur?: number; mur2?: number; toit?: number;
  an?: number; u?: string; u2?: string; leger?: boolean;
}
export const USAGES: Record<string, string>;
export function codeMateriaux(code: unknown): [number, number];
export function medianePonderee(list: [number, number][]): number;
export function loadIgn(dir: string, proj: (lat: number, lon: number) => [number, number]): { files: number; list: IgnBatiment[] } | null;
export function apparier(osm: { pts: [number, number][]; area: number; type: string }[], ign: IgnBatiment[]): (Appariement | null)[];
