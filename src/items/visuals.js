// Item visuals: one InstancedMesh per kind (hidden while empty, so an empty frame costs no draw call),
// per-kart pens and foil shells, and visual-only particle pools. Reads the simulation state from
// items.js and never writes it.
import * as THREE from 'three';
import { clamp, lerpAngle, smoothstep } from '../core/math.js';
import {
  bottleGeometry, boxAtlas, boxGeometry, discGeometry, dropGeometry, flyerGeometry, foilShellGeometry,
  gumGeometry, gumSeeds, penGeometry, scissorsHalfGeometry, splatGeometry,
} from './shapes.js';

const CAP = { gum: 72, flyer: 16, pen: 40, bottle: 4, drop: 72, scissors: 4, decal: 72 };
const TUMBLES = 8;
// Flight-path trail: samples every TRAIL_DT s, each lives TRAIL_LIFE s (≈ 20 m behind a plane).
const TRAIL_N = 12;
const TRAIL_DT = 0.045;
const TRAIL_LIFE = 0.5;
// Planes fly visually a little higher than they hit (sim hover 0.75 m), so they clear the kart's own
// silhouette in the chase view almost at once; the hit test still uses the simulated height.
const FLYER_LIFT = 0.5;
// The boxes' own paper, the same on every chapter: they must read at a glance by day and by night,
// and a theme's accents can be two near-identical yellows and a cream (Boğaz Gecesi).
// Cells: 0 = front/back faces, 1 = top/bottom, 2 = left/right.
const BOX_PAPER = ['#ffbf1f', '#2f7fe6', '#f0506e'];

// Self-lit share of the box paper, and the printed "?" drawn at full albedo like a lit sign. The "?" is
// the only near-white print in the atlas, so its mask is the texel's darkest channel.
const BOX_LIGHT_GLSL = /* glsl */`
{
  float kkQ = gl_FrontFacing ? smoothstep( 0.62, 0.74, min( min( diffuseColor.r, diffuseColor.g ), diffuseColor.b ) ) : 0.0;
  outgoingLight = mix( outgoingLight, diffuseColor.rgb * ( 1.0 + 0.12 * kkQ ), max( uSelfLit, kkQ ) );
}
`;

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
const Z_ID = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _km = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _p3 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _col = new THREE.Color();

// Box net: side faces swing out about their bottom edge, the lid rides on the front face and opens
// about its own hinge. Faces fall open in sequence so the unfold reads as paper, not a scale-down.
const FOLD_GLSL = /* glsl */`
{
  float h = uHalf;
  float st = aFace < 0.5 ? 0.0 : aFace < 1.5 ? 0.0 : aFace < 2.5 ? 0.3 : aFace < 3.5 ? 0.12 : aFace < 4.5 ? 0.2 : 0.36;
  // the stagger only delays opening; a negative fold (the refold snap) applies to every face alike
  float u = aFold < 0.0 ? max( aFold, -0.25 ) : clamp( ( aFold - st ) / ( 1.0 - st ), 0.0, 1.0 );
  float th = u * 1.5707963;
  if ( aFace > 0.5 && aFace < 4.5 ) {
    vec3 n = aFace < 1.5 ? vec3( 0.0, 0.0, 1.0 ) : aFace < 2.5 ? vec3( 0.0, 0.0, -1.0 ) : aFace < 3.5 ? vec3( 1.0, 0.0, 0.0 ) : vec3( -1.0, 0.0, 0.0 );
    float y = transformed.y;
    vec3 tang = transformed - n * dot( transformed, n );
    tang.y = 0.0;
    transformed = n * h + y * ( cos( th ) * vec3( 0.0, 1.0, 0.0 ) + sin( th ) * n ) + tang;
  } else if ( aFace > 4.5 ) {
    float thF = clamp( aFold, -0.25, 1.0 ) * 1.5707963;
    vec3 n = vec3( 0.0, 0.0, 1.0 );
    vec3 hinge = n * h + 2.0 * h * ( cos( thF ) * vec3( 0.0, 1.0, 0.0 ) + sin( thF ) * n );
    float a = thF + th;
    vec3 D = sin( a ) * vec3( 0.0, 1.0, 0.0 ) - cos( a ) * n;
    transformed = hinge + ( h - transformed.z ) * D + vec3( transformed.x, 0.0, 0.0 );
  }
}
`;

// Cellophane and gold foil. The clear body is nearly invisible face-on and turns to a gold rim at grazing
// angles, cut into two hard bands like a printed highlight; the crinkled facets (flat normals) flash
// white where they mirror the sun, and a glint band sweeps along the wrap. The twisted ends (vKkEnd)
// are opaque gold foil with the same glints.
const FOIL_GLSL = /* glsl */`
{
  vec3 kkV = normalize( vViewPosition );
  vec3 kkL = vec3( 0.3, 0.9, 0.3 );
  #if NUM_DIR_LIGHTS > 0
    kkL = directionalLights[ 0 ].direction;
  #endif
  float kkNV = abs( dot( normal, kkV ) );
  float kkRim = 1.0 - kkNV;
  float kkRimBand = 0.5 * step( 0.5, kkRim ) + 0.5 * step( 0.78, kkRim );
  float kkSpec = step( 0.8, pow( max( dot( reflect( -kkV, normal ), kkL ), 0.0 ), 10.0 ) );
  float kkBand = step( 0.93, sin( dot( vKkObj, vec3( 0.55, 1.3, 0.8 ) ) * 2.6 - uTime * 6.0 ) );
  vec3 kkGold = vec3( 0.93, 0.62, 0.12 );
  vec3 kkPale = vec3( 1.0, 0.93, 0.66 );
  vec3 kkClear = mix( kkPale, kkGold, kkRimBand * 0.6 );
  float kkA = 0.07 + 0.5 * kkRimBand + 0.75 * max( kkSpec, kkBand * 0.8 );
  vec3 kkEndCol = mix( outgoingLight, kkPale, 0.65 * max( kkSpec, kkBand ) );
  vec3 kkBodyCol = mix( kkClear, vec3( 1.0, 0.98, 0.9 ), max( kkSpec, kkBand ) );
  outgoingLight = mix( kkBodyCol, kkEndCol, vKkEnd );
  diffuseColor.a = mix( clamp( kkA, 0.0, 0.92 ), 1.0, vKkEnd );
}
`;

