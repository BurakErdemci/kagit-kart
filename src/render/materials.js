// The only way to make surfaces (ARCHITECTURE.md §12). Paper = MeshToonMaterial with a 3-band gradient,
// screen-space halftone dots in the darkest band and in received shadow, optional printed overlay.
// Cached materials are read-only: never mutate or dispose them; use { unique: true } for per-object changes.
import * as THREE from 'three';
import { createTextures } from './textures.js';

const PARS = /* glsl */`
#include <shadowmask_pars_fragment>
uniform float uDotPx;
uniform vec3 uInk;
uniform float uTime;
uniform sampler2D uGrainTex;
uniform float uGrainAmount;
varying vec3 vPaperWorld;
#ifdef PAPER_SCREEN
  uniform vec3 uScreen; // cell size (m), dot radius (cells), strength
#endif
#ifdef PAPER_OVERLAY
  uniform sampler2D uOverlay;
  uniform vec3 uOverlayColor;
  uniform vec2 uOverlayRepeat;
  varying vec2 vPaperUv;
  #ifdef PAPER_SCROLL
    uniform float uScroll;
  #endif
#endif
`;

const OVERLAY = /* glsl */`
#include <map_fragment>
{
  // paper fibre in world space so it sticks to surfaces: fibres plus slow mottling
  float gA = texture2D( uGrainTex, vPaperWorld.xz * 0.14 + vPaperWorld.y * 0.09 ).r;
  float gB = texture2D( uGrainTex, vPaperWorld.xz * 0.021 ).r;
  diffuseColor.rgb *= 1.0 + ( ( gA - 0.92 ) * 0.9 + ( gB - 0.92 ) * 0.6 ) * uGrainAmount;
}
#ifdef PAPER_SCREEN
  {
    // printed tone: a world-space dot screen; below ~3 px per cell it fades to its mean coverage
    vec2 sp = vPaperWorld.xz / uScreen.x;
    sp = vec2( sp.x + sp.y, sp.y - sp.x ) * 0.70710678;
    vec2 cell = fract( sp ) - 0.5;
    float d = length( cell );
    float w = max( fwidth( d ), 1e-4 );
    float m = 1.0 - smoothstep( uScreen.y - w, uScreen.y + w, d );
    float cellsPerPx = length( fwidth( sp ) );
    float fade = smoothstep( 0.18, 0.45, cellsPerPx );
    float coverage = 3.14159 * uScreen.y * uScreen.y;
    diffuseColor.rgb *= 1.0 - uScreen.z * mix( m, coverage, fade );
  }
#endif
#ifdef PAPER_OVERLAY
  {
    vec2 puv = vPaperUv * uOverlayRepeat;
    #ifdef PAPER_SCROLL
      puv.y -= uTime * uScroll;
    #endif
    float ov = texture2D( uOverlay, puv ).r;
    diffuseColor.rgb = mix( diffuseColor.rgb, uOverlayColor, ov );
  }
#endif
`;

const PROJECT = /* glsl */`
#include <project_vertex>
{
  vec4 kkWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    kkWorld = instanceMatrix * kkWorld;
  #endif
  vPaperWorld = ( modelMatrix * kkWorld ).xyz;
}
`;

// Dots grow with darkness; the pattern is rotated 45° like a print screen.
const HALFTONE = /* glsl */`
#ifdef PAPER_HALFTONE
  {
    float kkNL = 1.0;
    #if NUM_DIR_LIGHTS > 0
      kkNL = dot( normal, directionalLights[ 0 ].direction );
    #endif
    float kkShadow = getShadowMask();
    float kkDark = max( 1.0 - step( -0.3333, kkNL ), 1.0 - kkShadow );
    if ( kkDark > 0.01 ) {
      vec2 p = gl_FragCoord.xy / uDotPx;
      p = vec2( p.x + p.y, p.y - p.x ) * 0.70710678;
      vec2 cell = fract( p ) - 0.5;
      float d = length( cell );
      float r = 0.36 * kkDark;
      float aa = 0.7 / uDotPx + 0.02;
      float dotMask = 1.0 - smoothstep( r - aa, r + aa, d );
      outgoingLight = mix( outgoingLight, uInk * 0.9 + outgoingLight * 0.25, dotMask * 0.42 );
    }
  }
#endif
`;

function hexOf(c) {
  if (c == null) return 'none';
  if (c instanceof THREE.Color) return c.getHexString();
  return new THREE.Color(c).getHexString();
}

