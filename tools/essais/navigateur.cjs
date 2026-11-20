// Contrôle dans le navigateur, sur la version compilée du jeu : ouvre des leçons guidées par le menu, lance
// la démonstration du moniteur et fait avancer la simulation (Game.debugStep, sans rendu) ; relève les
// erreurs JavaScript, les fautes, les chocs et les chevauchements entre véhicules.
//   npm run build && npx vite preview --port 4173 &
//   node tools/essais/navigateur.cjs "Les giratoires" "Feux, stops" "Circuler sur les grands axes"
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall/.test(m.text())) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  for (const title of process.argv.slice(2)) {
    await page.goto('http://localhost:4173/?perf=fixe', { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', { timeout: 120000 });
    const r = await page.evaluate(async (title) => {
      const g = window.__game;
      let btn = [...document.querySelectorAll('button.card')].find((b) => b.textContent.includes(title));
      if (!btn) { const open = [...document.querySelectorAll('button')].find((b) => /Leçons/i.test(b.textContent)); if (open) { open.click(); await new Promise((r) => setTimeout(r, 300)); } btn = [...document.querySelectorAll('button.card')].find((b) => b.textContent.includes(title)); }
      if (!btn) return { title, erreur: 'bouton introuvable' };
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      const steps = g.route ? g.route.steps.length : 0, rue = g.rules.situation.street || g.startPose.edge.name;
      const chocs = [];
      const prev = g.player.events.collision;
      g.player.events.collision = (k, s) => { chocs.push(k + '@' + Math.round(s * 3.6)); if (prev) prev(k, s); };
      if (!g.demo) g.toggleDemo();
      let overlaps = 0, maxVeh = 0, maxRes = 0, t = 0, dist0 = g.session.distance;
      const T = g.traffic;
      for (; t < 420 && g.state === 'drive' && g.demo; t += 5) {
        g.debugStep(5);
        maxVeh = Math.max(maxVeh, T.vehicles.length); maxRes = Math.max(maxRes, T.vehicles.filter((v) => v.grant >= 0).length);
        for (let i = 0; i < T.vehicles.length; i++) for (let j = i + 1; j < T.vehicles.length; j++) if (Math.hypot(T.vehicles[i].x - T.vehicles[j].x, T.vehicles[i].z - T.vehicles[j].z) < 1.6) overlaps++;
        if (t % 60 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      const faults = (g.session.faults || []).map((f) => (f.inf ? f.inf.id : f.id) + (f.inf && f.inf.grave ? '!' : ''));
      return { title, depart: rue, etapes: steps, secondesSimulees: t, metres: Math.round(g.session.distance - dist0), arrive: !g.demo || g.state !== 'drive', vehiculesMax: maxVeh, reservationsMax: maxRes, chevauchements: overlaps, chocs, fautes: faults, etat: g.state };
    }, title);
    console.log(JSON.stringify(r));
  }
  console.log('erreurs', JSON.stringify(errs.slice(0, 6)));
  await browser.close();
})();
