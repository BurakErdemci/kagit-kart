// The respawn crane: an origami paper crane that swoops in, tows the kart on a slanted string
// through the lift, carry and drop, lets go at touchdown and flies off ahead. Choreography follows
// kart.respawn.stage (§8.1). Instanced pool: bodies in one draw call, both wings of every crane in
// another (the right wing is the left one mirrored).
import * as THREE from 'three';

const MAX = 4;
const SCALE = 1.2;
// Held ahead of the hook, not above it: straight above, the chase camera (6.5 m back, 2.6 m up)
// cut off the head and neck for the whole respawn (verifier, 2026-09-23).
const HOLD_FWD = 2.6;
const HOLD_UP = 1.2;
const STRING = Math.hypot(HOLD_FWD, HOLD_UP);
const DANGLE = 1.8;          // loose string hanging from a crane not yet tied on
const VIEW_YAW = 0.7;        // held three-quarter-on so the neck, tail and wings read
const FOOT_Y = -0.4 * SCALE; // string knot under the body, crane-local
const TOP = 1.9;             // head and raised wing tips above the body centre (m)
const VIEW_TOP = 0.78;       // the chase camera keeps TOP within this share of the upper half-frame
const T_IN = 0.5;
const T_OUT = 1.35;
const DEG = Math.PI / 180;

function craneBodyGeometry() {
  const pos = [];
  const uv = [];
  const tri = (a, b, c) => {
    for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); uv.push(p[2] * 0.55 + 0.5, p[1] * 0.55 + p[0] * 0.4); }
  };
  // body: a flattened double pyramid
  const F = [0, 0, 0.75], B = [0, 0.06, -0.75], T = [0, 0.36, 0], D = [0, -0.42, 0.05], L = [0.28, 0, 0], R = [-0.28, 0, 0];
  tri(T, L, F); tri(T, F, R); tri(T, R, B); tri(T, B, L);
  tri(D, F, L); tri(D, R, F); tri(D, B, R); tri(D, L, B);
  // neck and folded-down head
  const n1 = [0.07, 0.04, 0.5], n2 = [-0.07, 0.04, 0.5], n3 = [0, -0.14, 0.64], nt = [0, 1.25, 1.2];
  tri(n1, n2, nt); tri(n2, n3, nt); tri(n3, n1, nt);
  const h1 = [0.05, 1.3, 1.14], h2 = [-0.05, 1.3, 1.14], h3 = [0, 1.16, 1.24], ht = [0, 1.0, 1.6];
  tri(h1, h2, ht); tri(h2, h3, ht); tri(h3, h1, ht);
  // tail
  const t1 = [0.06, 0.06, -0.5], t2 = [-0.06, 0.06, -0.5], t3 = [0, -0.12, -0.62], tt = [0, 1.12, -1.42];
  tri(t1, t2, tt); tri(t2, t3, tt); tri(t3, t1, tt);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.scale(SCALE, SCALE, SCALE);
  return g;
}

// Left wing, hinged along +z at the origin, spreading toward +x; a raised crease shows the fold.
function craneWingGeometry() {
  const pos = [];
  const uv = [];
  const tri = (a, b, c) => {
    for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); uv.push(p[0] * 0.45, p[2] * 0.45 + 0.5); }
  };
  const h0 = [0, 0, 0.5], h1 = [0, 0, -0.5], a = [1.05, 0.1, 0.38], tip = [2.3, 0.18, -0.45], b = [1.1, 0.0, -0.62];
  tri(h0, a, tip); tri(h0, tip, h1); tri(h1, tip, b);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.scale(SCALE, SCALE, SCALE);
  return g;
}

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _hook = new THREE.Vector3();
const _target = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _cf = new THREE.Vector3();
const _cu = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WING_L = new THREE.Matrix4().makeTranslation(0.03 * SCALE, 0.3 * SCALE, 0.05 * SCALE);
const WING_R = new THREE.Matrix4().makeTranslation(-0.03 * SCALE, 0.3 * SCALE, 0.05 * SCALE).multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
const _rz = new THREE.Matrix4();

function easeOutCubic(x) { const u = 1 - Math.min(1, Math.max(0, x)); return 1 - u * u * u; }

function dampAngle(a, b, hl, dt) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return b - d * Math.pow(2, -dt / hl);
}

