import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoadNet, type MapFile } from '../src/map/roadnet';
import { Traffic, type PlayerInfo } from '../src/traffic/traffic';

const map = JSON.parse(readFileSync(new URL('../public/maps/montreuil.json', import.meta.url), 'utf8')) as MapFile;
const net = new RoadNet(map);

function fakePlayer(x: number, z: number): PlayerInfo {
  return { x, z, heading: 0, speed: 0, length: 4.05, width: 1.8, approach: null, approachDist: Infinity, inJunction: null, left: false, right: false };
}

describe('circulation', () => {
  it('tourne 6 minutes autour de la Croix de Chavaux sans blocage durable ni accrochage', () => {
    // joueur garé hors chaussée, près de la place Jacques Duclos
    const e = net.edges.find((x) => x.name === 'Place Jacques Duclos')!;
    const p0 = e.line.at(0);
    const player = fakePlayer(p0.x + 40, p0.z + 40);
    const tr = new Traffic(net, { vehicles: 45, pedestrians: 30, seed: 3 });
    const dt = 1 / 30;
    let overlaps = 0, moved = 0, samples = 0, speedSum = 0, maxStuck = 0, forced = 0;
    tr.onForcedBrake = () => { forced++; };
    const stuck = new Map<number, number>();
    for (let t = 0; t < 360; t += dt) {
      tr.update(dt, player);
      if (Math.round(t / dt) % 15 === 0) {
        for (const v of tr.vehicles) {
          samples++; speedSum += v.v; if (v.v > 0.5) moved++;
          const s = v.v < 0.1 ? (stuck.get(v.id) ?? 0) + 0.5 : 0;
          stuck.set(v.id, s); maxStuck = Math.max(maxStuck, s);
        }
        // recouvrements : centres à moins de 1,6 m
        for (let i = 0; i < tr.vehicles.length; i++) for (let j = i + 1; j < tr.vehicles.length; j++) {
          const a = tr.vehicles[i], b = tr.vehicles[j];
          if (Math.hypot(a.x - b.x, a.z - b.z) < 1.6) overlaps++;
        }
      }
    }
    const stats = {
      véhicules: tr.vehicles.length, piétons: tr.pedestrians.length,
      vitesseMoyenneKmh: +((speedSum / samples) * 3.6).toFixed(1), partEnMouvement: +(moved / samples).toFixed(2),
      arrêtMaxS: maxStuck, recouvrements: overlaps, freinagesForcés: forced,
      piétonsParÉtat: tr.pedestrians.reduce((m, p) => { m[p.state] = (m[p.state] ?? 0) + 1; return m; }, {} as Record<string, number>),
    };
    console.log(stats);
    expect(tr.vehicles.length).toBeGreaterThan(20);
    expect(stats.vitesseMoyenneKmh).toBeGreaterThan(6);
    expect(stats.arrêtMaxS).toBeLessThan(120);
    expect(overlaps).toBeLessThan(40);
  });
});
