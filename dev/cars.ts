// Page de mise au point des véhicules : ?view=exterior | detail&kind=…&az=…&el=… | cockpit&look=left|right&steer=…
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCarVisual, createCockpit, CAR_COLORS, CAR_DIMS, type CarKind } from '../src/render/car-model';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const view = q.get('view') ?? 'exterior';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c0d6);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.85;
const sun = new THREE.DirectionalLight(0xfff2de, 2.6);
sun.position.set(-9, 16, -7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, new THREE.HemisphereLight(0xcfe0f5, 0x6a6258, 0.5));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4b4d50, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.PerspectiveCamera(num('fov', 35), innerWidth / innerHeight, 0.03, 600);
const info: Record<string, unknown> = {};
const stats = (o: THREE.Object3D): { tris: number; calls: number } => {
  let tris = 0, calls = 0;
  o.traverse((m) => { const g = (m as THREE.Mesh).geometry; if ((m as THREE.Mesh).isMesh && g) { calls++; tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3; } });
  return { tris, calls };
};
const parts = (o: THREE.Object3D): number[] => {
  const r: number[] = [];
  o.traverse((m) => { const g = (m as THREE.Mesh).geometry; if ((m as THREE.Mesh).isMesh && g) r.push((g.index ? g.index.count : g.getAttribute('position').count) / 3); });
  return r;
};
const orbit = (target: THREE.Vector3, dist: number): void => {
  const az = (num('az', 35) * Math.PI) / 180, el = (num('el', 14) * Math.PI) / 180, d = num('dist', dist);
  camera.position.set(target.x + d * Math.sin(az) * Math.cos(el), target.y + d * Math.sin(el), target.z - d * Math.cos(az) * Math.cos(el));
  camera.lookAt(target);
};
const lights = { brake: q.has('brake'), left: q.has('left'), right: q.has('right'), reverse: q.has('reverse'), head: q.has('head') };
const KINDS: CarKind[] = ['citadine', 'berline', 'suv', 'utilitaire', 'bus'];

function card(label: string, w: number, h: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, '#c0392b'); grad.addColorStop(1, '#2471a3');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f1c40f'; g.fillRect(0, 0, w, h * 0.12);
  g.fillStyle = '#fff'; g.font = `bold ${h * 0.4}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`G ${label} D`, w / 2, h * 0.56);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

if (view === 'cockpit') {
  const cp = createCockpit();
  scene.add(cp.group);
  info.cockpit = stats(cp.group);
  camera.fov = num('fov', 62); camera.updateProjectionMatrix();
  camera.position.copy(cp.eye);
  const yaw = ((q.get('look') === 'left' ? 60 : q.get('look') === 'right' ? -60 : num('yaw', 0)) * Math.PI) / 180, pitch = (num('pitch', 0) * Math.PI) / 180;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  cp.steeringWheel.rotation.z = (-num('steer', 0) * Math.PI) / 180;
  cp.setGauges({ speedKmh: num('speed', 0), rpm: num('rpm', 850), gear: q.get('gear') ?? 'N', left: q.has('left'), right: q.has('right'), handbrake: q.has('hb'), seatbelt: q.has('belt'), engineOn: !q.has('off'), stalled: q.has('stalled'), lights: q.has('head'), shiftHint: num('hint', 0) as -1 | 0 | 1, limitKmh: num('limit', 50) });
  if (q.has('wipe')) cp.setWipers?.(num('wipe', 0));
  if (q.has('color')) cp.setBodyColor?.(Number(q.get('color')));
  (cp.mirrors.left.material as THREE.MeshBasicMaterial).map = card('L', 256, 160);
  (cp.mirrors.center.material as THREE.MeshBasicMaterial).map = card('C', 512, 128);
  (cp.mirrors.right.material as THREE.MeshBasicMaterial).map = card('R', 256, 160);
  (cp.screen.material as THREE.MeshBasicMaterial).map = card('GPS', 512, 288);
  for (const m of [cp.mirrors.left, cp.mirrors.center, cp.mirrors.right, cp.screen]) { const mt = m.material as THREE.MeshBasicMaterial; mt.color.set(0xffffff); mt.needsUpdate = true; }
  // route simple : chaussée, marquages, trottoirs, quelques véhicules et poteaux
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 300), new THREE.MeshStandardMaterial({ color: 0x2f3134, roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2; road.position.set(1.3, 0.01, -120); road.receiveShadow = true; scene.add(road);
  const white = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  for (let i = 0; i < 40; i++) { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 3), white); d.rotation.x = -Math.PI / 2; d.position.set(1.75, 0.02, -4 - i * 7.5); scene.add(d); }
  for (const x of [-2.2, 4.8]) { const k = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 300), new THREE.MeshStandardMaterial({ color: 0x8b8d8f, roughness: 0.9 })); k.position.set(x - (x < 0 ? 1.2 : -1.2), 0.07, -120); k.receiveShadow = true; scene.add(k); }
  for (let i = 0; i < 12; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6, 8), new THREE.MeshStandardMaterial({ color: 0x555a5e })); p.position.set(i % 2 ? -2.8 : 5.4, 3, -8 - i * 14); p.castShadow = true; scene.add(p); }
  const ahead = createCarVisual('berline', 0x1d3b6e); ahead.group.position.set(0, 0, -11); ahead.setLights({ ...lights, brake: true }); scene.add(ahead.group);
  const onc = createCarVisual('suv', 0xf3f3f1); onc.group.position.set(3.5, 0, -22); onc.group.rotation.y = Math.PI; scene.add(onc.group);
  const bus = createCarVisual('bus', 0xe9edf0); bus.group.position.set(3.6, 0, -48); bus.group.rotation.y = Math.PI; scene.add(bus.group);
  sun.target.position.set(0, 0, -10); scene.add(sun.target);
} else if (view === 'detail') {
  const kind = (q.get('kind') ?? 'citadine') as CarKind;
  const car = createCarVisual(kind, q.has('color') ? Number(q.get('color')) : 0xb7babd);
  car.setLights(lights);
  car.wheels[0].rotation.y = car.wheels[1].rotation.y = (num('steer', 0) * Math.PI) / 180;
  scene.add(car.group);
  info[kind] = stats(car.group); info.parts = parts(car.group);
  orbit(new THREE.Vector3(0, CAR_DIMS[kind].height * 0.42, num('tz', 0)), CAR_DIMS[kind].length * 1.9);
} else {
  KINDS.forEach((kind, i) => {
    const car = createCarVisual(kind, kind === 'bus' ? 0xe9edf0 : kind === 'utilitaire' ? 0xf3f3f1 : [0x9b1620, 0x7f8387, 0x1d3b6e][i]);
    car.group.position.set(kind === 'bus' ? 0.5 : (i - 1.5) * 2.9, 0, kind === 'bus' ? 7.5 : 0);
    if (kind === 'bus') car.group.rotation.y = Math.PI / 2;
    if (q.has('nobus') && kind === 'bus') car.group.visible = false;
    car.setLights(lights);
    scene.add(car.group);
    info[kind] = stats(car.group);
  });
  void CAR_COLORS;
  orbit(new THREE.Vector3(0, 0.9, q.has('nobus') ? 0 : 2.5), 17);
}
(window as unknown as { __info: unknown }).__info = info;
let frames = 0;
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  if (++frames === 2) (window as unknown as { __ready: boolean }).__ready = true;
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