export function createMaterials(renderer, cfg) {
  const shared = {
    uDotPx: { value: cfg.render.dotPx },
    uInk: { value: new THREE.Color('#2d2a32') },
    uTime: { value: 0 },
    uGrainTex: { value: null },
  };

  const g = cfg.render.gradient;
  const gradData = new Uint8Array(12);
  for (let i = 0; i < 3; i++) {
    const v = Math.round(g[i] * 255);
    gradData[i * 4] = gradData[i * 4 + 1] = gradData[i * 4 + 2] = v;
    gradData[i * 4 + 3] = 255;
  }
  const gradientMap = new THREE.DataTexture(gradData, 3, 1, THREE.RGBAFormat);
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;

  const textures = createTextures(renderer);
  shared.uGrainTex.value = textures.grain;
  const cache = new Map();

  function paper(color, opts = {}) {
    const {
      halftone = true, map = null, side = THREE.FrontSide, flat = true, unique = false,
      overlay = null, overlayColor = null, overlayRepeat = null, scroll = 0,
      vertexColors = false, transparent = false, opacity = 1, depthWrite = true,
      screen = null, // { size: m, dot: 0..0.5 cells, amount: 0..1 } world-space print screen
      grain = 1, // paper fibre strength
    } = opts;
    const key = [
      hexOf(color), halftone ? 1 : 0, map ? map.uuid : '-', side, flat ? 1 : 0,
      overlay ? overlay.uuid : '-', hexOf(overlayColor), overlayRepeat ? overlayRepeat.join('x') : '-', scroll,
      vertexColors ? 1 : 0, transparent ? 1 : 0, opacity, depthWrite ? 1 : 0,
      screen ? `${screen.size}/${screen.dot}/${screen.amount}` : '-', grain,
    ].join('|');
    if (!unique && cache.has(key)) return cache.get(key);

    const m = new THREE.MeshToonMaterial({
      color: new THREE.Color(color ?? 0xffffff), gradientMap, map, side,
      vertexColors, transparent, opacity, depthWrite,
    });
    // MeshToonMaterial has no flatShading option in r186, but the program parameters read the property.
    m.flatShading = flat;
    m.defines = m.defines || {};
    const variant = [];
    if (halftone) { m.defines.PAPER_HALFTONE = ''; variant.push('h'); }
    if (overlay) { m.defines.PAPER_OVERLAY = ''; variant.push('o'); }
    if (overlay && scroll) { m.defines.PAPER_SCROLL = ''; variant.push('s'); }
    if (screen) { m.defines.PAPER_SCREEN = ''; variant.push('p'); }
    const screenUniform = screen ? { value: new THREE.Vector3(screen.size ?? 0.5, screen.dot ?? 0.3, screen.amount ?? 0.25) } : null;
    const grainUniform = { value: grain };
    const variantKey = variant.join('') || 'plain';
    const overlayUniforms = overlay ? {
      uOverlay: { value: overlay },
      uOverlayColor: { value: new THREE.Color(overlayColor ?? 0x000000) },
      uOverlayRepeat: { value: new THREE.Vector2(...(overlayRepeat || [1, 1])) },
      uScroll: { value: scroll },
    } : null;

    m.onBeforeCompile = (shader) => {
      shader.uniforms.uDotPx = shared.uDotPx;
      shader.uniforms.uInk = shared.uInk;
      shader.uniforms.uTime = shared.uTime;
      if (overlayUniforms) Object.assign(shader.uniforms, overlayUniforms);
      if (screenUniform) shader.uniforms.uScreen = screenUniform;
      shader.uniforms.uGrainAmount = grainUniform;
      shader.uniforms.uGrainTex = shared.uGrainTex;
      let vs = 'varying vec3 vPaperWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', PROJECT);
      if (overlay) vs = 'varying vec2 vPaperUv;\n' + vs.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvPaperUv = uv;');
      shader.vertexShader = vs;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + PARS)
        .replace('#include <map_fragment>', OVERLAY)
        .replace('#include <opaque_fragment>', HALFTONE + '\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'paper:' + variantKey;
    m.userData.paper = { key, cached: !unique, overlayUniforms };
    if (!unique) cache.set(key, m);
    return m;
  }

  const inkMaterial = new THREE.MeshBasicMaterial({ color: shared.uInk.value.clone() });
  inkMaterial.userData.cached = true;
  function ink() {
    return inkMaterial;
  }

  const emissiveCache = new Map();
  function emissive(color, { transparent = false, opacity = 1, fog = true } = {}) {
    const key = `${hexOf(color)}|${transparent ? 1 : 0}|${opacity}|${fog ? 1 : 0}`;
    let m = emissiveCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent, opacity, fog, depthWrite: !transparent });
      m.userData.cached = true;
      emissiveCache.set(key, m);
    }
    return m;
  }

  function setInk(color) {
    shared.uInk.value.set(color);
    inkMaterial.color.set(color);
  }

  function setDotPx(px) {
    shared.uDotPx.value = px;
  }

  function update(time) {
    shared.uTime.value = time;
  }

  // Upload every generated texture now so per-race memory checks start from a stable baseline.
  function warm() {
    for (const t of Object.values(textures)) renderer.initTexture(t);
    renderer.initTexture(gradientMap);
  }

  function all() {
    return [...cache.values(), ...emissiveCache.values(), inkMaterial];
  }

  return { paper, ink, emissive, textures, uniforms: shared, gradientMap, setInk, setDotPx, update, warm, all };
}
