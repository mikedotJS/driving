// Ciel HDRI, lumière du soleil et ombres en cascade.
//
// Les cascades sont des boîtes concentriques centrées sur le véhicule (et non découpées
// dans le champ de la caméra) : les ombres restent donc correctes dans les rétroviseurs.
// Chaque cascade est une DirectionalLight ; le shader n'évalue l'éclairage qu'une fois et
// prend l'ombre de la cascade la plus fine qui contient le fragment.

import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

let chunkPatched = false;

/** Remplace la boucle des lumières directionnelles par une version « cascades ». */
function patchShaderChunk() {
  if (chunkPatched) return;
  chunkPatched = true;
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const startTok = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const a = src.indexOf(startTok);
  const loopStart = src.indexOf('#pragma unroll_loop_start', a);
  const loopEnd = src.indexOf('#pragma unroll_loop_end', loopStart) + '#pragma unroll_loop_end'.length;
  if (a < 0 || loopStart < 0 || loopEnd < loopStart) {
    console.warn('Ombres en cascade : structure du shader inattendue, ombres simples utilisées.');
    return;
  }
  const loop = /* glsl */ `
	float sunShadow = 1.0;
	bool sunDone = false;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );

		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
			{
				vec3 sc = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
				bool inside = all( greaterThan( sc.xy, vec2( 0.015 ) ) ) && all( lessThan( sc.xy, vec2( 0.985 ) ) ) && sc.z < 1.0;
				if ( ! sunDone && inside ) {
					directionalLightShadow = directionalLightShadows[ i ];
					sunShadow = receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
					sunDone = true;
				}
			}
			#if ( UNROLLED_LOOP_INDEX == NUM_DIR_LIGHT_SHADOWS - 1 )
				directLight.color *= sunShadow;
				RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
			#endif
		#else
			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#endif

	}
	#pragma unroll_loop_end`;
  THREE.ShaderChunk.lights_fragment_begin = src.slice(0, loopStart) + loop + src.slice(loopEnd);
}

export interface SkyOptions {
  hdr: string;
  /** demi-tailles des cascades (m), de la plus fine à la plus large */
  cascades: number[];
  mapSize: number;
  sunIntensity: number;
  envIntensity: number;
  shadows: boolean;
}

