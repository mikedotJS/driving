// Affichage tête haute : tableau de bord simplifié, consignes du moniteur, fiches de fautes,
// guidage, étapes de la leçon, mini-carte.

import type { FaultEvent } from '../rules/engine';
import { sanctionText } from '../rules/infractions';
import type { Maneuver, Route } from '../map/route';
import type { RoadNet } from '../map/roadnet';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export interface DashState {
  speed: number; limit: number; gear: string; rpm: number;
  left: boolean; right: boolean; belt: boolean; handbrake: boolean; engine: 'off' | 'on' | 'stalled'; lights: boolean;
  throttle: number; brake: number; clutch: number;
}
export interface StepView { text: string; hint?: string; state: 'todo' | 'cur' | 'done' }

export class Hud {
  private root = $('#hud');
  private speed = $('#dash .speed'); private limit = $('#dash .limit'); private gear = $('#dash .gear');
  private rpm = $('#dash .rpm .fill'); private indL = $('#dash .ind.l'); private indR = $('#dash .ind.r');
  private belt = $('#dash .belt'); private hb = $('#dash .hb'); private eng = $('#dash .eng'); private lights = $('#dash .lights');
  private pc = $('#dash .pedals .c b'); private pf = $('#dash .pedals .f b'); private pa = $('#dash .pedals .a b');
  private coachEl = $('#coach'); private coachTxt = $('#coach .txt');
  private faults = $('#faults');
  private nav = $('#nav'); private navArrow = $('#nav .arrow'); private navD = $('#nav .d'); private navS = $('#nav .s');
  private stepsEl = $('#steps'); private stepsTitle = $('#steps h3'); private stepsList = $('#steps ol');
  private streetEl = $('#street'); private deviceEl = $('#device'); private fpsEl = $('#fps');
  private pts = $('#score .pts'); private amende = $('#score .amende b'); private nb = $('#score .nb b');
  private mapCanvas = $<HTMLCanvasElement>('#minimap canvas');
  private coachTimer = 0;
  private last: Partial<DashState> & { street?: string; steps?: string } = {};
  showMinimap = true;

  show(v: boolean) { this.root.classList.toggle('hidden', !v); }

  setDash(d: DashState) {
    const L = this.last;
    const sp = Math.round(d.speed);
    if (L.speed !== sp) { this.speed.textContent = String(sp); L.speed = sp; }
    this.speed.classList.toggle('over', d.speed > d.limit + 1.5);
    if (L.limit !== d.limit) { this.limit.textContent = String(d.limit); L.limit = d.limit; }
    if (L.gear !== d.gear) { this.gear.textContent = d.gear; L.gear = d.gear; }
    this.rpm.style.width = `${Math.min(100, (d.rpm / 7000) * 100).toFixed(1)}%`;
    this.indL.classList.toggle('on', d.left); this.indR.classList.toggle('on', d.right);
    this.belt.className = 'ico belt ' + (d.belt ? 'green' : 'red');
    this.hb.className = 'ico hb ' + (d.handbrake ? 'red' : '');
    this.eng.className = 'ico eng ' + (d.engine === 'on' ? 'green' : d.engine === 'stalled' ? 'amber' : '');
    this.lights.className = 'ico lights ' + (d.lights ? 'green' : '');
    this.pc.style.height = `${d.clutch * 100}%`; this.pf.style.height = `${d.brake * 100}%`; this.pa.style.height = `${d.throttle * 100}%`;
  }

