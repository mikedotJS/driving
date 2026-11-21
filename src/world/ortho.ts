// Photo aérienne de l'IGN (BD ORTHO) plaquée sur le sol hors chaussée ; les toits en reçoivent la
// couleur, bâtiment par bâtiment (la photo penche les immeubles : plaquée sur un toit, elle déborde).
// Les dalles de photo (public/ortho, préparées par tools/fetch-ortho.mjs) couvrent chacune 4 × 4 dalles
// de la ville. Chaque dalle de photo a ses propres matériaux, copies de ceux du décor avec une lecture
// de texture en plus : les lots de sol existants les reçoivent, sans maillage ni appel de dessin de
// plus. La photo est chargée quand on s'approche, libérée quand on s'éloigne ; tant qu'elle n'est pas
// là (ou si elle manque), le poids du mélange est nul et le sol reste le sol procédural.

import * as THREE from 'three';

/** Index écrit par tools/prepare-ortho.py (public/ortho/index.json). */
export interface IndexOrtho {
  /** coin nord-ouest de la grille (m), côté d'une dalle (m), nombre de dalles en x et en z */
  x0: number; z0: number; cote: number; nx: number; nz: number;
  /** côté d'une dalle en pixels, pas au sol (m par pixel) */
  pixels: number; pas: number;
  /** couleur moyenne de la photo (sRGB, 0 à 1) */
  moyenne?: [number, number, number];
  /** dalles présentes (« i_j ») et dates de prise de vue */
  dalles: string[]; prises?: string[];
  /** nombre de bâtiments de la carte pour lesquels toits.bin donne une couleur */
  batiments?: number;
}

/** L'index lu est-il utilisable ? Un fichier absent ou abîmé coupe la photo sans rien casser. */
export function indexValide(ix: unknown): ix is IndexOrtho {
  if (!ix || typeof ix !== 'object') return false;
  const o = ix as Record<string, unknown>;
  const n = (k: string) => typeof o[k] === 'number' && Number.isFinite(o[k] as number);
  return n('x0') && n('z0') && n('cote') && (o.cote as number) > 0 && n('nx') && n('nz') && n('pixels') && Array.isArray(o.dalles) && o.dalles.every((d) => typeof d === 'string');
}

/** Dalle de photo (« i_j ») qui contient le point, ou null hors de la grille. */
export function dalleDe(ix: IndexOrtho, x: number, z: number): string | null {
  const i = Math.floor((x - ix.x0) / ix.cote), j = Math.floor((z - ix.z0) / ix.cote);
  return i < 0 || j < 0 || i >= ix.nx || j >= ix.nz ? null : `${i}_${j}`;
}

/** Dalle de photo d'une dalle de la ville (ci, cj) de côté `tuile` : celle de son centre. */
export function dalleDeTuile(ix: IndexOrtho, ci: number, cj: number, tuile: number): string | null {
  return dalleDe(ix, (ci + 0.5) * tuile, (cj + 0.5) * tuile);
}

/** Emprise au sol d'une dalle de photo. */
export function empriseDalle(ix: IndexOrtho, cle: string): { x0: number; z0: number; x1: number; z1: number } {
  const [i, j] = cle.split('_').map(Number);
  return { x0: ix.x0 + i * ix.cote, z0: ix.z0 + j * ix.cote, x1: ix.x0 + (i + 1) * ix.cote, z1: ix.z0 + (j + 1) * ix.cote };
}

/**
 * Coordonnées de texture d'un point dans sa dalle : u vers l'est, v vers le sud, la première ligne de
 * l'image étant au nord (texture non retournée).
 */
export function uvPhoto(ix: IndexOrtho, cle: string, x: number, z: number): [number, number] {
  const e = empriseDalle(ix, cle);
  return [(x - e.x0) / ix.cote, (z - e.z0) / ix.cote];
}

/** Distance (m) du point au rectangle de la dalle ; 0 dedans. */
export function distanceDalle(ix: IndexOrtho, cle: string, x: number, z: number): number {
  const e = empriseDalle(ix, cle);
  return Math.hypot(Math.max(e.x0 - x, 0, x - e.x1), Math.max(e.z0 - z, 0, z - e.z1));
}

