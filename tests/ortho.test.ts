// Photo aérienne du sol (IGN – BD ORTHO) : découpage et adresses de téléchargement
// (tools/lib/ortho.mjs), dalles et mélange au rendu (src/world/ortho.ts), dalles livrées (public/ortho).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { PAS, PAS_BRUT, TUILES_PAR_DALLE, echelles, emprise, grille, nomDalle, urlMillesime, urlWms, versGeo } from '../tools/lib/ortho.mjs';
import { CHARGEMENTS_MAX, FLOU_MINERAL, GAIN_TOIT, LOIN, Ortho, PART_MINERAL, POIDS, PRES, REPRISES_MS, lireIndex, lireToits, teinteToit, dalleDe, dalleDeTuile, dallesProches, distanceDalle, empriseDalle, indexValide, memoireDalle, nettete, uvPhoto, type ChargeurPhoto, type IndexOrtho, type Modeles } from '../src/world/ortho';
import { GeoBuilder } from '../src/world/geo';
import type { MapFile } from '../src/map/roadnet';

const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const g = grille(Object.keys(map.chunks), map.chunk);
const fichier = (n: string) => new URL('../public/ortho/' + n, import.meta.url);
const index = JSON.parse(readFileSync(fichier('index.json'), 'utf8')) as IndexOrtho;

describe('grille des dalles de photo', () => {
  it('couvre toutes les dalles de la ville, par blocs de 4 × 4', () => {
    expect(g).toEqual({ x0: -1600, z0: -1000, cote: 400, nx: 8, nz: 5 });
    expect(TUILES_PAR_DALLE * map.chunk).toBe(g.cote);
    for (const k of Object.keys(map.chunks)) {
      const [ci, cj] = k.split(',').map(Number);
      const x = (ci + 0.5) * map.chunk, z = (cj + 0.5) * map.chunk;
      expect(x > g.x0 && x < g.x0 + g.nx * g.cote && z > g.z0 && z < g.z0 + g.nz * g.cote).toBe(true);
    }
  });
  it('donne des emprises jointives', () => {
    expect(emprise(g, 0, 0)).toEqual({ x0: -1600, z0: -1000, x1: -1200, z1: -600 });
    expect(emprise(g, 1, 0).x0).toBe(emprise(g, 0, 0).x1);
    expect(emprise(g, 0, 1).z0).toBe(emprise(g, 0, 0).z1);
    expect(nomDalle(5, 2)).toBe('5_2');
  });
  it('refuse une carte sans dalle', () => {
    expect(() => grille([], 100)).toThrow();
  });
});