  /** Message du moniteur. */
  coach(text: string, sub = '', good = false, seconds = 6) {
    this.coachTxt.innerHTML = '';
    this.coachTxt.append(text);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; this.coachTxt.append(s); }
    this.coachEl.classList.toggle('good', good);
    this.coachEl.classList.add('show');
    clearTimeout(this.coachTimer);
    this.coachTimer = window.setTimeout(() => this.coachEl.classList.remove('show'), seconds * 1000);
  }
  clearCoach() { this.coachEl.classList.remove('show'); }

  fault(f: FaultEvent) {
    const el = document.createElement('div');
    el.className = `fault panel ${f.inf.severity}`;
    const h = document.createElement('h4');
    h.append(f.inf.titre);
    if (f.inf.article) { const a = document.createElement('span'); a.textContent = `art. ${f.inf.article}`; h.append(a); }
    const p = document.createElement('p');
    p.textContent = (f.detail ? f.detail.charAt(0).toUpperCase() + f.detail.slice(1) + '. ' : '') + f.inf.regle;
    const s = document.createElement('div');
    s.className = 'sanction';
    s.textContent = f.inf.classe ? `Dans la réalité : ${sanctionText(f.inf)}` : 'Conseil du moniteur';
    el.append(h, p, s);
    this.faults.prepend(el);
    while (this.faults.children.length > 3) this.faults.lastElementChild!.remove();
    const life = f.inf.severity === 'conseil' ? 7000 : 10000;
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, life);
  }
  clearFaults() { this.faults.innerHTML = ''; }

  setScore(points: number, amende: number, n: number) {
    (this.pts.querySelector('b') as HTMLElement).textContent = String(points);
    this.pts.classList.toggle('low', points <= 4);
    this.amende.textContent = `${amende} €`;
    this.nb.textContent = String(n);
  }

  setNav(next: { m: Maneuver; dist: number } | null) {
    if (!next) { this.nav.classList.remove('show'); return; }
    this.nav.classList.add('show');
    const k = next.m.kind;
    this.navArrow.textContent = k === 'droite' ? '↱' : k === 'gauche' ? '↰' : k === 'giratoire' ? '⟳' : k === 'arrivee' ? '⚑' : '↑';
    const d = next.dist;
    this.navD.textContent = d > 950 ? `${(d / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(d / 10) * 10)} m`;
    this.navS.textContent = k === 'giratoire' ? `${next.m.exit}ᵉ sortie${next.m.street ? ' · ' + next.m.street : ''}` : k === 'arrivee' ? 'Arrivée' : next.m.street || '';
  }

  setSteps(title: string, steps: StepView[] | null) {
    if (!steps) { this.stepsEl.classList.remove('show'); this.last.steps = ''; return; }
    const sig = title + steps.map((s) => s.state[0] + s.text).join('|');
    if (sig === this.last.steps) return;
    this.last.steps = sig;
    this.stepsEl.classList.add('show');
    this.stepsTitle.textContent = title;
    this.stepsList.innerHTML = '';
    // on montre les étapes autour de l'étape courante
    const cur = Math.max(0, steps.findIndex((s) => s.state === 'cur'));
    const from = Math.max(0, Math.min(cur - 2, steps.length - 6));
    steps.slice(from, from + 6).forEach((s) => {
      const li = document.createElement('li');
      li.className = s.state === 'todo' ? '' : s.state;
      li.append(s.text);
      if (s.hint && s.state === 'cur') { const sm = document.createElement('small'); sm.innerHTML = s.hint; li.append(sm); }
      this.stepsList.append(li);
    });
  }

  setStreet(name: string, zone: string) {
    const t = name ? `${name}${zone ? ' · ' + zone : ''}` : zone;
    if (t !== this.last.street) { this.streetEl.textContent = t; this.streetEl.style.display = t ? '' : 'none'; this.last.street = t; }
  }
  setDevice(text: string) { this.deviceEl.textContent = text; }
  setFps(text: string) { this.fpsEl.textContent = text; }

  /** Mini-carte orientée dans le sens de la marche. */
  drawMinimap(net: RoadNet, x: number, z: number, heading: number, route: Route | null, step: number, canvas: HTMLCanvasElement = this.mapCanvas, range = 150) {
    const c = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    c.fillStyle = '#1b222c'; c.fillRect(0, 0, W, H);
    const k = W / (2 * range);
    c.save();
    c.translate(W / 2, H * 0.62);
    c.rotate(-heading);
    c.scale(k, k);
    c.translate(-x, -z);
    c.lineCap = 'round'; c.lineJoin = 'round';
    const seen = new Set<number>();
    const cells = Math.ceil(range * 1.5 / 40);
    for (let i = -cells; i <= cells; i++) for (let j = -cells; j <= cells; j++) {
      for (const e of net.edgesNear(x + i * 40, z + j * 40)) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        c.strokeStyle = e.cls === 'primary' || e.cls === 'secondary' ? '#8791a0' : '#5b6573';
        c.lineWidth = Math.max(e.width, 4);
        c.beginPath();
        const P = e.line.pts;
        c.moveTo(P[0], P[1]);
        for (let q = 2; q < P.length; q += 2) c.lineTo(P[q], P[q + 1]);
        c.stroke();
      }
    }
    if (route) {
      c.strokeStyle = '#3d8bf2'; c.lineWidth = 5;
      c.beginPath();
      let first = true;
      for (let i = Math.max(0, step - 1); i < Math.min(route.steps.length, step + 14); i++) {
        const st = route.steps[i];
        const P = st.edge.line.pts, n = P.length / 2;
        for (let q = 0; q < n; q++) {
          const idx = st.dir > 0 ? q : n - 1 - q;
          if (first) { c.moveTo(P[idx * 2], P[idx * 2 + 1]); first = false; } else c.lineTo(P[idx * 2], P[idx * 2 + 1]);
        }
      }
      c.stroke();
    }
    c.restore();
    // voiture
    c.save(); c.translate(W / 2, H * 0.62);
    c.fillStyle = '#fff'; c.strokeStyle = '#0b0e13'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -16); c.lineTo(11, 12); c.lineTo(0, 6); c.lineTo(-11, 12); c.closePath(); c.stroke(); c.fill();
    c.restore();
  }
}
