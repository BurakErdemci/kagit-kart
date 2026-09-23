// Per-frame pose from kart state (§10.7). Allocation-free: all scratch objects are module level.
// Only children of visual.object3d are touched; core owns object3d's own transform.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();
const _c = new THREE.Vector3(0, 0.6, 0);
const _col = new THREE.Color();
const _colB = new THREE.Color();
const FOIL_A = new THREE.Color('#fff1b8');
const FOIL_B = new THREE.Color('#bfe3ff');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, hl, dt) => (hl <= 0 ? b : b + (a - b) * Math.pow(2, -dt / hl));
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

// Streamer behaviour per chain kind. Angles in radians; `stream` is reached at top speed.
// x = pitch about the bone's X (negative tips an upright part backwards), side = sway axis.
const KINDS = {
  ear: { stream: -0.55, sway: 0.05, side: 'z', freq: 2.1, flutter: 0.1, fFreq: 15, droop: -0.75, splay: 0.35, perk: 0.18, drift: 0.22 },
  roundEar: { stream: -0.18, sway: 0.03, side: 'z', freq: 1.5, flutter: 0.05, fFreq: 12, droop: -0.35, splay: 0.3, perk: 0.1, drift: 0.1 },
  tuft: { stream: -0.7, sway: 0.05, side: 'z', freq: 1.8, flutter: 0.14, fFreq: 13, droop: -0.6, splay: 0.4, perk: 0.2, drift: 0.2 },
  longEar: { stream: -1.35, dist: [0.62, 0.38], sway: 0.08, side: 'z', freq: 1.6, flutter: 0.18, fFreq: 11, droop: -1.25, splay: 0.45, perk: 0.12, drift: 0.3 },
  tail: { stream: -0.3, sway: 0.1, side: 'y', freq: 2.6, flutter: 0.14, fFreq: 9, droop: -0.65, perk: 0.2, wag: 0.55, drift: 0.45 },
  catTail: { stream: -0.3, sway: 0.16, side: 'z', freq: 1.3, flutter: 0.06, fFreq: 7, droop: -0.55, perk: 0.1, wag: 0.4, drift: 0.3 },
  scarf: { stream: 0, hang: -0.95, sway: 0.2, side: 'y', freq: 3, flutter: 0.3, fFreq: 17, droop: -0.2, drift: 0.5 },
  tentacle: { stream: 0.05, sway: 0.3, side: 'y', freq: 2.2, flutter: 0.1, fFreq: 6, droop: -0.2, perk: 0.2, wag: 0.3, drift: 0.35, wave: 0.16 },
  flag: {},
  bell: {},
  wobble: {},
};

