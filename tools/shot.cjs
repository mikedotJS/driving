// usage: node shot.cjs <url> <out.png> [width] [height] [waitMs] [extra js to eval before shot]
const { chromium } = require('playwright');
(async () => {
  const [url, out, w = '1280', h = '720', wait = '1500', js = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  try { await page.waitForFunction('window.__ready === true', { timeout: 60000 }); } catch (e) { logs.push('[timeout waiting __ready]'); }
  await page.waitForTimeout(+wait);
  if (js) { try { const r = await page.evaluate(js); if (r !== undefined) console.log('eval →', JSON.stringify(r)); } catch (e) { console.log('eval error', e.message); } await page.waitForTimeout(300); }
  await page.screenshot({ path: out });
  const info = await page.evaluate('window.__info ?? null');
  if (info) console.log('info', JSON.stringify(info));
  console.log(logs.slice(0, 40).join('\n'));
  await browser.close();
})();
