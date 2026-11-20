// Bibliothèque de matériaux PBR du décor urbain.

import * as THREE from 'three';
import { buildFacades, type FacadeSet } from '../world/facades';
import { Rng } from '../core/math';

const loader = new THREE.TextureLoader();

async function tex(url: string, srgb: boolean, aniso: number): Promise<THREE.Texture> {
  const t = await loader.loadAsync(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

async function pbr(name: string, aniso: number, opts: THREE.MeshStandardMaterialParameters = {}, normalScale = 1): Promise<THREE.MeshStandardMaterial> {
  const base = 'textures/' + name;
  const [map, normalMap, arm] = await Promise.all([tex(base + '_diff.jpg', true, aniso), tex(base + '_nor.jpg', false, aniso), tex(base + '_arm.jpg', false, 4)]);
  return new THREE.MeshStandardMaterial({
    map, normalMap, roughnessMap: arm, aoMap: arm, metalness: 0, roughness: 1,
    normalScale: new THREE.Vector2(normalScale, normalScale), ...opts,
  });
}

/** Ajoute une variation à grande échelle pour casser la répétition visible des textures de sol. */
function addMacroVariation(mat: THREE.MeshStandardMaterial, strength = 0.55) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
      {
        vec3 m1 = texture2D( map, vMapUv * 0.123 + 0.37 ).rgb;
        vec3 m2 = texture2D( map, vMapUv * 0.031 + 0.11 ).rgb;
        float l1 = dot( m1, vec3( 0.333 ) ), l2 = dot( m2, vec3( 0.333 ) );
        diffuseColor.rgb *= mix( 1.0, clamp( ( l1 * 0.6 + l2 * 0.4 ) / 0.18, 0.55, 1.6 ), ${strength.toFixed(2)} );
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'macro' + strength;
}

/** Peinture routière usée : blanc cassé, bords légèrement grignotés (alphaTest). */
function paintTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const rng = new Rng(4242);
  c.fillStyle = '#fff'; c.fillRect(0, 0, S, S);
  const img = c.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const g = 222 + Math.floor(rng.next() * 30);
    img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g - 6;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // éclats et fissures (transparents)
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    c.globalAlpha = 0.5 + rng.next() * 0.5;
    c.beginPath();
    c.ellipse(rng.next() * S, rng.next() * S, 1 + rng.next() * 4, 0.6 + rng.next() * 2.2, rng.next() * 3, 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 16; i++) {
    c.globalAlpha = 0.8; c.lineWidth = 0.8 + rng.next() * 1.4;
    c.beginPath();
    let x = rng.next() * S, y = rng.next() * S;
    c.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rng.next() - 0.5) * 50; y += (rng.next() - 0.5) * 50; c.lineTo(x, y); }
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class MaterialLib {
  road!: THREE.MeshStandardMaterial;
  roadSett!: THREE.MeshStandardMaterial;
  sidewalk!: THREE.MeshStandardMaterial;
  kerb!: THREE.MeshStandardMaterial;
  gutter!: THREE.MeshStandardMaterial;
  paint!: THREE.MeshStandardMaterial;
  paintYellow!: THREE.MeshStandardMaterial;
  grass!: THREE.MeshStandardMaterial;
  yard!: THREE.MeshStandardMaterial;
  plaza!: THREE.MeshStandardMaterial;
  dirt!: THREE.MeshStandardMaterial;
  roof!: THREE.MeshStandardMaterial;
  wall!: THREE.MeshStandardMaterial;
  hedge!: THREE.MeshStandardMaterial;
  fence!: THREE.MeshStandardMaterial;
  water!: THREE.MeshStandardMaterial;
  facade!: THREE.MeshStandardMaterial;
  facades!: FacadeSet;
  metalDark = new THREE.MeshStandardMaterial({ color: 0x24282b, roughness: 0.55, metalness: 0.6 });
  metalGrey = new THREE.MeshStandardMaterial({ color: 0x8a8f93, roughness: 0.45, metalness: 0.8 });
  metalGreen = new THREE.MeshStandardMaterial({ color: 0x1f3b2c, roughness: 0.5, metalness: 0.5 });
  plasticBlack = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.8, metalness: 0 });
  concrete = new THREE.MeshStandardMaterial({ color: 0xb4b1a8, roughness: 0.9, metalness: 0 });

  async load(renderer: THREE.WebGLRenderer): Promise<void> {
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const [road, sett, sidewalk, kerb, grass, roof, wallM, facades] = await Promise.all([
      pbr('asphalt_02', aniso, { color: new THREE.Color(1.5, 1.5, 1.52) }, 0.9),
      pbr('cobblestone_floor_08', aniso, { color: new THREE.Color(1.05, 1.03, 1.0) }, 1.2),
      pbr('asphalt_04', aniso, { color: new THREE.Color(0.86, 0.85, 0.83) }, 0.6),
      pbr('granite_tile', aniso, { color: new THREE.Color(1.25, 1.24, 1.22) }, 0.5),
      pbr('leafy_grass', aniso, { color: new THREE.Color(0.62, 0.95, 0.5) }, 1.0),
      pbr('grey_roof_01', aniso, { color: new THREE.Color(0.8, 0.83, 0.87) }, 0.8),
      pbr('plastered_stone_wall', aniso, { color: new THREE.Color(1.0, 0.98, 0.94) }, 0.8),
      buildFacades(),
    ]);
    this.road = road; addMacroVariation(road, 0.5);
    this.roadSett = sett; addMacroVariation(sett, 0.3);
    this.sidewalk = sidewalk; addMacroVariation(sidewalk, 0.45);
    this.kerb = kerb;
    this.grass = grass; addMacroVariation(grass, 0.5);
    // cœurs d'îlot : herbe plus terne, mêlée de terre
    this.yard = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, roughnessMap: grass.roughnessMap, color: new THREE.Color(0.62, 0.72, 0.5), roughness: 1, metalness: 0 });
    addMacroVariation(this.yard, 0.75);
    this.roof = roof;
    this.wall = wallM;
    this.facades = facades;

    this.gutter = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const paintMap = paintTexture();
    this.paint = new THREE.MeshStandardMaterial({
      map: paintMap, color: 0xf4f3ee, roughness: 0.62, metalness: 0, alphaTest: 0.5,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.paintYellow = this.paint.clone();
    this.paintYellow.color.set(0xf2c230);
    this.plaza = new THREE.MeshStandardMaterial({ map: sett.map, normalMap: sett.normalMap, roughnessMap: sett.roughnessMap, color: new THREE.Color(1.25, 1.22, 1.15), roughness: 1, metalness: 0 });
    this.dirt = new THREE.MeshStandardMaterial({ color: 0x8d7b62, roughness: 1, metalness: 0 });
    // vert de troène au soleil : plus sombre, les haies à l'ombre viraient au noir
    this.hedge = new THREE.MeshStandardMaterial({ color: 0x55783f, roughness: 1, metalness: 0 });
    // Grillages et clôtures à barreaux : on voit au travers. En panneau plein vert sombre, ils dressaient
    // des blocs noirs le long des trottoirs et devant les places (Croix de Chavaux, mairie).
    this.fence = new THREE.MeshStandardMaterial({ color: 0x3f4d45, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.45, depthWrite: false });
    this.water = new THREE.MeshStandardMaterial({ color: 0x3a5d6e, roughness: 0.08, metalness: 0.2 });
    this.facade = this.makeFacadeMaterial();
  }

  private makeFacadeMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, vertexColors: true });
    const facadeTex = this.facades.texture;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.facadeTex = { value: facadeTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 facade;\nvarying vec3 vFacade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray facadeTex;\nvarying vec3 vFacade;\nfloat facadeGlass;')
        .replace(
          '#include <map_fragment>',
          /* glsl */ `vec4 facadeTexel = texture( facadeTex, vec3( vFacade.xy, floor( vFacade.z + 0.5 ) ) );
          facadeGlass = 1.0 - facadeTexel.a;
          diffuseColor.rgb *= mix( facadeTexel.rgb, facadeTexel.rgb * 0.55, facadeGlass * 0.5 );`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.045, facadeGlass );')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.55, facadeGlass );');
    };
    mat.customProgramCacheKey = () => 'facade';
    return mat;
  }
}
