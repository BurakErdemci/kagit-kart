// Cards rewritten every frame: boost flames (layered cut paper, flickering by swapping between four
// silhouettes) and the crane's string. A card spans A → B, turned about that axis to face the camera;
// a BURST card is the flame seen end-on, a camera-facing rosette of tongues centred on A. An optional
// hard offset in screen pixels draws a layer's drop shadow. One draw call.
import * as THREE from 'three';

export const CARD = { FLAME: 0, STRING: 1, BURST: 2 };

const VERT = /* glsl */`
uniform vec2 uRes;
attribute vec4 aA;   // base point, half width (m)
attribute vec4 aB;   // tip point, shape id
attribute vec4 aCol; // colour, self-lit share
attribute vec4 aVar; // silhouette variant, outline, opacity, hard shadow offset (px)
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vVar;
varying float vShape;
#include <fog_pars_vertex>

void main() {
  vec3 A = aA.xyz;
  vec3 B = aB.xyz;
  if ( aB.w > 1.5 ) {
    vec3 camR = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
    vec3 camU = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
    vec2 q = vec2( position.x, position.y * 2.0 - 1.0 );
    vec4 mvB = viewMatrix * vec4( A + ( camR * q.x + camU * q.y ) * aA.w, 1.0 );
    gl_Position = projectionMatrix * mvB;
    gl_Position.xy += vec2( 1.0, -1.0 ) * aVar.w * 2.0 / uRes * gl_Position.w;
    vUv = q;
    vCol = aCol;
    vVar = aVar;
    vShape = aB.w;
    vec4 mvPosition = mvB;
    #include <fog_vertex>
    return;
  }
  vec3 axis = B - A;
  float len = length( axis );
  vec3 dir = len > 1e-5 ? axis / len : vec3( 0.0, 1.0, 0.0 );
  vec3 mid = mix( A, B, position.y );
  vec3 toCam = cameraPosition - mid;
  float dist = length( toCam );
  vec3 side = cross( dir, toCam / max( dist, 1e-4 ) );
  side = dot( side, side ) > 1e-8 ? normalize( side ) : vec3( 1.0, 0.0, 0.0 );
  // never thinner than ~1.2 px so a string stays a line at any distance
  float pxWorld = 2.0 * dist / ( uRes.y * projectionMatrix[ 1 ][ 1 ] );
  float w = max( aA.w, pxWorld * 1.2 );
  vec4 mvPosition = viewMatrix * vec4( mid + side * position.x * w, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.xy += vec2( 1.0, -1.0 ) * aVar.w * 2.0 / uRes * gl_Position.w;
  vUv = position.xy;
  vCol = aCol;
  vVar = aVar;
  vShape = aB.w;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform vec3 uInk;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vVar;
varying float vShape;
#include <fog_pars_fragment>

float sdUnevenCapsule( vec2 p, vec2 pa, vec2 pb, float ra, float rb ) {
  p -= pa;
  pb -= pa;
  float h = dot( pb, pb );
  vec2 q = vec2( dot( p, vec2( pb.y, -pb.x ) ), dot( p, pb ) ) / h;
  q.x = abs( q.x );
  float b = ra - rb;
  vec2 c = vec2( sqrt( h - b * b ), b );
  float k = c.x * q.y - c.y * q.x;
  float m = dot( c, q );
  float n = dot( q, q );
  if ( k < 0.0 ) return sqrt( h * n ) - ra;
  else if ( k > c.x ) return sqrt( h * ( n + 1.0 - 2.0 * q.y ) ) - rb;
  return m - ra;
}

// A flame is a fat main tongue plus two side licks; the variant moves the tips, so swapping the
// variant reads as a cut-paper flame being replaced, not as a blur.
float sdFlame( vec2 p, float variant ) {
  float v = floor( variant + 0.5 );
  vec2 q = vec2( p.x * 0.5, p.y );
  float lean = ( v == 0.0 ? 0.05 : v == 1.0 ? -0.07 : v == 2.0 ? 0.1 : -0.03 );
  float l1y = ( v == 0.0 ? 0.62 : v == 1.0 ? 0.74 : v == 2.0 ? 0.56 : 0.68 );
  float l2y = ( v == 0.0 ? 0.7 : v == 1.0 ? 0.55 : v == 2.0 ? 0.66 : 0.78 );
  float d = sdUnevenCapsule( q, vec2( 0.0, 0.2 ), vec2( lean, 0.99 ), 0.2, 0.0 );
  d = min( d, sdUnevenCapsule( q, vec2( -0.12, 0.26 ), vec2( -0.31 + lean * 0.5, l1y ), 0.13, 0.0 ) );
  d = min( d, sdUnevenCapsule( q, vec2( 0.12, 0.28 ), vec2( 0.29 + lean * 0.5, l2y ), 0.12, 0.0 ) );
  return d;
}

// End-on flame: six tongues around the nozzle; the variant turns them and changes which is longest.
float sdBurst( vec2 p, float variant ) {
  float v = floor( variant + 0.5 );
  float r = length( p );
  float s = atan( p.y, p.x ) / 6.2831853 * 6.0 + v * 0.29;
  float tongue = floor( s );
  float tri = abs( fract( s ) - 0.5 ) * 2.0;
  float tip = 0.78 + 0.2 * fract( sin( ( tongue + v * 3.0 ) * 12.9898 ) * 43758.5453 );
  float edge = 0.42 + ( tip - 0.42 ) * pow( 1.0 - tri, 1.7 );
  return ( r - edge ) * 0.8;
}

void main() {
  float d;
  if ( vShape < 0.5 ) d = sdFlame( vUv, vVar.x );
  else if ( vShape < 1.5 ) d = abs( vUv.x ) - 0.85;
  else d = sdBurst( vUv, vVar.x );
  float w = max( fwidth( d ), 1e-4 );
  float alpha = ( 1.0 - smoothstep( -w * 0.5, w * 0.5, d ) ) * vVar.z;
  if ( alpha < 0.02 ) discard;
  vec3 col = vCol.rgb;
  float lineW = 1.4 * w;
  float edge = smoothstep( -lineW - w * 0.5, -lineW + w * 0.5, d ) * vVar.y * smoothstep( 0.25, 0.08, w );
  col = mix( col, uInk, edge * 0.9 );
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createCards(game, { capacity = 96 } = {}) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, 1, 1, 0, -1, 1, 0,
  ]), 3));
  const names = ['aA', 'aB', 'aCol', 'aVar'];
  const arr = {};
  const attr = {};
  for (const n of names) {
    arr[n] = new Float32Array(capacity * 4);
    attr[n] = new THREE.InstancedBufferAttribute(arr[n], 4);
    attr[n].setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(n, attr[n]);
  }
  geo.instanceCount = 0;

  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uInk: game.materials.uniforms.uInk,
    uRes: { value: new THREE.Vector2(1280, 720) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'fx:cards', uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:cards';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.matrixAutoUpdate = false;

  let n = 0;
  let lastN = 0;

  function begin() { n = 0; }

  // Appends one card; returns false once the pool is full.
  function add(ax, ay, az, bx, by, bz, halfWidth, shape, color, glow, variant, outline, opacity, offsetPx) {
    if (n >= capacity) return false;
    const o = n * 4;
    let a = arr.aA; a[o] = ax; a[o + 1] = ay; a[o + 2] = az; a[o + 3] = halfWidth;
    a = arr.aB; a[o] = bx; a[o + 1] = by; a[o + 2] = bz; a[o + 3] = shape;
    a = arr.aCol; a[o] = color.r; a[o + 1] = color.g; a[o + 2] = color.b; a[o + 3] = glow;
    a = arr.aVar; a[o] = variant; a[o + 1] = outline; a[o + 2] = opacity; a[o + 3] = offsetPx;
    n++;
    return true;
  }

  function end() {
    if (n > 0 || lastN > 0) {
      for (const k of names) {
        const at = attr[k];
        at.clearUpdateRanges();
        at.addUpdateRange(0, Math.max(n, 1) * 4);
        at.needsUpdate = true;
      }
    }
    geo.instanceCount = n;
    lastN = n;
  }

  function setResolution(w, h) { uniforms.uRes.value.set(w, h); }

  function dispose() {
    mesh.parent?.remove(mesh);
    geo.dispose();
    mat.dispose();
  }

  return { mesh, begin, add, end, setResolution, dispose, get count() { return n; } };
}
