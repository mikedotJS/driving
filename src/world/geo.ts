// Accumulateur de géométrie (positions, normales, UV, couleurs, attributs libres) → BufferGeometry.

import * as THREE from 'three';
import earcut from 'earcut';

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  extra: number[] = [];
  idx: number[] = [];
  constructor(private useColor = false, private extraSize = 0, private extraName = 'facade') {}

  get vertexCount() { return this.pos.length / 3; }
  get empty() { return this.idx.length === 0; }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, r = 1, g = 1, b = 1, e0 = 0, e1 = 0, e2 = 0): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v);
    if (this.useColor) this.col.push(r, g, b);
    if (this.extraSize === 3) this.extra.push(e0, e1, e2);
    return i;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  quadIdx(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }

  /**
   * Polygone horizontal (anneau extérieur + trous, coordonnées x,z à plat) à l'altitude y,
   * face vers le haut. UV = coordonnées monde × uvScale.
   */
  polygon(outer: ArrayLike<number>, holes: ArrayLike<number>[], y: number, uvScale: number, ox = 0, oz = 0, scale = 1, r = 1, g = 1, b = 1) {
    const flat: number[] = [];
    const holeIdx: number[] = [];
    for (let i = 0; i < outer.length; i++) flat.push(outer[i]);
    for (const h of holes) { holeIdx.push(flat.length / 2); for (let i = 0; i < h.length; i++) flat.push(h[i]); }
    const tris = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
    const base = this.vertexCount;
    for (let i = 0; i < flat.length; i += 2) {
      const x = ox + flat[i] * scale, z = oz + flat[i + 1] * scale;
      this.vertex(x, y, z, 0, 1, 0, x * uvScale, z * uvScale, r, g, b);
    }
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], bb = tris[i + 1], c = tris[i + 2];
      const ax = flat[a * 2], az = flat[a * 2 + 1];
      const ny = (flat[bb * 2 + 1] - az) * (flat[c * 2] - ax) - (flat[bb * 2] - ax) * (flat[c * 2 + 1] - az);
      if (ny >= 0) this.idx.push(base + a, base + bb, base + c); else this.idx.push(base + a, base + c, base + bb);
    }
  }

  /** étiquette de mise au point */
  label = '';

  build(): THREE.BufferGeometry {
    // garde-fou : une coordonnée invalide rendrait tout le maillage invisible
    let bad = 0;
    for (let i = 0; i < this.pos.length; i++) if (!Number.isFinite(this.pos[i])) { this.pos[i] = 0; bad++; }
    for (let i = 0; i < this.nor.length; i++) if (!Number.isFinite(this.nor[i])) this.nor[i] = 0;
    for (let i = 0; i < this.uv.length; i++) if (!Number.isFinite(this.uv[i])) this.uv[i] = 0;
    if (bad) console.warn(`Géométrie « ${this.label} » : ${bad} coordonnées invalides corrigées`);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.extraSize) g.setAttribute(this.extraName, new THREE.Float32BufferAttribute(this.extra, this.extraSize));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