describe('repère du jeu et WMS', () => {
  it('inverse la projection de tools/build-map.mjs', () => {
    const { kx, kz } = echelles(map.origin);
    // projection directe : x = (lon − lon0)·kx, z = −(lat − lat0)·kz
    const lat = 48.8612, lon = 2.4411;
    const x = (lon - map.origin.lon) * kx, z = -(lat - map.origin.lat) * kz;
    const r = versGeo(map.origin, x, z);
    expect(r.lat).toBeCloseTo(lat, 10);
    expect(r.lon).toBeCloseTo(lon, 10);
    // l'origine est au centre, le nord est vers les z négatifs
    expect(versGeo(map.origin, 0, 0)).toEqual({ lat: map.origin.lat, lon: map.origin.lon });
    expect(versGeo(map.origin, 0, -100).lat).toBeGreaterThan(map.origin.lat);
    expect(kx).toBeCloseTo(73240.4, 0);
    expect(kz).toBeCloseTo(111319.5, 0);
  });
  it('demande une dalle en EPSG:4326, latitude d’abord, à 20 cm', () => {
    const u = new URL(urlWms(map.origin, emprise(g, 5, 2), PAS_BRUT));
    expect(u.hostname).toBe('data.geopf.fr');
    const q = u.searchParams;
    expect(q.get('CRS')).toBe('EPSG:4326');
    expect(q.get('LAYERS')).toBe('ORTHOIMAGERY.ORTHOPHOTOS');
    expect(q.get('WIDTH')).toBe('2000');
    expect(q.get('HEIGHT')).toBe('2000');
    const [latS, lonO, latN, lonE] = q.get('BBOX')!.split(',').map(Number);
    expect(latS).toBeLessThan(latN);
    expect(lonO).toBeLessThan(lonE);
    // la dalle 5_2 va de x = 400 à 800 et de z = −200 à 200 : elle contient l'origine en latitude
    expect(latS).toBeLessThan(map.origin.lat);
    expect(latN).toBeGreaterThan(map.origin.lat);
    const { kx, kz } = echelles(map.origin);
    expect((lonE - lonO) * kx).toBeCloseTo(400, 2);
    expect((latN - latS) * kz).toBeCloseTo(400, 2);
    expect((lonO - map.origin.lon) * kx).toBeCloseTo(400, 2);
  });
  it('des pixels carrés et des dalles voisines qui partagent leur bord au pixel près', () => {
    const a = new URL(urlWms(map.origin, emprise(g, 2, 1), PAS)).searchParams.get('BBOX')!.split(',');
    const b = new URL(urlWms(map.origin, emprise(g, 3, 1), PAS)).searchParams.get('BBOX')!.split(',');
    expect(a[3]).toBe(b[1]);
    expect(new URL(urlWms(map.origin, emprise(g, 2, 1), PAS)).searchParams.get('WIDTH')).toBe('800');
  });
  it('refuse une image plus grande que la limite du serveur', () => {
    expect(() => urlWms(map.origin, { x0: 0, z0: 0, x1: 3200, z1: 2000 }, 0.2)).toThrow();
  });
  it('interroge le graphe de mosaïquage sur la même emprise', () => {
    expect(urlMillesime(map.origin, emprise(g, 0, 0))).toMatch(/graphe_bdortho.*BBOX=48\.\d+,2\.\d+,48\.\d+,2\.\d+,urn:ogc:def:crs:EPSG::4326/);
  });
});

describe('dalle d’un point, coordonnées de texture', () => {
  it('range chaque dalle de ville dans une seule dalle de photo', () => {
    expect(dalleDe(index, 640, 0)).toBe('5_2');
    expect(dalleDe(index, -1600, -1000)).toBe('0_0');
    expect(dalleDe(index, -1600.1, 0)).toBeNull();
    expect(dalleDe(index, 1600, 0)).toBeNull();
    expect(dalleDeTuile(index, -16, -10, 100)).toBe('0_0');
    expect(dalleDeTuile(index, -13, -7, 100)).toBe('0_0');
    expect(dalleDeTuile(index, -12, -6, 100)).toBe('1_1');
    expect(dalleDeTuile(index, 15, 9, 100)).toBe('7_4');
    for (const k of Object.keys(map.chunks)) {
      const [ci, cj] = k.split(',').map(Number);
      const cle = dalleDeTuile(index, ci, cj, map.chunk)!;
      const e = empriseDalle(index, cle);
      // la dalle de ville est tout entière dans sa dalle de photo
      expect(ci * map.chunk >= e.x0 && (ci + 1) * map.chunk <= e.x1 && cj * map.chunk >= e.z0 && (cj + 1) * map.chunk <= e.z1).toBe(true);
    }
  });
  it('u va vers l’est, v vers le sud, le coin nord-ouest est en (0, 0)', () => {
    expect(uvPhoto(index, '5_2', 400, -200)).toEqual([0, 0]);
    expect(uvPhoto(index, '5_2', 800, 200)).toEqual([1, 1]);
    expect(uvPhoto(index, '5_2', 500, -200)).toEqual([0.25, 0]);
    expect(uvPhoto(index, '5_2', 400, 0)).toEqual([0, 0.5]);
  });
  it('le pixel d’un point est celui que le WMS a rendu pour ce point', () => {
    // Croix de Chavaux : la colonne et la ligne du pixel, retrouvées par la longitude et la latitude
    const x = 674, z = 1.9, cle = dalleDe(index, x, z)!;
    const [u, v] = uvPhoto(index, cle, x, z);
    const [i, j] = cle.split('_').map(Number);
    const [latS, lonO, latN, lonE] = new URL(urlWms(map.origin, emprise(g, i, j), PAS)).searchParams.get('BBOX')!.split(',').map(Number);
    const p = versGeo(map.origin, x, z);
    expect(u).toBeCloseTo((p.lon - lonO) / (lonE - lonO), 6);
    expect(v).toBeCloseTo((latN - p.lat) / (latN - latS), 6);
  });
  it('distance à une dalle et dalles à portée', () => {
    expect(distanceDalle(index, '5_2', 640, 0)).toBe(0);
    expect(distanceDalle(index, '5_2', 300, 0)).toBe(100);
    expect(distanceDalle(index, '5_2', 300, 500)).toBeCloseTo(Math.hypot(100, 300), 9);
    expect(dallesProches(index, 600, 0, 0)).toEqual(['5_2']);
    const p = dallesProches(index, 600, 0, 350);
    expect(p[0]).toBe('5_2');
    expect(p).toHaveLength(9);
    // au bord de la carte, rien au-delà de la grille
    expect(dallesProches(index, -1590, -990, 100)).toEqual(['0_0']);
    expect(dallesProches({ ...index, dalles: ['0_0'] }, 600, 0, 350)).toEqual([]);
  });
});

