// Boost speed lines: tapered ink strokes that start at the screen border and slide toward the
// centre. Screen space (the vertex shader writes clip coordinates directly), drawn last over the
// scene, so they pass through the post pass and pick up its paper grain. Every stroke's angle, length
// and timing come from its index and cycle count: the pattern is designed, never re-rolled per frame.
import * as THREE from 'three';

const COUNT = 34;

const VERT = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform float uAspect;
attribute float aIdx;
varying vec2 vUv;
varying float vAlpha;

float hash( float n ) { return fract( sin( n * 12.9898 + 4.1414 ) * 43758.5453 ); }

void main() {
  float i = aIdx;
  float period = 0.26 + 0.14 * hash( i + 3.1 );
  float t = uTime / period + hash( i + 7.7 );
  float cyc = floor( t );
  float ph = fract( t );
  float ang = ( i + 0.35 + 0.5 * hash( i * 1.7 + cyc * 3.3 ) ) / ${COUNT}.0 * 6.2831853;
  vec2 dir = vec2( cos( ang ), sin( ang ) );
  // distance from the centre to the screen border along dir, in aspect-corrected units (x spans ±aspect)
  float border = 1.0 / max( abs( dir.x ) / uAspect, abs( dir.y ) );
  float outer = border * ( 1.04 - 0.3 * ph );
  float len = ( 0.16 + 0.22 * hash( i * 3.3 + cyc ) ) * ( 0.55 + 0.45 * uIntensity );
  float inner = outer - len;
  vec2 along = dir * mix( outer, inner, position.y );
  float w = ( 0.009 + 0.01 * hash( i + cyc * 1.3 ) ) * ( 1.0 - position.y * 0.8 );
  vec2 q = along + vec2( -dir.y, dir.x ) * position.x * w;
  gl_Position = vec4( q.x / uAspect, q.y, 0.0, 1.0 );
  vUv = position.xy;
  vAlpha = uIntensity * sin( 3.14159265 * ph ) * ( 0.55 + 0.45 * hash( i * 5.9 + cyc ) );
}`;

// Two-tone stroke: a core with a rim in the opposite tone, so a stroke reads over light sky and
// over mid-grey road alike (a plain ink stroke vanished over the day road).
const FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uEdge;
uniform float uOpacity;
varying vec2 vUv;
varying float vAlpha;

void main() {
  float x = abs( vUv.x );
  float a = ( 1.0 - smoothstep( 0.78, 1.0, x ) ) * vAlpha * uOpacity;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( mix( uColor, uEdge, smoothstep( 0.4, 0.56, x ) ), a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSpeedLines() {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, 1, 1, 0, -1, 1, 0,
  ]), 3));
  const idx = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) idx[i] = i;
  geo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1));
  geo.instanceCount = COUNT;

  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uAspect: { value: 16 / 9 },
    uColor: { value: new THREE.Color('#2d2a32') },
    uEdge: { value: new THREE.Color('#fbf6e9') },
    uOpacity: { value: 0.6 },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'fx:speedlines', uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:speedlines';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;

  let intensity = 0;

  // target 0..1; fades in fast and out slower so a chain of boosts does not strobe. `cut` drops the
  // lines at once: they are drawn for the chase view, and over any other view they point nowhere.
  function update(dt, target, aspect, cut = false) {
    const hl = target > intensity ? 0.05 : 0.16;
    intensity = cut ? 0 : target + (intensity - target) * Math.pow(2, -dt / hl);
    if (intensity < 0.015 && target === 0) intensity = 0;
    uniforms.uTime.value += dt;
    uniforms.uIntensity.value = intensity;
    uniforms.uAspect.value = aspect;
    mesh.visible = intensity > 0;
  }

  function dispose() {
    mesh.parent?.remove(mesh);
    geo.dispose();
    mat.dispose();
  }

  return { mesh, uniforms, update, dispose, get intensity() { return intensity; } };
}