export function createPose(model, bones, rig, mesh, obj, baseEmissive = null, seed = 0) {
  const rest = bones.map((b) => b.position.clone());
  const I = model.index;
  const B = (n) => (I[n] !== undefined ? bones[I[n]] : null);
  const chassis = B('chassis'), torso = B('torso'), head = B('head'), armL = B('armL'), armR = B('armR');
  const wFL = B('wFL'), wFR = B('wFR'), wFLs = B('wFLs'), wFRs = B('wFRs'), wRL = B('wRL'), wRR = B('wRR');
  const steer = B('steer');
  const steerAxis = new THREE.Vector3(0, 0.55, -0.83).normalize();
  const iChassis = I.chassis, iTorso = I.torso;
  const chains = model.chains.map((c) => ({ ...c, K: KINDS[c.kind] || KINDS.ear, b: c.bones.map((i) => bones[i]) }));
  const prop = model.prop >= 0 ? bones[model.prop] : null;
  const peri = model.peri >= 0 ? bones[model.peri] : null;

  const st = {
    // seeded clock offset: idle loops of neighbouring visuals never march in step
    t: (seed * 7.31) % 10, init: false, spins: 0,
    angF: 0, angR: 0, propAng: 0,
    steer: 0, drift: 0, tier: 0, boost: 0, lookBack: 0, ink: 0, hang: 0, speedN: 0, throttle: 0,
    sq: 0, sqV: 0, air: 0, wasGrounded: true,
    spinning: false, spinCause: null, spinTotal: 1, spinP: 0, spinDir: 1,
    flat: 0, flatV: 0, trickT: -1, trickDir: 1,
    wobble: 0, emo: { cheer: 0, sad: 0, dizzy: 0, idle: 0 },
    forced: null,
    flashT: 0, flashDur: 0, flashColor: new THREE.Color(), emissiveOn: false,
    ghostSpeed: 0, ghostSteer: 0, prevX: 0, prevZ: 0, prevYaw: 0, havePrev: false,
    blinkHidden: false,
    base: new THREE.Color(baseEmissive ?? 0x000000), baseOn: !!baseEmissive,
  };

  function spinTotalFor(cause, env, now) {
    const s = env.spins && (env.spins[cause] || env.spins.default);
    return s && s.time > 0 ? Math.max(s.time, now) : Math.max(now, 0.5);
  }

  function update(dt, kart, env) {
    if (dt <= 0 && st.init) return;
    st.init = true;
    dt = Math.min(dt, 0.1);
    st.t += dt;
    const t = st.t;
    const rm = env.reducedMotion ? 0.4 : 1;
    const ghost = env.ghost;

    // ---- read kart state (all guarded: ghost replays and menu visuals pass null)
    let speed = 0, steerIn = 0, grounded = true, driftActive = false, driftDir = 0, tier = 0;
    let spin = 0, cause = null, grace = 0, boostT = 0, invT = 0, inkT = 0, lookBack = false, throttle = 0;
    let respawn = false, finished = false, place = 99, surface = 'road';
    if (kart) {
      speed = kart.speed || 0;
      const c = kart.controls;
      if (c) { steerIn = c.steer || 0; lookBack = !!c.lookBack; throttle = c.throttle || 0; }
      grounded = kart.grounded !== false;
      const d = kart.drift;
      if (d && d.active) { driftActive = true; driftDir = d.dir || 0; tier = d.tier || 0; }
      spin = kart.spinTime || 0; cause = kart.spinCause || null;
      grace = kart.graceTime || 0; boostT = kart.boostTime || 0; invT = kart.invincibleTime || 0; inkT = kart.inkTime || 0;
      respawn = !!(kart.respawn && kart.respawn.active);
      finished = !!kart.finished; place = kart.place || 99;
      surface = kart.surface || (kart.offroad ? 'offroad' : 'road');
    } else if (ghost && obj) {
      // Ghost replays move object3d only: derive speed and steer from its motion.
      const p = obj.position;
      _v.set(0, 0, 1).applyQuaternion(obj.quaternion);
      const yaw = Math.atan2(_v.x, _v.z);
      if (st.havePrev && dt > 0) {
        const vs = Math.hypot(p.x - st.prevX, p.z - st.prevZ) / dt;
        let dy = yaw - st.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        st.ghostSpeed = damp(st.ghostSpeed, vs < 80 ? vs : st.ghostSpeed, 0.1, dt);
        st.ghostSteer = damp(st.ghostSteer, clamp(-dy / dt / 1.6, -1, 1), 0.12, dt);
      }
      st.prevX = p.x; st.prevZ = p.z; st.prevYaw = yaw; st.havePrev = true;
      speed = st.ghostSpeed; steerIn = st.ghostSteer;
    }
    const driving = !!kart || ghost;
    const top = env.topSpeed || 25;
    const sN = clamp(Math.abs(speed) / top, 0, 1.3);
    st.speedN = damp(st.speedN, sN, 0.2, dt);
    const sS = st.speedN;

    st.steer = damp(st.steer, steerIn, 0.07, dt);
    st.drift = damp(st.drift, driftActive ? driftDir : 0, 0.09, dt);
    st.tier = damp(st.tier, tier, 0.1, dt);
    st.boost = damp(st.boost, boostT > 0 ? 1 : 0, boostT > 0 ? 0.05 : 0.2, dt);
    st.lookBack = damp(st.lookBack, lookBack ? 1 : 0, 0.07, dt);
    st.ink = damp(st.ink, inkT > 0 ? 1 : 0, 0.15, dt);
    st.hang = damp(st.hang, respawn ? 1 : 0, 0.15, dt);
    st.throttle = damp(st.throttle, throttle, 0.1, dt);
    st.wobble = damp(st.wobble, 0, 0.3, dt);

    // ---- emotions: explicit setEmotion wins; otherwise idle without a kart, finish result with one
    let target = st.forced;
    if (!target) target = kart ? (finished ? (place <= 3 ? 'cheer' : 'sad') : null) : (ghost ? null : 'idle');
    const E = st.emo;
    E.cheer = damp(E.cheer, target === 'cheer' ? 1 : 0, 0.18, dt);
    E.sad = damp(E.sad, target === 'sad' ? 1 : 0, 0.18, dt);
    E.dizzy = damp(E.dizzy, target === 'dizzy' ? 1 : 0, 0.18, dt);
    E.idle = damp(E.idle, target === 'idle' ? 1 : 0, 0.18, dt);

    // ---- wheels
    const F = 0.27, R = 0.31;
    st.angF += (speed * dt) / F;
    st.angR += (speed * dt) / R;
    if (st.angF > 1e4 || st.angF < -1e4) { st.angF %= TAU; st.angR %= TAU; }
    const frontYaw = driftActive ? driftDir * 0.32 - st.steer * 0.12 : -st.steer * 0.45;
    if (wFL) { wFL.rotation.y = frontYaw; wFR.rotation.y = frontYaw; }
    if (wFLs) { wFLs.rotation.x = st.angF; wFRs.rotation.x = st.angF; }
    if (wRL) { wRL.rotation.x = st.angR; wRR.rotation.x = st.angR; }

    // ---- air: stretch on take-off, squash on landing (hop included)
    if (!grounded) st.air += dt;
    if (!grounded && st.wasGrounded) st.sqV += 2.2 * rm + 0.6;
    if (grounded && !st.wasGrounded) { st.sqV -= Math.min(7.5, 2.8 + st.air * 7) * (0.6 + 0.4 * rm); st.air = 0; }
    st.wasGrounded = grounded;
    {
      const k = 380, c = 15;
      st.sqV += (-k * st.sq - c * st.sqV) * dt;
      st.sq += st.sqV * dt;
      st.sq = clamp(st.sq, -0.45, 0.35);
    }

    // ---- spin-out by cause
    if (spin > 0) {
      if (!st.spinning) {
        st.spinning = true;
        st.spinCause = cause || 'default';
        st.spinTotal = spinTotalFor(st.spinCause, env, spin);
        st.spins++;
        st.spinDir = st.steer > 0.2 ? -1 : st.steer < -0.2 ? 1 : ((st.spins + (seed | 0)) & 1 ? 1 : -1);
      }
      st.spinP = clamp(1 - spin / st.spinTotal, 0, 1);
    } else if (st.spinning) {
      st.spinning = false;
      const cz = st.spinCause;
      if (cz === 'plane' || cz === 'homing' || cz === 'rocket') st.sqV -= 5;
      st.spinP = 1;
    }
    const sc = st.spinning ? st.spinCause : null;
    const p = st.spinP;
    let yaw = 0, pitch = 0, roll = 0, lift = 0, jx = 0, jz = 0;
    let flail = 0, dazed = 0;
    if (sc === 'gum') {
      yaw = st.spinDir * TAU * 2 * easeOut(p);
      roll = Math.sin(p * Math.PI * 5) * 0.14 * (1 - p);
      flail = 1; dazed = 1;
    } else if (sc === 'plane' || sc === 'homing' || sc === 'rocket') {
      const e = smooth(p);
      pitch = -TAU * e;
      yaw = st.spinDir * Math.PI * e;
      lift = Math.sin(Math.PI * p) * 1.25;
      flail = 1; dazed = p;
    } else if (sc === 'foil') {
      yaw = st.spinDir * TAU * easeOut(p);
      lift = Math.sin(Math.PI * p) * 0.35;
      roll = Math.sin(Math.PI * p) * 0.28 * st.spinDir;
      flail = 0.6; dazed = 1;
    } else if (sc === 'burnout') {
      jx = Math.sin(t * 71) * Math.sin(t * 23) * 0.015; jz = Math.sin(t * 59 + 1) * Math.sin(t * 29) * 0.015;
      pitch = Math.sin(t * 31) * 0.035;
      lift = Math.abs(Math.sin(t * 13)) * 0.03;
      dazed = 0.7;
    } else if (sc && sc !== 'scissors') {
      yaw = st.spinDir * TAU * easeOut(p);
      flail = 0.6; dazed = 1;
    }
    // scissors: flattened to a sheet, then pops back with an overshoot
    const flatTarget = sc === 'scissors' && p < 0.86 ? 1 : 0;
    {
      // stiff and damped while flattening; loose on release so it overshoots into a stretch
      const going = flatTarget === 1;
      const k = going ? 1100 : 240, c = going ? 60 : 9;
      st.flatV += (k * (flatTarget - st.flat) - c * st.flatV) * dt;
      st.flat += st.flatV * dt;
      if (st.flat > 1) { st.flat = 1; st.flatV = 0; }
      if (st.flat < -0.6) { st.flat = -0.6; st.flatV = 0; }
    }
    const fl = st.flat;
    if (fl > 0.05) {
      pitch += Math.sin(t * 7.5) * 0.07 * fl * rm;
      roll += Math.sin(t * 5.3 + 1) * 0.05 * fl * rm;
      lift += 0.03 * fl;
    }

    // trick: a barrel roll off a ramp
    if (st.trickT >= 0) {
      st.trickT += dt;
      const tp = st.trickT / 0.6;
      if (tp >= 1) st.trickT = -1;
      else roll += st.trickDir * TAU * smooth(tp);
    }

    // respawn: dangling from the crane
    if (st.hang > 0.01) {
      roll += Math.sin(t * 2.6) * 0.12 * st.hang * rm;
      pitch += Math.sin(t * 1.9) * 0.07 * st.hang * rm;
    }

    // ---- rig transform: rotation about the kart's middle, squash about the ground
    rig.rotation.set(pitch, yaw, roll, 'YXZ');
    _v.copy(_c).applyQuaternion(rig.quaternion);
    rig.position.set(_c.x - _v.x + jx, _c.y - _v.y + lift, _c.z - _v.z + jz);
    const sy = (1 + st.sq) * (1 - 0.93 * fl);
    const sxz = (1 - 0.5 * st.sq) * (1 + 0.28 * fl);
    rig.scale.set(sxz, Math.max(0.05, sy), sxz);

    // ---- chassis
    const off = surface === 'offroad' || surface === 'sand' || surface === 'out';
    let cy = 0, cRoll = 0, cPitch = 0;
    if (driving) {
      cRoll = -st.drift * 0.1 - st.steer * sS * 0.05;
      cPitch = -0.07 * st.boost + 0.04 * st.sq;
      cy += Math.sin(t * 55) * 0.005 * st.tier * rm;
      cy += Math.sin(t * 62) * 0.006 * st.throttle * (1 - Math.min(1, sS * 3)) * rm;
      if (off) { cy += Math.sin(t * 23) * Math.sin(t * 7.3) * 0.028 * Math.min(1, sS * 2) * rm; cRoll += Math.sin(t * 17) * 0.03 * sS * rm; }
      cRoll += Math.sin(t * 30) * 0.08 * st.wobble;
    } else {
      cy += Math.sin(t * 40) * 0.0025 * rm;
    }
    chassis.position.set(rest[iChassis].x, rest[iChassis].y + cy, rest[iChassis].z);
    chassis.rotation.set(cPitch, 0, cRoll);
    if (steer) steer.quaternion.setFromAxisAngle(steerAxis, (driving ? -st.steer : 0) * 1.3);

    // ---- driver
    const cheer = E.cheer, sad = E.sad, dizzy = Math.max(E.dizzy, dazed), idle = E.idle;
    let tx = 0, ty = 0, tz = 0, tyPos = 0, tScale = 1;
    let hx = 0, hy = 0, hz = 0;
    if (driving) {
      tx = 0.07 * sS - 0.2 * st.boost;
      tz = st.drift * 0.2 + st.steer * sS * 0.1;
      ty = -st.drift * 0.12 + st.lookBack * 0.5;
      hx = -0.08 * st.boost;
      hy = -st.drift * 0.3 - st.steer * 0.22 + st.lookBack * 2.4 + Math.sin(t * 12) * 0.28 * st.ink;
      hz = st.drift * 0.1;
      tyPos += Math.sin(t * 48) * 0.004 * st.tier * rm;
    }
    // idle: breathe and look around
    tScale += Math.sin(t * 2.4) * 0.018 * idle * rm;
    hy += (Math.sin(t * 0.7) * 0.35 + Math.sin(t * 1.9) * 0.08) * idle * rm;
    hx += Math.sin(t * 1.1) * 0.05 * idle * rm;
    // cheer: bounce and look up; sad: slump; dizzy: head circles
    tyPos += Math.abs(Math.sin(t * 6.2)) * 0.07 * cheer * rm;
    hx += -0.25 * cheer + Math.sin(t * 6.2) * 0.06 * cheer;
    tx += 0.22 * sad; hx += 0.5 * sad; hy += Math.sin(t * 0.8) * 0.15 * sad;
    hz += Math.sin(t * 4.3) * 0.3 * dizzy * rm; hx += Math.cos(t * 4.3) * 0.18 * dizzy * rm; tz += Math.sin(t * 4.3 + 1) * 0.08 * dizzy * rm;
    torso.position.set(rest[iTorso].x, rest[iTorso].y + tyPos, rest[iTorso].z);
    torso.rotation.set(tx, ty, tz, 'YXZ');
    torso.scale.set(1, tScale, 1);
    head.rotation.set(hx, hy, hz, 'YXZ');

    // arms: on the wheel while driving; up for cheer / respawn / flail
    const grip = driving ? 1 - Math.max(cheer, st.hang, flail) : 0;
    const up = Math.max(cheer, st.hang * 0.9, flail * 0.8);
    const steerLift = st.steer * 0.28 * grip;
    const wave = Math.sin(t * 9) * 0.35 * cheer + Math.sin(t * 19) * 0.5 * flail;
    const hangX = 0.35 * (1 - grip) * (1 - up) * (driving ? 0 : 1) + 0.25 * sad;
    const wipe = st.ink * 1.6 * grip;
    if (armL) {
      // ZYX: lift about X first, then splay outward about Z
      armL.rotation.set(-steerLift - up * 1.8 + wave + hangX - wipe, 0, -up * 0.42, 'ZYX');
      armR.rotation.set(steerLift - up * 1.8 - wave + hangX, 0, up * 0.42, 'ZYX');
    }

    // ---- streamers
    const bs = 1 + st.boost * 0.35;
    for (let ci = 0; ci < chains.length; ci++) {
      const ch = chains[ci], K = ch.K, n = ch.b.length, side = ch.side || 1, ph = (ch.phase || 0) + ci * 0.7;
      if (ch.kind === 'flag') {
        ch.b[0].rotation.set(0, 0, -st.drift * 0.25 + Math.sin(t * 2.3) * 0.05 * rm);
        const f = (0.12 + 0.3 * sS) * rm;
        ch.b[1].rotation.set(Math.sin(t * 5.1) * 0.05, Math.sin(t * (5 + 11 * sS)) * f + st.drift * 0.4, 0);
        continue;
      }
      if (ch.kind === 'bell') {
        ch.b[0].rotation.set(Math.sin(t * 8.5) * (0.05 + 0.3 * st.wobble + 0.08 * sS) * rm - 0.2 * st.boost, 0, Math.sin(t * 6.1) * 0.06 * rm - st.drift * 0.25);
        continue;
      }
      if (ch.kind === 'wobble') {
        const wv = st.wobble + Math.abs(st.sq) * 1.5;
        ch.b[0].rotation.set(-0.08 * st.boost + Math.sin(t * 13) * 0.12 * wv * rm, 0, -st.drift * 0.12 + Math.sin(t * 14 + ci) * 0.18 * wv * rm + Math.sin(t * 2.1) * 0.02 * rm);
        continue;
      }
      for (let j = 0; j < n; j++) {
        const w = K.dist ? K.dist[j] : 1 / n;
        const bone = ch.b[j];
        const fl2 = Math.sin(t * K.fFreq + ph - j * 1.1) * K.flutter * (0.15 + sS) * rm;
        let x = K.stream * Math.min(1, sS) * bs * w + (K.hang ? K.hang * (1 - Math.min(1, sS * 1.5)) * w : 0)
          + (K.droop || 0) * sad * w + (K.perk || 0) * cheer * w + fl2;
        let s = K.sway * Math.sin(t * K.freq + ph - j * 0.9) * (0.35 + 0.65 * (1 - Math.min(1, sS))) * rm;
        s += Math.sin(t * 14 - j) * (K.wag || 0) * cheer * rm;
        if (K.wave) x += Math.sin(t * 1.7 + ph - j * 1.2) * K.wave * rm;
        if (K.side === 'z') {
          // upright parts: roll outward when sad, lean with the drift's centrifugal pull
          s += -side * (K.splay || 0) * sad * w - st.drift * (K.drift || 0) * w;
          if (idle > 0.5 && K.splay) {
            const tw = Math.sin(t * 0.83 + side * 2 + ci);
            if (tw > 0.985) x += (tw - 0.985) * 40 * 0.3;
          }
          bone.rotation.set(x, 0, s, 'XYZ');
        } else {
          s += -st.drift * (K.drift || 0) * w + st.lookBack * 0.2 * side * w;
          bone.rotation.set(x, s * (ch.kind === 'tentacle' ? side : 1), 0, 'YXZ');
        }
      }
    }
    if (prop) {
      st.propAng += (driving ? 7 + Math.abs(speed) * 2.2 : 4 + cheer * 14) * dt;
      if (st.propAng > 1e4) st.propAng %= TAU;
      prop.rotation.set(0, 0, st.propAng);
    }
    if (peri) peri.rotation.set(0, Math.sin(t * 0.5) * 0.7 * rm + st.lookBack * Math.PI, 0);

    // ---- grace blink at 8 Hz (visible half of each 1/8 s)
    const hide = !ghost && grace > 0 && spin <= 0 && ((st.t * 16) | 0) % 2 === 1;
    if (hide !== st.blinkHidden) { mesh.visible = !hide; st.blinkHidden = hide; }

    // ---- tint: flash() pulses and a foil shimmer while invincible
    const m = mesh.material;
    if (m && m.emissive) {
      let on = st.baseOn;
      _col.copy(st.base);
      if (invT > 0) {
        _colB.copy(FOIL_A).lerp(FOIL_B, 0.5 + 0.5 * Math.sin(t * 9));
        const pulse = Math.abs(Math.sin(t * 14));
        _col.copy(_colB).multiplyScalar(0.22 + 0.4 * pulse * pulse);
        on = true;
      }
      if (st.flashT > 0) {
        st.flashT = Math.max(0, st.flashT - dt);
        const k = st.flashDur > 0 ? st.flashT / st.flashDur : 0;
        _col.lerp(st.flashColor, clamp(k * 1.2, 0, 1));
        on = true;
      }
      if (on || st.emissiveOn) { m.emissive.copy(_col); st.emissiveOn = on; }
    }
  }

  function onEvent(name, payload) {
    if (name === 'trick') { st.trickT = 0; st.trickDir = st.steer >= 0 ? -1 : 1; }
    else if (name === 'bump') st.wobble = Math.min(1, st.wobble + 0.25 + (payload.impulse || 0) * 0.06);
    else if (name === 'wallHit') st.wobble = Math.min(1, st.wobble + 0.6);
  }

  function flash(color, duration) {
    st.flashColor.set(color ?? 0xffffff);
    st.flashDur = Math.max(0.01, duration ?? 0.08);
    st.flashT = st.flashDur;
  }

  function setEmotion(name) {
    st.forced = name === 'cheer' || name === 'sad' || name === 'dizzy' || name === 'idle' ? name : null;
  }

  return { st, update, onEvent, flash, setEmotion };
}