/** Dalles présentes à moins de `rayon` m du point, de la plus proche à la plus lointaine. */
export function dallesProches(ix: IndexOrtho, x: number, z: number, rayon: number): string[] {
  return ix.dalles.map((cle) => ({ cle, d: distanceDalle(ix, cle, x, z) })).filter((e) => e.d <= rayon).sort((a, b) => a.d - b.d).map((e) => e.cle);
}

// ───────────────────────── mélange ─────────────────────────
/** Distances (m) entre lesquelles la photo passe de sa version floue (teinte seule) à sa version nette. */
export const PRES = 5, LOIN = 28;
/** Niveau de détail ajouté à la lecture de près : 2^3 pixels de 0,5 m, soit une teinte moyenne sur 4 m. */
export const FLOU_PRES = 3;
/** Gain de la photo, lue comme une couleur de matière alors qu'elle est déjà éclairée par le soleil. */
export const GAIN = 0.62;
/** Part du relief procédural gardée de loin, quand la photo est nette (de près il est entier). */
export const RELIEF_LOIN = 0.6;
/** Gain des couleurs de toit : au soleil, un toit sort plus clair sur la photo que le sol. */
export const GAIN_TOIT = 0.45;
/**
 * Part de la couleur de la photo gardée sur le sol minéral (le reste ne garde que sa clarté) : les
 * houppiers des arbres, vus du ciel, verdiraient sinon le béton et les pavés d'une place.
 */
export const CHROMA_MINERAL = 0.45;
/** Part maximale de la photo dans la couleur du sol. */
export const PART_MAX = 0.85;
/**
 * Sur le sol minéral (cours, parkings, places en béton), la photo n'est jamais lue nette : seulement
 * sa teinte moyenne sur 2^FLOU_MINERAL pixels (8 m), et pour PART_MINERAL au plus. Nette, elle y plaquait
 * ce qui n'est pas du sol (voitures garées, ombres et houppiers aplatis) et, là où la chaussée du jeu
 * n'est pas exactement celle de la photo (Croix de Chavaux, réaménagée depuis la prise de vue), des
 * bandes de bitume et des passages piétons fantômes. Les places pavées, elles, ne la reçoivent plus.
 */
export const FLOU_MINERAL = 4, PART_MINERAL = 0.6;
/**
 * Sur le sol végétal, un pixel de la photo à la fois clair (clarté linéaire entre GRIS_CLARTE) et sans
 * couleur (saturation sous GRIS_SATURATION) n'est pas de l'herbe : la photo s'y efface et l'herbe
 * procédurale reste. Sans cela, pelouses et jardins se couvraient de taches blanches.
 */
export const GRIS_CLARTE = [0.28, 0.44], GRIS_SATURATION = [0.32, 0.5];

/** Netteté de la photo selon la distance à l'œil : 0 de près (teinte floue), 1 de loin. Même courbe que le shader. */
export function nettete(d: number): number {
  const t = Math.min(1, Math.max(0, (d - PRES) / (LOIN - PRES)));
  return t * t * (3 - 2 * t);
}

/**
 * Teinte par sommet qui donne à un toit la couleur `c` relevée sur la photo (octets sRGB), sachant que
 * le matériau de toiture a pour couleur moyenne `ref` (linéaire). Bornée : une texture très sombre ne
 * doit pas faire exploser la teinte. (0, 0, 0) veut dire « pas de couleur relevée ».
 */
export function teinteToit(c: [number, number, number], ref: [number, number, number], gain = GAIN): [number, number, number] | undefined {
  if (c[0] === 0 && c[1] === 0 && c[2] === 0) return undefined;
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return [0, 1, 2].map((k) => Math.min(6, Math.max(0.05, (lin(c[k]) * gain) / Math.max(ref[k], 0.02)))) as [number, number, number];
}

/** Mémoire vidéo d'une dalle chargée (RGBA 8 bits et ses niveaux de détail), en octets. */
export function memoireDalle(pixels: number): number {
  return Math.round((pixels * pixels * 4 * 4) / 3);
}

/** Poids de la photo par nature de sol (attribut `photo` des lots de sol). */
export const POIDS = { trottoir: 0, cour: 1, jardin: 1, espace: 1 };

