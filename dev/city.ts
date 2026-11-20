// Page de mise au point du décor : ?x=&z=&h=(cap en degrés)&y=(hauteur œil)&pitch=&edge=<nom de rue>&fov=
import * as THREE from 'three';
import { RoadNet, type MapFile } from '../src/map/roadnet';
import { MaterialLib } from '../src/render/materials';
import { Sky } from '../src/render/sun';
import { City } from '../src/world/city';
import { Ground } from '../src/world/ground';
import { Props } from '../src/world/props';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? parseFloat(q.get(k)!) : d);
const hud = document.getElementById('hud')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 0.62);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbfd0e0, 0.0016);
const camera = new THREE.PerspectiveCamera(num('fov', 62), innerWidth / innerHeight, 0.15, 2500);

const t0 = performance.now();
const map = (await (await fetch('maps/montreuil.json')).json()) as MapFile;
const net = new RoadNet(map);
const mats = new MaterialLib();
const sky = new Sky(scene, renderer, { shadows: q.get('shadows') !== '0' });
await Promise.all([mats.load(renderer), sky.load()]);
const city = new City(net, mats);
scene.add(city.group);
const ground = new Ground(map);
const props = new Props(net, mats, ground, city.enseignes);
city.decorators.push((k, g, textes) => props.populateChunk(k, g, textes));
scene.add(props.group);
props.update(num('time', 0));

let x = num('x', 1080), z = num('z', -480), h = num('h', 0);
if (q.has('edge')) {
  const name = q.get('edge')!;
  const cands = net.edges.filter((e) => e.name === name).sort((a, b) => b.length - a.length);
  const e = cands[Math.min(cands.length - 1, num('n', 0))];
  if (e) {
    const s = e.length * num('t', 0.3);
    const lane = e.lanesF[e.lanesF.length - 1];
    const p = e.line.atOffset(s, lane ? lane.off : 0);
    x = p.x; z = p.z; h = (Math.atan2(p.tx, -p.tz) * 180) / Math.PI + num('dh', 0);
  }
}
city.ensureAround(x, z, num('r', 260));
const hr = (h * Math.PI) / 180;
camera.position.set(x, num('y', 1.2), z);
camera.rotation.order = 'YXZ';
camera.rotation.y = -hr;
camera.rotation.x = (num('pitch', 0) * Math.PI) / 180;
sky.update(x, z);
renderer.render(scene, camera);
sky.update(x, z); renderer.render(scene, camera);
for (let i = 0; i < 6; i++) { sky.update(x, z); renderer.render(scene, camera); }
const info = renderer.info;
hud.textContent = `x=${x.toFixed(0)} z=${z.toFixed(0)} cap=${h.toFixed(0)}° | dalles ${city.built} | ${info.render.calls} appels, ${(info.render.triangles / 1000).toFixed(0)} k tri | chargement ${(performance.now() - t0).toFixed(0)} ms | soleil ${sky.sunDir.toArray().map((v) => v.toFixed(2))}`;
(window as any).__info = { calls: info.render.calls, tris: info.render.triangles, ms: performance.now() - t0, sun: sky.sunDir.toArray() };
(window as any).__ready = true;
