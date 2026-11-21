// Types de tools/lib/sol.mjs, pour les tests (tests/sol.test.ts).
export type Point = [number, number];
export interface Nature { k: string; s?: string; e?: number }
export const MASSIF_MAX: number;
export const VEGETAL: RegExp;
export function revetement(surface: string | undefined): string;
export function nature(tags: Record<string, string>, relation?: boolean, aire?: number): Nature | null;
export function rang(k: string): number;
export function ordreDessus(a: { k: string; aire: number }, b: { k: string; aire: number }): number;
export function estMaison(b: { t: string; l: number; aire: number }): boolean;
export function tissu(batiments: { t: string; l: number; aire: number }[]): 'jardin' | 'cour';
export function ecarterArbre(x: number, z: number, bord: { x: number; z: number } | null, dedans: boolean, marge?: number, tol?: number): Point | null;
export function versTrottoir(x: number, z: number, surChaussee: (x: number, z: number) => boolean, max?: number, garde?: number): Point | null;
export function dansAnneau(pts: Point[], x: number, z: number): boolean;
export function assembler<T>(chemins: T[][]): T[][];
export function rangerTrous(exterieurs: Point[][], trous: Point[][]): { o: Point[]; h: Point[][] }[];
export interface Vegetation { x0: number; z0: number; cote: number; l: number; h: number; part(i: number, j: number): number; arbres: [number, number, number][] }
export function lireVegetation(v: unknown): Vegetation | null;
export const SEUIL_JARDIN: number;
export function casesJardin(veg: Vegetation, seuil?: number): [number, number, number, number][];
export function hauteurArbre(r: number): number;
export interface Candidat { x: number; z: number; r: number; route: number }
export function choisirArbres<T extends Candidat>(candidats: T[], quota: number, ecart?: number, portee?: number): T[];
export const PORTAIL: number;
export const TONS_MURET: number;
export function decouperCloture(pts: Point[], graine: number): { pts: Point[]; muret: number; haie: number; ton: number }[];
