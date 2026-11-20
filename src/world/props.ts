// Mobilier et signalisation verticale : panneaux (atlas de textures), plaques de rue, feux tricolores
// à la française (feu principal, répétiteur bas, figurines piétons), arbres, lampadaires, potelets.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Edge, EdgeEnd, RoadNet, SignalController, SignalState } from '../map/roadnet';
import type { MaterialLib } from '../render/materials';
import type { Ground } from './ground';
import { KERB_H } from './city';
import { GeoBuilder } from './geo';
import { SIGNS, drawSign } from './signs';
import { hash32, Rng } from '../core/math';

interface SignPlacement { code: string; text?: string; x: number; z: number; /** direction vers laquelle le panneau fait face */ fx: number; fz: number; y: number; plate?: boolean }

const SIGN_CELL = 256;
const PLATE_W = 256, PLATE_H = 128;

class Atlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  private cells = new Map<string, { u0: number; v0: number; u1: number; v1: number }>();
  private next = 0;
  constructor(private w: number, private h: number, private cw: number, private ch: number) {
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }
  get(code: string, text: string | undefined) {
    const key = code + '|' + (text ?? '');
    let c = this.cells.get(key);
    if (c) return c;
    const cols = Math.floor(this.w / this.cw), rows = Math.floor(this.h / this.ch);
    const i = this.next++ % (cols * rows);
    const x = (i % cols) * this.cw, y = Math.floor(i / cols) * this.ch;
    const src = drawSign(code, Math.max(this.cw, this.ch) - 8, text);
    // on centre le panneau dans sa cellule en conservant ses proportions
    const k = Math.min((this.cw - 8) / src.width, (this.ch - 8) / src.height);
    const dw = src.width * k, dh = src.height * k;
    const dx = x + (this.cw - dw) / 2, dy = y + (this.ch - dh) / 2;
    this.ctx.clearRect(x, y, this.cw, this.ch);
    this.ctx.drawImage(src, dx, dy, dw, dh);
    c = { u0: dx / this.w, u1: (dx + dw) / this.w, v0: 1 - (dy + dh) / this.h, v1: 1 - dy / this.h };
    this.cells.set(key, c);
    this.texture.needsUpdate = true;
    return c;
  }
}

interface Lamp { index: number; ctl: SignalController; group: number; role: 'r' | 'y' | 'g' | 'pr' | 'pg' }
interface InstanceList { m: number[] }

const C_OFF = new THREE.Color(0.035, 0.035, 0.04);
const C_RED = new THREE.Color(5.5, 0.25, 0.12);
const C_YEL = new THREE.Color(5.0, 2.6, 0.15);
const C_GRN = new THREE.Color(0.2, 4.6, 1.6);