export class Sky {
  readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  readonly sunColor = new THREE.Color(1, 0.96, 0.9);
  readonly lights: THREE.DirectionalLight[] = [];
  private frame = 0;
  private opts: SkyOptions;
  envMap: THREE.Texture | null = null;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, opts: Partial<SkyOptions> = {}) {
    this.opts = { hdr: 'textures/sky_day.hdr', cascades: [16, 55, 210], mapSize: 2048, sunIntensity: 5.2, envIntensity: 0.9, shadows: true, ...opts };
    if (this.opts.shadows) patchShaderChunk();
  }

  async load(): Promise<void> {
    const loader = new HDRLoader().setDataType(THREE.FloatType);
    const tex = await loader.loadAsync(this.opts.hdr);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const { width, height } = tex.image as { width: number; height: number };
    const data = tex.image.data as Float32Array;
    const stride = data.length / (width * height);

    // direction du soleil : barycentre des pixels les plus lumineux
    let maxL = 0;
    for (let i = 0; i < data.length; i += stride) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (l > maxL) maxL = l;
    }
    let sx = 0, sy = 0, sz = 0, sw = 0, cr = 0, cg = 0, cb = 0;
    const thr = maxL * 0.5;
    for (let y = 0; y < height; y++) {
      const v = (y + 0.5) / height;
      const theta = v * Math.PI; // 0 = zénith
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * stride;
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (l < thr) continue;
        const phi = ((x + 0.5) / width) * Math.PI * 2;
        // convention équirectangulaire de three.js : u = atan2(z, x) / 2π + 0,5 ; première ligne = zénith
        const dx = -Math.sin(theta) * Math.cos(phi), dy = Math.cos(theta), dz = -Math.sin(theta) * Math.sin(phi);
        sx += dx * l; sy += dy * l; sz += dz * l; sw += l;
        cr += data[i]; cg += data[i + 1]; cb += data[i + 2];
      }
    }
    if (sw > 0 && sy / sw > 0.05) {
      this.sunDir.set(sx / sw, sy / sw, sz / sw).normalize();
      const m = Math.max(cr, cg, cb) || 1;
      this.sunColor.setRGB(cr / m, cg / m, cb / m);
      // un soleil de midi n'est pas blanc pur : légère chaleur
      this.sunColor.lerp(new THREE.Color(1, 0.95, 0.86), 0.6);
    }

    // Environnement : on écrête le disque solaire (la lumière directionnelle le remplace,
    // sinon le soleil serait compté deux fois et « éclairerait » les zones à l'ombre).
    const envData = new Float32Array(data.length);
    const cap = 6;
    // couleur moyenne de l'horizon (brume) pour raccorder le sol
    let hr = 0, hg = 0, hb = 0, hn = 0;
    for (let y = Math.floor(height * 0.46); y < Math.floor(height * 0.5); y++) {
      for (let x = 0; x < width; x += 4) { const i = (y * width + x) * stride; hr += Math.min(cap, data[i]); hg += Math.min(cap, data[i + 1]); hb += Math.min(cap, data[i + 2]); hn++; }
    }
    hr /= hn; hg /= hn; hb /= hn;
    // hémisphère inférieur : sol urbain éclairé (rebond de lumière sur les façades à l'ombre)
    const gr = 0.23, gg = 0.22, gb = 0.205;
    for (let y = 0; y < height; y++) {
      const below = (y + 0.5) / height - 0.5; // > 0 sous l'horizon
      const t = Math.min(1, Math.max(0, below / 0.05));
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * stride;
        let r = data[i], g = data[i + 1], b = data[i + 2];
        const m = Math.max(r, g, b);
        if (m > cap) { const k = cap / m; r *= k; g *= k; b *= k; }
        if (below > 0) {
          const k = t * t * (3 - 2 * t);
          r = hr * 0.7 * (1 - k) + gr * k; g = hg * 0.7 * (1 - k) + gg * k; b = hb * 0.7 * (1 - k) + gb * k;
        }
        envData[i] = r; envData[i + 1] = g; envData[i + 2] = b;
        if (stride === 4) envData[i + 3] = 1;
      }
    }
    const envTex = new THREE.DataTexture(envData, width, height, stride === 4 ? THREE.RGBAFormat : THREE.RGBFormat, THREE.FloatType);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.LinearSRGBColorSpace;
    envTex.minFilter = THREE.LinearFilter; envTex.magFilter = THREE.LinearFilter;
    envTex.flipY = tex.flipY;
    envTex.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromEquirectangular(envTex).texture;
    pmrem.dispose();
    envTex.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = this.opts.envIntensity;
    this.scene.background = tex;
    this.scene.backgroundIntensity = 1.0;

    this.buildLights();
  }

  private buildLights() {
    const o = this.opts;
    const n = o.shadows ? o.cascades.length : 1;
    for (let k = 0; k < n; k++) {
      const light = new THREE.DirectionalLight(this.sunColor, k === n - 1 ? o.sunIntensity : 0);
      if (o.shadows) {
        const S = o.cascades[k];
        light.castShadow = true;
        light.shadow.mapSize.set(o.mapSize, o.mapSize);
        const cam = light.shadow.camera;
        cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S;
        cam.near = 1; cam.far = 900;
        cam.updateProjectionMatrix();
        // biais proportionnels à la taille du texel
        const texel = (2 * S) / o.mapSize;
        light.shadow.bias = -0.00012 - texel * 0.0006;
        light.shadow.normalBias = texel * 1.6;
        light.shadow.radius = k === 0 ? 2.2 : 1.6;
        light.shadow.autoUpdate = false;
        light.shadow.needsUpdate = true;
      }
      this.scene.add(light);
      this.scene.add(light.target);
      this.lights.push(light);
    }
    if (o.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
    }
  }

  /** À appeler une fois par image, avant le rendu principal. */
  update(focusX: number, focusZ: number) {
    if (!this.opts.shadows) {
      const l = this.lights[0];
      if (l) { l.target.position.set(focusX, 0, focusZ); l.position.copy(l.target.position).addScaledVector(this.sunDir, 400); }
      return;
    }
    this.frame++;
    const o = this.opts;
    // repère lumière pour caler les cascades sur la grille de texels (pas de scintillement)
    const up = Math.abs(this.sunDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, this.sunDir).normalize();
    const upL = new THREE.Vector3().crossVectors(this.sunDir, right).normalize();
    const focus = new THREE.Vector3(focusX, 0, focusZ);
    this.lights.forEach((light, k) => {
      // cadence : la cascade fine à chaque image, les autres moins souvent
      const every = k === 0 ? 1 : k === 1 ? 2 : 6;
      if (this.frame % every !== k % every && this.frame > 3) return;
      const S = o.cascades[k];
      const texel = (2 * S) / o.mapSize;
      const fx = Math.round(focus.dot(right) / texel) * texel;
      const fy = Math.round(focus.dot(upL) / texel) * texel;
      const fz = focus.dot(this.sunDir);
      const c = new THREE.Vector3().addScaledVector(right, fx).addScaledVector(upL, fy).addScaledVector(this.sunDir, fz);
      light.target.position.copy(c);
      light.position.copy(c).addScaledVector(this.sunDir, 450);
      light.target.updateMatrixWorld();
      light.updateMatrixWorld();
      light.shadow.needsUpdate = true;
    });
    this.renderer.shadowMap.needsUpdate = true;
  }
}
