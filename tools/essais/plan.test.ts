// Plan de dessus d'un carrefour avec la trace des roues du pilote automatique (SVG).
// THEME=pietons SEED=3 SEG=5 OUT=/chemin/plan.svg npx vitest run --config tools/vitest.config.ts tools/essais/plan.test.ts
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { RoadNet, type MapFile } from '../../src/map/roadnet';
import { Ground } from '../../src/world/ground';
import { Player } from '../../src/game/player';
import { Autopilot } from '../../src/game/autopilot';
import { START_STREETS, planRoute, startOnStreet, type Theme } from '../../src/game/lessons';
import type { InputState, Action } from '../../src/input/controls';

const map = JSON.parse(readFileSync(new URL('../../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);
const ground = new Ground(map);

it('plan', () => {
  const theme: Theme = (process.env.THEME as Theme) ?? 'pietons';
  const seed = +(process.env.SEED ?? 3), target = +(process.env.SEG ?? 5);
  const pose = START_STREETS[theme].map((n) => startOnStreet(net, n, 0.25)).find(Boolean)!;
  const route = planRoute(net, { edge: pose.edge, dir: pose.dir }, pose.s, theme, seed)!;
  const ap = new Autopilot(net, null, route);
  const A = ap as any;
  // on démarre un peu avant le segment visé
  const first = Math.max(0, target - 1);
  A.k = first;
  const l0 = ap.segs[first].lane ?? ap.segs[first - 1].lane!;
  if (!ap.segs[first].lane) A.k = first - 1;
  const s0 = Math.max(1, l0.line.length - 30);
  const p = l0.line.at(s0);
  const player = new Player(ground, net, null as any);
  player.car.mode = 'auto';
  player.spawn(p.x, p.z, Math.atan2(p.tx, -p.tz), { running: true, belt: true });
  player.handbrake = false; player.car.selector = 'D';
  const input: InputState = { steer: 0, throttle: 0, brake: 0, clutch: 0, pressed: new Set<Action>(), held: new Set<Action>(), hGear: null, device: 'keyboard', deviceName: '', hasClutchPedal: false, steerRate: 0 };
  const tracks: [number, number, number][][] = [[], [], [], []];
  let steer = 0;
  const dt = 1 / 60;
  for (let t = 0; t < 40 && A.k <= target + 1; t += dt) {
    const cmd = ap.update(dt, player.car);
    steer += Math.max(-2.2 * dt, Math.min(2.2 * dt, cmd.steer - steer));
    input.steer = steer; input.throttle = cmd.throttle; input.brake = cmd.brake;
    player.update(dt, input);
    for (let i = 0; i < 4; i++) { const w = player.car.wheelWorld(i); tracks[i].push([w[0], w[1], player.car.groundH[i]]); }
  }
  const seg = ap.segs[target];
  const c = seg.line.at(seg.line.length / 2);
  const R = +(process.env.R ?? 22), S = 22; // m, px/m
  const X = (x: number) => ((x - c.x + R) * S).toFixed(1), Z = (z: number) => ((z - c.z + R) * S).toFixed(1);
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${2 * R * S}" height="${2 * R * S}" style="background:#9a9">`];
  const C = map.chunk;
  for (let ci = Math.floor((c.x - R) / C); ci <= Math.floor((c.x + R) / C); ci++) for (let cj = Math.floor((c.z - R) / C); cj <= Math.floor((c.z + R) / C); cj++) {
    const ck = map.chunks[`${ci},${cj}`];
    if (!ck) continue;
    for (const poly of ck.r as any[]) {
      const rings: number[][] = Array.isArray(poly[0]) ? poly : poly.o ? [poly.o, ...(poly.h ?? [])] : [poly];
      const d = rings.map((r) => 'M' + Array.from({ length: r.length / 2 }, (_, i) => `${X(r[i * 2] / 100 + ci * C)},${Z(r[i * 2 + 1] / 100 + cj * C)}`).join('L') + 'Z').join(' ');
      out.push(`<path d="${d}" fill="#444" fill-rule="evenodd" stroke="#ddd" stroke-width="1"/>`);
    }
  }
  const poly = (L: any, color: string, w = 1) => out.push(`<polyline fill="none" stroke="${color}" stroke-width="${w}" points="${Array.from({ length: L.n }, (_, i) => `${X(L.pts[i * 2])},${Z(L.pts[i * 2 + 1])}`).join(' ')}"/>`);
  for (const e of net.edges) {
    if (e.line.maxX < c.x - R || e.line.minX > c.x + R || e.line.maxZ < c.z - R || e.line.minZ > c.z + R) continue;
    poly(e.line, '#06c', 1);
    for (const l of e.allLanes) { poly(l.line, l.kind === 'C' ? '#3a3' : '#bbb', 1); for (const k of l.links) poly(k.line, '#777', 0.6); }
  }
  for (let i = Math.max(0, target - 1); i <= Math.min(ap.segs.length - 1, target + 1); i++) poly(ap.segs[i].line, '#ff0', 2);
  const cols = ['#f80', '#f08', '#0cf', '#0f8'];
  tracks.forEach((tr, i) => {
    out.push(`<polyline fill="none" stroke="${cols[i]}" stroke-width="1.5" points="${tr.map((q) => `${X(q[0])},${Z(q[1])}`).join(' ')}"/>`);
    for (const q of tr) if (q[2] > 0.05) out.push(`<circle cx="${X(q[0])}" cy="${Z(q[1])}" r="2.5" fill="#f00"/>`);
  });
  out.push(`<text x="8" y="18" fill="#fff" font-family="sans-serif" font-size="14">${theme} ${seed} seg ${target} : ${seg.link ? `${seg.link.turn} ${seg.link.from.edge.name} → ${seg.link.to.edge.name}` : seg.lane!.edge.name} — AVG orange, AVD rose, ARG cyan, ARD vert ; rouge = roue sur bordure</text></svg>`);
  writeFileSync(process.env.OUT ?? 'plan.svg', out.join('\n'));
});