describe('mélange selon la distance', () => {
  it('teinte floue de près, photo nette de loin, sans à-coup', () => {
    expect(nettete(0)).toBe(0);
    expect(nettete(PRES)).toBe(0);
    expect(nettete(LOIN)).toBe(1);
    expect(nettete(300)).toBe(1);
    expect(nettete((PRES + LOIN) / 2)).toBeCloseTo(0.5, 9);
    let avant = 0;
    for (let d = 0; d <= 40; d += 0.5) { const n = nettete(d); expect(n).toBeGreaterThanOrEqual(avant); expect(n - avant).toBeLessThan(0.05); avant = n; }
  });
  it('pas de photo sur les trottoirs, photo entière sur cours, jardins et espaces', () => {
    expect(POIDS.trottoir).toBe(0);
    expect(POIDS.cour).toBe(1);
    expect(POIDS.jardin).toBe(1);
    expect(POIDS.espace).toBe(1);
  });
  it('mémoire d’une dalle de 800 pixels : 3,4 Mo avec ses niveaux de détail', () => {
    expect(memoireDalle(800)).toBe(3413333);
  });
});

describe('poids de la photo dans les lots de sol', () => {
  it('un polygone porte son poids par sommet, le reste du lot (mobilier, flancs) un poids nul', () => {
    const lot = new GeoBuilder(true, 1, 'photo');
    lot.polygon([0, 0, 10, 0, 10, 10, 0, 10], [], 0, 1, 0, 0, 1, 1, 1, 1, POIDS.cour);
    lot.polygon([20, 0, 30, 0, 30, 10], [], 0, 1, 0, 0, 1, 1, 1, 1, POIDS.trottoir);
    lot.vertex(0, 1, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0.5);
    expect(lot.extra).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    const geo = lot.build();
    expect(geo.getAttribute('photo').itemSize).toBe(1);
    expect(geo.getAttribute('photo').count).toBe(geo.getAttribute('position').count);
  });
  it('un lot de façades garde son attribut à trois valeurs', () => {
    const lot = new GeoBuilder(true, 3, 'facade');
    lot.polygon([0, 0, 3, 0, 3, 3], [], 0, 0.5, 0, 0, 1, 1, 1, 1, 7);
    expect(lot.extra.slice(0, 3)).toEqual([0, 0, 7]);
  });
});

