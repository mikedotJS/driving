// Photo aérienne de l'IGN (BD ORTHO) : découpage en dalles alignées sur les dalles de la ville et
// adresses de téléchargement. Règles pures, partagées par tools/fetch-ortho.mjs et les tests.
//
// Le repère du jeu est linéaire en longitude et en latitude (x = (lon − lon0)·KX, z = −(lat − lat0)·KZ,
// voir tools/build-map.mjs). Une image demandée au WMS en EPSG:4326 sur l'emprise d'une dalle tombe
// donc exactement dans ce repère, sans reprojection : les colonnes suivent x, les lignes suivent z.

const R_TERRE = 6378137;
const D2R = Math.PI / 180;

/** Nombre de dalles de la ville (100 m) par côté de dalle de photo. */
export const TUILES_PAR_DALLE = 4;
/** Pas au sol des dalles livrées (m par pixel) et pas du téléchargement brut. */
export const PAS = 0.5;
export const PAS_BRUT = 0.2;
/** Le WMS de la Géoplateforme refuse les images de plus de 5010 pixels de côté. */
export const COTE_MAX_WMS = 5010;
export const WMS = 'https://data.geopf.fr/wms-r';
export const COUCHE = 'ORTHOIMAGERY.ORTHOPHOTOS';

/** Mètres du jeu par degré de longitude et de latitude autour de l'origine de la carte. */
export function echelles(origine) {
  return { kx: R_TERRE * D2R * Math.cos(origine.lat * D2R), kz: R_TERRE * D2R };
}

/** Position du jeu (x vers l'est, z vers le sud) → latitude et longitude. */
export function versGeo(origine, x, z) {
  const { kx, kz } = echelles(origine);
  return { lat: origine.lat - z / kz, lon: origine.lon + x / kx };
}

/**
 * Grille des dalles de photo qui couvre les dalles de la ville (`cles` : « ci,cj », `tuile` : leur côté
 * en mètres). La grille part de la dalle de ville la plus au nord-ouest.
 */
export function grille(cles, tuile) {
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const k of cles) {
    const [i, j] = k.split(',').map(Number);
    if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
  }
  if (!Number.isFinite(i0)) throw new Error('aucune dalle de ville');
  return {
    x0: i0 * tuile, z0: j0 * tuile, cote: tuile * TUILES_PAR_DALLE,
    nx: Math.ceil((i1 - i0 + 1) / TUILES_PAR_DALLE), nz: Math.ceil((j1 - j0 + 1) / TUILES_PAR_DALLE),
  };
}

/** Emprise au sol de la dalle (i, j) de la grille : x0, z0 au nord-ouest, x1, z1 au sud-est. */
export function emprise(g, i, j) {
  return { x0: g.x0 + i * g.cote, z0: g.z0 + j * g.cote, x1: g.x0 + (i + 1) * g.cote, z1: g.z0 + (j + 1) * g.cote };
}

/**
 * Adresse WMS de l'image d'une emprise, au pas donné. En WMS 1.3.0 l'EPSG:4326 se lit latitude puis
 * longitude : BBOX = latSud,lonOuest,latNord,lonEst. La première ligne de l'image est au nord (z0).
 */
export function urlWms(origine, e, pas, format = 'image/jpeg') {
  const no = versGeo(origine, e.x0, e.z0), se = versGeo(origine, e.x1, e.z1);
  const l = Math.round((e.x1 - e.x0) / pas), h = Math.round((e.z1 - e.z0) / pas);
  if (l > COTE_MAX_WMS || h > COTE_MAX_WMS) throw new Error(`image de ${l} × ${h} pixels : le WMS s'arrête à ${COTE_MAX_WMS}`);
  const f = (v) => v.toFixed(8);
  return `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${COUCHE}&STYLES=&CRS=EPSG:4326`
    + `&BBOX=${f(se.lat)},${f(no.lon)},${f(no.lat)},${f(se.lon)}&WIDTH=${l}&HEIGHT=${h}&FORMAT=${format}`;
}

/** Adresse WFS du graphe de mosaïquage : dates de prise de vue des clichés qui couvrent l'emprise. */
export function urlMillesime(origine, e) {
  const no = versGeo(origine, e.x0, e.z0), se = versGeo(origine, e.x1, e.z1);
  const f = (v) => v.toFixed(6);
  return 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature'
    + '&TYPENAMES=ORTHOIMAGERY.ORTHOPHOTOS.GRAPHE-MOSAIQUAGE:graphe_bdortho&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326'
    + `&BBOX=${f(se.lat)},${f(no.lon)},${f(no.lat)},${f(se.lon)},urn:ogc:def:crs:EPSG::4326&COUNT=200`;
}

/** Nom du fichier d'une dalle. */
export const nomDalle = (i, j) => `${i}_${j}`;
