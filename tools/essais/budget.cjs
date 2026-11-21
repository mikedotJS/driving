// Budget de rendu sans carte graphique : compte les appels de dessin et les triangles du jeu compilé,
// passe par passe (ombres, rétroviseurs, image principale) et par famille de matériaux, sur un cycle
// complet des ombres en cascade (6 images), puis enregistre l'image du canevas.
//   node budget.cjs <sortie> <point>...
// point = nom:mode:x:z:cap[:y:pitch][:qualite]   mode = menu | conduite | libre
//   menu     : caméra tournante du menu, figée à l'angle 0
//   conduite : conduite libre lancée, voiture posée en (x,z) cap en degrés (0 = −z, 90 = +x), vue conducteur
//   libre    : caméra libre en (x,y,z), cap et inclinaison en degrés, circulation retirée (décor seul)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.URL || 'http://localhost:4174/?perf=fixe';
const W = +(process.env.W || 640), H = +(process.env.H || 360);

(async () => {
  const [out, ...points] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const tout = [];
  for (const pt of points) {
    const [nom, mode, x, z, cap, a, b, c] = pt.split(':');
    const libre = mode === 'libre';
    const o = { nom, mode, x: +x, z: +z, cap: cap === 'auto' ? NaN : +cap, y: libre ? +(a || 1.6) : 0, pitch: libre ? +(b || 0) : 0, qualite: (libre ? c : a) || 'moyenne' };
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(0);
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', null, { timeout: 600000 });
    const res = await page.evaluate(async (o) => {
      const g = window.__game, R = g.renderer, info = R.info;
      g.settings.quality = o.qualite; g.settings.autoQuality = false; g.settings.mirrors = true;
      g.applySettings();
      const rad = (d) => (d * Math.PI) / 180;
      // ── mise en place ──
      if (o.mode === 'conduite') {
        g.start(window.__lessons.FREE);
        // cap « auto » : la voiture est posée sur la voie la plus proche, dans son sens de circulation
        if (Number.isNaN(o.cap)) {
          const loc = g.net.locate(o.x, o.z), e = loc.edge, dir = e.lanesF.length ? 1 : -1;
          const lanes = dir > 0 ? e.lanesF : e.lanesB, p = e.line.atOffset(loc.s, lanes[lanes.length - 1].off);
          o.x = p.x; o.z = p.z; o.cap = (Math.atan2(p.tx * dir, -p.tz * dir) * 180) / Math.PI; o.rue = e.name;
        }
        g.player.spawn(o.x, o.z, rad(o.cap), { running: true, belt: true });
        g.city.ensureAround(o.x, o.z, g.viewRadius);
      } else if (o.mode === 'libre') {
        g.state = 'pause';
        g.menuCenter = { x: o.x, z: o.z };
        g.traffic.vehicles.forEach((v) => { v.alive = false; });
        g.traffic.pedestrians.forEach((p) => { p.alive = false; });
        g.city.ensureAround(o.x, o.z, g.viewRadius);
        const cam = g.view.camera;
        cam.layers.disable(1); cam.layers.enable(2);
        cam.position.set(o.x, o.y, o.z);
        cam.rotation.order = 'YXZ'; cam.rotation.set(rad(o.pitch), -rad(o.cap), 0);
        cam.updateMatrixWorld();
      }
      // ── instrumentation ──
      info.autoReset = false;
      const matName = new Map();
      for (const [k, v] of Object.entries(g.mats)) if (v && v.isMaterial) matName.set(v, 'décor:' + k);
      for (const [k, v] of Object.entries(g.props)) if (v && v.isMaterial && !matName.has(v)) matName.set(v, 'mobilier:' + k);
      const under = (obj, root) => { for (let p = obj; p; p = p.parent) if (p === root) return true; return false; };
      const cat = (obj, mat) => {
        if (under(obj, g.view.root)) return 'voiture du joueur';
        if (under(obj, g.trafficView.group)) return 'circulation';
        if (under(obj, g.props.group)) return matName.get(mat) ? matName.get(mat).replace('décor:', 'mobilier global:') : 'mobilier global';
        if (under(obj, g.city.group)) return matName.get(mat) || 'dalle:autre (voitures garées…)';
        return 'ciel et divers';
      };
      const tris = (obj, geo, group) => {
        let n = group ? group.count : geo.index ? Math.min(geo.index.count, geo.drawRange.count) : Math.min(geo.attributes.position.count, geo.drawRange.count);
        if (obj.isLine || obj.isPoints) return 0;
        return (n / 3) * (obj.isInstancedMesh ? obj.count : 1);
      };
      let passe = null, parCat = null;
      const hook = function (r, s, c, geo, mat, group) {
        if (!passe || !parCat) return;
        const k = cat(this, mat);
        const e = (parCat[k] ||= { appels: 0, triangles: 0 });
        e.appels++; e.triangles += Math.round(tris(this, geo, group));
      };
      const hooked = new WeakSet();
      const hookAll = () => g.scene.traverse((m) => {
        if (!(m.isMesh || m.isLine || m.isPoints) || hooked.has(m)) return;
        hooked.add(m);
        const prev = m.onBeforeRender;
        m.onBeforeRender = function (...args) { hook.apply(this, args); return prev.apply(this, args); };
      });
      const origRender = R.render.bind(R);
      const origShadow = R.shadowMap.render.bind(R.shadowMap);
      let cur = null, ombre = null;
      R.shadowMap.render = (...args) => {
        const c0 = info.render.calls, t0 = info.render.triangles;
        origShadow(...args);
        if (ombre) { ombre.appels += info.render.calls - c0; ombre.triangles += info.render.triangles - t0; }
      };
      R.render = (scene, camera) => {
        const cible = R.getRenderTarget() ? 'rétroviseur' : 'principale';
        const c0 = info.render.calls, t0 = info.render.triangles;
        ombre = { appels: 0, triangles: 0 };
        passe = cible; parCat = cur && cible === 'principale' ? cur.parFamille : null;
        origRender(scene, camera);
        passe = null;
        if (cur) cur.rendus.push({ cible, appels: info.render.calls - c0, triangles: info.render.triangles - t0, ombres: ombre });
      };
      const origFrame = g.frame.bind(g);
      let onFrame = null;
      g.frame = (now) => {
        if (o.mode === 'menu') g.menuAngle = 0;
        info.reset();
        const t = performance.now();
        origFrame(now);
        if (onFrame) onFrame(performance.now() - t);
      };
      const nextFrame = () => new Promise((r) => { onFrame = (ms) => { onFrame = null; r(ms); }; });
      // ── stabilisation : toutes les dalles construites, programmes compilés ──
      let n = 0;
      do { await nextFrame(); n++; } while ((g.city.pending.length > 0 || n < 4) && n < 80);
      // photo aérienne du sol : dalles chargées et fondu terminé avant de mesurer
      const ortho = g.city.ortho && g.city.ortho.active ? g.city.ortho : null;
      if (ortho) {
        await ortho.pretes();
        const t = performance.now();
        while (performance.now() - t < 900) await nextFrame();
      }
      hookAll();
      // ── mesure sur 6 images (un cycle complet des cascades d'ombre) ──
      const images = [];
      let png = null;
      for (let i = 0; i < 6; i++) {
        cur = { rendus: [], parFamille: {} };
        const ms = await new Promise((r) => { onFrame = (m) => { onFrame = null; if (i === 5) png = R.domElement.toDataURL('image/png'); r(m); }; });
        const tot = { appels: info.render.calls, triangles: info.render.triangles };
        const princ = cur.rendus.find((x) => x.cible === 'principale');
        const retro = cur.rendus.filter((x) => x.cible === 'rétroviseur');
        const sum = (l, f) => l.reduce((s, x) => s + f(x), 0);
        images.push({
          ms: Math.round(ms), total: tot,
          ombres: { appels: sum(cur.rendus, (x) => x.ombres.appels), triangles: sum(cur.rendus, (x) => x.ombres.triangles) },
          couleurPrincipale: princ ? { appels: princ.appels - princ.ombres.appels, triangles: princ.triangles - princ.ombres.triangles } : null,
          retroviseurs: { nombre: retro.length, appels: sum(retro, (x) => x.appels - x.ombres.appels), triangles: sum(retro, (x) => x.triangles - x.ombres.triangles) },
          parFamille: cur.parFamille,
        });
      }
      cur = null;
      // ── inventaire de ce qui est chargé ──
      let dalles = 0, dallesVisibles = 0, maillages = 0;
      const charge = {};
      for (const ch of g.city.chunks.values()) {
        dalles++;
        if (!ch.group.visible) continue;
        dallesVisibles++;
        ch.group.traverse((m) => {
          if (!m.isMesh) return;
          maillages++;
          const k = cat(m, m.material);
          const e = (charge[k] ||= { maillages: 0, triangles: 0 });
          e.maillages++; e.triangles += Math.round(tris(m, m.geometry, null));
        });
      }
      const cam = g.view.camera;
      const c = g.player.car;
      return {
        point: o, etat: g.state, rayonVue: g.viewRadius, vue: g.view.mode, canevas: [R.domElement.width, R.domElement.height],
        imagesStabilisation: n,
        voiture: { x: +c.x.toFixed(1), z: +c.z.toFixed(1), capDeg: +((c.heading * 180) / Math.PI).toFixed(1) },
        camera: { x: +cam.position.x.toFixed(1), y: +cam.position.y.toFixed(1), z: +cam.position.z.toFixed(1) },
        circulation: { vehicules: g.traffic.vehicles.filter((v) => v.alive !== false).length, pietons: g.traffic.pedestrians.filter((p) => p.alive !== false).length },
        memoire: { geometries: info.memory.geometries, textures: info.memory.textures, programmes: info.programs.length },
        photoSol: ortho ? { dalles: ortho.mesures.chargees, octets: ortho.mesures.octets } : null,
        dalles: { construites: dalles, visibles: dallesVisibles, maillagesDansDallesVisibles: maillages },
        charge, images, png,
      };
    }, o);
    const png = res.png; delete res.png;
    if (png) fs.writeFileSync(path.join(out, nom + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    res.dureeTotaleS = Math.round((Date.now() - t0) / 1000);
    if (errs.length) res.erreurs = errs.slice(0, 5);
    tout.push(res);
    fs.writeFileSync(path.join(out, nom + '.json'), JSON.stringify(res, null, 1));
    const tt = res.images.map((i) => i.total);
    console.log(nom, 'appels', tt.map((t) => t.appels).join(' '), '| triangles(k)', tt.map((t) => Math.round(t.triangles / 1000)).join(' '), '| mem', JSON.stringify(res.memoire), '| ms/image', res.images.map((i) => i.ms).join(' '));
    await page.close();
  }
  await browser.close();
})();