describe('chargement et libération des dalles', () => {
  const modeles = (): Modeles => {
    const m = () => new THREE.MeshStandardMaterial();
    const c = () => new THREE.Color(0.2, 0.2, 0.2);
    return { mineral: m(), vegetal: m(), pave: m(), uni: m(), toit: m(), chaussee: m(), moyennes: { mineral: c(), vegetal: c(), pave: c(), toit: c() } };
  };
  /** faux chargeur : compte les demandes et les libérations, échoue pour les dalles de `absentes` */
  const faux = (absentes: string[] = []) => {
    const demandes: string[] = [], liberees: string[] = [];
    const chargeur: ChargeurPhoto = async (url) => {
      demandes.push(url);
      if (absentes.some((a) => url.endsWith(a + '.webp'))) throw new Error('404');
      const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
      return { texture, liberer: () => { liberees.push(url); } };
    };
    return { chargeur, demandes, liberees };
  };
  const poids = (o: Ortho, ci: number, cj: number) => lirePoids(o, ci, cj);
  // le poids du mélange est la 4e composante de l'uniforme « boîte », lue à la compilation du matériau
  function lirePoids(o: Ortho, ci: number, cj: number): number {
    const mat = o.materiaux(ci, cj, 100)!.mineral;
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    mat.onBeforeCompile(shader as never, null as never);
    return (shader.uniforms.orthoBoite.value as THREE.Vector4).w;
  }

  it('les dalles de ville d’une même dalle de photo partagent leurs matériaux, pas les autres', () => {
    const o = new Ortho(index, modeles(), faux());
    const a = o.materiaux(4, -2, 100)!, b = o.materiaux(7, 1, 100)!, c = o.materiaux(8, 1, 100)!;
    expect(a.mineral).toBe(b.mineral);
    expect(c.mineral).not.toBe(a.mineral);
    // hors de la grille ou dalle non livrée : pas de matériau, la ville garde les siens
    expect(o.materiaux(99, 0, 100)).toBeNull();
    expect(new Ortho({ ...index, dalles: ['0_0'] }, modeles(), faux()).materiaux(4, -2, 100)).toBeNull();
    expect(a.chaussee).toBeNull();
  });

  it('avant le chargement le poids est nul (sol procédural), puis il monte en fondu', async () => {
    const f = faux();
    const o = new Ortho(index, modeles(), f);
    expect(poids(o, 6, 0)).toBe(0);
    o.update(640, 0, 100, 0);
    expect(f.demandes).toEqual(['ortho/5_2.webp']);
    expect(poids(o, 6, 0)).toBe(0);
    await o.pretes();
    const t = performance.now();
    o.update(640, 0, 100, t + 350);
    expect(poids(o, 6, 0)).toBeGreaterThan(0.3);
    expect(poids(o, 6, 0)).toBeLessThan(0.7);
    o.update(640, 0, 100, t + 5000);
    expect(poids(o, 6, 0)).toBe(1);
    expect(o.mesures.chargees).toBe(1);
    expect(o.mesures.octets).toBe(memoireDalle(index.pixels));
    expect(o.mesures.chargements).toHaveLength(1);
    expect(o.mesures.envois).toHaveLength(1);
    // une dalle prête n'est pas redemandée
    o.update(640, 0, 100, t + 6000);
    expect(f.demandes).toHaveLength(1);
  });

  it('libère la texture quand on s’éloigne, avec une marge pour ne pas recharger au moindre demi-tour', async () => {
    const f = faux();
    const o = new Ortho(index, modeles(), f);
    o.update(640, 0, 100, 0);
    await o.pretes();
    o.update(640, 0, 100, 1e9);
    // 200 m hors de la dalle : au-delà du rayon (100 m) mais dans la marge
    o.update(1000, 0, 100, 1e9);
    expect(f.liberees).toEqual([]);
    await o.pretes();
    o.update(1300, 0, 100, 1e9);
    expect(f.liberees).toContain('ortho/5_2.webp');
    expect(poids(o, 6, 0)).toBe(0);
    await o.pretes();
    // au retour, elle est redemandée
    const n = f.demandes.length;
    o.update(640, 0, 100, 1e9);
    expect(f.demandes.length).toBe(n + 1);
    expect(o.mesures.octets).toBeGreaterThanOrEqual(0);
  });

  it('une dalle absente laisse le sol procédural : redemandée deux fois, puis signalée et laissée', async () => {
    const f = faux(['5_2']);
    const avis: string[] = [];
    let t = 0;
    const o = new Ortho(index, modeles(), { ...f, avertir: (m) => avis.push(m), horloge: () => t });
    const passe = async (maintenant: number) => { t = maintenant; o.update(640, 0, 10, maintenant); await new Promise((r) => setTimeout(r, 2)); };
    await passe(0);
    expect(f.demandes).toHaveLength(1);
    // pas avant le premier délai
    await passe(REPRISES_MS[0] - 1);
    expect(f.demandes).toHaveLength(1);
    await passe(REPRISES_MS[0] + 1);
    expect(f.demandes).toHaveLength(2);
    expect(avis).toHaveLength(0);
    await passe(REPRISES_MS[0] + REPRISES_MS[1] + 2);
    expect(f.demandes).toHaveLength(3);
    // troisième échec : abandon, signalé une fois, avec le nom de la dalle
    await passe(1e9);
    await passe(2e9);
    expect(f.demandes).toEqual(['ortho/5_2.webp', 'ortho/5_2.webp', 'ortho/5_2.webp']);
    expect(avis).toHaveLength(1);
    expect(avis[0]).toContain('5_2.webp');
    expect(poids(o, 6, 0)).toBe(0);
    expect(o.mesures.echecs).toBe(3);
    expect(o.mesures.chargees).toBe(0);
  });

  it('un raté passager ne prive pas la dalle de photo : le deuxième essai la charge', async () => {
    const f = faux();
    let rates = 1, t = 0;
    const avis: string[] = [];
    const chargeur: ChargeurPhoto = async (url) => { if (rates-- > 0) { f.demandes.push(url); throw new Error('réseau'); } return f.chargeur(url); };
    const o = new Ortho(index, modeles(), { chargeur, avertir: (m) => avis.push(m), horloge: () => t });
    o.update(640, 0, 10, 0);
    await new Promise((r) => setTimeout(r, 2));
    t = REPRISES_MS[0] + 1;
    o.update(640, 0, 10, t);
    await new Promise((r) => setTimeout(r, 2));
    o.update(640, 0, 10, t + 1);
    expect(f.demandes).toHaveLength(2);
    expect(o.mesures.chargees).toBe(1);
    expect(avis).toHaveLength(0);
  });

  it('pretes() n’attend pas les délais : la dalle absente est abandonnée, les autres installées', async () => {
    const f = faux(['5_2']);
    const avis: string[] = [];
    const o = new Ortho(index, modeles(), { ...f, avertir: (m) => avis.push(m) });
    o.update(640, 0, 350, 0);
    await o.pretes();
    expect(o.mesures.chargees).toBe(8);
    expect(avis).toHaveLength(1);
  });

  it('coupée (qualité basse), elle ne charge rien et rend ce qu’elle tenait', async () => {
    const f = faux();
    const o = new Ortho(index, modeles(), f);
    o.active = false;
    o.update(640, 0, 300, 0);
    expect(f.demandes).toEqual([]);
    o.active = true;
    o.update(640, 0, 300, 0);
    await o.pretes();
    o.update(640, 0, 300, 1e9);
    const n = o.mesures.chargees;
    expect(n).toBeGreaterThan(1);
    o.active = false;
    o.update(640, 0, 300, 1e9);
    expect(o.mesures.chargees).toBe(0);
    expect(o.mesures.octets).toBe(0);
    expect(f.liberees).toHaveLength(n);
    expect(poids(o, 6, 0)).toBe(0);
  });

  it('n’installe qu’une dalle par image, pour ne pas bloquer le fil principal', async () => {
    const f = faux();
    const envois: number[] = [];
    const o = new Ortho(index, modeles(), { ...f, envoyer: () => { envois.push(1); } });
    o.update(640, 0, 350, 0);
    // neuf dalles à portée, mais CHARGEMENTS_MAX demandes à la fois, la plus proche d'abord
    expect(f.demandes).toHaveLength(CHARGEMENTS_MAX);
    expect(f.demandes[0]).toBe('ortho/5_2.webp');
    await new Promise((r) => setTimeout(r, 5));
    expect(o.mesures.chargees).toBe(0);
    // chaque image installe une dalle et lance les demandes suivantes
    let image = 1;
    for (; image < 60 && o.mesures.chargees < 9; image++) {
      const avant = o.mesures.chargees;
      o.update(640, 0, 350, image);
      expect(o.mesures.chargees - avant).toBeLessThanOrEqual(1);
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(o.mesures.chargees).toBe(9);
    expect(envois).toHaveLength(9);
    // sans bouger, rien n'est redemandé
    o.update(640, 0, 350, image + 1);
    expect(f.demandes).toHaveLength(9);
  });

  it('une dalle qui n’est plus à portée quand vient son tour n’est pas téléchargée', async () => {
    const f = faux();
    const o = new Ortho(index, modeles(), f);
    o.update(640, 0, 350, 0);
    expect(f.demandes).toHaveLength(CHARGEMENTS_MAX);
    // la voiture est posée ailleurs avant que la file soit vidée : les six dalles en attente sont oubliées
    o.update(-1000, 800, 10, 1);
    await o.pretes();
    const loin = f.demandes.slice(CHARGEMENTS_MAX);
    expect(loin).toEqual(['ortho/1_4.webp']);
    expect(o.mesures.chargees).toBe(1);
  });

  it('une dalle coupée pendant son chargement est rendue dès son arrivée', async () => {
    const f = faux();
    const o = new Ortho(index, modeles(), f);
    o.update(640, 0, 10, 0);
    o.active = false;
    await o.pretes();
    expect(o.mesures.chargees).toBe(0);
    expect(f.liberees).toHaveLength(1);
  });

  it('le shader garde la variation du matériau d’origine et ajoute la lecture de la photo', () => {
    const m = modeles();
    let appele = 0;
    m.mineral.onBeforeCompile = () => { appele++; };
    m.mineral.customProgramCacheKey = () => 'macro';
    const o = new Ortho(index, m, faux());
    const mat = o.materiaux(6, 0, 100)!;
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    mat.mineral.onBeforeCompile(shader as never, null as never);
    expect(appele).toBe(1);
    expect(shader.vertexShader).toContain('attribute float photo;');
    expect(shader.fragmentShader).toContain('orthoTex');
    expect(mat.mineral.customProgramCacheKey()).toMatch(/^macro\|photo/);
    // sol minéral : la teinte moyenne de la photo (niveau de détail fixe), jamais la photo nette
    expect(shader.fragmentShader).toContain(`texture2D( orthoTex, vOrtho.xy, ${FLOU_MINERAL.toFixed(1)} )`);
    expect(shader.fragmentShader).toContain(`* ${PART_MINERAL.toFixed(2)};`);
    const sv = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    mat.vegetal.onBeforeCompile(sv as never, null as never);
    expect(sv.fragmentShader).toContain('smoothstep');
    expect(mat.vegetal.customProgramCacheKey()).not.toBe(mat.mineral.customProgramCacheKey());
    // pavés des places : le matériau procédural lui-même, sans photo (bandes de bitume fantômes)
    expect(mat.pave).toBe(m.pave);
    // sauf pour la mise au point du calage, où tout reçoit la photo
    const oc = new Ortho(index, m, { ...faux(), calage: true });
    expect(oc.materiaux(6, 0, 100)!.pave).not.toBe(m.pave);
  });
});

describe('couleur des toits', () => {
  const ref: [number, number, number] = [0.2, 0.2, 0.2];
  it('la teinte rapporte la couleur relevée à la couleur moyenne du matériau', () => {
    // blanc pur, gain 1, matériau à 0,2 : il faut multiplier par 5
    expect(teinteToit([255, 255, 255], ref, 1)).toEqual([5, 5, 5]);
    const t = teinteToit([200, 120, 90], ref, 1)!;
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
    // sRGB 188 ≈ 0,5 en linéaire
    expect(teinteToit([188, 188, 188], [0.5, 0.5, 0.5], 1)![0]).toBeCloseTo(1, 1);
  });
  it('bornée, et (0, 0, 0) veut dire « pas de couleur relevée »', () => {
    expect(teinteToit([0, 0, 0], ref)).toBeUndefined();
    expect(teinteToit([255, 255, 255], [0.001, 0.001, 0.001], 1)).toEqual([6, 6, 6]);
    expect(teinteToit([1, 1, 1], [1, 1, 1], 1)).toEqual([0.05, 0.05, 0.05]);
  });
  it('la photo donne la teinte du bâtiment de même rang, rien au-delà du fichier', () => {
    const m = () => new THREE.MeshStandardMaterial();
    const c = () => new THREE.Color(0.2, 0.2, 0.2);
    const modeles: Modeles = { mineral: m(), vegetal: m(), pave: m(), uni: m(), toit: m(), chaussee: m(), moyennes: { mineral: c(), vegetal: c(), pave: c(), toit: c() } };
    const o = new Ortho(index, modeles, { toits: new Uint8Array([255, 255, 255, 0, 0, 0, 200, 120, 90]) });
    expect(o.teinteToit(0)![0]).toBeCloseTo(5 * GAIN_TOIT, 6);
    expect(o.teinteToit(1)).toBeUndefined();
    expect(o.teinteToit(2)).toEqual(teinteToit([200, 120, 90], ref, GAIN_TOIT));
    expect(o.teinteToit(3)).toBeUndefined();
    expect(o.teinteToit(-1)).toBeUndefined();
    expect(new Ortho(index, modeles, {}).teinteToit(0)).toBeUndefined();
  });
});

describe('lecture de l’index et des couleurs de toit', () => {
  const rep = (corps: unknown, ok = true, status = 200) => ({ ok, status, json: async () => corps, arrayBuffer: async () => (corps as Uint8Array).buffer as ArrayBuffer });
  const sansAttente = { attendre: async () => {} };

  it('un raté de lecture de l’index ne coupe pas la photo : il est redemandé', async () => {
    let n = 0;
    const avis: string[] = [];
    const ix = await lireIndex('ortho/', { ...sansAttente, avertir: (m) => avis.push(m), lire: async () => { if (n++ === 0) throw new Error('réseau'); return rep(index); } });
    expect(ix).toEqual(index);
    expect(n).toBe(2);
    expect(avis).toHaveLength(0);
  });

  it('un index absent ou illisible est demandé trois fois, puis l’abandon est signalé avec sa raison', async () => {
    for (const [reponse, raison] of [[rep(null, false, 404), 'réponse 404'], [rep({ html: 1 }), 'index illisible']] as const) {
      let n = 0;
      const avis: string[] = [];
      const ix = await lireIndex('ortho/', { ...sansAttente, avertir: (m) => avis.push(m), lire: async () => { n++; return reponse; } });
      expect(ix).toBeNull();
      expect(n).toBe(3);
      expect(avis).toHaveLength(1);
      expect(avis[0]).toContain(raison);
      expect(avis[0]).toContain('procédur');
    }
  });

  it('les couleurs de toit : relues après un raté, refusées et signalées si elles ne correspondent pas à la carte', async () => {
    const octets = new Uint8Array(index.batiments! * 3);
    let n = 0;
    const avis: string[] = [];
    const o = { ...sansAttente, avertir: (m: string) => avis.push(m) };
    const t = await lireToits(index, index.batiments!, 'ortho/', { ...o, lire: async () => (n++ === 0 ? rep(null, false, 503) : rep(octets)) });
    expect(t).toHaveLength(octets.length);
    expect(avis).toHaveLength(0);
    // carte régénérée avec un bâtiment de plus : rien n'est lu
    n = 0;
    expect(await lireToits(index, index.batiments! + 1, 'ortho/', { ...o, lire: async () => { n++; return rep(octets); } })).toBeNull();
    expect(n).toBe(0);
    expect(avis).toHaveLength(1);
    // fichier tronqué
    expect(await lireToits(index, index.batiments!, 'ortho/', { ...o, lire: async () => rep(octets.slice(3)) })).toBeNull();
    expect(avis).toHaveLength(2);
    expect(avis[1]).toContain('octets');
  });
});

describe('index', () => {
  it('écarte un index abîmé', () => {
    expect(indexValide(index)).toBe(true);
    expect(indexValide(null)).toBe(false);
    expect(indexValide({})).toBe(false);
    expect(indexValide({ ...index, cote: 0 })).toBe(false);
    expect(indexValide({ ...index, dalles: [1, 2] })).toBe(false);
  });
});

describe('dalles livrées (public/ortho)', () => {
  it('l’index décrit la grille de la carte', () => {
    expect({ x0: index.x0, z0: index.z0, cote: index.cote, nx: index.nx, nz: index.nz }).toEqual(g);
    expect(index.pas).toBe(PAS);
    expect(index.pixels).toBe(g.cote / PAS);
    expect(index.prises?.length).toBeGreaterThan(0);
  });
  it('chaque dalle de l’index est un fichier WebP, et toute dalle de ville en a une', () => {
    let total = 0;
    for (const d of index.dalles) {
      expect(existsSync(fichier(d + '.webp'))).toBe(true);
      const b = readFileSync(fichier(d + '.webp'));
      expect(b.subarray(0, 4).toString('latin1')).toBe('RIFF');
      expect(b.subarray(8, 12).toString('latin1')).toBe('WEBP');
      total += statSync(fichier(d + '.webp')).size;
    }
    const presentes = new Set(index.dalles);
    for (const k of Object.keys(map.chunks)) {
      const [ci, cj] = k.split(',').map(Number);
      expect(presentes.has(dalleDeTuile(index, ci, cj, map.chunk)!)).toBe(true);
    }
    // budget : moins de 15 Mo pour toute la photo
    expect(total).toBeLessThan(15e6);
  });
  it('une couleur de toit par bâtiment de la carte, dans le même ordre', () => {
    const t = readFileSync(fichier('toits.bin'));
    expect(index.batiments).toBe(map.buildings.length);
    expect(t.length).toBe(3 * map.buildings.length);
    // presque tous les bâtiments ont une couleur relevée, et elles ne sont pas toutes pareilles
    let connus = 0;
    const vues = new Set<number>();
    for (let i = 0; i < map.buildings.length; i++) {
      const v = (t[i * 3] << 16) | (t[i * 3 + 1] << 8) | t[i * 3 + 2];
      if (v) connus++;
      vues.add(v >> 4);
    }
    expect(connus / map.buildings.length).toBeGreaterThan(0.99);
    expect(vues.size).toBeGreaterThan(500);
  });
  it('la carte cite la source de la photo', () => {
    expect(map.attribution).toContain('BD ORTHO');
  });
});