/** Variantes du shader : `partout` sans attribut de poids (pavés), `calage` photo seule (mise au point). */
export interface OptionsPhoto {
  partout?: boolean; calage?: boolean; moyenne?: THREE.Color; part?: number; chroma?: number;
  /** niveau de détail fixe (teinte moyenne sur 2^flou pixels) au lieu de la netteté selon la distance */
  flou?: number;
  /** écarte de la photo ce qui est clair et gris (sol végétal : taches de béton, d'allées, de voitures) */
  sansClair?: boolean;
}
interface Uniformes { tex: { value: THREE.Texture }; boite: { value: THREE.Vector4 }; gain: { value: number } }

/**
 * Ajoute la photo à un matériau de sol. `suite` est le onBeforeCompile déjà posé (variation à grande
 * échelle), à garder. La couleur procédurale P reste la base ; la photo, multipliée par le relief de P
 * (P rapporté à sa moyenne), la remplace à hauteur du poids du sommet.
 */
export function brancherPhoto(mat: THREE.MeshStandardMaterial, u: Uniformes, suite: THREE.Material['onBeforeCompile'] | null, cle: string, o: OptionsPhoto = {}) {
  const moy = o.moyenne ?? new THREE.Color(1, 1, 1);
  const part = o.part ?? PART_MAX, chroma = o.chroma ?? 1;
  mat.onBeforeCompile = (shader, renderer) => {
    if (suite) suite.call(mat, shader, renderer);
    shader.uniforms.orthoTex = u.tex; shader.uniforms.orthoBoite = u.boite; shader.uniforms.orthoGain = u.gain;
    shader.uniforms.orthoMoy = { value: moy };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${o.partout ? '' : 'attribute float photo;'}\nuniform vec4 orthoBoite;\nvarying vec3 vOrtho;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n{ vec4 po = modelMatrix * vec4( position, 1.0 ); vOrtho = vec3( ( po.xz - orthoBoite.xy ) * orthoBoite.z, ${o.partout ? '1.0' : 'photo'} ); }`);
    const melange = o.calage
      ? /* glsl */ `diffuseColor.rgb = mix( diffuseColor.rgb, texture2D( orthoTex, vOrtho.xy ).rgb, orthoBoite.w );`
      : /* glsl */ `
        float oPoids = vOrtho.z * orthoBoite.w * ${part.toFixed(2)};
        if ( oPoids > 0.0 ) {
          float oNet = ${o.flou === undefined ? `smoothstep( ${PRES.toFixed(1)}, ${LOIN.toFixed(1)}, length( vViewPosition ) )` : '0.0'};
          vec3 oPhoto = texture2D( orthoTex, vOrtho.xy, ${o.flou === undefined ? `${FLOU_PRES.toFixed(1)} * ( 1.0 - oNet )` : o.flou.toFixed(1)} ).rgb * orthoGain;
          oPhoto = mix( vec3( dot( oPhoto, vec3( 0.2126, 0.7152, 0.0722 ) ) ), oPhoto, ${chroma.toFixed(2)} );${o.sansClair ? `
          {
            // clair et sans couleur : du béton, une allée, une voiture, pas de l'herbe ; le sol reste procédural
            float oMax = max( oPhoto.r, max( oPhoto.g, oPhoto.b ) ), oMin = min( oPhoto.r, min( oPhoto.g, oPhoto.b ) );
            float oGris = 1.0 - smoothstep( ${GRIS_SATURATION[0].toFixed(2)}, ${GRIS_SATURATION[1].toFixed(2)}, ( oMax - oMin ) / max( oMax, 1e-4 ) );
            oPoids *= 1.0 - oGris * smoothstep( ${GRIS_CLARTE[0].toFixed(2)}, ${GRIS_CLARTE[1].toFixed(2)}, dot( oPhoto, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( orthoGain, 1e-4 ) );
          }` : ''}
          vec3 oMoy = orthoMoy * diffuse;
          #ifdef USE_COLOR
            oMoy *= vColor.rgb;
          #endif
          float oRelief = clamp( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( dot( oMoy, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 ), 0.45, 1.8 );
          diffuseColor.rgb = mix( diffuseColor.rgb, oPhoto * mix( oRelief, 1.0, ${(1 - RELIEF_LOIN).toFixed(2)} * oNet ), oPoids );
        }`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D orthoTex;\nuniform vec4 orthoBoite;\nuniform float orthoGain;\nuniform vec3 orthoMoy;\nvarying vec3 vOrtho;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n{${melange}\n}`);
  };
  mat.customProgramCacheKey = () => `${cle}|photo${o.partout ? 'P' : ''}${o.calage ? 'C' : ''}${part}|${chroma}|${o.flou ?? 'n'}${o.sansClair ? 'G' : ''}`;
}