export function createCranes(game, theme) {
  const mats = game.materials;
  const material = mats.paper(theme.curbA || '#d9483b', {
    side: THREE.DoubleSide, overlay: mats.textures.waves, overlayColor: theme.curbB || '#fbf6e9', overlayRepeat: [1.4, 1.4],
  });
  const bodyGeo = craneBodyGeometry();
  const wingGeo = craneWingGeometry();
  const bodies = new THREE.InstancedMesh(bodyGeo, material, MAX);
  const wings = new THREE.InstancedMesh(wingGeo, material, MAX * 2);
  for (const m of [bodies, wings]) {
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  bodies.name = 'fx:crane.bodies';
  wings.name = 'fx:crane.wings';
  // One zero-scale instance for the first frames so the instanced shadow-depth program compiles
  // during the countdown instead of at the first respawn.
  let prewarm = 3;
  bodies.setMatrixAt(0, ZERO);
  wings.setMatrixAt(0, ZERO);
  bodies.count = 1;
  wings.count = 1;

  const slots = [];
  for (let i = 0; i < MAX; i++) {
    slots.push({
      i, kart: null, phase: 'free', t: 0, age: 0, early: false, attached: false, released: false,
      pos: new THREE.Vector3(), from: new THREE.Vector3(), ctrl: new THREE.Vector3(), vel: new THREE.Vector3(),
      prev: new THREE.Vector3(), rel: new THREE.Vector3(), yaw: 0, pitch: 0, bank: 0, flap: i * 1.3, dropping: false,
      stringLen: 0, drawn: 0, scale: 1, waited: 0,
    });
  }

  function hookPoint(k, out) {
    const head = k.visual?.anchors?.head;
    if (head) {
      head.updateWorldMatrix(true, false);
      out.setFromMatrixPosition(head.matrixWorld);
      out.y += 0.3;
      return out;
    }
    if (k.visual) out.copy(k.visual.object3d.position); else out.copy(k.pos);
    out.y += 1.85;
    return out;
  }

  // The chase camera's own kart: its crane must stay in frame.
  function framed(k) {
    const rig = game.cameraRig;
    if (!rig || rig.override || rig.debugMode || rig.lookBack) return false;
    if (k.controls?.lookBack && !k.autopilot) return false;
    return k === (rig.target || game.player);
  }

  // Body-centre target for a hook point: ahead along the kart's heading, then, for the framed kart,
  // slid along the camera's view axis until the crane's top sits inside the frame.
  function holdTarget(k, hook, out) {
    out.set(hook.x + Math.sin(k.heading) * HOLD_FWD, hook.y + HOLD_UP - FOOT_Y, hook.z + Math.cos(k.heading) * HOLD_FWD);
    if (!framed(k)) return out;
    const cam = game.camera;
    _cf.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _cu.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _v.copy(out).sub(cam.position);
    const up = _v.dot(_cu) + TOP * _cu.y;
    if (up <= 0) return out;
    const need = up / (Math.tan((cam.fov * DEG) / 2) * VIEW_TOP) - _v.dot(_cf);
    if (need > 0) out.addScaledVector(_cf, Math.min(need, 8));
    return out;
  }

  function slotFor(k) {
    for (const s of slots) if (s.kart === k && s.phase !== 'free' && s.phase !== 'out') return s;
    return null;
  }

  function has(k) { return !!slotFor(k); }

  // `force` (the player): with every crane busy, take one from a CPU kart rather than go without.
  function summon(k, early, force = false) {
    if (slotFor(k)) return;
    let s = slots.find((x) => x.phase === 'free');
    if (!s) {
      let best = null;
      for (const x of slots) if (x.phase === 'out' && (!best || x.t > best.t)) best = x;
      s = best;
    }
    if (!s && force) s = slots.find((x) => x.kart && !x.kart.isPlayer) || null;
    if (!s) return;
    s.kart = k;
    s.phase = 'in';
    s.t = 0;
    s.age = 0;
    s.early = early;
    s.attached = false;
    s.released = false;
    s.dropping = false;
    s.waited = 0;
    s.scale = 1;
    s.stringLen = 0;
    hookPoint(k, _hook);
    holdTarget(k, _hook, _target);
    // Enter from above and beyond the kart as seen from the camera, alternating sides per slot. An
    // early crane has time for a long swoop; one summoned at the lift starts just above the frame and
    // dives, so it takes the string early in the 0.6 s lift.
    _cam.copy(game.camera.position);
    _v.set(_target.x - _cam.x, 0, _target.z - _cam.z);
    if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
    _v.normalize();
    const side = s.i % 2 === 0 ? 1 : -1;
    if (early) {
      s.from.copy(_target).addScaledVector(_v, 7).add(_s.set(-_v.z * 5 * side, 11, _v.x * 5 * side));
      s.ctrl.copy(_target).addScaledVector(_v, 2).y += 4;
    } else {
      s.from.copy(_target).addScaledVector(_v, 2).add(_s.set(-_v.z * 2.5 * side, 5.5, _v.x * 2.5 * side));
      s.ctrl.copy(_target).addScaledVector(_v, 0.6).y += 1.6;
    }
    s.pos.copy(s.from);
    s.prev.copy(s.from);
    s.yaw = Math.atan2(_target.x - s.from.x, _target.z - s.from.z);
    s.pitch = 0;
    s.bank = 0;
  }

  function release(s) {
    s.phase = 'out';
    s.t = 0;
    s.released = true;
    const k = s.kart;
    s.vel.set(Math.sin(k.heading) * 8, 1.5, Math.cos(k.heading) * 8);
  }

  function update(dt, cards, stringColor) {
    let nb = 0;
    let nw = 0;
    for (const s of slots) {
      if (s.phase === 'free') continue;
      const k = s.kart;
      s.t += dt;
      s.age += dt;
      s.prev.copy(s.pos);
      let flapHz = 3;
      let flapAmp = 0.7;
      let faceYaw = null;

      if (s.phase === 'in' || s.phase === 'hold') {
        hookPoint(k, _hook);
        if (k.respawn.active && k.respawn.stage === 'drop') s.dropping = true;
        holdTarget(k, _hook, _target);

        if (s.phase === 'in') {
          const dur = s.early ? T_IN : T_IN * 0.5;
          const u = easeOutCubic(s.t / dur);
          // quadratic Bézier toward a target that follows the kart
          const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
          s.pos.set(
            a * s.from.x + b * s.ctrl.x + c * _target.x,
            a * s.from.y + b * s.ctrl.y + c * _target.y,
            a * s.from.z + b * s.ctrl.z + c * _target.z,
          );
          flapHz = 2.4; flapAmp = 0.85;
          if (s.t >= dur) { s.phase = 'hold'; s.t = 0; s.rel.subVectors(s.pos, _hook); }
        } else {
          // Damp the offset from the hook, not the absolute position: an absolute follow trails the
          // kart by speed × lag, ~1.5 m above the frame at the end of the drop.
          const f = 1 - Math.pow(2, -dt / 0.06);
          s.rel.x += (_target.x - _hook.x - s.rel.x) * f;
          s.rel.y += (_target.y - _hook.y - s.rel.y) * f;
          s.rel.z += (_target.z - _hook.z - s.rel.z) * f;
          s.pos.copy(_hook).add(s.rel).y += Math.sin(s.age * 6.5) * 0.08;
          flapHz = s.dropping ? 2.2 : 3.6;
          flapAmp = s.dropping ? 0.55 : 0.8;
        }

        _foot.set(0, FOOT_Y, 0).applyAxisAngle(_s.set(0, 1, 0), s.yaw).add(s.pos);
        // Tie on only once the crane is close: a string from a crane still far off-screen draws a
        // long line across the sky.
        if (k.respawn.active && !s.attached && (s.phase === 'hold' || _foot.distanceTo(_hook) < STRING * 1.3)) s.attached = true;

        if (k.respawn.active) {
          const dx = k.respawnTo.x - k.respawnFrom.x, dz = k.respawnTo.z - k.respawnFrom.z;
          faceYaw = (dx * dx + dz * dz > 1 ? Math.atan2(dx, dz) : k.respawnHeading) + (k.index % 2 ? VIEW_YAW : -VIEW_YAW);
        } else if (s.attached) {
          release(s);
        } else if (s.phase === 'hold') {
          // Summoned early for a kart that recovered on its own: give up after a moment.
          s.waited += dt;
          if (s.waited > 1.4 || (k.grounded && k.surface !== 'out' && k.trackInfo.hasGround && s.waited > 0.3)) release(s);
        }

        if (s.phase !== 'out') {
          if (s.attached) {
            cards.add(_foot.x, _foot.y, _foot.z, _hook.x, _hook.y, _hook.z, 0.022, 1, stringColor, 1, 0, 0, 1, 0);
            s.drawn = _foot.distanceTo(_hook);
          } else {
            s.stringLen = Math.min(DANGLE, s.stringLen + dt * 7);
            cards.add(_foot.x, _foot.y, _foot.z, _foot.x, _foot.y - s.stringLen, _foot.z, 0.022, 1, stringColor, 1, 0, 0, 1, 0);
            s.drawn = s.stringLen;
          }
        }
      }

      if (s.phase === 'out') {
        _v.set(Math.sin(k.heading) * 11, 3.5, Math.cos(k.heading) * 11);
        s.vel.lerp(_v, 1 - Math.pow(2, -dt / 0.25));
        s.pos.addScaledVector(s.vel, dt);
        flapHz = 3.2; flapAmp = 0.8;
        s.scale = 1 - Math.max(0, (s.t - (T_OUT - 0.35)) / 0.35);
        // the released string springs back up to the crane
        s.stringLen = s.released ? Math.max(0, (s.attached ? DANGLE : s.stringLen) * (1 - s.t / 0.18)) : 0;
        if (s.stringLen > 0.02) {
          _foot.set(0, FOOT_Y, 0).applyAxisAngle(_s.set(0, 1, 0), s.yaw).add(s.pos);
          cards.add(_foot.x, _foot.y, _foot.z, _foot.x, _foot.y - s.stringLen, _foot.z, 0.022, 1, stringColor, 1, 0, 0, 1, 0);
        }
        if (s.t >= T_OUT) { s.phase = 'free'; s.kart = null; continue; }
      }

      // Orientation from motion: face the travel direction, nose follows climb/descent, bank into turns.
      _v.subVectors(s.pos, s.prev);
      const h2 = _v.x * _v.x + _v.z * _v.z;
      if (faceYaw === null && h2 > 0.09 * dt * dt && dt > 0) faceYaw = Math.atan2(_v.x, _v.z);
      const prevYaw = s.yaw;
      if (faceYaw !== null && dt > 0) s.yaw = dampAngle(s.yaw, faceYaw, 0.12, dt);
      if (dt > 0) {
        const vy = _v.y / dt;
        const yawRate = Math.atan2(Math.sin(s.yaw - prevYaw), Math.cos(s.yaw - prevYaw)) / dt;
        s.pitch += (Math.max(-0.5, Math.min(0.5, -vy * 0.05)) - s.pitch) * Math.min(1, dt * 8);
        s.bank += (Math.max(-0.6, Math.min(0.6, -yawRate * 0.25)) - s.bank) * Math.min(1, dt * 6);
        s.flap += dt * flapHz * Math.PI * 2;
      }

      const sc = Math.max(0, s.scale);
      _e.set(s.pitch, s.yaw, s.bank);
      _q.setFromEuler(_e);
      _m.compose(s.pos, _q, _s.set(sc, sc, sc));
      bodies.setMatrixAt(nb++, _m);
      const flap = 0.15 + flapAmp * Math.sin(s.flap);
      _rz.makeRotationZ(flap);
      _w.multiplyMatrices(_m, WING_L).multiply(_rz);
      wings.setMatrixAt(nw++, _w);
      _w.multiplyMatrices(_m, WING_R).multiply(_rz);
      wings.setMatrixAt(nw++, _w);
    }
    if (prewarm > 0) {
      prewarm--;
      if (nb === 0) { bodies.setMatrixAt(0, ZERO); wings.setMatrixAt(0, ZERO); nb = 1; nw = 1; }
    }
    bodies.count = nb;
    wings.count = nw;
    if (nb) bodies.instanceMatrix.needsUpdate = true;
    if (nw) wings.instanceMatrix.needsUpdate = true;
  }

  function active() {
    let n = 0;
    for (const s of slots) if (s.phase !== 'free') n++;
    return n;
  }

  function debug() {
    return slots.filter((s) => s.phase !== 'free').map((s) => ({
      kart: s.kart.id, phase: s.phase, attached: s.attached, stage: s.kart.respawn.stage, string: +s.drawn.toFixed(2),
      pos: [+s.pos.x.toFixed(2), +s.pos.y.toFixed(2), +s.pos.z.toFixed(2)],
    }));
  }

  function dispose() {
    for (const m of [bodies, wings]) { m.parent?.remove(m); m.dispose(); }
    bodyGeo.dispose();
    wingGeo.dispose();
  }

  return { meshes: [bodies, wings], summon, has, update, active, debug, dispose };
}
