#!/usr/bin/env node
// Photo aérienne du sol : télécharge la BD ORTHO de l'IGN (WMS de la Géoplateforme, sans clé) sur
// l'emprise de la carte, puis la découpe en dalles alignées sur les dalles de la ville.
//   node tools/fetch-ortho.mjs            télécharge ce qui manque puis prépare public/ortho
//   node tools/fetch-ortho.mjs --prepare  ne refait que la préparation (brutes déjà là)
// Brutes : data/ortho-raw/<i>_<j>.jpg, 2000 × 2000 pixels à 20 cm (non versionnées).
// Livrées : public/ortho/<i>_<j>.webp, 800 × 800 pixels à 50 cm, toits.bin (couleur du toit de chaque
// bâtiment de la carte) et index.json (versionnées). À relancer avec --prepare après tools/build-map.mjs
// si les bâtiments de la carte ont changé : toits.bin suit leur ordre.
// Données IGN – BD ORTHO, Licence Ouverte Etalab 2.0.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAS, PAS_BRUT, emprise, grille, nomDalle, urlMillesime, urlWms } from './lib/ortho.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRUT = join(RACINE, 'data', 'ortho-raw');
const SORTIE = join(RACINE, 'public', 'ortho');
const UA = 'driving-sim-map-builder/0.1';
const carte = JSON.parse(readFileSync(join(RACINE, 'public', 'maps', 'montreuil.json'), 'utf8'));
const g = grille(Object.keys(carte.chunks), carte.chunk);
mkdirSync(BRUT, { recursive: true });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Télécharge par curl (qui suit le mandataire de la machine) ; renvoie le code HTTP. */
function curl(url, dest) {
  try {
    return execFileSync('curl', ['-sS', '-m', '180', '-A', UA, '-o', dest, '-w', '%{http_code}', url], { encoding: 'utf8' }).trim();
  } catch (e) {
    return 'échec (' + String(e.message).split('\n')[0] + ')';
  }
}
/** Un JPEG entier commence par FF D8 et finit par FF D9. */
function jpegEntier(f) {
  if (!existsSync(f) || statSync(f).size < 2000) return false;
  const b = readFileSync(f);
  return b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
}

if (!process.argv.includes('--prepare')) {
  let n = 0;
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const f = join(BRUT, nomDalle(i, j) + '.jpg');
    if (jpegEntier(f)) continue;
    const url = urlWms(carte.origin, emprise(g, i, j), PAS_BRUT);
    let ok = false;
    for (let essai = 1; essai <= 4 && !ok; essai++) {
      const code = curl(url, f + '.tmp');
      ok = code === '200' && jpegEntier(f + '.tmp');
      if (!ok) { console.error(`  dalle ${i}_${j} : essai ${essai} raté (${code})`); await pause(essai * 4000); }
    }
    if (!ok) { rmSync(f + '.tmp', { force: true }); console.error(`dalle ${i}_${j} : abandon`); process.exit(1); }
    renameSync(f + '.tmp', f);
    n++;
    console.log(`dalle ${i}_${j} : ${statSync(f).size} octets`);
    // le service est public et sans clé : on espace les demandes
    await pause(1000);
  }
  console.log(`${n} dalles téléchargées, ${g.nx * g.nz - n} déjà là`);
  // dates de prise de vue des clichés de la mosaïque : la Licence Ouverte demande la date de la donnée
  const fm = join(BRUT, 'millesime.json');
  const tout = { x0: g.x0, z0: g.z0, x1: g.x0 + g.nx * g.cote, z1: g.z0 + g.nz * g.cote };
  if (curl(urlMillesime(carte.origin, tout), fm + '.tmp') === '200') renameSync(fm + '.tmp', fm);
  else { rmSync(fm + '.tmp', { force: true }); console.error('graphe de mosaïquage indisponible : dates de prise de vue non relevées'); }
}

// dates de prise de vue : le fichier téléchargé n'est lu que comme donnée
let prises = [];
try {
  const fc = JSON.parse(readFileSync(join(BRUT, 'millesime.json'), 'utf8'));
  prises = [...new Set(fc.features.map((f) => String(f.properties.date_vol).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
} catch { /* pas de graphe : l'index n'aura pas de date */ }

writeFileSync(join(BRUT, 'grille.json'), JSON.stringify({ ...g, pas: PAS, pasBrut: PAS_BRUT, prises }));
// -I : Python n'importe rien depuis le dossier courant ni l'environnement
execFileSync('python3', ['-I', join(RACINE, 'tools', 'prepare-ortho.py'), BRUT, SORTIE, join(RACINE, 'public', 'maps', 'montreuil.json')], { stdio: 'inherit' });