export class Props {
  readonly group = new THREE.Group();
  private signAtlas = new Atlas(2048, 2048, SIGN_CELL, SIGN_CELL);
  private plateAtlas = new Atlas(4096, 4096, PLATE_W, PLATE_H);
  private signMat: THREE.MeshStandardMaterial;
  private plateMat: THREE.MeshStandardMaterial;
  private signsByChunk = new Map<string, SignPlacement[]>();
  private treesByChunk = new Map<string, number[][]>();
  private lampsByChunk = new Map<string, InstanceList>();
  private bollardsByChunk = new Map<string, InstanceList>();
  private lamps: Lamp[] = [];
  private lampMesh!: THREE.InstancedMesh;
  private lastState = new Map<string, string>();
  // géométries partagées
  private trunkGeo!: THREE.BufferGeometry;
  private crownGeo!: THREE.BufferGeometry;
  private crownMat!: THREE.MeshStandardMaterial;
  private crownDepth!: THREE.MeshDepthMaterial;
  private trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5d4f, roughness: 0.95, metalness: 0 });
  private lampGeo!: THREE.BufferGeometry;
  private bollardGeo!: THREE.BufferGeometry;
  private bollardMat = new THREE.MeshStandardMaterial({ color: 0x3a2d24, roughness: 0.55, metalness: 0.35, vertexColors: true });
  private chunk: number;
  /** positions des obstacles ponctuels (poteaux, arbres) pour les collisions */
  readonly posts: { x: number; z: number; r: number }[] = [];

  constructor(private net: RoadNet, private mats: MaterialLib, private ground: Ground) {
    this.chunk = net.map.chunk;
    this.signMat = new THREE.MeshStandardMaterial({ map: this.signAtlas.texture, alphaTest: 0.5, roughness: 0.45, metalness: 0.05 });
    this.plateMat = new THREE.MeshStandardMaterial({ map: this.plateAtlas.texture, alphaTest: 0.5, roughness: 0.35, metalness: 0.1 });
    this.buildShared();
    this.placeSigns();
    this.placeSignals();
    this.placeTrees();
    this.placeLamps();
    this.placeBollards();
  }

  private key(x: number, z: number) { return `${Math.floor(x / this.chunk)},${Math.floor(z / this.chunk)}`; }
  private push<T>(map: Map<string, T[]>, x: number, z: number, v: T) {
    const k = this.key(x, z);
    let a = map.get(k);
    if (!a) map.set(k, (a = []));
    a.push(v);
  }

  // ───────────────────────── géométries partagées ─────────────────────────
  private buildShared() {
    // tronc
    const trunk = new THREE.CylinderGeometry(0.75, 1, 1, 8, 1, true);
    trunk.translate(0, 0.5, 0);
    this.trunkGeo = trunk;
    // houppier : cartes de feuillage réparties sur un ellipsoïde, normales sphériques
    const rng = new Rng(77);
    const g = new GeoBuilder();
    const cards = 36;
    for (let i = 0; i < cards; i++) {
      const u = rng.next() * Math.PI * 2, v = Math.acos(rng.range(-0.75, 1));
      const r = 0.55 + rng.next() * 0.4;
      const cx = Math.sin(v) * Math.cos(u) * r, cy = Math.cos(v) * r * 0.82 + 0.05, cz = Math.sin(v) * Math.sin(u) * r;
      const size = 0.46 + rng.next() * 0.28;
      // base de la carte : tangente à la sphère, orientation aléatoire
      const n = new THREE.Vector3(cx, cy, cz).normalize();
      const t = new THREE.Vector3(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5).cross(n).normalize();
      const b = new THREE.Vector3().crossVectors(n, t);
      // on incline la carte pour qu'elle ne soit pas toujours tangente
      const tilt = rng.range(-0.7, 0.7);
      const b2 = b.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(n, Math.sin(tilt));
      const corner = (sx: number, sy: number, uu: number, vv: number) => {
        const px = cx + t.x * sx * size + b2.x * sy * size, py = cy + t.y * sx * size + b2.y * sy * size, pz = cz + t.z * sx * size + b2.z * sy * size;
        const nn = new THREE.Vector3(px, py - 0.1, pz).normalize();
        return g.vertex(px, py, pz, nn.x, nn.y * 0.8 + 0.2, nn.z, uu, vv);
      };
      const a = corner(-1, -1, 0, 0), bb = corner(1, -1, 1, 0), c = corner(1, 1, 1, 1), d = corner(-1, 1, 0, 1);
      g.quadIdx(a, bb, c, d);
    }
    this.crownGeo = g.build();
    const leaf = foliageTexture();
    this.crownMat = new THREE.MeshStandardMaterial({ map: leaf, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.95, metalness: 0, color: new THREE.Color(1.25, 1.3, 1.1) });
    this.crownDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaf, alphaTest: 0.42 });

    // lampadaire : mât conique, crosse, lanterne
    const pole = new THREE.CylinderGeometry(0.055, 0.09, 7.6, 8); pole.translate(0, 3.8, 0);
    const base = new THREE.CylinderGeometry(0.11, 0.13, 0.9, 8); base.translate(0, 0.45, 0);
    const arm = new THREE.CylinderGeometry(0.04, 0.045, 1.5, 6); arm.rotateZ(Math.PI / 2 - 0.18); arm.translate(0.72, 7.72, 0);
    const head = new THREE.BoxGeometry(0.62, 0.09, 0.26); head.translate(1.55, 7.84, 0);
    this.lampGeo = mergeGeometries([pole, base, arm, head])!;

    // potelet parisien : fût brun, boule blanche
    const post = new THREE.CylinderGeometry(0.04, 0.045, 0.92, 8); post.translate(0, 0.46, 0);
    const ball = new THREE.SphereGeometry(0.06, 10, 8); ball.translate(0, 0.97, 0);
    const paint = (geo: THREE.BufferGeometry, r: number, gg: number, b: number) => {
      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    };
    paint(post, 1, 1, 1); paint(ball, 4.6, 4.6, 4.4);
    this.bollardGeo = mergeGeometries([post, ball])!;
  }

  // ───────────────────────── panneaux ─────────────────────────
  /** Position sur le trottoir, à droite du sens de circulation `dir` à l'abscisse s. */
  private kerbside(e: Edge, s: number, dir: 1 | -1, extra = 0.55): { x: number; z: number; tx: number; tz: number } | null {
    const p = e.line.at(s);
    const side = dir; // droite du sens a→b = décalage positif
    for (const off of [e.half + extra, e.half + extra + 0.5, e.half + extra + 1.1]) {
      const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
      if (!this.ground.isRoad(x, z)) return { x, z, tx: p.tx * dir, tz: p.tz * dir };
    }
    return null;
  }

  private sign(code: string, x: number, z: number, fx: number, fz: number, y = 2.3, text?: string, plate = false) {
    this.push(this.signsByChunk, x, z, { code, text, x, z, fx, fz, y, plate });
  }

  private placeSigns() {
    const net = this.net;
    for (const e of net.edges) {
      const len = e.length;
      for (const end of [e.endA, e.endB]) {
        const dir: 1 | -1 = end.atA ? -1 : 1; // sens du trafic qui arrive sur cette extrémité
        // ── stop / cédez-le-passage ──
        if (end.canArrive && (end.control === 'stop' || end.control === 'yield')) {
          const s = end.sAt(end.stopDist + 0.3);
          const k = this.kerbside(e, s, dir);
          if (k) {
            this.sign(end.control === 'stop' ? 'AB4' : 'AB3a', k.x, k.z, -k.tx, -k.tz, 2.3);
            if (end.vertex.roundabout && !e.roundabout) this.sign('AB25', k.x, k.z, -k.tx, -k.tz, 3.05);
          }
        }
        // ── sens interdit : au débouché d'un sens unique ──
        if (e.oneway && !e.roundabout && !end.canLeave && end.vertex.ends.length >= 3) {
          // un conducteur à contresens entrerait par cette extrémité : panneaux tournés vers lui
          const s = end.sAt(end.trim + 1.2);
          const inDir: 1 | -1 = end.atA ? 1 : -1;
          for (const side of [1, -1] as const) {
            const p = e.line.at(s);
            const off = (e.half + 0.55) * side;
            const x = p.x - p.tz * off, z = p.z + p.tx * off;
            if (this.ground.isRoad(x, z)) continue;
            this.sign('B1', x, z, -p.tx * inDir, -p.tz * inDir, 2.3);
            if (e.dsc) this.sign('M9v', x, z, -p.tx * inDir, -p.tz * inDir, 2.02);
          }
        }
        // ── en début de rue (sens de circulation qui quitte le sommet) ──
        if (end.canLeave && end.vertex.ends.length >= 2 && len > 30) {
          const outDir: 1 | -1 = end.atA ? 1 : -1;
          const others = end.vertex.ends.filter((o) => o !== end && o.canArrive);
          const changed = others.some((o) => o.edge.limit !== e.limit);
          if (changed && others.length) {
            const s = end.sAt(Math.min(len * 0.4, end.trim + 6));
            const k = this.kerbside(e, s, outDir);
            if (k) {
              const fromFaster = others.some((o) => o.edge.limit > e.limit);
              let code = `B14_${e.limit}`;
              if (e.living) code = 'B52';
              else if (e.limit === 30 && fromFaster) code = 'B30';
              else if (others.every((o) => o.edge.living) && !e.living) code = 'B53';
              this.sign(code, k.x, k.z, -k.tx, -k.tz, 2.3);
            }
          }
          // double-sens cyclable signalé à l'entrée du sens unique
          if (e.dsc && e.oneway && end.vertex.ends.length >= 3 && hash32('dsc' + e.id) % 2 === 0) {
            const s = end.sAt(Math.min(len * 0.45, end.trim + 9));
            const k = this.kerbside(e, s, outDir);
            if (k) this.sign('C24a_dsc', k.x, k.z, -k.tx, -k.tz, 2.3);
          }
        }
      }
      // ── passages piétons en section courante, sans feux ──
      for (const c of e.crossings) {
        if (c.signalized) continue;
        if (c.s < e.endA.trim + 18 || c.s > len - e.endB.trim - 18) continue;
        for (const dir of [1, -1] as const) {
          if (dir > 0 ? !e.lanesF.length : !e.lanesB.length) continue;
          const k = this.kerbside(e, c.s - dir * (c.halfLen + 0.6), dir);
          if (k) this.sign('C20a', k.x, k.z, -k.tx, -k.tz, 2.3);
        }
      }
    }
    // ── plaques de rue aux carrefours ──
    for (const v of net.vertices) {
      if (v.ends.length < 3) continue;
      const done = new Set<string>();
      for (const end of v.ends) {
        const e = end.edge;
        if (!e.name || done.has(e.name) || e.roundabout) continue;
        done.add(e.name);
        const s = end.sAt(Math.min(e.length * 0.45, end.trim + 0.8));
        const side: 1 | -1 = hash32(e.name + v.id) % 2 ? 1 : -1;
        const k = this.kerbside(e, s, side, 0.9);
        if (!k) continue;
        // plaque parallèle à la rue, lisible depuis la chaussée
        const p = e.line.at(s);
        const nx = -p.tz * side, nz = p.tx * side; // vers l'extérieur de la chaussée
        const paris = e.paris;
        const text = paris ? '20|' + e.name.toUpperCase() : e.name;
        this.sign(paris ? 'PLAQUE_PARIS' : 'PLAQUE_BANLIEUE', k.x, k.z, -nx, -nz, 2.55, text, true);
      }
    }
  }

  // ───────────────────────── feux tricolores ─────────────────────────
  private placeSignals() {
    const boxes: THREE.BufferGeometry[] = [];
    const poles: THREE.BufferGeometry[] = [];
    const lampM: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);

    const addLamp = (x: number, y: number, z: number, yaw: number, r: number, ctl: SignalController, group: number, role: Lamp['role']) => {
      q.setFromAxisAngle(Y, yaw); sc.set(r, r, r); pos.set(x, y, z);
      lampM.push(new THREE.Matrix4().compose(pos, q, sc));
      this.lamps.push({ index: lampM.length - 1, ctl, group, role });
    };
    const addBox = (x: number, y: number, z: number, yaw: number, w: number, h: number, d: number) => {
      const b = new THREE.BoxGeometry(w, h, d);
      m.makeRotationY(yaw); m.setPosition(x, y, z);
      b.applyMatrix4(m);
      boxes.push(b);
    };
    /** Poteau de feux tourné vers (fx, fz) — direction d'où vient le conducteur. */
    const signalPole = (x: number, z: number, fx: number, fz: number, ctl: SignalController, group: number) => {
      const y0 = KERB_H;
      const yaw = Math.atan2(fx, fz); // l'axe +Z local regarde vers le conducteur
      const pole = new THREE.CylinderGeometry(0.055, 0.065, 3.5, 10); pole.translate(x, y0 + 1.75, z);
      poles.push(pole);
      this.posts.push({ x, z, r: 0.09 });
      const ox = fx * 0.16, oz = fz * 0.16;
      // feu principal : caisson 0,30 × 0,96 × 0,22 entre 2,35 et 3,31 m
      addBox(x + ox, y0 + 2.85, z + oz, yaw, 0.3, 0.98, 0.2);
      // visières
      for (let i = 0; i < 3; i++) addBox(x + fx * 0.3, y0 + 3.27 - i * 0.3, z + fz * 0.3, yaw, 0.26, 0.02, 0.12);
      const lx = x + fx * 0.262, lz = z + fz * 0.262;
      addLamp(lx, y0 + 3.15, lz, yaw, 0.1, ctl, group, 'r');
      addLamp(lx, y0 + 2.85, lz, yaw, 0.1, ctl, group, 'y');
      addLamp(lx, y0 + 2.55, lz, yaw, 0.1, ctl, group, 'g');
      // répétiteur bas, à hauteur des yeux du conducteur arrêté à la ligne
      addBox(x + fx * 0.12, y0 + 1.45, z + fz * 0.12, yaw, 0.12, 0.36, 0.12);
      const rx = x + fx * 0.182, rz = z + fz * 0.182;
      addLamp(rx, y0 + 1.56, rz, yaw, 0.036, ctl, group, 'r');
      addLamp(rx, y0 + 1.45, rz, yaw, 0.036, ctl, group, 'y');
      addLamp(rx, y0 + 1.34, rz, yaw, 0.036, ctl, group, 'g');
    };
    /** Figurines piétons tournées vers (fx, fz). */
    const pedHead = (x: number, z: number, fx: number, fz: number, ctl: SignalController, group: number, withPole: boolean) => {
      const y0 = KERB_H;
      const yaw = Math.atan2(fx, fz);
      if (withPole) { const pole = new THREE.CylinderGeometry(0.045, 0.05, 2.7, 8); pole.translate(x, y0 + 1.35, z); poles.push(pole); this.posts.push({ x, z, r: 0.08 }); }
      addBox(x + fx * 0.14, y0 + 2.2, z + fz * 0.14, yaw, 0.22, 0.46, 0.16);
      const lx = x + fx * 0.222, lz = z + fz * 0.222;
      addLamp(lx, y0 + 2.31, lz, yaw, 0.075, ctl, group, 'pr');
      addLamp(lx, y0 + 2.09, lz, yaw, 0.075, ctl, group, 'pg');
    };

    const net = this.net;
    for (const e of net.edges) {
      // feux d'entrée de carrefour
      for (const end of [e.endA, e.endB]) {
        if (end.control !== 'signal' || !end.controller || !end.canArrive) continue;
        const dir: 1 | -1 = end.atA ? -1 : 1;
        const s = end.sAt(end.stopDist - 0.5);
        const k = this.kerbside(e, s, dir, 0.5);
        if (k) signalPole(k.x, k.z, -k.tx, -k.tz, end.controller, end.group);
        // chaussée large : second feu à gauche
        const arriving = end.arriving.length;
        if (arriving >= 2 || e.width > 11) {
          const p = e.line.at(s);
          const off = -(e.half + 0.5) * dir;
          const x = p.x - p.tz * off, z = p.z + p.tx * off;
          if (!this.ground.isRoad(x, z)) signalPole(x, z, -p.tx * dir, -p.tz * dir, end.controller, end.group);
        }
      }
      // feux en section courante
      for (const lane of e.allLanes) {
        if (lane.kind !== 'L' || lane.right) continue;
        for (const st of lane.stops) {
          if (st.kind !== 'signal' || st.atEnd || !st.controller) continue;
          const es = lane.toEdgeS(st.s);
          const k = this.kerbside(e, es + lane.dir * 0.5, lane.dir, 0.5);
          if (k) signalPole(k.x, k.z, -k.tx, -k.tz, st.controller, st.group ?? 0);
        }
      }
      // figurines piétons de part et d'autre des passages à feux
      for (const c of e.crossings) {
        if (!c.controller) continue;
        const p = e.line.at(c.s);
        for (const side of [1, -1] as const) {
          const off = (e.half + 0.75) * side;
          const x = p.x - p.tz * off + p.tx * (c.halfLen + 0.25) * side, z = p.z + p.tx * off + p.tz * (c.halfLen + 0.25) * side;
          if (this.ground.isRoad(x, z)) continue;
          // tournée vers le trottoir d'en face
          pedHead(x, z, p.tz * side, -p.tx * side, c.controller, c.group, true);
        }
      }
    }
    if (boxes.length) {
      const mesh = new THREE.Mesh(mergeGeometries(boxes)!, this.mats.plasticBlack);
      mesh.castShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
      const pm = new THREE.Mesh(mergeGeometries(poles)!, this.mats.metalDark);
      pm.castShadow = true; pm.frustumCulled = false;
      this.group.add(pm);
    }
    const disc = new THREE.CircleGeometry(1, 14);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.lampMesh = new THREE.InstancedMesh(disc, lampMat, Math.max(1, lampM.length));
    lampM.forEach((mm, i) => { this.lampMesh.setMatrixAt(i, mm); this.lampMesh.setColorAt(i, C_OFF); });
    this.lampMesh.frustumCulled = false;
    this.lampMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.lampMesh);
  }

  /** Met à jour l'allumage des feux. */
  update(time: number) {
    if (!this.lamps.length) return;
    let dirty = false;
    const cache = new Map<string, { car: SignalState; ped: boolean }>();
    for (const l of this.lamps) {
      const k = l.ctl.id + ':' + l.group;
      let st = cache.get(k);
      if (!st) cache.set(k, (st = { car: l.ctl.state(l.group, time), ped: l.ctl.pedWalk(l.group, time) }));
      const on = l.role === 'r' ? st.car === 'red' : l.role === 'y' ? st.car === 'yellow' : l.role === 'g' ? st.car === 'green' : l.role === 'pg' ? st.ped : !st.ped;
      const key = k + l.role + l.index;
      const prev = this.lastState.get(key);
      const cur = on ? '1' : '0';
      if (prev === cur) continue;
      this.lastState.set(key, cur);
      const col = !on ? C_OFF : l.role === 'r' || l.role === 'pr' ? C_RED : l.role === 'y' ? C_YEL : C_GRN;
      this.lampMesh.setColorAt(l.index, col);
      dirty = true;
    }
    if (dirty && this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;
  }

  // ───────────────────────── arbres, lampadaires, potelets ─────────────────────────
  private placeTrees() {
    for (const t of this.net.map.trees) {
      const [x, z, h, circ] = t;
      if (this.ground.isRoad(x, z)) continue;
      const seed = hash32(`${x}|${z}`);
      const r = (seed % 1000) / 1000;
      const height = h > 3 ? Math.min(22, h) : 7.5 + r * 6;
      const radius = circ > 20 ? Math.min(0.45, circ / 100 / (2 * Math.PI)) : 0.14 + r * 0.1;
      this.push(this.treesByChunk, x, z, [x, z, height, radius, r]);
      this.posts.push({ x, z, r: radius + 0.05 });
    }
  }

  private placeLamps() {
    const m = new THREE.Matrix4();
    const add = (x: number, z: number, yaw: number) => {
      const k = this.key(x, z);
      let a = this.lampsByChunk.get(k);
      if (!a) this.lampsByChunk.set(k, (a = { m: [] }));
      m.makeRotationY(yaw); m.setPosition(x, KERB_H, z);
      a.m.push(...m.elements);
      this.posts.push({ x, z, r: 0.12 });
    };
    for (const e of this.net.edges) {
      if (e.cls === 'service') continue;
      const len = e.length;
      const s0 = e.endA.trim + 6, s1 = len - e.endB.trim - 6;
      if (s1 - s0 < 10) continue;
      const step = e.width > 9 ? 26 : 30;
      const n = Math.max(1, Math.floor((s1 - s0) / step));
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * (i + 0.5)) / (n + 1);
        // alternance des côtés ; en vis-à-vis sur les grands axes
        const sides: (1 | -1)[] = e.width > 12 ? [1, -1] : [(i + e.id) % 2 ? 1 : -1];
        for (const side of sides) {
          const k = this.kerbside(e, s, side, 0.75);
          if (!k) continue;
          // évite les passages piétons
          if (e.crossings.some((c) => Math.abs(c.s - s) < c.halfLen + 1.5)) continue;
          const p = e.line.at(s);
          // la crosse est tournée vers la chaussée
          const toRoadX = p.tz * side, toRoadZ = -p.tx * side;
          add(k.x, k.z, Math.atan2(-toRoadZ, toRoadX));
        }
      }
    }
  }

  private placeBollards() {
    const m = new THREE.Matrix4();
    const add = (x: number, z: number) => {
      if (this.ground.isRoad(x, z)) return;
      const k = this.key(x, z);
      let a = this.bollardsByChunk.get(k);
      if (!a) this.bollardsByChunk.set(k, (a = { m: [] }));
      m.makeTranslation(x, KERB_H, z);
      a.m.push(...m.elements);
      this.posts.push({ x, z, r: 0.07 });
    };
    for (const c of this.net.crossings) {
      const e = c.edge;
      if (!e.paris && e.cls === 'residential' && hash32('b' + c.id) % 3) continue;
      const p = e.line.at(c.s);
      for (const side of [1, -1]) {
        const off = (e.half + 0.38) * side;
        // deux potelets de chaque côté du passage, qui empêchent le stationnement
        for (const along of [-(c.halfLen + 0.5), -(c.halfLen + 1.8), c.halfLen + 0.5, c.halfLen + 1.8]) {
          add(p.x - p.tz * off + p.tx * along, p.z + p.tx * off + p.tz * along);
        }
      }
    }
  }

  // ───────────────────────── construction par dalle ─────────────────────────
  /** Ajoute au groupe de la dalle son mobilier. */
  populateChunk(key: string, group: THREE.Group) {
    // panneaux
    const signs = this.signsByChunk.get(key);
    if (signs) {
      const face = new GeoBuilder(), plate = new GeoBuilder(), back = new GeoBuilder(), pole = new GeoBuilder();
      const poleSeen = new Set<string>();
      for (const s of signs) {
        const info = SIGNS[s.code] ?? { w: 0.6, h: 0.6 };
        const cell = (s.plate ? this.plateAtlas : this.signAtlas).get(s.code, s.text);
        const w = info.w, h = info.h;
        // repère du panneau : normale (fx,fz), droite = normale tournée
        const rx = s.fz, rz = -s.fx;
        const cy = KERB_H + s.y + h / 2;
        const cx = s.x + s.fx * 0.05, cz = s.z + s.fz * 0.05;
        const g = s.plate ? plate : face;
        const a = g.vertex(cx - rx * w / 2, cy - h / 2, cz - rz * w / 2, s.fx, 0, s.fz, cell.u0, cell.v0);
        const b = g.vertex(cx + rx * w / 2, cy - h / 2, cz + rz * w / 2, s.fx, 0, s.fz, cell.u1, cell.v0);
        const c = g.vertex(cx + rx * w / 2, cy + h / 2, cz + rz * w / 2, s.fx, 0, s.fz, cell.u1, cell.v1);
        const d = g.vertex(cx - rx * w / 2, cy + h / 2, cz - rz * w / 2, s.fx, 0, s.fz, cell.u0, cell.v1);
        g.quadIdx(a, b, c, d);
        // dos gris (légèrement en retrait, un peu plus petit pour rester dans la silhouette)
        const k = 0.86, bx = s.x + s.fx * 0.04, bz = s.z + s.fz * 0.04;
        const a2 = back.vertex(bx - rx * w * k / 2, cy - h * k / 2, bz - rz * w * k / 2, -s.fx, 0, -s.fz, 0, 0);
        const b2 = back.vertex(bx + rx * w * k / 2, cy - h * k / 2, bz + rz * w * k / 2, -s.fx, 0, -s.fz, 1, 0);
        const c2 = back.vertex(bx + rx * w * k / 2, cy + h * k / 2, bz + rz * w * k / 2, -s.fx, 0, -s.fz, 1, 1);
        const d2 = back.vertex(bx - rx * w * k / 2, cy + h * k / 2, bz - rz * w * k / 2, -s.fx, 0, -s.fz, 0, 1);
        back.quadIdx(a2, d2, c2, b2);
        // poteau (un par emplacement)
        const pk = `${s.x.toFixed(1)},${s.z.toFixed(1)}`;
        if (!poleSeen.has(pk)) {
          poleSeen.add(pk);
          const top = KERB_H + s.y + h + 0.05;
          boxPost(pole, s.x, s.z, KERB_H, top, 0.03);
          this.posts.push({ x: s.x, z: s.z, r: 0.06 });
        }
      }
      const add = (g: GeoBuilder, mat: THREE.Material) => { if (g.empty) return; const mesh = new THREE.Mesh(g.build(), mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; group.add(mesh); };
      add(face, this.signMat); add(plate, this.plateMat); add(back, this.mats.metalGrey); add(pole, this.mats.metalGrey);
    }
    // arbres
    const trees = this.treesByChunk.get(key);
    if (trees) {
      const trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, trees.length);
      const crowns = new THREE.InstancedMesh(this.crownGeo, this.crownMat, trees.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      const col = new THREE.Color();
      trees.forEach((t, i) => {
        const [x, z, h, r, rnd] = t;
        const trunkH = h * 0.42;
        m.compose(p.set(x, KERB_H, z), q.identity(), s.set(r, trunkH, r));
        trunks.setMatrixAt(i, m);
        const cr = h * (0.3 + rnd * 0.08);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd * 6.28);
        m.compose(p.set(x, KERB_H + trunkH + cr * 0.55, z), q, s.set(cr, cr * 1.05, cr));
        crowns.setMatrixAt(i, m);
        col.setHSL(0.24 + rnd * 0.07, 0.3, 0.5 + ((rnd * 7) % 1) * 0.22);
        crowns.setColorAt(i, col);
      });
      trunks.castShadow = true; trunks.receiveShadow = true;
      crowns.castShadow = true; crowns.receiveShadow = true;
      crowns.customDepthMaterial = this.crownDepth;
      trunks.computeBoundingSphere(); crowns.computeBoundingSphere();
      group.add(trunks, crowns);
    }
    // lampadaires
    const lamps = this.lampsByChunk.get(key);
    if (lamps) {
      const n = lamps.m.length / 16;
      const mesh = new THREE.InstancedMesh(this.lampGeo, this.mats.metalDark, n);
      mesh.instanceMatrix.array.set(lamps.m);
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    // potelets
    const bol = this.bollardsByChunk.get(key);
    if (bol) {
      const n = bol.m.length / 16;
      const mesh = new THREE.InstancedMesh(this.bollardGeo, this.bollardMat, n);
      mesh.instanceMatrix.array.set(bol.m);
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
}

function boxPost(g: GeoBuilder, x: number, z: number, y0: number, y1: number, r: number) {
  const faces: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (const [nx, nz] of faces) {
    const tx = -nz, tz = nx;
    const a = g.vertex(x + nx * r - tx * r, y0, z + nz * r - tz * r, nx, 0, nz, 0, 0);
    const b = g.vertex(x + nx * r + tx * r, y0, z + nz * r + tz * r, nx, 0, nz, 1, 0);
    const c = g.vertex(x + nx * r + tx * r, y1, z + nz * r + tz * r, nx, 0, nz, 1, 1);
    const d = g.vertex(x + nx * r - tx * r, y1, z + nz * r - tz * r, nx, 0, nz, 0, 1);
    // orientation vers l'extérieur
    const ux = tx * 2 * r, uz = tz * 2 * r;
    const cy = uz * 0 - 0 * 0; void cy;
    const crossX = 0 * 0 - uz * (y1 - y0), crossZ = ux * (y1 - y0) - 0;
    if (crossX * nx + crossZ * nz >= 0) g.quadIdx(a, b, c, d); else g.quadIdx(a, d, c, b);
  }
}

/** Texture de feuillage (alpha) : amas de petites feuilles. */
function foliageTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const rng = new Rng(2024);
  c.clearRect(0, 0, S, S);
  // amas de petites feuilles : sombres au cœur, plus claires en périphérie
  for (let i = 0; i < 2600; i++) {
    const a = rng.next() * Math.PI * 2, r = Math.pow(rng.next(), 0.62) * S * 0.48;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const shade = r / (S * 0.48);
    const l = (17 + rng.next() * 16) * (0.6 + 0.6 * shade), sz = 2.6 + rng.next() * 3.6;
    c.fillStyle = `hsl(${92 + rng.next() * 30}, ${30 + rng.next() * 18}%, ${l}%)`;
    c.beginPath();
    c.ellipse(x, y, sz, sz * 0.5, rng.next() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
