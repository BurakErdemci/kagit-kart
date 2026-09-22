// Scene → one render target (with depth texture) → one full-screen pass: depth-discontinuity ink
// outlines, paper grain multiply, slight vignette. Off on low quality.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

// Outlines use the Laplacian of 1/z: it is zero on any plane (1/z is affine in screen space),
// so grazing ground does not ink, while silhouettes and creases do.
const FRAG = /* glsl */`
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tGrain;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform vec3 uInk;
uniform float uThick;
uniform float uPR;
uniform float uEdgeLo;
uniform float uEdgeHi;
uniform float uGrain;
uniform float uVignette;
varying vec2 vUv;

float invZ( vec2 uv ) {
  float d = texture2D( tDepth, uv ).x;
  float z = -perspectiveDepthToViewZ( d, uNear, uFar );
  return 1.0 / max( z, 1e-3 );
}

void main() {
  vec3 col = texture2D( tColor, vUv ).rgb;
  vec2 px = uThick / uRes;
  float c = invZ( vUv );
  float l = invZ( vUv - vec2( px.x, 0.0 ) );
  float r = invZ( vUv + vec2( px.x, 0.0 ) );
  float u = invZ( vUv + vec2( 0.0, px.y ) );
  float d = invZ( vUv - vec2( 0.0, px.y ) );
  float lap = abs( l + r - 2.0 * c ) + abs( u + d - 2.0 * c );
  float nearest = max( max( l, r ), max( max( u, d ), c ) );
  float rel = lap / nearest;
  float zc = 1.0 / nearest;
  float edge = smoothstep( uEdgeLo, uEdgeHi, rel ) * ( 1.0 - smoothstep( 160.0, 420.0, zc ) );
  col = mix( col, uInk, edge * 0.92 );

  float g = texture2D( tGrain, gl_FragCoord.xy / ( 256.0 * uPR ) ).r;
  col *= 1.0 - uGrain * ( 1.0 - g ) * 3.0;

  vec2 q = vUv - 0.5;
  float vig = smoothstep( 0.85, 0.25, length( q * vec2( 1.0, 0.8 ) ) );
  col *= mix( 1.0 - uVignette, 1.0, vig );

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createPost(renderer, materials, cfg) {
  const outlinePx = cfg.render.outlinePx;
  const hasFloat = renderer.extensions.has('EXT_color_buffer_float');
  let rt = null;
  let samples = 0;
  let enabled = true;
  let width = 1, height = 1, pr = 1;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, tGrain: { value: materials.textures.grain },
      uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: cfg.camera.near }, uFar: { value: cfg.camera.far },
      uInk: { value: new THREE.Color('#2d2a32') }, uThick: { value: 1 }, uPR: { value: 1 },
      uEdgeLo: { value: 0.012 }, uEdgeHi: { value: 0.03 }, uGrain: { value: 0.05 }, uVignette: { value: 0.16 },
    },
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function makeTarget() {
    if (rt) { rt.depthTexture?.dispose(); rt.dispose(); }
    const w = Math.max(1, Math.round(width * pr)), h = Math.max(1, Math.round(height * pr));
    rt = new THREE.WebGLRenderTarget(w, h, {
      type: hasFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      colorSpace: hasFloat ? THREE.NoColorSpace : THREE.SRGBColorSpace,
      samples,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    rt.texture.name = 'post.color';
    mat.uniforms.tColor.value = rt.texture;
    mat.uniforms.tDepth.value = rt.depthTexture;
    mat.uniforms.uRes.value.set(w, h);
  }

  function setSize(w, h, pixelRatio) {
    width = w; height = h; pr = pixelRatio;
    mat.uniforms.uPR.value = pr;
    // Line weight follows the render height (1 px taps at 720 p, 2 at 1080–1440 p, 3 at 2160 p). Taps stay
    // whole pixels: with nearest depth samples a fractional offset lands -1/+2 px, and the uneven
    // Laplacian then inks flat ground near the horizon.
    mat.uniforms.uThick.value = Math.max(1, Math.round(outlinePx * (h * pr) / 720));
    if (enabled) makeTarget();
  }

  function setQuality(level) {
    enabled = level !== 'low';
    samples = level === 'high' ? 4 : 0;
    if (enabled) makeTarget();
    else if (rt) { rt.depthTexture?.dispose(); rt.dispose(); rt = null; }
  }

  function setInk(color) {
    mat.uniforms.uInk.value.set(color);
  }

  function render(scene, camera) {
    mat.uniforms.uNear.value = camera.near;
    mat.uniforms.uFar.value = camera.far;
    if (!enabled || !rt) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  return {
    render, setSize, setQuality, setInk, material: mat,
    get enabled() { return enabled; },
    get target() { return rt; },
  };
}