// Crumpled-paper print for the gum: cells around designed seed points on the unit sphere, a pressed
// crease where two cells meet and a slightly different tone per cell, all in object space.
function gumPrint(seeds) {
  const n = seeds.length;
  const arr = seeds.map((s) => `vec3( ${s.map((x) => x.toFixed(4)).join(', ')} )`).join(', ');
  return /* glsl */`
{
  const vec3 kkSeeds[ ${n} ] = vec3[ ${n} ]( ${arr} );
  vec3 kkQ = normalize( vKkObj + vec3( 1e-4 ) );
  float kkD1 = 9.0;
  float kkD2 = 9.0;
  float kkId = 0.0;
  for ( int i = 0; i < ${n}; i ++ ) {
    float d = distance( kkQ, kkSeeds[ i ] );
    if ( d < kkD1 ) { kkD2 = kkD1; kkD1 = d; kkId = float( i ); }
    else if ( d < kkD2 ) kkD2 = d;
  }
  float kkE = kkD2 - kkD1;
  float kkW = fwidth( kkE ) + 1e-4;
  float kkCrease = 1.0 - smoothstep( 0.02, 0.02 + 1.5 * kkW, kkE );
  // blown into a bubble the paper shows its gores instead: six meridian folds, fading at the poles
  float kkAz = atan( kkQ.z, kkQ.x ) * 0.9549297 + 0.5;
  float kkG = abs( fract( kkAz ) - 0.5 );
  float kkGore = ( 1.0 - smoothstep( 0.012, 0.04, kkG ) ) * ( 1.0 - smoothstep( 0.75, 0.95, abs( kkQ.y ) ) );
  float kkLine = mix( kkCrease, kkGore, vKkBub );
  diffuseColor.rgb *= mix( 0.95 + 0.1 * fract( kkId * 0.618 ), 1.0, vKkBub ) * ( 1.0 - 0.3 * kkLine );
}
`;
}

// Printed gloss on the gum, as on a cartoon bubble: a hot spot and a crescent towards the upper left in
// view space, drawn unlit; the rest keeps a self-lit share so the pink holds at night.
const GUM_GLOSS_GLSL = /* glsl */`
{
  outgoingLight = mix( outgoingLight, diffuseColor.rgb, uSelfLit );
  vec3 kkN = normalize( normal );
  vec3 kkS = normalize( vec3( -0.42, 0.55, 0.72 ) );
  float kkD = dot( kkN, kkS );
  float kkW = fwidth( kkD ) + 1e-4;
  float kkSpot = smoothstep( 0.962 - kkW, 0.962 + kkW, kkD );
  float kkRing = smoothstep( 0.8 - kkW, 0.8 + kkW, kkD ) * ( 1.0 - smoothstep( 0.875 - kkW, 0.875 + kkW, kkD ) );
  vec2 kkDir = normalize( kkS.xy );
  float kkOuter = step( length( kkS.xy ) + 0.05, dot( kkN.xy, kkDir ) );
  float kkGloss = max( kkSpot, kkRing * kkOuter );
  outgoingLight = mix( outgoingLight, vec3( 1.0, 0.94, 0.97 ), kkGloss * 0.95 );
}
`;

