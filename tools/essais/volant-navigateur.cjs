// Contrôle dans le navigateur du parcours « Volant et commandes → Connecter le volant → Vérifier », avec un
// G923 simulé dans la page : un objet Gamepad et un périphérique WebHID factices, dont l'axe de direction
// tourne sous l'effet des trames de retour de force — dans le sens prévu, puis dans le sens contraire.
//   npm run build && npx vite preview --port 4173 &
//   node tools/essais/volant-navigateur.cjs
const { chromium } = require('playwright');

async function essai(browser, polarite) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.addInitScript((pol) => {
    const pad = { id: 'Logitech G923 Racing Wheel for PlayStation and PC (Vendor: 046d Product: c266)', index: 0, connected: true, mapping: '', timestamp: 0, axes: [0, 1, 1, 0, 0, 1], buttons: Array.from({ length: 25 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__pad = pad; window.__trames = [];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    const dev = {
      vendorId: 0x046d, productId: 0xc266, productName: 'G923', opened: false,
      collections: [{ outputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: 7 }] }] }],
      open: async () => { dev.opened = true; }, close: async () => { dev.opened = false; }, addEventListener: () => {}, removeEventListener: () => {},
      sendReport: async (id, data) => {
        const d = Array.from(new Uint8Array(data.buffer ? data.buffer : data));
        window.__trames.push(d);
        // octet de niveau inférieur à 0x80 = effort vers la droite, selon la convention déduite des pilotes
        if (d[0] === 0x11 || d[0] === 0x1c) pad.axes[0] = Math.max(-1, Math.min(1, pad.axes[0] + ((0x80 - d[2]) / 127) * pol * 0.02));
      },
    };
    Object.defineProperty(navigator, 'hid', { configurable: true, value: { addEventListener: () => {}, getDevices: async () => [], requestDevice: async () => [dev] } });
  }, polarite);
  await page.goto('http://localhost:4173/?perf=fixe', { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 180000 });
  // le rendu logiciel de cette machine met plusieurs secondes par image : on le neutralise pour cet essai d'interface
  await page.evaluate(() => { const g = window.__game; g.renderer.render = () => {}; g.view.renderMirrors = () => {}; g.menus.settings('volant'); });
  const clic = async (texte) => { await page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t)); if (!b) throw new Error('bouton introuvable : ' + t); b.click(); }, texte); };
  await page.waitForTimeout(500);
  await clic('Connecter le volant');
  await page.waitForFunction(() => window.__game.ffb.connected === true, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const volantReconnu = await page.evaluate(() => ({ appareil: window.__game.controls.state.device, angle: window.__game.controls.wheelAngle() }));
  await clic('Vérifier');
  await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => /Retour de force vérifié|Test du retour de force/.test(h.textContent)), null, { timeout: 30000 });
  const res = await page.evaluate(() => ({ titre: document.querySelector('.menu h2').textContent, lignes: [...document.querySelectorAll('.menu p')].map((p) => p.textContent), inverse: window.__game.ffb.settings.invert, verifie: window.__game.ffb.settings.verified ?? null, trames: window.__trames.length }));
  // retour aux réglages : la date de vérification doit s'afficher
  await clic('Retour').catch(() => {});
  await page.waitForTimeout(300);
  const mention = await page.evaluate(() => [...document.querySelectorAll('.menu p.note')].map((p) => p.textContent).find((t) => /vérifié sur ce volant/.test(t)) ?? null);
  await page.close();
  return { volantSimule: polarite > 0 ? 'conforme' : 'sens inversé', volantReconnu, ...res, mentionReglages: mention, erreurs };
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  for (const pol of [1, -1]) console.log(JSON.stringify(await essai(browser, pol)));
  await browser.close();
})();
