// Voitures en stationnement le long des rues : emplacements déduits des bandes de stationnement,
// rendus par instances (une géométrie « peinture » teintée par instance + une géométrie pour le reste).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCarVisual, CAR_COLORS, CAR_DIMS, type CarKind } from '../render/car-model';
import type { RoadNet } from '../map/roadnet';
import type { StaticBox } from '../game/player';
import { Rng, hash32 } from '../core/math';

interface Spot { x: number; z: number; heading: number; kind: CarKind; color: number }
const KINDS: CarKind[] = ['citadine', 'berline', 'suv', 'utilitaire'];
const PAINT_MARK = 0xff00fe;

interface BakedPart { geo: THREE.BufferGeometry; mat: THREE.Material; tint: boolean }

/** Fusionne un modèle de voiture en quelques géométries instanciables (peinture teintée par instance, détails, roues). */
function bake(kind: CarKind, paintMat: THREE.Material): BakedPart[] {
  const v = createCarVisual(kind, PAINT_MARK);
  v.group.updateMatrixWorld(true);
  const mark = new THREE.Color(PAINT_MARK);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  v.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    // attributs homogènes pour la fusion (les roues n'ont pas d'attribut de lueur)
    if (!g.getAttribute('aGlow')) g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1));
    else g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1));
    if (!g.getAttribute('aRM')) { const rm = new Float32Array(n * 2); for (let i = 0; i < n; i++) rm[i * 2] = 0.5; g.setAttribute('aRM', new THREE.BufferAttribute(rm, 2)); }
    if (!g.getAttribute('color')) { const c = new Float32Array(n * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aRM', 'aGlow'].includes(name)) g.deleteAttribute(name);
    let list = groups.get(mat);
    if (!list) groups.set(mat, (list = []));
    list.push(g);
  });
  const parts: BakedPart[] = [];
  for (const [mat, list] of groups) {
    const geo = mergeGeometries(list);
    if (!geo) continue;
    const col = (mat as THREE.MeshStandardMaterial).color;
    const isPaint = !!col && Math.abs(col.r - mark.r) + Math.abs(col.g - mark.g) + Math.abs(col.b - mark.b) < 0.02;
    if (isPaint) { geo.deleteAttribute('color'); geo.deleteAttribute('aRM'); geo.deleteAttribute('aGlow'); }
    parts.push({ geo, mat: isPaint ? paintMat : mat, tint: isPaint });
  }
  return parts;
}

export class ParkedCars {
  private byChunk = new Map<string, Spot[]>();
  private grid = new Map<number, StaticBox[]>();
  private baked = new Map<CarKind, BakedPart[]>();
  private paintMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08 });
  count = 0;

  constructor(private net: RoadNet, density = 0.74) {
    const C = net.map.chunk;
    for (const e of net.edges) {
      const len = e.length;
      for (const st of e.strips) {
        if (st.kind !== 'P') continue;
        const rng = new Rng(hash32(`p${e.id}:${st.off.toFixed(1)}`));
        // sens des voitures garées : celui de la voie adjacente
        const side = Math.sign(st.off) || 1;
        const adj = e.strips.filter((x) => x.kind !== 'P' && x.dir !== 0).sort((a, b) => Math.abs(a.off - st.off) - Math.abs(b.off - st.off))[0];
        const dir = adj ? adj.dir : 1;
        const perp = st.park === 'perpendicular', diag = st.park === 'diagonal';
        const slot = perp ? 2.5 : diag ? 2.9 : 5.3;
        const s0 = e.endA.trim + 5.5, s1 = len - e.endB.trim - 5.5;
        for (let s = s0 + slot / 2; s < s1 - slot / 2; s += slot) {
          // pas de stationnement sur les passages piétons ni dans les 5 m qui les précèdent (loi d'orientation des mobilités)
          if (e.crossings.some((c) => { const d = (c.s - s) * dir; return d > -c.halfLen - 3.2 && d < c.halfLen + 5 + slot / 2; })) continue;
          if (rng.next() > density) continue;
          const r = rng.next();
          const kind: CarKind = r < 0.5 ? 'citadine' : r < 0.72 ? 'berline' : r < 0.9 ? 'suv' : 'utilitaire';
          const dims = CAR_DIMS[kind];
          const lat = st.off + (perp || diag ? 0 : side * (st.w / 2 - dims.width / 2 - 0.22)) + rng.range(-0.06, 0.06);
          const p = e.line.atOffset(s + rng.range(-0.25, 0.25), lat);
          let heading = Math.atan2(p.tx * dir, -p.tz * dir) + rng.range(-0.025, 0.025);
          if (perp) heading += (Math.PI / 2) * side * dir;
          else if (diag) heading += 0.9 * side * dir;
          const color = kind === 'utilitaire' && rng.next() < 0.7 ? 0xf2f2f0 : rng.pick(CAR_COLORS);
          const spot: Spot = { x: p.x, z: p.z, heading, kind, color };
          const key = `${Math.floor(p.x / C)},${Math.floor(p.z / C)}`;
          let a = this.byChunk.get(key);
          if (!a) this.byChunk.set(key, (a = []));
          a.push(spot);
          const box: StaticBox = { x: p.x, z: p.z, heading, halfLen: dims.length / 2, halfWid: dims.width / 2 };
          const gk = this.gkey(p.x, p.z);
          let gl = this.grid.get(gk);
          if (!gl) this.grid.set(gk, (gl = []));
          gl.push(box);
          this.count++;
        }
      }
    }
  }

  private gkey(x: number, z: number) { return (Math.floor(x / 20) + 4096) * 8192 + Math.floor(z / 20) + 4096; }

  /** Voitures garées proches d'un point (pour les collisions). */
  near(x: number, z: number, r: number): StaticBox[] {
    const out: StaticBox[] = [];
    for (let i = Math.floor((x - r) / 20); i <= Math.floor((x + r) / 20); i++) {
      for (let j = Math.floor((z - r) / 20); j <= Math.floor((z + r) / 20); j++) {
        const a = this.grid.get((i + 4096) * 8192 + j + 4096);
        if (a) for (const b of a) if (Math.abs(b.x - x) < r + 3 && Math.abs(b.z - z) < r + 3) out.push(b);
      }
    }
    return out;
  }

  populateChunk(key: string, group: THREE.Group) {
    const spots = this.byChunk.get(key);
    if (!spots) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const Y = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const holder = new THREE.Group();
    holder.name = 'stationnement';
    for (const kind of KINDS) {
      const list = spots.filter((x) => x.kind === kind);
      if (!list.length) continue;
      let parts = this.baked.get(kind);
      if (!parts) this.baked.set(kind, (parts = bake(kind, this.paintMat)));
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((sp, i) => {
          q.setFromAxisAngle(Y, -sp.heading);
          m.compose(p.set(sp.x, 0, sp.z), q, s);
          mesh.setMatrixAt(i, m);
          if (part.tint) mesh.setColorAt(i, col.setHex(sp.color));
        });
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        holder.add(mesh);
      }
    }
    group.add(holder);
  }
}