/** Matériaux d'une dalle de photo, à donner aux lots de sol des dalles de la ville qu'elle couvre. */
export interface MateriauxPhoto {
  mineral: THREE.MeshStandardMaterial; vegetal: THREE.MeshStandardMaterial; pave: THREE.MeshStandardMaterial;
  uni: THREE.MeshStandardMaterial;
  /** chaussée : seulement en mode calage (mise au point de l'alignement) */
  chaussee: THREE.MeshStandardMaterial | null;
}
/** Matériaux du décor dont la photo fait des copies, avec la couleur moyenne (linéaire) de leur texture. */
export interface Modeles {
  mineral: THREE.MeshStandardMaterial; vegetal: THREE.MeshStandardMaterial; pave: THREE.MeshStandardMaterial;
  uni: THREE.MeshStandardMaterial; toit: THREE.MeshStandardMaterial; chaussee: THREE.MeshStandardMaterial;
  moyennes: { mineral: THREE.Color; vegetal: THREE.Color; pave: THREE.Color; toit: THREE.Color };
}

interface Dalle {
  cle: string; mats: MateriauxPhoto; u: Uniformes;
  etat: 'vide' | 'charge' | 'pret' | 'absent';
  /** chargements ratés, et instant (ms) avant lequel on ne la redemande pas */
  echecs: number; apres: number;
  /** instant de fin de chargement (ms), pour le fondu */
  t0: number;
}

interface Arrivee { d: Dalle; texture: THREE.Texture; liberer: () => void; ms: number }

export type ChargeurPhoto = (url: string) => Promise<{ texture: THREE.Texture; liberer: () => void }>;

