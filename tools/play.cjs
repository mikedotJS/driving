// Pilote le jeu dans Chromium sans écran pour les essais :
//   node tools/play.cjs <url> <action>...
// actions : wait:<ms>  key:<Code>  down:<Code>  up:<Code>  shot:<fichier.png>  eval:<js>  size:<w>x<h>
const { chromium } = require('playwright');
(async () => {
  const [url, ...actions] = process.argv.slice(2);
  let w = 1280, h = 720;
  const sz = actions.find((a) => a.startsWith('size:'));
  if (sz) [w, h] = sz.slice(5).split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (!/GPU stall|\[vite\]/.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
  await page.goto(url, { waitUntil: 'load' });
  try { await page.waitForFunction('window.__ready === true', { timeout: 120000 }); } catch (e) { logs.push('[timeout waiting __ready]'); }
  for (const a of actions) {
    const i = a.indexOf(':');
    const cmd = a.slice(0, i), arg = a.slice(i + 1);
    if (cmd === 'wait') await page.waitForTimeout(+arg);
    else if (cmd === 'key') await page.keyboard.press(arg);
    else if (cmd === 'down') await page.keyboard.down(arg);
    else if (cmd === 'up') await page.keyboard.up(arg);
    else if (cmd === 'shot') await page.screenshot({ path: arg });
    else if (cmd === 'eval') { try { const r = await page.evaluate(arg); console.log('eval →', JSON.stringify(r)); } catch (e) { console.log('eval error', e.message); } }
  }
  console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})();
