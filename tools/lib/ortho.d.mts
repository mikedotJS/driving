export interface Origine { lat: number; lon: number }
export interface Grille { x0: number; z0: number; cote: number; nx: number; nz: number }
export interface Emprise { x0: number; z0: number; x1: number; z1: number }
export const TUILES_PAR_DALLE: number;
export const PAS: number;
export const PAS_BRUT: number;
export const COTE_MAX_WMS: number;
export const WMS: string;
export const COUCHE: string;
export function echelles(origine: Origine): { kx: number; kz: number };
export function versGeo(origine: Origine, x: number, z: number): { lat: number; lon: number };
export function grille(cles: Iterable<string>, tuile: number): Grille;
export function emprise(g: Grille, i: number, j: number): Emprise;
export function urlWms(origine: Origine, e: Emprise, pas: number, format?: string): string;
export function urlMillesime(origine: Origine, e: Emprise): string;
export function nomDalle(i: number, j: number): string;
