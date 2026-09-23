// Pooled paper bits: every world particle (drift sparks, debris, puffs, stars, graphite, streaks,
// confetti) is one instance of a folded paper card in a single InstancedBufferGeometry draw call.
// Motion is analytic in the vertex shader (drag + gravity from the spawn state), so the CPU only
// writes an instance once, at spawn, into a ring buffer.
import * as THREE from 'three';

export const SHAPE = { TRI: 0, SLIVER: 1, STAR: 2, RECT: 3, PUFF: 4, STROKE: 5 };
export const MODE = { TUMBLE: 0, SPIN: 1, FLIP: 2, STREAK: 3 };
export const GROW = { POP: 0, PUFF: 1 };

const ATTRS = ['aP0', 'aV0', 'aPhys', 'aShape', 'aLook', 'aColA', 'aColB'];
const NEVER = 1e4;

const VERT = /* glsl */`
uniform float uTime;
attribute vec4 aP0;    // spawn position, spawn time
attribute vec4 aV0;    // spawn velocity, life
attribute vec4 aPhys;  // drag, gravity, floor y, landing age
attribute vec4 aShape; // shape id, half size, seed, mode
attribute vec4 aLook;  // spin rad/s, fold rad, aspect, flutter m
attribute vec4 aColA;  // front colour, self-lit share
attribute vec4 aColB;  // back colour, grow curve
varying vec2 vUv;
varying vec3 vN;
varying vec4 vColA;
varying vec4 vColB;
varying vec3 vInfo;    // shape id, seed, life fraction
#include <fog_pars_vertex>

vec3 hash3( float s ) {
  return fract( sin( vec3( s * 127.1, s * 311.7, s * 74.7 ) ) * 43758.5453 );
}

mat3 axisAngle( vec3 a, float ang ) {
  float c = cos( ang ), s = sin( ang ), t = 1.0 - c;
  return mat3(
    t * a.x * a.x + c,       t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
    t * a.x * a.y - s * a.z, t * a.y * a.y + c,       t * a.y * a.z + s * a.x,
    t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c );
}

void main() {
  float age = uTime - aP0.w;
  float life = aV0.w;
  if ( age < 0.0 || age >= life ) {
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 ); // outside the clip volume
    return;
  }
  float u = age / life;
  bool landed = age >= aPhys.w;
  float tl = min( age, aPhys.w );

  // v' = -k v - g y  →  closed form for position and velocity
  float k = max( aPhys.x, 0.01 );
  float g = aPhys.y;
  float e = exp( -k * tl );
  float fk = ( 1.0 - e ) / k;
  vec3 p = aP0.xyz + aV0.xyz * fk;
  p.y -= g * ( tl - fk ) / k;
  vec3 vel = aV0.xyz * e;
  vel.y -= g * fk;

  float seed = aShape.z;
  float flutter = aLook.w;
  if ( flutter > 0.0 ) {
    float ph = seed * 37.0;
    float amp = flutter * ( 1.0 - exp( -2.0 * tl ) );
    p.x += sin( tl * 4.3 + ph ) * amp;
    p.z += cos( tl * 3.7 + ph * 1.3 ) * amp;
  }
  if ( landed ) p.y = aPhys.z + 0.02;

  float sc;
  if ( aColB.a < 0.5 ) {
    sc = min( 1.0, 0.55 + age * 14.0 ) * ( 1.0 - smoothstep( 0.72, 1.0, u ) );
  } else {
    sc = ( 0.35 + 0.65 * ( 1.0 - exp( -age * 11.0 ) ) ) * ( 1.0 + 0.45 * u ) * ( 1.0 - smoothstep( 0.6, 1.0, u ) );
  }

  float size = aShape.y * sc;
  float aspect = aLook.z;
  float fold = landed ? 0.0 : aLook.y;
  float side = position.z;
  float a = fold * 0.5;
  vec3 lp = vec3( position.x * aspect * cos( a ), position.y, -abs( position.x ) * aspect * sin( a ) ) * size;
  vec3 ln = vec3( side * sin( a ), 0.0, cos( a ) );

  vec3 camR = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
  vec3 camU = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
  vec3 camF = vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] );

  float mode = aShape.w;
  float ang = aLook.x * tl + seed * 6.2831853;
  vec3 wp;
  vec3 wn;
  if ( mode < 0.5 ) {
    mat3 R;
    if ( landed ) {
      float yw = seed * 6.2831853;
      float c = cos( yw ), s = sin( yw );
      R = mat3( vec3( c, 0.0, s ), vec3( s, 0.0, -c ), vec3( 0.0, 1.0, 0.0 ) );
    } else {
      vec3 ax = normalize( hash3( seed ) - 0.5 + vec3( 0.0, 1e-3, 0.0 ) );
      R = axisAngle( ax, ang );
    }
    wp = R * lp;
    wn = R * ln;
  } else if ( mode < 1.5 ) {
    float c = cos( ang ), s = sin( ang );
    wp = camR * ( c * lp.x - s * lp.y ) + camU * ( s * lp.x + c * lp.y ) + camF * lp.z;
    wn = camR * ( c * ln.x - s * ln.y ) + camU * ( s * ln.x + c * ln.y ) + camF * ln.z;
  } else if ( mode < 2.5 ) {
    float c = cos( ang ), s = sin( ang );
    wp = camR * ( c * lp.x + s * lp.z ) + camU * lp.y + camF * ( -s * lp.x + c * lp.z );
    wn = camR * ( c * ln.x + s * ln.z ) + camU * ln.y + camF * ( -s * ln.x + c * ln.z );
  } else {
    vec3 dir = dot( vel, vel ) > 1e-6 ? normalize( vel ) : camU;
    vec3 toCam = normalize( cameraPosition - p );
    vec3 wide = cross( dir, toCam );
    wide = dot( wide, wide ) > 1e-8 ? normalize( wide ) : camR;
    wp = wide * lp.x + dir * lp.y;
    wn = toCam;
  }

  vec4 mvPosition = viewMatrix * vec4( p + wp, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  vUv = position.xy;
  vN = wn;
  vColA = aColA;
  vColB = aColB;
  vInfo = vec3( aShape.x, seed, u );
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform vec3 uInk;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
varying vec2 vUv;
varying vec3 vN;
varying vec4 vColA;
varying vec4 vColB;
varying vec3 vInfo;
#include <fog_pars_fragment>

float hash1( float n ) { return fract( sin( n ) * 43758.5453 ); }

float sdTri( vec2 p, float r ) {
  const float k = 1.7320508;
  p.x = abs( p.x ) - r;
  p.y = p.y + r / k;
  if ( p.x + k * p.y > 0.0 ) p = vec2( p.x - k * p.y, -k * p.x - p.y ) / 2.0;
  p.x -= clamp( p.x, -2.0 * r, 0.0 );
  return -length( p ) * sign( p.y );
}

float sdStar5( vec2 p, float r, float rf ) {
  const vec2 k1 = vec2( 0.809016994375, -0.587785252292 );
  const vec2 k2 = vec2( -0.809016994375, -0.587785252292 );
  p.x = abs( p.x );
  p -= 2.0 * max( dot( k1, p ), 0.0 ) * k1;
  p -= 2.0 * max( dot( k2, p ), 0.0 ) * k2;
  p.x = abs( p.x );
  p.y -= r;
  vec2 ba = rf * vec2( -k1.y, k1.x ) - vec2( 0.0, 1.0 );
  float h = clamp( dot( p, ba ) / dot( ba, ba ), 0.0, r );
  return length( p - ba * h ) * sign( p.y * ba.x - p.x * ba.y );
}

// Crumpled puff: a cloud of six seeded lobes around a core, like the book's hanging clouds; the
// nearest lobe picks the facet tone and the seam between two lobes is a crease.
float sdPuff( vec2 p, float seed, out float facet, out float crease ) {
  float best = 1e3;
  float second = 1e3;
  float bi = 0.0;
  for ( int i = 0; i < 6; i ++ ) {
    float fi = float( i );
    float a = fi * 1.0471976 + seed * 6.2831853;
    float rr = 0.34 + 0.12 * hash1( seed * 17.3 + fi * 2.1 );
    vec2 c = vec2( cos( a ), sin( a ) ) * ( 0.46 + 0.05 * hash1( seed * 5.1 + fi ) );
    float di = length( p - c ) - rr;
    if ( di < best ) { second = best; best = di; bi = fi; }
    else if ( di < second ) second = di;
  }
  facet = bi;
  crease = second - best;
  return min( length( p ) - 0.5, best );
}

void main() {
  vec2 p = vUv;
  float id = vInfo.x;
  float seed = vInfo.y;
  float d;
  float facet = -1.0;
  float crease = 1.0;
  float shade = 1.0;
  float alphaK = 1.0;
  if ( id < 0.5 ) {
    d = sdTri( p + vec2( 0.0, 0.24 ), 0.95 );
  } else if ( id < 1.5 ) {
    d = abs( p.x ) - 0.92 * ( 1.0 - p.y * p.y );
  } else if ( id < 2.5 ) {
    d = sdStar5( p * 1.04, 0.95, 0.46 );
  } else if ( id < 3.5 ) {
    vec2 q = abs( p );
    d = max( max( q.x, q.y ) - 0.9, q.x + q.y - 1.45 - 0.2 * hash1( seed * 3.1 ) );
  } else if ( id < 4.5 ) {
    d = sdPuff( p, seed, facet, crease );
    shade = 0.78 + 0.22 * hash1( seed * 7.7 + facet * 3.3 );
  } else {
    // ink stroke: thick head (+y), thin tail, fading tail
    float t = p.y * 0.5 + 0.5;
    d = abs( p.x ) - 0.95 * ( 0.2 + 0.8 * t * t ) * ( 1.0 - smoothstep( 0.86, 1.0, t ) * 0.9 );
    alphaK = 0.8 * smoothstep( 0.0, 0.45, t );
  }
  float w = max( fwidth( d ), 1e-4 );
  float alpha = ( 1.0 - smoothstep( -w * 0.5, w * 0.5, d ) ) * alphaK;
  if ( alpha < 0.02 ) discard;

  vec3 n = normalize( vN );
  vec3 base = gl_FrontFacing ? vColA.rgb : vColB.rgb;
  if ( !gl_FrontFacing ) n = -n;
  float nl = dot( n, uSunDir );
  float band = nl >= 0.3333 ? 1.0 : ( nl >= -0.3333 ? 0.7 : 0.38 );
  vec3 lit = base * ( uAmb + uSunCol * band ) * 0.31830989;
  vec3 col = mix( lit, base, vColA.a ) * shade;

  // cut edge inked about 1.3 px wide; fades out when the piece is only a few pixels big
  float lineW = 1.3 * w;
  float edge = smoothstep( -lineW - w * 0.5, -lineW + w * 0.5, d ) * smoothstep( 0.4, 0.14, w );
  if ( id > 4.5 ) edge = 0.0;
  if ( facet >= 0.0 ) {
    float seam = ( 1.0 - smoothstep( w * 0.8, w * 2.2, crease ) ) * smoothstep( 0.0, -w * 3.0, d );
    edge = max( edge, seam * 0.45 * smoothstep( 0.4, 0.14, w ) );
  }
  col = mix( col, uInk, edge * 0.9 );

  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// Two half-quads meeting at the crease x = 0; z carries the half (-1 left, +1 right) so the
// vertex shader can fold them.
function foldedCardGeometry() {
  const P = [];
  const quad = (x0, x1, s) => {
    P.push(x0, -1, s, x1, -1, s, x1, 1, s, x0, -1, s, x1, 1, s, x0, 1, s);
  };
  quad(-1, 0, -1);
  quad(0, 1, 1);
  return new Float32Array(P);
}

export function createBits(game, { capacity = 2048 } = {}) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(foldedCardGeometry(), 3));
  const arr = {};
  const attr = {};
  for (const name of ATTRS) {
    arr[name] = new Float32Array(capacity * 4);
    attr[name] = new THREE.InstancedBufferAttribute(arr[name], 4);
    attr[name].setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr[name]);
  }
  // Unused slots are born dead: spawn time far in the future.
  for (let i = 0; i < capacity; i++) { arr.aP0[i * 4 + 3] = NEVER; arr.aV0[i * 4 + 3] = 1; }
  geo.instanceCount = 0;

  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uInk: game.materials.uniforms.uInk,
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uSunCol: { value: new THREE.Color(2, 2, 2) },
    uAmb: { value: new THREE.Color(1.2, 1.2, 1.2) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'fx:bits', uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:bits';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.matrixAutoUpdate = false;

  let head = 0;
  let highest = 0;
  let lastDeath = -1;
  let dirtyLo = Infinity, dirtyHi = -1, wrapped = false;
  let spawned = 0;

  // Reusable spawn description: callers fill it and pass it to emit().
  const spec = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.5, delay: 0,
    drag: 2, grav: 9, floor: -1e4,
    shape: SHAPE.TRI, size: 0.1, mode: MODE.TUMBLE, spin: 10, fold: 0.8, aspect: 1, flutter: 0,
    colA: new THREE.Color(1, 1, 1), glow: 0, colB: new THREE.Color(1, 1, 1), grow: GROW.POP,
  };

  function heightAt(t, y0, vy0, k, g) {
    const fk = (1 - Math.exp(-k * t)) / k;
    return y0 + vy0 * fk - g * (t - fk) / k;
  }

  // Age at which the piece reaches its floor (NEVER when it does not within its life).
  function landingAge(s) {
    if (s.grav <= 0 || s.floor <= -1e3) return NEVER;
    const k = Math.max(s.drag, 0.01);
    const n = 10;
    let prev = 0;
    for (let i = 1; i <= n; i++) {
      const t = (s.life * i) / n;
      if (heightAt(t, s.y, s.vy, k, s.grav) <= s.floor) {
        let lo = prev, hi = t;
        for (let j = 0; j < 7; j++) {
          const m = (lo + hi) * 0.5;
          if (heightAt(m, s.y, s.vy, k, s.grav) <= s.floor) hi = m; else lo = m;
        }
        return hi;
      }
      prev = t;
    }
    return NEVER;
  }

  function emit(s = spec) {
    const i = head;
    head++;
    if (head >= capacity) { head = 0; wrapped = true; }
    if (i + 1 > highest) highest = i + 1;
    if (i < dirtyLo) dirtyLo = i;
    if (i > dirtyHi) dirtyHi = i;
    const o = i * 4;
    const t0 = uniforms.uTime.value + s.delay;
    if (s.y < s.floor) s.floor = s.y - 0.01;
    let a = arr.aP0; a[o] = s.x; a[o + 1] = s.y; a[o + 2] = s.z; a[o + 3] = t0;
    a = arr.aV0; a[o] = s.vx; a[o + 1] = s.vy; a[o + 2] = s.vz; a[o + 3] = s.life;
    a = arr.aPhys; a[o] = s.drag; a[o + 1] = s.grav; a[o + 2] = s.floor; a[o + 3] = landingAge(s);
    a = arr.aShape; a[o] = s.shape; a[o + 1] = s.size; a[o + 2] = (spawned * 0.618034 + Math.abs(s.x) * 0.013) % 1; a[o + 3] = s.mode;
    a = arr.aLook; a[o] = s.spin; a[o + 1] = s.fold; a[o + 2] = s.aspect; a[o + 3] = s.flutter;
    a = arr.aColA; a[o] = s.colA.r; a[o + 1] = s.colA.g; a[o + 2] = s.colA.b; a[o + 3] = s.glow;
    a = arr.aColB; a[o] = s.colB.r; a[o + 1] = s.colB.g; a[o + 2] = s.colB.b; a[o + 3] = s.grow;
    spawned++;
    const death = t0 + s.life;
    if (death > lastDeath) lastDeath = death;
    s.delay = 0;
  }

  function flush() {
    if (dirtyHi >= 0) {
      for (const name of ATTRS) {
        const at = attr[name];
        at.clearUpdateRanges();
        // A wrap inside one frame leaves two dirty spans; upload the whole pool then.
        if (wrapped || dirtyHi - dirtyLo + 1 >= capacity) at.addUpdateRange(0, capacity * 4);
        else at.addUpdateRange(dirtyLo * 4, (dirtyHi - dirtyLo + 1) * 4);
        at.needsUpdate = true;
      }
      dirtyLo = Infinity; dirtyHi = -1; wrapped = false;
    }
    geo.instanceCount = uniforms.uTime.value < lastDeath ? highest : 0;
  }

  function setTime(t) { uniforms.uTime.value = t; }

  function alive() { return uniforms.uTime.value < lastDeath; }

  function dispose() {
    mesh.parent?.remove(mesh);
    geo.dispose();
    mat.dispose();
  }

  return { mesh, uniforms, spec, emit, flush, setTime, alive, dispose, get spawned() { return spawned; }, capacity };
}
