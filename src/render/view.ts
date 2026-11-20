// Point de vue du joueur : habitacle (vue conducteur, regard, rétroviseurs réels par rendu
// dans des textures), vue capot et vue extérieure. Gère aussi la carrosserie visible de l'extérieur.

import * as THREE from 'three';
import { createCarVisual, createCockpit, type CarVisual, type Cockpit } from './car-model';
import type { Player } from '../game/player';
import type { InputState } from '../input/controls';
import { clamp, damp, DEG } from '../core/math';

export type ViewMode = 'cockpit' | 'capot' | 'poursuite';
export const VIEW_LABELS: Record<ViewMode, string> = { cockpit: 'Vue conducteur', capot: 'Vue capot', poursuite: 'Vue extérieure' };

const LAYER_COCKPIT = 1;
const LAYER_EXTERIOR = 2;

interface Mirror {
  mesh: THREE.Mesh;
  rt: THREE.WebGLRenderTarget;
  cam: THREE.PerspectiveCamera;
  /** facteur de rapprochement de l'œil (miroir bombé : champ plus large) */
  convex: number;
  hw: number; hh: number;
  center: THREE.Vector3;
}

function setLayer(o: THREE.Object3D, layer: number) { o.traverse((c) => c.layers.set(layer)); }

export class PlayerView {
  readonly camera: THREE.PerspectiveCamera;
  mode: ViewMode = 'cockpit';
  fov = 60;
  /** amplitude du regard automatique vers l'intérieur des virages (0..1) */
  lookIntoTurns = 0.55;
  mirrorsEnabled = true;
  /** nombre de rétroviseurs rafraîchis par image */
  mirrorRate = 1;
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly cockpit: Cockpit;
  readonly exterior: CarVisual;
  private head = new THREE.Group();
  private mirrors: Mirror[] = [];
  private mirrorIndex = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private chaseYaw = 0;
  private headOffset = new THREE.Vector3();
  private readonly cgShift: number;
  private tmp = new THREE.Vector3();
  private gaugeTimer = 0;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.08, 1800);
    this.exterior = createCarVisual('citadine', 0xb9bec4);
    this.cockpit = createCockpit();
    const d = this.exterior.dims;
    // le centre de gravité est en avant du milieu de l'empattement
    this.cgShift = d.wheelbase / 2 - 1.02;
    this.root.add(this.body);
    // la carrosserie extérieure : son groupe « body » suit la caisse, ses roues restent au sol
    this.root.add(this.exterior.group);
    this.body.add(this.cockpit.group);
    this.head.position.copy(this.cockpit.eye);
    this.body.add(this.head);
    setLayer(this.cockpit.group, LAYER_COCKPIT);
    setLayer(this.exterior.group, LAYER_EXTERIOR);
    scene.add(this.root);
    scene.add(this.camera);
    this.camera.layers.enable(LAYER_COCKPIT);

    const mk = (mesh: THREE.Mesh, w: number, h: number, convex: number) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
      rt.texture.wrapS = THREE.RepeatWrapping;
      rt.texture.repeat.x = -1; rt.texture.offset.x = 1; // image miroir
      rt.texture.minFilter = THREE.LinearFilter;
      const mat = new THREE.MeshBasicMaterial({ map: rt.texture, color: new THREE.Color(0.84, 0.86, 0.88) });
      mesh.material = mat;
      mesh.layers.set(LAYER_COCKPIT);
      const cam = new THREE.PerspectiveCamera();
      cam.matrixAutoUpdate = false;
      cam.layers.enable(LAYER_EXTERIOR);
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox!;
      const center = bb.getCenter(new THREE.Vector3());
      this.mirrors.push({ mesh, rt, cam, convex, hw: (bb.max.x - bb.min.x) / 2, hh: (bb.max.y - bb.min.y) / 2, center });
    };
    mk(this.cockpit.mirrors.center, 640, 192, 1);
    mk(this.cockpit.mirrors.left, 448, 288, 0.5);
    mk(this.cockpit.mirrors.right, 448, 288, 0.42);
  }

  setAspect(aspect: number) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  cycle(): ViewMode {
    const order: ViewMode[] = ['cockpit', 'capot', 'poursuite'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
    return this.mode;
  }

  update(dt: number, player: Player, input: InputState, limitKmh: number) {
    const c = player.car;
    const fx = c.forwardX, fz = c.forwardZ;
    this.root.position.set(c.x - fx * this.cgShift, 0, c.z - fz * this.cgShift);
    this.root.rotation.y = -c.heading;
    // caisse : tangage (piqué positif), roulis, pompage
    this.body.rotation.x = -c.pitch;
    this.body.rotation.z = c.roll;
    this.body.position.y = c.heave;
    const ex = this.exterior;
    ex.body.rotation.x = -c.pitch; ex.body.rotation.z = c.roll; ex.body.position.y = c.heave;
    const R = c.spec.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const w = ex.wheels[i];
      w.position.y = R + c.groundH[i];
      w.rotation.y = i < 2 ? -c.steerWheelAngle[i] : 0;
      const spin = w.children[0];
      if (spin) spin.rotation.x = -c.wheelAngle[i];
    }
    ex.setLights({ brake: c.brakePressure > 0.03, left: player.leftOn, right: player.rightOn, reverse: c.gear === -1, head: player.lights });

    // volant et instruments
    this.cockpit.steeringWheel.rotation.z = -input.steer * c.spec.steeringWheelLockDeg * DEG;
    this.gaugeTimer -= dt;
    if (this.gaugeTimer <= 0) {
      this.gaugeTimer = 1 / 30;
      const gear = c.mode === 'auto' ? (c.selector === 'D' ? `D${Math.max(1, c.gear)}` : c.selector) : c.gear === 0 ? 'N' : c.gear < 0 ? 'R' : String(c.gear);
      let hint: -1 | 0 | 1 = 0;
      if (c.mode === 'manual' && c.engineRunning && c.gear > 0) {
        if (c.rpm > 2700 && c.gear < c.spec.gears.length && c.throttleEff > 0.1) hint = 1;
        else if (c.rpm < 1150 && c.gear > 1) hint = -1;
      }
      this.cockpit.setGauges({
        speedKmh: Math.abs(c.vx) * 3.6, rpm: c.rpm, gear, left: player.leftOn, right: player.rightOn,
        handbrake: player.handbrake, seatbelt: !player.seatbelt, engineOn: c.engineRunning, stalled: c.ignition && !c.engineRunning,
        lights: player.lights, shiftHint: hint, limitKmh,
      });
    }

    // ── regard ──
    let yawT = 0, pitchT = 0;
    const L = input.held.has('lookLeft'), Rr = input.held.has('lookRight'), B = input.held.has('lookBack');
    if (B || (L && Rr)) { yawT = -150 * DEG; }
    else if (L) yawT = 78 * DEG;
    else if (Rr) yawT = -78 * DEG;
    else {
      // le conducteur regarde vers l'intérieur du virage
      const sp = clamp(Math.abs(c.vx) / 4, 0, 1);
      yawT = -clamp(input.steer * 1.6, -1, 1) * 30 * DEG * this.lookIntoTurns * sp;
      if (c.gear === -1 && Math.abs(c.vx) > 0.2) pitchT = 0;
    }
    this.lookYaw = damp(this.lookYaw, yawT, L || Rr || B ? 14 : 5, dt);
    this.lookPitch = damp(this.lookPitch, pitchT, 6, dt);

    const cam = this.camera;
    if (cam.fov !== this.fov) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    cam.layers.disable(LAYER_COCKPIT); cam.layers.disable(LAYER_EXTERIOR);
    if (this.mode === 'cockpit') {
      cam.layers.enable(LAYER_COCKPIT);
      // la tête se penche un peu quand on regarde sur le côté, et subit les accélérations
      const lean = Math.sin(this.lookYaw);
      this.headOffset.x = damp(this.headOffset.x, -lean * 0.07 - clamp(c.ay * 0.004, -0.03, 0.03), 6, dt);
      this.headOffset.z = damp(this.headOffset.z, -Math.abs(lean) * 0.05 + clamp(c.ax * 0.004, -0.04, 0.04), 6, dt);
      this.head.position.copy(this.cockpit.eye).add(this.headOffset);
      this.head.updateWorldMatrix(true, false);
      this.root.updateWorldMatrix(true, true);
      cam.position.setFromMatrixPosition(this.head.matrixWorld);
      // orientation : caisse (cap + tangage/roulis atténués) puis regard
      const q = new THREE.Quaternion();
      this.body.getWorldQuaternion(q);
      cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ')));
    } else if (this.mode === 'capot') {
      this.root.updateWorldMatrix(true, true);
      this.tmp.set(0, 1.18, -0.75).applyMatrix4(this.body.matrixWorld);
      cam.position.copy(this.tmp);
      const q = new THREE.Quaternion();
      this.body.getWorldQuaternion(q);
      cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.lookYaw, 0, 'YXZ')));
    } else {
      cam.layers.enable(LAYER_EXTERIOR);
      this.root.updateWorldMatrix(true, true);
      this.chaseYaw = damp(this.chaseYaw, -c.heading + this.lookYaw * 1.2, 5, dt);
      const dist = 6.4, h = 2.3;
      cam.position.set(this.root.position.x + Math.sin(this.chaseYaw) * dist, h, this.root.position.z + Math.cos(this.chaseYaw) * dist);
      cam.lookAt(this.root.position.x, 1.1, this.root.position.z);
    }
    cam.updateMatrixWorld();
  }

  /** Rend les rétroviseurs (à appeler avant le rendu principal). */
  renderMirrors() {
    if (!this.mirrorsEnabled || this.mode !== 'cockpit') return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    for (let k = 0; k < this.mirrorRate; k++) {
      const mir = this.mirrors[this.mirrorIndex];
      this.mirrorIndex = (this.mirrorIndex + 1) % this.mirrors.length;
      mir.mesh.updateWorldMatrix(true, false);
      const M = mir.mesh.matrixWorld;
      const right = new THREE.Vector3().setFromMatrixColumn(M, 0).normalize();
      const up = new THREE.Vector3().setFromMatrixColumn(M, 1).normalize();
      const n = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize();
      const c = mir.center.clone().applyMatrix4(M);
      const sx = new THREE.Vector3().setFromMatrixColumn(M, 0).length(), sy = new THREE.Vector3().setFromMatrixColumn(M, 1).length();
      const hw = mir.hw * sx, hh = mir.hh * sy;
      // œil (éventuellement rapproché pour simuler un miroir bombé), puis symétrique par rapport au plan
      const e = c.clone().add(eye.clone().sub(c).multiplyScalar(mir.convex));
      let d = e.clone().sub(c).dot(n);
      if (d < 0.02) continue; // l'œil est derrière le miroir
      const ep = e.clone().addScaledVector(n, -2 * d);
      const rel = c.clone().sub(ep);
      const cx = -rel.dot(right), cy = rel.dot(up);
      const cam = mir.cam;
      const xc = right.clone().negate(), zc = n.clone().negate();
      cam.matrix.makeBasis(xc, up, zc).setPosition(ep);
      cam.matrixWorldNeedsUpdate = true;
      cam.updateMatrixWorld(true);
      const near = d, far = 260;
      cam.projectionMatrix.makePerspective(cx - hw, cx + hw, cy + hh, cy - hh, near, far);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      r.setRenderTarget(mir.rt);
      r.clear();
      r.render(this.scene, cam);
    }
    r.setRenderTarget(prevTarget);
  }
}
