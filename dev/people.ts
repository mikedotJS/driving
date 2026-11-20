// Page de contrôle visuel des piétons, cyclistes et trottinettes (voir dev/README.md).
//
// Paramètres d'URL :
//   cx=<m>, w=<m> centre et largeur visibles pour cam=side|front ; cy=<m> hauteur de la caméra
//   t=<s>       fige le temps d'animation (comparaison de phases du cycle de marche)
//   cam=side|front|back|close|bike|scooter|top
//   n=<nombre>  piétons de la rangée (14 par défaut) ; crowd=<nombre> ajoute une foule en grille
//   focus=<i>   piéton visé par cam=close ; seed0=<graine> ; v=<m/s> impose la vitesse de tous
//   move=1      les piétons avancent réellement (vérifie que les pieds ne glissent pas)
//   sync=1      supprime le décalage de cycle propre à chaque piéton
//   shade=1     ajoute une dalle qui projette son ombre sur une partie de la rangée
//   lean=<rad>  roulis imposé aux deux-roues (positif = penché à droite)
//   hud=0       masque le bandeau
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PedestrianCrowd, createCyclist, createScooterRider } from '../src/render/people';
import type { RiderVisual } from '../src/render/people';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const frozen = q.has('t');
const cam = q.get('cam') ?? 'side';
const n = Math.max(1, Math.floor(num('n', 14)));
const crowdN = Math.max(0, Math.floor(num('crowd', 0)));
const focus = Math.floor(num('focus', 6));
const seed0 = num('seed0', 1);
const move = q.get('move') === '1';
const forcedSpeed = q.has('v') ? num('v', 1.4) : null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c4dc);
scene.add(new THREE.HemisphereLight(0xcfe0f5, 0x6b6a66, 1.25));
const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
sun.position.set(5, 11, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -13;
sun.shadow.camera.right = 13;
sun.shadow.camera.top = 5;
sun.shadow.camera.bottom = -5;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// sol quadrillé (0,5 m) pour juger du glissement des pieds
{
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#8f9092';
  c.fillRect(0, 0, 128, 128);
  c.strokeStyle = '#7b7c7f';
  c.lineWidth = 2;
  c.strokeRect(0, 0, 128, 128);
  c.strokeStyle = '#86878a';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(64, 0);
  c.lineTo(64, 128);
  c.moveTo(0, 64);
  c.lineTo(128, 64);
  c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 40);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

// shade=1 : dalle flottante qui met à l'ombre la moitié gauche de la rangée (test des ombres reçues)
if (q.get('shade') === '1') {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0x6f7378 }));
  slab.position.set(-1.5, 4.2, 2.6);
  slab.castShadow = true;
  scene.add(slab);
}

// ── piétons ──────────────────────────────────────────────────────────────────
const SPEEDS = [1.4, 1.4, 0, 1.4, 3.0, 1.4, 1.0, 0, 1.8, 3.2, 1.4, 0, 1.4, 4.0];
const heading = cam === 'front' ? Math.PI : cam === 'back' ? 0 : Math.PI / 2; // de face : vers la caméra (+Z) ; de dos : −Z ; de profil : vers +X
const crowd = new PedestrianCrowd(n + crowdN);
crowd.phaseJitter = q.get('sync') !== '1';
scene.add(crowd.mesh);
interface Walker {
  id: number;
  x: number;
  z: number;
  speed: number;
  heading: number;
}
const walkers: Walker[] = [];
const spacing = 0.95;
for (let i = 0; i < n; i++) {
  walkers.push({
    id: crowd.add(seed0 + i),
    x: (i - (n - 1) / 2) * spacing,
    z: 0,
    speed: forcedSpeed ?? SPEEDS[i % SPEEDS.length],
    heading,
  });
}
// remove=3,5 : libère ces piétons (test de remove())
for (const k of (q.get('remove') ?? '').split(',').filter((v) => v !== '')) crowd.remove(walkers[Number(k)].id);
for (let i = 0; i < crowdN; i++) {
  const col = i % 20;
  const row = Math.floor(i / 20);
  walkers.push({
    id: crowd.add(seed0 + 100 + i),
    x: (col - 9.5) * 1.1,
    z: -3 - row * 1.6,
    speed: forcedSpeed ?? [1.2, 1.5, 0, 1.4, 3.1][(i * 7) % 5],
    heading: i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2,
  });
}

