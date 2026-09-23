// Item visuals: one InstancedMesh per kind (hidden while empty, so an empty frame costs no draw call),
// per-kart pens and foil shells, and visual-only particle pools. Reads the simulation state from
// items.js and never writes it.
import * as THREE from 'three';
import { clamp, lerpAngle, smoothstep } from '../core/math.js';
import {
  blobGeometry, bottleGeometry, boxAtlas, boxGeometry, discGeometry, flyerGeometry, foilShellGeometry,
  penGeometry, scissorsHalfGeometry,
} from './shapes.js';

const CAP = { gum: 72, flyer: 16, pen: 40, bottle: 4, drop: 72, scissors: 4, decal: 72 };
const TUMBLES = 8;
const INK_BLUE = '#2a4a9c';

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
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

// Gold foil: facets that mirror the sun flash, and a sheen band sweeps along the wrapper.
const FOIL_GLSL = /* glsl */`
{
  vec3 kkV = normalize( vViewPosition );
  vec3 kkL = vec3( 0.3, 0.9, 0.3 );
  #if NUM_DIR_LIGHTS > 0
    kkL = directionalLights[ 0 ].direction;
  #endif
  float kkSpec = pow( max( dot( reflect( -kkV, normal ), kkL ), 0.0 ), 14.0 );
  float kkFacet = fract( sin( dot( floor( vPaperWorld * 2.7 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  float kkBand = smoothstep( 0.9, 0.99, sin( dot( vPaperWorld, vec3( 0.8, 0.45, 0.5 ) ) * 2.4 - uTime * 7.0 ) );
  // crinkles: neighbouring patches of foil catch the light differently
  outgoingLight *= 0.82 + 0.36 * kkFacet;
  float kkGlint = clamp( kkSpec * ( 0.3 + 1.3 * step( 0.55, kkFacet ) ) + kkBand * ( 0.2 + 0.6 * kkFacet ), 0.0, 1.0 );
  outgoingLight = mix( outgoingLight, vec3( 1.0, 0.96, 0.8 ), kkGlint );
}
`;