/** Charge une dalle par ImageBitmap : le décodage se fait hors du fil principal. */
const chargeurNavigateur: ChargeurPhoto = async (url) => {
  const rep = await fetch(url);
  if (!rep.ok) throw new Error(`${url} : ${rep.status}`);
  const image = await createImageBitmap(await rep.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture = new THREE.Texture(image);
  // une ImageBitmap n'est pas retournée à l'envoi : la première ligne (nord) reste en v = 0
  texture.flipY = false;
  return { texture, liberer: () => image.close() };
};

/** Durée du fondu d'apparition d'une dalle (ms) et marge de libération au-delà du rayon de chargement (m). */
const FONDU_MS = 700;
const MARGE_LIBERATION = 150;
/** Déplacement (m) au bout duquel on revoit quelles dalles charger et lesquelles rendre. */
const PAS_REVUE = 8;
/** Dalles téléchargées en même temps, au plus : les plus proches d'abord, les autres attendent leur tour. */
export const CHARGEMENTS_MAX = 3;
/** Une dalle qui ne se charge pas est redemandée après ces délais (ms) ; ensuite elle est tenue pour absente. */
export const REPRISES_MS = [5000, 20000];

export class Ortho {
  private dalles = new Map<string, Dalle>();
  private liberations = new Map<string, () => void>();
  private enCours = new Set<Promise<void>>();
  /** dalles décodées qui attendent leur mise en service */
  private arrivees: Arrivee[] = [];
  /** dalles à portée qui attendent leur tour de téléchargement, de la plus proche à la plus lointaine */
  private attente: Dalle[] = [];
  /** dernière position où les dalles à charger et à rendre ont été revues */
  private vu = { x: Infinity, z: Infinity, rayon: -1, active: true };
  private vide: THREE.DataTexture;
  private presentes: Set<string>;
  /** coupée (qualité basse) : rien n'est chargé, le sol reste procédural */
  active = true;
  /** gain appliqué à la photo, lue comme une couleur de matière alors qu'elle est déjà éclairée */
  gain = GAIN;
  /**
   * mesures : dalles chargées, octets en mémoire vidéo, durées (ms) du chargement (téléchargement et
   * décodage, hors du fil principal) et de l'envoi à la carte graphique (sur le fil principal)
   */
  readonly mesures = { chargees: 0, octets: 0, chargements: [] as number[], envois: [] as number[], echecs: 0 };

  /**
   * `toits` : couleur du toit de chaque bâtiment de la carte (3 octets sRGB, dans l'ordre de la carte), lue
   * par lireToits ; null si le fichier manque ou ne correspond pas à la carte.
   */
  constructor(readonly index: IndexOrtho, private modeles: Modeles, private opts: { base?: string; calage?: boolean; anisotropie?: number; chargeur?: ChargeurPhoto; toits?: Uint8Array | null; envoyer?: (t: THREE.Texture) => void; avertir?: (message: string) => void; horloge?: () => number } = {}) {
    this.presentes = new Set(index.dalles);
    this.vide = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    this.vide.needsUpdate = true;
  }

  get calage() { return !!this.opts.calage; }

  /**
   * Teinte par sommet du toit du bâtiment n° `i` de la carte : la couleur relevée sur la photo, rapportée
   * à la couleur moyenne du matériau de toiture qu'elle multiplie. Indéfinie si elle n'est pas connue.
   */
  teinteToit(i: number): [number, number, number] | undefined {
    const t = this.opts.toits;
    if (!t || i < 0 || i * 3 + 2 >= t.length) return undefined;
    const m = this.modeles;
    return teinteToit([t[i * 3], t[i * 3 + 1], t[i * 3 + 2]], [m.moyennes.toit.r * m.toit.color.r, m.moyennes.toit.g * m.toit.color.g, m.moyennes.toit.b * m.toit.color.b], GAIN_TOIT);
  }

  /** Matériaux de la dalle de photo qui couvre la dalle de ville (ci, cj), ou null si la photo n'y existe pas. */
  materiaux(ci: number, cj: number, tuile: number): MateriauxPhoto | null {
    const cle = dalleDeTuile(this.index, ci, cj, tuile);
    if (!cle || !this.presentes.has(cle)) return null;
    return this.dalle(cle).mats;
  }

  private dalle(cle: string): Dalle {
    let d = this.dalles.get(cle);
    if (d) return d;
    const e = empriseDalle(this.index, cle), m = this.modeles, calage = this.calage;
    const u: Uniformes = { tex: { value: this.vide }, boite: { value: new THREE.Vector4(e.x0, e.z0, 1 / this.index.cote, 0) }, gain: { value: this.gain } };
    const copie = (src: THREE.MeshStandardMaterial, nom: string, o: OptionsPhoto) => {
      const c = src.clone();
      c.name = nom;
      brancherPhoto(c, u, src.onBeforeCompile, src.customProgramCacheKey(), { ...o, calage });
      return c;
    };
    const mats: MateriauxPhoto = {
      mineral: copie(m.mineral, 'sol minéral', { moyenne: m.moyennes.mineral, chroma: CHROMA_MINERAL, flou: FLOU_MINERAL, part: PART_MINERAL }),
      vegetal: copie(m.vegetal, 'sol végétal', { moyenne: m.moyennes.vegetal, sansClair: true }),
      // les pavés des places restent procéduraux (sauf pour la mise au point du calage)
      pave: calage ? copie(m.pave, 'pavés', { moyenne: m.moyennes.pave, partout: true }) : m.pave,
      // aires de jeux, terre battue : une teinte, pas la photo nette (jeux et voitures aplatis)
      uni: copie(m.uni, 'uni', { flou: FLOU_MINERAL, part: PART_MINERAL }),
      chaussee: calage ? copie(m.chaussee, 'chaussée', { partout: true }) : null,
    };
    d = { cle, mats, u, etat: 'vide', t0: 0, echecs: 0, apres: 0 };
    this.dalles.set(cle, d);
    return d;
  }

  /**
   * Charge les dalles à portée du point, libère celles qui s'éloignent et fait avancer les fondus.
   * `rayon` : distance jusqu'à laquelle le décor est affiché.
   */
  update(x: number, z: number, rayon: number, maintenant = performance.now()) {
    // quelles dalles charger, lesquelles rendre : revu seulement quand on a bougé (ou changé de réglage)
    const v = this.vu;
    if (Math.abs(x - v.x) > PAS_REVUE || Math.abs(z - v.z) > PAS_REVUE || rayon !== v.rayon || this.active !== v.active) {
      v.x = x; v.z = z; v.rayon = rayon; v.active = this.active;
      // file d'attente refaite à chaque revue : une dalle qui n'est plus à portée n'est pas téléchargée
      this.attente = this.active ? dallesProches(this.index, x, z, rayon).map((cle) => this.dalle(cle)).filter((d) => d.etat === 'vide') : [];
      for (const d of this.dalles.values()) {
        if (d.etat === 'pret' && (!this.active || distanceDalle(this.index, d.cle, x, z) > rayon + MARGE_LIBERATION)) this.liberer(d);
      }
    }
    this.lancer(maintenant);
    // une seule dalle installée par image : l'envoi d'une texture à la carte graphique se fait sur le
    // fil principal, et plusieurs dalles arrivent souvent ensemble quand on change de rangée
    const a = this.arrivees.shift();
    if (a) this.installer(a);
    for (const d of this.dalles.values()) {
      if (d.etat === 'pret') d.u.boite.value.w = Math.min(1, (maintenant - d.t0) / FONDU_MS);
      d.u.gain.value = this.gain;
    }
  }

  /** Lance les téléchargements en attente, du plus proche au plus lointain, sans dépasser CHARGEMENTS_MAX à la fois. */
  private lancer(maintenant: number) {
    for (let i = 0; i < this.attente.length && this.enCours.size < CHARGEMENTS_MAX; i++) {
      const d = this.attente[i];
      if (d.etat !== 'vide') { this.attente.splice(i--, 1); continue; }
      // après un échec, on attend avant de la redemander ; les suivantes passent devant
      if (maintenant < d.apres) continue;
      this.attente.splice(i--, 1);
      this.charger(d);
    }
  }

  private charger(d: Dalle) {
    d.etat = 'charge';
    const t = performance.now();
    const url = `${this.opts.base ?? 'ortho/'}${d.cle}.webp`;
    const p: Promise<void> = (this.opts.chargeur ?? chargeurNavigateur)(url).then(({ texture, liberer }) => {
      d.echecs = 0;
      this.arrivees.push({ d, texture, liberer, ms: performance.now() - t });
    }).catch((e: unknown) => {
      // dalle illisible : le sol reste procédural. Un raté passager (réseau, serveur en cours de mise à
      // jour) ne doit pas la priver de photo pour toute la session : on la redemande, deux fois au plus.
      this.mesures.echecs++;
      const delai = REPRISES_MS[d.echecs++];
      if (delai === undefined) {
        d.etat = 'absent';
        (this.opts.avertir ?? console.warn)(`Photo aérienne : la dalle ${url} ne se charge pas (${e instanceof Error ? e.message : String(e)}) ; le sol y reste procédural.`);
      } else {
        d.etat = 'vide'; d.apres = (this.opts.horloge ?? performance.now.bind(performance))() + delai;
        // elle reprend la file par la fin : les dalles qui n'ont pas encore été demandées passent avant
        if (this.active) this.attente.push(d);
      }
    }).finally(() => { this.enCours.delete(p); });
    this.enCours.add(p);
  }

  /** Met en service une dalle décodée : réglages de la texture, envoi à la carte graphique, début du fondu. */
  private installer(a: Arrivee) {
    const { d, texture, liberer } = a;
    // coupée entre-temps, ou déjà trop loin : on ne garde pas la texture
    if (!this.active || distanceDalle(this.index, d.cle, this.vu.x, this.vu.z) > this.vu.rayon + MARGE_LIBERATION) {
      texture.dispose(); liberer(); d.etat = 'vide';
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = this.opts.anisotropie ?? 4;
    texture.needsUpdate = true;
    // envoi tout de suite, plutôt qu'au milieu de la première image qui s'en sert
    const te = performance.now();
    this.opts.envoyer?.(texture);
    const pousser = (l: number[], v: number) => { l.push(v); if (l.length > 64) l.shift(); };
    pousser(this.mesures.envois, +(performance.now() - te).toFixed(1));
    pousser(this.mesures.chargements, Math.round(a.ms));
    d.u.tex.value = texture;
    this.liberations.set(d.cle, liberer);
    d.etat = 'pret'; d.t0 = performance.now();
    this.mesures.chargees++; this.mesures.octets += memoireDalle(this.index.pixels);
  }

  /**
   * Se résout quand plus aucune dalle n'est en cours de chargement, celles qui sont arrivées étant
   * installées sans attendre les images suivantes (captures, essais, page de mise au point).
   */
  async pretes(): Promise<void> {
    for (;;) {
      this.lancer(Infinity);
      if (!this.enCours.size) break;
      await Promise.race([...this.enCours]);
    }
    for (const a of this.arrivees.splice(0)) this.installer(a);
  }

  private liberer(d: Dalle) {
    const t = d.u.tex.value;
    d.u.tex.value = this.vide; d.u.boite.value.w = 0;
    if (t !== this.vide) t.dispose();
    this.liberations.get(d.cle)?.();
    this.liberations.delete(d.cle);
    d.etat = 'vide';
    this.mesures.chargees--; this.mesures.octets -= memoireDalle(this.index.pixels);
  }
}

/** Options de lecture de l'index et des toits : délais (ms) avant chaque nouvel essai, lecteur, journal. */
export interface OptionsLecture {
  reprises?: number[];
  lire?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
  attendre?: (ms: number) => Promise<void>;
  avertir?: (message: string) => void;
}
const REPRISES_INDEX = [300, 900];

/** Essaie `lecture` jusqu'à ce qu'elle rende une valeur, en patientant `reprises` entre deux essais. Renvoie aussi la dernière raison d'échec. */
async function avecReprises<T>(lecture: () => Promise<T | string>, o: OptionsLecture): Promise<{ valeur: T | null; raison: string }> {
  const reprises = o.reprises ?? REPRISES_INDEX;
  const attendre = o.attendre ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let raison = '';
  for (let essai = 0; ; essai++) {
    try {
      const v = await lecture();
      if (typeof v !== 'string') return { valeur: v, raison: '' };
      raison = v;
    } catch (e) { raison = e instanceof Error ? e.message : String(e); }
    if (essai >= reprises.length) return { valeur: null, raison };
    await attendre(reprises[essai]);
  }
}

/**
 * Lit l'index des dalles ; null s'il manque ou s'il est abîmé (la photo est alors coupée pour la
 * session). Un seul raté de lecture ne suffit pas : l'index est redemandé deux fois, et l'abandon est
 * signalé dans la console, avec sa raison, au lieu de laisser un sol procédural sans explication.
 */
export async function lireIndex(base = 'ortho/', o: OptionsLecture = {}): Promise<IndexOrtho | null> {
  const lire = o.lire ?? ((url: string) => fetch(url, { cache: 'no-cache' }));
  const { valeur, raison } = await avecReprises<IndexOrtho>(async () => {
    const rep = await lire(base + 'index.json');
    if (!rep.ok) return `réponse ${rep.status}`;
    const ix: unknown = await rep.json();
    return indexValide(ix) ? ix : 'index illisible';
  }, o);
  if (!valeur) (o.avertir ?? console.warn)(`Photo aérienne du sol indisponible (${base}index.json : ${raison}) : le sol et les toits restent procéduraux.`);
  return valeur;
}

/** Lit les couleurs de toit ; null si le fichier manque ou ne compte pas `batiments` couleurs (carte régénérée depuis). */
export async function lireToits(index: IndexOrtho, batiments: number, base = 'ortho/', o: OptionsLecture = {}): Promise<Uint8Array | null> {
  const avertir = o.avertir ?? console.warn;
  if (index.batiments !== batiments) {
    avertir(`Couleurs de toit ignorées : relevées pour ${index.batiments ?? '?'} bâtiments, la carte en compte ${batiments} (relancer tools/fetch-ortho.mjs --prepare).`);
    return null;
  }
  const lire = o.lire ?? ((url: string) => fetch(url, { cache: 'no-cache' }));
  const { valeur, raison } = await avecReprises<Uint8Array>(async () => {
    const rep = await lire(base + 'toits.bin');
    if (!rep.ok) return `réponse ${rep.status}`;
    const t = new Uint8Array(await rep.arrayBuffer());
    return t.length === batiments * 3 ? t : `${t.length} octets au lieu de ${batiments * 3}`;
  }, o);
  if (!valeur) avertir(`Couleurs de toit indisponibles (${base}toits.bin : ${raison}) : les toits restent procéduraux.`);
  return valeur;
}
