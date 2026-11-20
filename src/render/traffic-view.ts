// Représentation 3D de la circulation : véhicules (modèles partagés) et piétons (instanciés).

import * as THREE from 'three';
import { createCarVisual, CAR_COLORS, type CarVisual } from './car-model';
import { PedestrianCrowd } from './people';
import type { Traffic, Vehicle, Pedestrian } from '../traffic/traffic';
import { KERB_HEIGHT } from '../world/ground';
import type { Ground } from '../world/ground';

interface Slot { visual: CarVisual; vehicle: Vehicle | null }

export class TrafficView {
  readonly group = new THREE.Group();
  private slots = new Map<number, Slot>();
  private pool: Record<string, CarVisual[]> = {};
  private crowd: PedestrianCrowd;
  private pedIndex = new Map<number, number>();
  private pedHit = new Map<number, number>();
  private blink = 0;

  constructor(private traffic: Traffic, private ground: Ground, capacity = 96) {
    this.crowd = new PedestrianCrowd(capacity);
    this.group.add(this.crowd.mesh);
  }

  update(dt: number) {
    this.blink = (this.blink + dt * 1.5) % 1;
    const lit = this.blink < 0.5;
    const alive = new Set<number>();
    for (const v of this.traffic.vehicles) {
      alive.add(v.id);
      let s = this.slots.get(v.id);
      if (!s) {
        const key = v.kind;
        const color = v.kind === 'bus' ? 0xe9edf0 : v.kind === 'utilitaire' && v.color % 3 ? 0xf2f2f0 : CAR_COLORS[v.color % CAR_COLORS.length];
        const visual = this.pool[key]?.pop() ?? createCarVisual(v.kind, color);
        s = { visual, vehicle: v };
        this.slots.set(v.id, s);
        this.group.add(visual.group);
      }
      const g = s.visual.group;
      g.position.set(v.x, 0, v.z);
      g.rotation.y = -v.heading;
      const R = s.visual.dims.wheelRadius;
      const spin = -v.wheelPhase / R;
      for (let i = 0; i < 4; i++) {
        const w = s.visual.wheels[i];
        if (w.children[0]) w.children[0].rotation.x = spin;
      }
      // tangage au freinage / à l'accélération
      s.visual.body.rotation.x = Math.max(-0.02, Math.min(0.03, -v.a * 0.006));
      s.visual.setLights({ brake: v.braking, left: v.indicator < 0 && lit, right: v.indicator > 0 && lit, reverse: false, head: false });
    }
    for (const [id, s] of this.slots) {
      if (alive.has(id)) continue;
      this.group.remove(s.visual.group);
      (this.pool[s.vehicle!.kind] ??= []).push(s.visual);
      this.slots.delete(id);
    }

    // piétons
    const seen = new Set<number>();
    for (const p of this.traffic.pedestrians) {
      seen.add(p.id);
      let idx = this.pedIndex.get(p.id);
      if (idx === undefined) {
        idx = this.crowd.add(p.seed);
        if (idx < 0) continue;
        this.pedIndex.set(p.id, idx);
      }
      if (p.hit) {
        const t = (this.pedHit.get(p.id) ?? 0) + dt;
        this.pedHit.set(p.id, t);
        if (t > 4) p.alive = false;
      }
      const y = this.ground.isRoad(p.x, p.z) ? 0 : KERB_HEIGHT;
      this.crowd.set(idx, p.x, p.z, y, p.heading, p.phase, p.hit ? 0 : p.speed);
    }
    for (const [id, idx] of this.pedIndex) {
      if (seen.has(id)) continue;
      this.crowd.remove(idx);
      this.pedIndex.delete(id); this.pedHit.delete(id);
    }
    this.crowd.commit();
  }

  /** Utilisé par le son : véhicules proches (distance, direction). */
  nearest(x: number, z: number, n = 4): { v: Vehicle; d: number }[] {
    return this.traffic.vehicles.map((v) => ({ v, d: Math.hypot(v.x - x, v.z - z) })).sort((a, b) => a.d - b.d).slice(0, n);
  }
  pedestrianList(): Pedestrian[] { return this.traffic.pedestrians; }
}