// ── usagers ──────────────────────────────────────────────────────────────────
interface Rider {
  vis: RiderVisual;
  speed: number;
  lean: number;
}
const riders: Rider[] = [];
const half = ((n - 1) / 2) * spacing;
const addRider = (vis: RiderVisual, x: number, speed: number, lean = 0): void => {
  vis.group.position.set(x, 0, 0);
  vis.group.rotation.y = -heading;
  scene.add(vis.group);
  riders.push({ vis, speed, lean });
};
addRider(createCyclist(seed0 + 3), -half - 1.7, 4.5);
addRider(createCyclist(seed0 + 8), -half - 3.9, 0);
addRider(createScooterRider(seed0 + 2), half + 1.5, 5.5);
addRider(createScooterRider(seed0 + 5), half + 3.2, 0);

// ── caméra ───────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
const target = new THREE.Vector3(0, 0.95, 0);
const fx = walkers[clampIndex(focus)].x;
function clampIndex(i: number): number {
  return Math.min(n - 1, Math.max(0, i));
}
if (cam === 'close') {
  camera.fov = 32;
  camera.position.set(fx + 0.9, 1.5, 4.6);
  target.set(fx, 0.95, 0);
} else if (cam === 'bike') {
  camera.fov = 32;
  camera.position.set(-half - 2.2, 1.45, 5.6);
  target.set(-half - 2.8, 0.85, 0);
} else if (cam === 'scooter') {
  camera.fov = 32;
  camera.position.set(half + 2.9, 1.45, 5.2);
  target.set(half + 2.35, 0.85, 0);
} else if (cam === 'top') {
  camera.position.set(0, 16, 9);
  target.set(0, 0.5, -2);
} else {
  // side / front : cx = centre visé (m), w = largeur visible (m)
  const width = num('w', 2 * half + 9.5);
  const cx = num('cx', 0);
  const dist = width / 2 / Math.tan((camera.fov * Math.PI) / 360) / (innerWidth / innerHeight);
  camera.position.set(cx, num('cy', 1.7), dist);
  target.set(cx, 0.95, 0);
}
camera.updateProjectionMatrix();
camera.lookAt(target);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.update();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const hud = document.getElementById('hud') as HTMLElement;
if (q.get('hud') === '0') hud.style.display = 'none';

function frame(time: number): void {
  for (const w of walkers) {
    const dist = w.speed * time;
    const fwd = move ? dist : 0;
    crowd.set(w.id, w.x + Math.sin(w.heading) * fwd, w.z - Math.cos(w.heading) * fwd, 0, w.heading, dist, w.speed);
  }
  crowd.commit(time);
  for (const r of riders) r.vis.update(r.speed * time, r.speed, r.lean + num('lean', 0));
  renderer.render(scene, camera);
}

let first = true;
const t0 = performance.now();
function loop(): void {
  const time = frozen ? num('t', 0) : (performance.now() - t0) / 1000;
  frame(time);
  if (first) {
    first = false;
    const info = {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      pedestrianTriangles: crowd.trianglesPerInstance,
      cyclistTriangles: riders[0].vis.group.userData.triangles as number,
      scooterTriangles: riders[2].vis.group.userData.triangles as number,
      pedestrians: walkers.length,
    };
    (window as unknown as { __info: unknown }).__info = info;
    hud.textContent = `piéton ${info.pedestrianTriangles} tri · cycliste ${info.cyclistTriangles} tri · trottinette ${info.scooterTriangles} tri · ${info.calls} draw calls · t=${time.toFixed(2)} s`;
    (window as unknown as { __ready: boolean }).__ready = true;
  }
  if (!frozen) requestAnimationFrame(loop);
  else setTimeout(() => frame(time), 200);
}
requestAnimationFrame(loop);