export function createItemVisuals(game, sim) {
  const T = sim.TUNE;
  const mats = game.materials;
  const theme = game.trackDef?.theme || {};
  const ink = theme.ink || '#2d2a32';
  const paperCol = theme.paper || '#f3ead3';
  const roadC = new THREE.Color(theme.road || '#9aa1a8');
  const night = 0.2126 * roadC.r + 0.7152 * roadC.g + 0.0722 * roadC.b < 0.2;
  const sunDir = new THREE.Vector3(...(theme.sun?.dir || [0.45, 0.8, 0.35])).normalize();
  const karts = game.karts;
  const camPos = game.camera.position;

  const root = new THREE.Group();
  root.name = 'items';
  const geos = [];
  const uniqueMats = [];
  const textures = [];
  const meshes = [];

  function geo(g) { geos.push(g); return g; }

  function extend(m, tag, fn) {
    const base = m.onBeforeCompile;
    const key = m.customProgramCacheKey();
    m.onBeforeCompile = (shader, renderer) => { base.call(m, shader, renderer); fn(shader); };
    m.customProgramCacheKey = () => key + ':items-' + tag;
    uniqueMats.push(m);
    return m;
  }

  function inst(g, mat, cap, name, receive = false) {
    const m = new THREE.InstancedMesh(g, mat, cap);
    m.name = 'items:' + name;
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = receive;
    m.count = 0;
    m.visible = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(m);
    meshes.push(m);
    return m;
  }

  function finish(m, n) {
    m.count = n;
    m.visible = n > 0;
    if (n > 0) m.instanceMatrix.needsUpdate = true;
  }

  function setAt(mesh, i, pos, quat, sx, sy, sz) {
    _s.set(sx, sy, sz);
    _m.compose(pos, quat, _s);
    mesh.setMatrixAt(i, _m);
  }

  // Interpolated kart frame: core has already written visual.object3d for this frame.
  function kartFrame(k, out) {
    const o = k.visual?.object3d;
    return out.compose(o ? o.position : k.pos, o ? o.quaternion : k.quat, ONE);
  }

  const vertexColored = mats.paper('#ffffff', { vertexColors: true });

  // --- boxes -----------------------------------------------------------------------------------
  let boxMesh = null, foldAttr = null;
  const boxBase = [];
  const boxAngle = [];
  if (sim.boxes.length) {
    const atlas = boxAtlas(BOX_PAPER, '#2d2a32', '#fbf6e9', game.config.fonts?.body || 'system-ui, sans-serif');
    textures.push(atlas);
    const g = geo(boxGeometry(T.boxHalf));
    foldAttr = new THREE.InstancedBufferAttribute(new Float32Array(sim.boxes.length), 1);
    foldAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFold', foldAttr);
    const mat = extend(mats.paper('#ffffff', { unique: true, map: atlas, side: THREE.DoubleSide }), 'box', (shader) => {
      shader.uniforms.uHalf = { value: T.boxHalf };
      shader.uniforms.uBack = { value: new THREE.Color('#fbf6e9').multiplyScalar(0.94) };
      shader.uniforms.uSelfLit = { value: night ? 0.42 : 0.16 };
      shader.vertexShader = 'attribute float aFace;\nattribute float aFold;\nuniform float uHalf;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FOLD_GLSL);
      // the inside of the paper shows once the cube lies open on the page
      shader.fragmentShader = 'uniform vec3 uBack;\nuniform float uSelfLit;\n' +
        shader.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\nif ( !gl_FrontFacing ) diffuseColor.rgb = uBack;')
          .replace('#include <opaque_fragment>', BOX_LIGHT_GLSL + '\n#include <opaque_fragment>');
    });
    boxMesh = inst(g, mat, sim.boxes.length, 'boxes', true);
    for (let i = 0; i < sim.boxes.length; i++) {
      boxBase.push(new THREE.Quaternion().setFromUnitVectors(Y, sim.boxes[i].up));
      boxAngle.push(i * 0.9);
    }
  }

  // --- gum, gum bits, strings (one mesh) --------------------------------------------------------
  const gumGeo = geo(gumGeometry());
  const bubAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP.gum), 1);
  bubAttr.setUsage(THREE.DynamicDrawUsage);
  gumGeo.setAttribute('aGumBub', bubAttr);
  const gumMat = extend(mats.paper('#ffffff', { unique: true, vertexColors: true, flat: false }), 'gum', (shader) => {
    shader.uniforms.uSelfLit = { value: night ? 0.3 : 0.06 };
    shader.vertexShader = 'attribute vec3 aBub;\nattribute float aGumBub;\nvarying vec3 vKkObj;\nvarying float vKkBub;\n' +
      shader.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize( mix( objectNormal, aBub, max( aGumBub, 0.72 ) ) );')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = mix( transformed, aBub, aGumBub );\nvKkObj = aBub;\nvKkBub = aGumBub;');
    shader.fragmentShader = 'varying vec3 vKkObj;\nvarying float vKkBub;\nuniform float uSelfLit;\n' +
      shader.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + gumPrint(gumSeeds(9)))
        .replace('#include <opaque_fragment>', GUM_GLOSS_GLSL + '\n#include <opaque_fragment>');
  });
  const gumMesh = inst(gumGeo, gumMat, CAP.gum, 'gum', true);
  // Ink: glossy teardrops in the air, flat lobed splats where they land or burst.
  const dropMesh = inst(geo(dropGeometry()), vertexColored, CAP.drop, 'ink-drops');
  const splatMesh = inst(geo(splatGeometry()), vertexColored, CAP.drop, 'ink-splats');

  // --- flyers: plane + homing share one mesh ----------------------------------------------------
  const flyerGeo = geo(flyerGeometry());
  const kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAP.flyer), 1);
  kindAttr.setUsage(THREE.DynamicDrawUsage);
  flyerGeo.setAttribute('aKind', kindAttr);
  const flyerMat = extend(mats.paper('#ffffff', { unique: true, vertexColors: true, side: THREE.DoubleSide }), 'flyer', (shader) => {
    shader.uniforms.uStripe = { value: new THREE.Color('#d9483b') };
    shader.vertexShader = 'attribute float aStripe;\nattribute float aFin;\nattribute float aKind;\nvarying float vStripe;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= mix( 1.0, aKind, aFin );\nvStripe = aStripe * aKind;');
    shader.fragmentShader = 'varying float vStripe;\nuniform vec3 uStripe;\n' +
      shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, uStripe, step( 0.5, vStripe ) );');
  });
  const flyerMesh = inst(flyerGeo, flyerMat, CAP.flyer, 'flyers');

  const penMesh = inst(geo(penGeometry()), vertexColored, CAP.pen, 'pens');
  const bottleMesh = inst(geo(bottleGeometry()), vertexColored, CAP.bottle, 'ink-bottles');
  const scissorsMesh = inst(geo(scissorsHalfGeometry()), vertexColored, CAP.scissors, 'scissors');
  const decalMesh = inst(geo(discGeometry()), mats.emissive(ink, { transparent: true, opacity: 0.3 }), CAP.decal, 'shadows');
  decalMesh.renderOrder = -1;
  // A plane's flight path, drawn behind it as a dashed line like in a picture book: ink by day, paper by
  // night, red for the homing plane.
  const dashMesh = inst(geo(new THREE.BoxGeometry(1, 1, 1)), mats.emissive('#ffffff'), CAP.flyer * TRAIL_N, 'flight-dashes');
  dashMesh.setColorAt(0, _col.set('#ffffff'));
  const dashPlane = new THREE.Color(night ? '#f4e6c4' : '#3a3444');
  const dashHoming = new THREE.Color('#e0412f');
  const trails = [];
  for (let i = 0; i < CAP.flyer; i++) {
    trails.push({
      id: -1, seen: false, homing: false, xyz: new Float32Array(TRAIL_N * 3), at: new Float32Array(TRAIL_N),
      n: 0, head: 0, next: 0, tipX: 0, tipY: 0, tipZ: 0,
    });
  }
  dashMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

  // --- foil shells ------------------------------------------------------------------------------
  const shellGeo = geo(foilShellGeometry());
  const foilMat = extend(mats.paper('#e3a92c', { unique: true, transparent: true, depthWrite: false, halftone: false }), 'foil', (shader) => {
    shader.vertexShader = 'attribute float aEnd;\nvarying float vKkEnd;\nvarying vec3 vKkObj;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvKkEnd = aEnd;\nvKkObj = position;');
    shader.fragmentShader = 'varying float vKkEnd;\nvarying vec3 vKkObj;\n' +
      shader.fragmentShader.replace('#include <opaque_fragment>', FOIL_GLSL + '\n#include <opaque_fragment>');
  });
  // Present at setup so compileAsync builds its program before the first foil is used.
  const foilProbe = new THREE.Mesh(shellGeo, foilMat);
  foilProbe.visible = false;
  root.add(foilProbe);

  game.scene.add(root);

  // --- per-kart and visual-only state -----------------------------------------------------------
  const kvis = karts.map(() => ({
    firing: false, fireStart: 0, world: new THREE.Matrix4(), shell: null, shellParent: null, shellBorn: 0,
  }));
  const tumbles = [];
  for (let i = 0; i < TUMBLES; i++) tumbles.push({ on: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), t: 0 });
  const drops = [];
  for (let i = 0; i < CAP.drop; i++) drops.push({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), floor: 0, t: 0, size: 0.3, splat: -1, big: false, rot: i * 2.39996 });
  // per flying bottle (projectile id): the last trail slot it dripped in, and when it was last seen
  const inkTrail = new Map();
  const bits = [];
  for (let i = 0; i < 24; i++) bits.push({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), floor: 0, t: 0 });
  const snips = [];
  for (let i = 0; i < 3; i++) snips.push({ on: false, pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), t: 0 });

  let vt = 0;
  let seenSeq = sim.fxSeq;
  const FXQ = sim.fxq.length;

  function spawnTumble(worldM, k) {
    let tb = tumbles.find((x) => !x.on) || tumbles[0];
    worldM.decompose(tb.pos, tb.quat, _s);
    tb.on = true;
    tb.t = 0;
    _p.set(0, 0, -1).applyQuaternion(tb.quat);
    tb.vel.copy(k.vel).multiplyScalar(0.55).addScaledVector(_p, 2.5);
    tb.vel.y += 3.2;
    tb.axis.set(1, 0, 0).applyQuaternion(tb.quat);
  }

  function spawnInkBurst(pos) {
    const floor = pos.y - T.inkHeight;
    let n = 0;
    for (let i = 0; i < drops.length && n < 26; i++) {
      const d = drops[i];
      if (d.on) continue;
      d.on = true;
      d.t = 0;
      d.splat = -1;
      d.pos.copy(pos);
      d.floor = floor;
      if (n < 5) { // the bottle bursting: splashes that face the camera
        d.big = true;
        d.size = 1.3 + (n % 2) * 0.55;
        d.pos.x += Math.cos(n * 2.4) * 0.9;
        d.pos.y += Math.sin(n * 1.7) * 0.5;
        d.pos.z += Math.sin(n * 2.4) * 0.9;
        d.vel.set(0, 0, 0);
      } else {
        d.big = false;
        const a = n * 2.39996, e = -0.2 + (n % 4) * 0.22, s = 5 + (n % 3) * 2.6;
        d.vel.set(Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1.5, Math.sin(a) * Math.cos(e) * s);
        d.size = 0.3 + (n % 3) * 0.1;
      }
      n++;
    }
  }

  function spawnBits(pos) {
    let n = 0;
    for (let i = 0; i < bits.length && n < 6; i++) {
      const b = bits[i];
      if (b.on) continue;
      b.on = true;
      b.t = 0;
      b.pos.copy(pos);
      b.pos.y += 0.25;
      b.floor = pos.y;
      const a = n * 1.047 + 0.3;
      b.vel.set(Math.cos(a) * 3.2, 4 + (n % 2) * 1.5, Math.sin(a) * 3.2);
      n++;
    }
  }

  function consumeCues() {
    const s = sim.fxSeq;
    if (s === seenSeq) return;
    for (let q = Math.max(seenSeq + 1, s - FXQ + 1); q <= s; q++) {
      const e = sim.fxq[q % FXQ];
      if (e.seq !== q) continue;
      if (e.kind === 'pen' && e.kart) {
        const kv = kvis[e.kart.index];
        if (kv) {
          if (kv.firing) spawnTumble(kv.world, e.kart);
          kv.firing = true;
          kv.fireStart = vt;
        }
      } else if (e.kind === 'ink') spawnInkBurst(e.pos);
      else if (e.kind === 'pop') spawnBits(e.pos);
      else if (e.kind === 'snip') {
        const sn = snips.find((x) => !x.on) || snips[0];
        sn.on = true;
        sn.t = 0;
        sn.pos.copy(e.pos);
        sn.up.copy(e.kart?.trackInfo?.up || Y);
      }
    }
    seenSeq = s;
  }

  // --- decals (hard ink shadows under hovering things) -----------------------------------------
  let di = 0;
  function decal(x, gy, z, up, height, sx, sz, yaw) {
    if (di >= CAP.decal || sx <= 0.01) return;
    const k = Math.max(0, height) / Math.max(0.25, sunDir.y);
    _p3.set(x - sunDir.x * k, gy + 0.045, z - sunDir.z * k);
    _q3.setFromUnitVectors(Y, up || Y);
    _q2.setFromAxisAngle(Y, yaw);
    _q3.multiply(_q2);
    setAt(decalMesh, di++, _p3, _q3, sx, 1, sz);
  }

  // --- boxes ------------------------------------------------------------------------------------
  function foldOf(b, now, rm) {
    if (b.active) return 0;
    if (rm) return 1;
    const e = now - b.takenAt;
    if (e < 0.26) { const t = e / 0.26; return 1 - (1 - t) * (1 - t) * (1 - t); }
    if (e < 0.8) return 1;
    const t = Math.min(1, (e - 0.8) / 0.4) - 1;
    return -(1.9 + 1) * t * t * t - 1.9 * t * t; // 1 − easeOutBack: closes with a small snap past shut
  }

  function updateBoxes(now, rm, frameDt) {
    if (!boxMesh) return;
    const bs = sim.boxes;
    const h = T.boxHalf;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      const u = foldOf(b, now, rm);
      const open = clamp(u, 0, 1);
      if (b.active) boxAngle[i] += frameDt * (i % 2 ? 0.8 : -0.7);
      const bob = rm ? 0 : Math.sin(vt * 2.1 + i * 1.3) * 0.1;
      const lift = (T.boxHover + bob) * (1 - open) + 0.035 * open;
      _p.copy(b.pos).addScaledVector(b.up, lift);
      _q2.setFromAxisAngle(Y, boxAngle[i]);
      _q.multiplyQuaternions(boxBase[i], _q2);
      setAt(boxMesh, i, _p, _q, 1, 1, 1);
      foldAttr.array[i] = u;
      decal(b.pos.x, b.pos.y, b.pos.z, b.up, lift + h, 0.78 * (1 - open), 0.78 * (1 - open), boxAngle[i]);
    }
    foldAttr.needsUpdate = true;
    finish(boxMesh, bs.length);
  }

  // --- gum --------------------------------------------------------------------------------------
  // Held: a bubble blown from a chewed knot, trailing on a string of gum. Dropped: the bubble swells,
  // pops and splats into a flat chewed wad that wobbles to rest.
  const GUM_R = 0.42;
  function gumAt(n, pos, quat, sx, sy, sz, bub) {
    setAt(gumMesh, n, pos, quat, sx, sy, sz);
    bubAttr.array[n] = bub;
    return n + 1;
  }

  function updateGum(now, alpha, rm, frameDt) {
    let n = 0;
    const hz = sim.hazards;
    for (let i = 0; i < hz.length && n < CAP.gum - 3; i++) {
      const h = hz[i];
      if (h.dead) continue;
      const yaw = h.id * 2.4;
      if (h.held) {
        const k = h.held;
        kartFrame(k, _km);
        const sway = rm ? 0 : Math.sin(vt * 6 + h.id) * 0.18;
        const bob = rm ? 0 : Math.abs(Math.sin(vt * 9 + h.id)) * 0.06;
        _p.set(sway, 0, -T.gumBack).applyMatrix4(_km);
        _p.y = h.prevPos.y + (h.pos.y - h.prevPos.y) * alpha;
        _q.setFromUnitVectors(Y, h.up);
        _q2.setFromAxisAngle(Y, k.heading);
        _q.multiply(_q2);
        _p2.copy(_p).addScaledVector(h.up, GUM_R + 0.04 + bob);
        n = gumAt(n, _p2, _q, GUM_R, GUM_R, GUM_R, 1);
        // the chewed knot on the kart side, where the string holds the bubble
        _p3.set(0, 0, 1).applyQuaternion(_q).multiplyScalar(GUM_R * 0.92).add(_p2);
        n = gumAt(n, _p3, _q, 0.15, 0.12, 0.13, 0);
        // the string of gum from the kart's tail to the knot
        _p2.set(0, 0.42, -1.02).applyMatrix4(_km);
        const len = _p2.distanceTo(_p3);
        _p.addVectors(_p2, _p3).multiplyScalar(0.5);
        _p.y -= 0.06;
        _p2.sub(_p3).normalize();
        _q.setFromUnitVectors(Z, _p2);
        n = gumAt(n, _p, _q, 0.045, 0.045, len * 0.5, 1);
      } else {
        const age = now - h.dropT;
        let sxz = 0.8, sy = 0.34, lift = 0, bub = 0;
        if (!rm) {
          const fell = h.heldFor < 0.25;
          const fall = 0.14, swell = 0.08;
          if (fell && age < fall) {
            const t = age / fall;
            lift = 0.55 * (1 - t * t);
            sxz = sy = 0.3; bub = 1;
          } else if (!fell && age < swell) {
            bub = 1;
            sxz = sy = GUM_R * (1 + 0.3 * age / swell);
          } else {
            const t = age - (fell ? fall : swell);
            const w = Math.exp(-7 * t) * Math.cos(17 * t);
            sxz = 0.8 * (1 + 0.42 * w);
            sy = 0.34 * (1 - 0.55 * w);
          }
        }
        _q.setFromUnitVectors(Y, h.up);
        _q2.setFromAxisAngle(Y, yaw);
        _q.multiply(_q2);
        _p.copy(h.pos).addScaledVector(h.up, (bub ? sy + 0.04 : 0.45 * sy) + lift);
        n = gumAt(n, _p, _q, sxz, sy, sxz, bub);
      }
    }
    // gum bits from a burst blob
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      if (!b.on) continue;
      b.t += frameDt;
      if (b.t > 0.5 || n >= CAP.gum) { b.on = false; continue; }
      b.vel.y -= 16 * frameDt;
      b.pos.addScaledVector(b.vel, frameDt);
      if (b.pos.y < b.floor + 0.05) { b.pos.y = b.floor + 0.05; b.vel.multiplyScalar(0.4); }
      const s = 0.2 * (1 - smoothstep(0.3, 0.5, b.t));
      _q.identity();
      n = gumAt(n, b.pos, _q, s, s, s, 1);
    }
    if (n > 0) bubAttr.needsUpdate = true;
    finish(gumMesh, n);
  }

  // --- pens (rocket) ----------------------------------------------------------------------------
  // Held pens lie across the rear bumper, small and low, alternating nib left / right and fanned a
  // little, so from the chase camera they read side-on as pens and the driver's back stays clear.
  const STOW_S = 0.62;
  const STOW_LEN = 1.35 * STOW_S;
  function stowPose(s, n, out) {
    const dir = s % 2 ? -1 : 1;
    _p.set(dir * STOW_LEN * 0.5, 0.44 + s * 0.14, -1.22 - s * 0.04);
    // a small shared tilt, so the rack reads as clipped on by hand rather than welded square
    _e.set(-0.07 * dir, dir * Math.PI / 2, 0, 'YXZ');
    _q.setFromEuler(_e);
    _s.setScalar(STOW_S);
    return out.compose(_p, _q, _s);
  }

  // From the stowed pose the pen swings round behind the tail, nib back, and grows to full size.
  function firePose(t, rm, out) {
    const slide = smoothstep(0, 1, t / 0.12);
    const kick = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 9);
    const shake = rm ? 0 : 0.018;
    stowPose(0, 1, _m);
    _m.decompose(_p2, _q2, _s);
    _p.set(Math.sin(vt * 71) * shake, 0.6 + Math.sin(vt * 53) * shake, -1.06 - 0.28 * kick);
    _p.lerpVectors(_p2, _p, slide);
    _q.slerpQuaternions(_q2, Z_ID, slide);
    _s.setScalar(STOW_S + (1 - STOW_S) * slide);
    return out.compose(_p, _q, _s);
  }

  function updatePens(frameDt, rm) {
    let n = 0;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      const kv = kvis[i];
      const stow = k.roulette > 0 ? 0 : k.item === 'rocket' ? 1 : k.item === 'rocket3' ? Math.min(3, k.itemCount) : 0;
      if (!stow && !kv.firing) continue;
      kartFrame(k, _km);
      for (let s = 0; s < stow && n < CAP.pen; s++) {
        _m2.multiplyMatrices(_km, stowPose(s, stow, _m2.identity()));
        penMesh.setMatrixAt(n++, _m2);
      }
      if (kv.firing) {
        const t = vt - kv.fireStart;
        const burning = (k.boostTime > 0 && k.boostSource === 'item') || t < 0.25;
        if (!burning || k.respawn.active) {
          spawnTumble(kv.world, k);
          kv.firing = false;
        } else if (n < CAP.pen) {
          kv.world.multiplyMatrices(_km, firePose(t, rm, _m2.identity()));
          penMesh.setMatrixAt(n++, kv.world);
        }
      }
    }
    for (let i = 0; i < tumbles.length; i++) {
      const tb = tumbles[i];
      if (!tb.on) continue;
      tb.t += frameDt;
      if (tb.t > 0.9 || n >= CAP.pen) { tb.on = false; continue; }
      tb.vel.y -= 16 * frameDt;
      tb.pos.addScaledVector(tb.vel, frameDt);
      _q.setFromAxisAngle(tb.axis, 10 * frameDt);
      tb.quat.premultiply(_q);
      const s = 1 - smoothstep(0.6, 0.9, tb.t);
      setAt(penMesh, n++, tb.pos, tb.quat, s, s, s);
    }
    finish(penMesh, n);
  }

  // --- flight-path trails -------------------------------------------------------------------------
  function trailSample(p, tail) {
    let tr = null, free = null;
    for (let i = 0; i < trails.length; i++) {
      const t = trails[i];
      if (t.id === p.id) { tr = t; break; }
      if (!free && t.id < 0) free = t;
    }
    if (!tr) {
      tr = free;
      if (!tr) return;
      tr.id = p.id;
      tr.n = 0;
      tr.head = 0;
      tr.next = vt;
    }
    tr.seen = true;
    tr.homing = p.kind === 'homing';
    const o = tr.head * 3;
    if (vt >= tr.next || tr.n === 0) {
      tr.xyz[o] = tail.x; tr.xyz[o + 1] = tail.y; tr.xyz[o + 2] = tail.z;
      tr.at[tr.head] = vt;
      tr.head = (tr.head + 1) % TRAIL_N;
      tr.n = Math.min(TRAIL_N, tr.n + 1);
      tr.next = vt + TRAIL_DT;
    }
    tr.tipX = tail.x; tr.tipY = tail.y; tr.tipZ = tail.z;
  }

  // The path stays where it was drawn, so its oldest dashes fall behind the thrower; between the
  // camera and the kart it follows they would read as a pole stuck in that kart, so they are skipped.
  let dashNear = 0;
  function dash(ax, ay, az, bx, by, bz, w, col, n) {
    _p2.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    const d = camPos.distanceTo(_p2);
    if (d < dashNear) return n;
    _p.set(bx - ax, by - ay, bz - az);
    const len = _p.length();
    if (len < 0.05) return n;
    _p.multiplyScalar(1 / len);
    _q.setFromUnitVectors(Z, _p);
    const k = 1 + clamp((d - 8) * 0.02, 0, 0.7);
    setAt(dashMesh, n, _p2, _q, w * k, w * k, len);
    dashMesh.setColorAt(n, col);
    return n + 1;
  }

  // Dashes cover the middle of each gap between samples, so the line is dashed and stays put in the
  // world while the plane draws it; each dash thins out as it ages.
  function updateTrails() {
    let n = 0;
    const tgt = game.cameraRig?.target;
    const tp = tgt?.visual?.object3d?.position || tgt?.pos;
    dashNear = tp && !game.cameraRig.override && !game.cameraRig.debugMode ? camPos.distanceTo(tp) + 1.5 : 0;
    for (let i = 0; i < trails.length; i++) {
      const tr = trails[i];
      if (tr.id < 0) continue;
      const newest = (tr.head - 1 + TRAIL_N) % TRAIL_N;
      if (!tr.seen && (tr.n === 0 || vt - tr.at[newest] > TRAIL_LIFE)) { tr.id = -1; tr.n = 0; continue; }
      const col = tr.homing ? dashHoming : dashPlane;
      // while the plane flies, the newest dash runs from its tail to the last sample
      let ax = tr.tipX, ay = tr.tipY, az = tr.tipZ;
      let j = 0;
      if (!tr.seen) {
        ax = tr.xyz[newest * 3]; ay = tr.xyz[newest * 3 + 1]; az = tr.xyz[newest * 3 + 2];
        j = 1;
      }
      for (; j < tr.n && n < CAP.flyer * TRAIL_N; j++) {
        const s = (tr.head - 1 - j + TRAIL_N * 2) % TRAIL_N;
        const age = vt - tr.at[s];
        if (age > TRAIL_LIFE) break;
        const bx = tr.xyz[s * 3], by = tr.xyz[s * 3 + 1], bz = tr.xyz[s * 3 + 2];
        const w = 0.13 * Math.sqrt(1 - age / TRAIL_LIFE);
        n = dash(ax + (bx - ax) * 0.22, ay + (by - ay) * 0.22, az + (bz - az) * 0.22,
          ax + (bx - ax) * 0.78, ay + (by - ay) * 0.78, az + (bz - az) * 0.78, w, col, n);
        ax = bx; ay = by; az = bz;
      }
      tr.seen = false;
    }
    if (n > 0) dashMesh.instanceColor.needsUpdate = true;
    finish(dashMesh, n);
  }

  // --- projectiles ------------------------------------------------------------------------------
  function updateProjectiles(alpha) {
    let nf = 0, nb = 0, ns = 0;
    const ps = sim.projectiles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.dead) continue;
      _p.lerpVectors(p.prevPos, p.pos, alpha);
      const heading = lerpAngle(p.prevHeading, p.heading, alpha);
      if ((p.kind === 'plane' || p.kind === 'homing') && nf < CAP.flyer) {
        let pitch = 0, roll = 0;
        if (p.kind === 'plane') {
          const f = p.age - p.flipAt;
          roll = (f < 0.4 ? Math.PI * 2 * smoothstep(0, 1, f / 0.4) : 0) + Math.sin(p.age * 7 + p.id) * 0.08;
        } else {
          roll = clamp(-p.turnRate * 0.22, -0.7, 0.7) + Math.sin(p.age * 12 + p.id) * 0.14;
          pitch = Math.sin(p.age * 9 + p.id) * 0.06;
        }
        if (p.falling) pitch = Math.min(1.2, (p.age - p.fallAt) * 2.2);
        _p.y += Math.sin(p.age * 8 + p.id) * 0.06 + FLYER_LIFT * smoothstep(0, 0.18, p.age);
        _e.set(pitch, heading, roll, 'YXZ');
        _q.setFromEuler(_e);
        // grows with distance so a plane far down the road is still a plane, not a speck
        const sc = 1 + clamp((camPos.distanceTo(_p) - 8) * 0.02, 0, 0.7);
        setAt(flyerMesh, nf, _p, _q, sc, sc, sc);
        kindAttr.array[nf] = p.kind === 'homing' ? 1 : 0;
        nf++;
        if (!p.falling) decal(_p.x, p.groundY, _p.z, p.up, _p.y - p.groundY, 0.5 * sc, 0.95 * sc, heading);
        // the trail starts at the tail
        _p2.set(0, 0, -1.2 * sc).applyQuaternion(_q).add(_p);
        trailSample(p, _p2);
      } else if (p.kind === 'ink' && nb < CAP.bottle) {
        // a slow tumble so the bottle's shape reads, spilling from its open mouth as it goes
        _p2.set(Math.cos(heading), 0, -Math.sin(heading));
        _q.setFromAxisAngle(_p2, 0.6 + p.age * 5.5);
        _q2.setFromAxisAngle(Y, heading);
        _q.multiply(_q2);
        setAt(bottleMesh, nb++, _p, _q, 1, 1, 1);
        decal(_p.x, p.to.y, _p.z, Y, _p.y - p.to.y, 0.6, 0.6, 0);
        dripInk(p, _p, _q);
      } else if (p.kind === 'scissors' && ns + 2 <= CAP.scissors) {
        let open, pitch = 0, scale = 1;
        if (p.phase < 2) {
          open = 0.14 + 0.5 * (0.5 + 0.5 * Math.sin(p.age * 13));
          pitch = Math.sin(p.age * 3) * 0.08;
          if (p.phase === 0) scale = 0.45 + 0.55 * smoothstep(0, 1, p.phaseT / T.scissorsRise);
        } else {
          const u = p.phaseT / T.scissorsDive;
          open = 0.95 * (1 - smoothstep(0.72, 1, u));
          pitch = 0.75 * smoothstep(0, 0.4, u);
        }
        _e.set(pitch, heading, 0, 'YXZ');
        _q.setFromEuler(_e);
        _q2.setFromAxisAngle(Y, -open / 2);
        _q3.multiplyQuaternions(_q, _q2);
        setAt(scissorsMesh, ns++, _p, _q3, scale, scale, scale);
        _q2.setFromAxisAngle(Y, open / 2);
        _q3.multiplyQuaternions(_q, _q2);
        _q2.setFromAxisAngle(Z, Math.PI);
        _q3.multiply(_q2);
        setAt(scissorsMesh, ns++, _p, _q3, scale, scale, scale);
        const high = Math.max(0, _p.y - p.groundY);
        decal(_p.x, p.groundY, _p.z, Y, high, 1.6 + Math.max(0, 9 - high) * 0.06, 1.1, heading);
      }
    }
    kindAttr.needsUpdate = nf > 0;
    finish(flyerMesh, nf);
    updateTrails();
    finish(bottleMesh, nb);
    finish(scissorsMesh, ns);
  }

  // One drop from the bottle's mouth every 50 ms of its flight: a trail of ink falling onto the road.
  function dripInk(p, pos, quat) {
    const slot = Math.floor(p.age / 0.05);
    const e = inkTrail.get(p.id);
    if (e) e.seen = vt;
    if (e && slot <= e.slot) return;
    inkTrail.set(p.id, { slot, seen: vt });
    const d = drops.find((x) => !x.on);
    if (!d) return;
    _p2.set(0, 1, 0).applyQuaternion(quat);
    d.on = true;
    d.big = false;
    d.t = 0;
    d.splat = -1;
    d.pos.copy(pos).addScaledVector(_p2, 0.75);
    d.vel.copy(_p2).multiplyScalar(2.2);
    d.floor = p.to.y;
    d.size = 0.32 + (slot % 3) * 0.08;
  }

  function updateDrops(frameDt) {
    let nd = 0, ns = 0;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.on) continue;
      d.t += frameDt;
      if (d.big) {
        // a splash printed in the air, turned to the camera
        if (d.t > 0.45) { d.on = false; continue; }
        const s = d.size * (d.t < 0.07 ? d.t / 0.07 : 1 - smoothstep(0.14, 0.45, d.t));
        _p.subVectors(camPos, d.pos).normalize();
        _q.setFromUnitVectors(Y, _p);
        _q2.setFromAxisAngle(Y, d.rot);
        _q.multiply(_q2);
        setAt(splatMesh, ns++, d.pos, _q, s, s, s);
      } else if (d.splat < 0) {
        // a falling teardrop, its tip trailing and stretched by speed
        d.vel.y -= 16 * frameDt;
        d.pos.addScaledVector(d.vel, frameDt);
        if (d.pos.y <= d.floor + 0.05) { d.pos.y = d.floor + 0.03; d.splat = d.t; }
        if (d.t > 2) { d.on = false; continue; }
        const sp = d.vel.length();
        if (sp > 1e-3) _q.setFromUnitVectors(Y, _p.copy(d.vel).multiplyScalar(-1 / sp));
        else _q.identity();
        setAt(dropMesh, nd++, d.pos, _q, d.size, d.size * (1 + Math.min(0.9, sp * 0.06)), d.size);
      } else {
        // landed: a flat splat that spreads, then shrinks away
        const s = d.t - d.splat;
        if (s > 1.2) { d.on = false; continue; }
        const k = (s < 0.06 ? 0.55 + (s / 0.06) * 0.45 : 1) * (1 - smoothstep(0.65, 1.2, s));
        _q.setFromAxisAngle(Y, d.rot);
        setAt(splatMesh, ns++, d.pos, _q, d.size * 1.9 * k, d.size * 1.9, d.size * 1.9 * k);
      }
    }
    finish(dropMesh, nd);
    finish(splatMesh, ns);
    if (inkTrail.size) for (const [id, e] of inkTrail) if (e.seen !== vt) inkTrail.delete(id);
  }

  function updateSnips(frameDt) {
    for (let i = 0; i < snips.length; i++) {
      const s = snips[i];
      if (!s.on) continue;
      s.t += frameDt;
      if (s.t > 0.5) { s.on = false; continue; }
      const r = T.scissorsSplash * (s.t < 0.12 ? smoothstep(0, 1, s.t / 0.12) : 1 - smoothstep(0.25, 0.5, s.t));
      decal(s.pos.x, s.pos.y, s.pos.z, s.up, 0, r, r, 0);
    }
  }

  // --- foil ---------------------------------------------------------------------------------------
  function dropShell(kv) {
    if (kv.shell) kv.shellParent?.remove(kv.shell);
    kv.shell = null;
    kv.shellParent = null;
  }

  function updateFoil(rm) {
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i];
      const kv = kvis[i];
      const want = k.invincibleTime > 0 && !!k.visual;
      if (!want) { if (kv.shell) dropShell(kv); continue; }
      if (!kv.shell || kv.shellParent !== k.visual.object3d) {
        dropShell(kv);
        const mesh = new THREE.Mesh(shellGeo, foilMat);
        mesh.name = 'items:foil';
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        k.visual.object3d.add(mesh);
        kv.shell = mesh;
        kv.shellParent = k.visual.object3d;
        kv.shellBorn = vt;
      }
      const t = vt - kv.shellBorn;
      // wraps tight around the kart, then blinks through its last second as a warning
      const s = rm || t > 0.3 ? 1 : 1 + 0.32 * (1 - smoothstep(0, 1, t / 0.3)) - 0.05 * Math.sin(t / 0.3 * Math.PI);
      kv.shell.scale.setScalar(s);
      kv.shell.visible = k.invincibleTime > 1.2 || Math.floor(vt * 10) % 2 === 0;
    }
  }

  function update(frameDt, alpha) {
    vt += frameDt;
    const now = game.raceTime;
    const rm = !!game.reducedMotion;
    di = 0;
    consumeCues();
    updateBoxes(now, rm, frameDt);
    updateGum(now, alpha, rm, frameDt);
    updatePens(frameDt, rm);
    updateProjectiles(alpha);
    updateDrops(frameDt);
    updateSnips(frameDt);
    updateFoil(rm);
    finish(decalMesh, di);
  }

  function dispose() {
    for (const kv of kvis) dropShell(kv);
    root.parent?.remove(root);
    for (const m of meshes) m.dispose();
    for (const g of geos) g.dispose();
    for (const m of uniqueMats) m.dispose();
    for (const t of textures) t.dispose();
  }

  return { update, dispose, root, meshes };
}
