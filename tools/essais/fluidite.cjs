// Mesure de fluidité sur une machine dotée d'une accélération graphique matérielle.
// Lance la mesure intégrée au jeu (Réglages → Mesurer la fluidité : le moniteur conduit une vingtaine de
// secondes sur un boulevard) dans Chromium, relève le rapport du jeu, la carte graphique annoncée par
// WebGL et la durée de chaque image. Voir .github/workflows/fluidite.yml.
//   npm run build && npx vite preview --port 4173 &
//   node tools/essais/fluidite.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const URL = process.env.URL || 'http://localhost:4173/?perf=fixe';
const OUT = process.env.OUT || 'mesures';
fs.mkdirSync(OUT, { recursive: true });

async function mesure(nom, { fenetre, qualite, largeur, hauteur, libre }) {
  const args = ['--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'];
  // cadence libre : sans synchronisation verticale ni plafond, pour connaître la marge au-delà de 60 images/s
  if (libre) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const browser = await chromium.launch(fenetre ? { headless: false, args } : { headless: true, channel: 'chromium', args });
  const res = { essai: nom, fenetre, qualite, taille: `${largeur}x${hauteur}`, cadenceLibre: !!libre };
  try {
    const page = await (await browser.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1 })).newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', { timeout: 180000 });
    res.chargementS = +((Date.now() - t0) / 1000).toFixed(1);
    res.carte = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return 'WebGL 2 indisponible';
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? `${gl.getParameter(e.UNMASKED_RENDERER_WEBGL)} — ${gl.getParameter(e.UNMASKED_VENDOR_WEBGL)}` : 'inconnue';
    });
    await page.evaluate((q) => {
      const g = window.__game;
      g.settings.quality = q; g.settings.autoQuality = false; g.settings.mirrors = true;
      window.__dt = [];
      let last = performance.now();
      const tick = (t) => { window.__dt.push(t - last); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      g.benchmark();
    }, qualite);
    await page.waitForTimeout(12000);
    await page.screenshot({ path: `${OUT}/${nom}.png` });
    res.enConduite = await page.evaluate(() => { const g = window.__game; return { vitesseKmh: Math.round(g.player.car.speedKmh), vehicules: g.traffic.vehicles.length, pietons: g.traffic.pedestrians.length, appelsDessin: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles }; });
    await page.waitForTimeout(7000);
    res.aDixNeufSecondes = await page.evaluate(() => { const g = window.__game; return { vitesseKmh: Math.round(g.player.car.speedKmh), metresParcourus: Math.round(g.session.distance), demonstration: !!g.demo }; });
    await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent.includes('Mesure de la fluidité')), null, { timeout: 120000 });
    res.rapportDuJeu = await page.evaluate(() => [...document.querySelectorAll('.menu p.note')].map((p) => p.textContent));
    // durée des images pendant la conduite (les 4 premières secondes servent au démarrage de la leçon)
    const dt = await page.evaluate(() => window.__dt);
    let t = 0; const drive = [];
    for (const d of dt) { t += d; if (t > 4000 && t < 23000) drive.push(d); }
    // plus long gel de l'affichage depuis le lancement de la leçon, démarrage compris
    res.plusLongGelMs = +Math.max(...dt).toFixed(0);
    drive.sort((a, b) => a - b);
    const q = (p) => drive[Math.min(drive.length - 1, Math.floor(drive.length * p))];
    const mean = drive.reduce((a, b) => a + b, 0) / Math.max(1, drive.length);
    res.images = { nombre: drive.length, cadenceMoyenne: +(1000 / mean).toFixed(1), dureeMedianeMs: +q(0.5).toFixed(2), duree95Ms: +q(0.95).toFixed(2), duree99Ms: +q(0.99).toFixed(2), plusLongueMs: +drive[drive.length - 1].toFixed(1) };
    if (erreurs.length) res.erreurs = erreurs.slice(0, 5);
  } catch (e) {
    res.echec = String(e.message || e).split('\n')[0];
  }
  await browser.close();
  console.log('MESURE ' + JSON.stringify(res));
  return res;
}

(async () => {
  const tout = [];
  // dans une fenêtre réelle (affichage composé par le système), puis sans fenêtre au cas où la machine n'a pas d'écran
  // (le premier essai est aussi le tout premier lancement sur cette machine : caches de shaders vides)
  tout.push(await mesure('fenetre-1080p-haute-premier-lancement', { fenetre: true, qualite: 'haute', largeur: 1920, hauteur: 1080 }));
  tout.push(await mesure('fenetre-1080p-haute', { fenetre: true, qualite: 'haute', largeur: 1920, hauteur: 1080 }));
  tout.push(await mesure('fenetre-1080p-moyenne', { fenetre: true, qualite: 'moyenne', largeur: 1920, hauteur: 1080 }));
  tout.push(await mesure('fenetre-1080p-haute-cadence-libre', { fenetre: true, qualite: 'haute', largeur: 1920, hauteur: 1080, libre: true }));
  tout.push(await mesure('fenetre-1440p-haute-cadence-libre', { fenetre: true, qualite: 'haute', largeur: 2560, hauteur: 1440, libre: true }));
  tout.push(await mesure('sans-fenetre-1080p-haute', { fenetre: false, qualite: 'haute', largeur: 1920, hauteur: 1080 }));
  fs.writeFileSync(`${OUT}/mesures.json`, JSON.stringify(tout, null, 2));
})();