export function createItemVisuals(game, sim) {
  const T = sim.TUNE;
  const mats = game.materials;
  const theme = game.trackDef?.theme || {};
  const ink = theme.ink || '#2d2a32';
  const paperCol = theme.paper || '#f3ead3';
  const accents = Array.isArray(theme.accents) && theme.accents.length >= 3 ? theme.accents : ['#f2c14e', '#e56b6f', '#6c8ead'];
  const sunDir = new THREE.Vector3(...(theme.sun?.dir || [0.45, 0.8, 0.35])).normalize();
  const karts = game.karts;

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
    const atlas = boxAtlas(accents, ink, '#fbf6e9', game.config.fonts?.body || 'system-ui, sans-serif');
    textures.push(atlas);
    const g = geo(boxGeometry(T.boxHalf));
    foldAttr = new THREE.InstancedBufferAttribute(new Float32Array(sim.boxes.length), 1);
    foldAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFold', foldAttr);
    const mat = extend(mats.paper('#ffffff', { unique: true, map: atlas, side: THREE.DoubleSide }), 'box', (shader) => {
      shader.uniforms.uHalf = { value: T.boxHalf };
      shader.uniforms.uBack = { value: new THREE.Color(paperCol).multiplyScalar(0.97) };
      shader.vertexShader = 'attribute float aFace;\nattribute float aFold;\nuniform float uHalf;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FOLD_GLSL);
      // the inside of the paper shows once the cube lies open on the page
      shader.fragmentShader = 'uniform vec3 uBack;\n' +
        shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif ( !gl_FrontFacing ) diffuseColor.rgb = uBack;');
    });
    boxMesh = inst(g, mat, sim.boxes.length, 'boxes', true);
    for (let i = 0; i < sim.boxes.length; i++) {
      boxBase.push(new THREE.Quaternion().setFromUnitVectors(Y, sim.boxes[i].up));
      boxAngle.push(i * 0.9);
    }
  }

  // --- gum, gum bits, strings (one mesh) --------------------------------------------------------
  const blob = geo(blobGeometry('#f06fa8', '#ffe1ee', '#c94f8a'));
  const gumMesh = inst(blob, vertexColored, CAP.gum, 'gum', true);
  const dropMesh = inst(blob, mats.paper(INK_BLUE), CAP.drop, 'ink-drops');

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

  // --- foil shells ------------------------------------------------------------------------------
  const shellGeo = geo(foilShellGeometry());
  const foilMat = extend(mats.paper('#d7a53a', { unique: true }), 'foil', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', FOIL_GLSL + '\n#include <opaque_fragment>');
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
  for (let i = 0; i < CAP.drop; i++) drops.push({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), floor: 0, t: 0, size: 0.3, splat: -1, big: false });
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
      if (n < 5) { // the bottle's body bursting
        d.big = true;
        d.size = 1.5 + (n % 2) * 0.6;
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
  function updateGum(now, alpha, rm, frameDt) {
    let n = 0;
    const hz = sim.hazards;
    for (let i = 0; i < hz.length && n < CAP.gum - 2; i++) {
      const h = hz[i];
      if (h.dead) continue;
      const yaw = h.id * 2.4;
      if (h.held) {
        const k = h.held;
        kartFrame(k, _km);
        const sway = rm ? 0 : Math.sin(vt * 6 + h.id) * 0.18;
        _p.set(sway, 0, -T.gumBack).applyMatrix4(_km);
        _p.y = h.prevPos.y + (h.pos.y - h.prevPos.y) * alpha;
        _q.setFromUnitVectors(Y, h.up);
        _q2.setFromAxisAngle(Y, k.heading);
        _q.multiply(_q2);
        const sy = 0.3, sx = 0.5;
        _p2.copy(_p).addScaledVector(h.up, 0.45 * sy);
        setAt(gumMesh, n++, _p2, _q, sx, sy, 0.6);
        // the string of gum from the kart's tail to the blob
        _p3.set(0, 0.42, -1.02).applyMatrix4(_km);
        _p2.addScaledVector(h.up, 0.12);
        const len = _p3.distanceTo(_p2);
        _p.addVectors(_p3, _p2).multiplyScalar(0.5);
        _p.y -= 0.08;
        _p3.sub(_p2).normalize();
        _q.setFromUnitVectors(Z, _p3);
        setAt(gumMesh, n++, _p, _q, 0.05, 0.05, len * 0.5);
      } else {
        const age = now - h.dropT;
        let sxz = 0.75, sy = 0.3, lift = 0;
        if (!rm) {
          const fell = h.heldFor < 0.25;
          const fall = 0.14;
          if (fell && age < fall) {
            const t = age / fall;
            lift = 0.55 * (1 - t * t);
            sxz = 0.46; sy = 0.62;
          } else {
            const t = age - (fell ? fall : 0);
            const w = Math.exp(-7 * t) * Math.cos(17 * t);
            sxz = 0.75 * (1 + 0.42 * w);
            sy = 0.3 * (1 - 0.55 * w);
          }
        }
        _q.setFromUnitVectors(Y, h.up);
        _q2.setFromAxisAngle(Y, yaw);
        _q.multiply(_q2);
        _p.copy(h.pos).addScaledVector(h.up, 0.45 * sy + lift);
        setAt(gumMesh, n++, _p, _q, sxz, sy, sxz);
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
      setAt(gumMesh, n++, b.pos, _q, s, s, s);
    }
    finish(gumMesh, n);
  }

  // --- pens (rocket) ----------------------------------------------------------------------------
  function stowPose(s, n, out) {
    const x = (s - (n - 1) / 2) * 0.32;
    _p.set(x, 1.0, -0.9);
    _e.set(-0.35, x * 0.35, 0, 'YXZ'); // nib raised, fanned slightly outwards
    _q.setFromEuler(_e);
    return out.compose(_p, _q, ONE);
  }

  function firePose(t, rm, out) {
    const slide = smoothstep(0, 1, t / 0.1);
    const kick = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 9);
    const shake = rm ? 0 : 0.018;
    _p.set(Math.sin(vt * 71) * shake, 0.6 + Math.sin(vt * 53) * shake, -1.06 - 0.28 * kick);
    _p2.set(0, 1.0, -0.9);
    _p.lerpVectors(_p2, _p, slide);
    _e.set(-0.35 * (1 - slide), 0, 0, 'YXZ');
    _q.setFromEuler(_e);
    return out.compose(_p, _q, ONE);
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
        _p.y += Math.sin(p.age * 8 + p.id) * 0.06;
        _e.set(pitch, heading, roll, 'YXZ');
        _q.setFromEuler(_e);
        setAt(flyerMesh, nf, _p, _q, 1, 1, 1);
        kindAttr.array[nf] = p.kind === 'homing' ? 1 : 0;
        nf++;
        if (!p.falling) decal(_p.x, p.groundY, _p.z, p.up, _p.y - p.groundY, 0.5, 0.95, heading);
      } else if (p.kind === 'ink' && nb < CAP.bottle) {
        _p2.set(Math.cos(heading), 0, -Math.sin(heading));
        _q.setFromAxisAngle(_p2, p.age * 11);
        _q2.setFromAxisAngle(Y, heading);
        _q.multiply(_q2);
        setAt(bottleMesh, nb++, _p, _q, 1, 1, 1);
        decal(_p.x, p.to.y, _p.z, Y, _p.y - p.to.y, 0.55, 0.55, 0);
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
    finish(bottleMesh, nb);
    finish(scissorsMesh, ns);
  }

  function updateDrops(frameDt) {
    let n = 0;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.on) continue;
      d.t += frameDt;
      let sx, sy, sz;
      if (d.big) {
        if (d.t > 0.4) { d.on = false; continue; }
        const s = d.size * (d.t < 0.08 ? d.t / 0.08 : 1 - smoothstep(0.08, 0.4, d.t));
        sx = sy = sz = s;
      } else if (d.splat < 0) {
        d.vel.y -= 16 * frameDt;
        d.pos.addScaledVector(d.vel, frameDt);
        if (d.pos.y <= d.floor + 0.05) { d.pos.y = d.floor + 0.04; d.splat = d.t; }
        if (d.t > 2) { d.on = false; continue; }
        sx = sz = d.size;
        sy = d.size * 1.3;
      } else {
        const s = d.t - d.splat;
        if (s > 0.8) { d.on = false; continue; }
        const k = 1 - smoothstep(0.35, 0.8, s);
        sx = sz = d.size * 2.2 * k;
        sy = 0.05 * k;
      }
      _q.identity();
      setAt(dropMesh, n++, d.pos, _q, sx, sy, sz);
    }
    finish(dropMesh, n);
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
