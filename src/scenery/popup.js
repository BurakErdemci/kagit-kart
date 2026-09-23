// Pop-up system (ARCHITECTURE §10.5). Props rest folded flat on the page, hinged at the base
// (local X axis), front face up. When the camera comes within 70–110 m along the track they
// spring upright with an overshoot and a short paper flutter; they fold back only when more
// than 60 m behind and never while the player looks back. One InstancedMesh per prop part.
import * as THREE from 'three';

const HALF_PI = Math.PI / 2;
// Unfold: under-damped spring, ζ 0.5 at 2.2 Hz → ~16 % overshoot (≈ 15° past upright), settled
// in ≈ 0.5 s. Fold: critically damped so a prop never swings through the page.
const UP_W = 2 * Math.PI * 2.2, UP_Z = 0.5;
const DOWN_W = 2 * Math.PI * 1.5, DOWN_Z = 1;
const FLUTTER_TIME = 0.42, FLUTTER_HZ = 11, FLUTTER_AMP = 0.07;
const TRIGGER_MIN = 70, TRIGGER_SPAN = 40;
const FOLD_BEHIND = 60, FOLD_AHEAD_SLACK = 50;
const RAMP_TRIGGER = 125; // 0.6 s of spring at 40 m/s is 24 m: still settled ≥ 40 m before the kart
const EMIT_GAP = 0.18;       // ≤ 6 popup events per second even with frame jitter
const EMIT_MIN_SIZE = 1.5;
const MAX_SUBSTEP = 1 / 60;
const CHUNK = 180;

export function createPopups(game, track, env) {
  const L = track.length;
  const types = [];
  const ramps = [];
  const meshes = [];
  const emitPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let emitSlot = 0, emitTimer = 0, pendingSize = 0;
  const pending = new THREE.Vector3();
  const mat4 = new THREE.Matrix4();
  let tabMesh = null;

  // parts: [{ geometry, material, cast }], kind: 'card' (rigid) | 'volume' (flattens like a
  // collapsed paper box while folded).
  function addType(name, parts, { kind = 'card', flutter = true, tab = true, noChunk = false } = {}) {
    const t = { name, parts, kind, flutterOn: flutter, tab, noChunk, items: [], meshes: [] };
    types.push(t);
    return t;
  }

  // Place one instance. yaw: local +Z faces this heading. Returns the instance index.
  // Folded, a prop lies on the page pointing away from the heading it faces, as long as it is
  // tall and as wide as it is, still as thick as its card: one whose folded footprint would lie
  // across a road stays upright instead.
  function add(type, x, y, z, yaw, sx = 1, sy = sx, sz = sx, opts = {}) {
    const geo = type.parts[0].geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    let alwaysUp = !!opts.alwaysUp;
    if (!alwaysUp && env.foldClear) {
      const len = bb.max.y * sy, hw = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * sx;
      alwaysUp = !env.foldClear(x, z, yaw, len, hw, opts.s ?? env.alongTrack(x, z));
    }
    type.items.push({
      x, y, z, yaw, sx, sy, sz,
      size: opts.size ?? sy * (bb.max.y ?? 1),
      alwaysUp,
      tint: opts.tint ?? null,
      tabW: opts.tabW ?? null, tabD: opts.tabD ?? null,
      // Lap distance that times the pop-up: the stretch the prop was placed for (the nearest
      // sample can belong to another stretch that passes closer).
      s: opts.s ?? null,
    });
    return type.items.length - 1;
  }

  function wrap(d) {
    d %= L;
    if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
    return d;
  }

  // Big types are split into chunks of neighbouring props (sorted along the lap) so each chunk
  // has a tight bounding sphere and is frustum-culled on its own.
  function chunkTypes() {
    const out = [];
    for (const t of types) {
      if (t.items.length <= CHUNK || t.noChunk) { out.push(t); continue; }
      const order = t.items.map((it, k) => [it.s ?? env.alongTrack(it.x, it.z), k]).sort((a, b) => a[0] - b[0]);
      const n = Math.ceil(order.length / CHUNK);
      for (let c = 0; c < n; c++) {
        const part = order.slice(Math.floor((c * order.length) / n), Math.floor(((c + 1) * order.length) / n));
        out.push({ ...t, name: `${t.name}${c}`, items: part.map(([, k]) => t.items[k]), meshes: [] });
      }
      t.chunkedInto = n;
    }
    types.length = 0;
    types.push(...out);
  }

  function finalize(tabGeometry, tabMaterial) {
    chunkTypes();
    let hash = 0x9e3779b9;
    const rnd = () => { hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0; return hash / 4294967296; };
    const tabs = [];
    for (const t of types) {
      const n = t.items.length;
      if (!n) continue;
      t.s = new Float32Array(n);
      t.trig = new Float32Array(n);
      t.a = new Float32Array(n);
      t.v = new Float32Array(n);
      t.target = new Uint8Array(n);
      t.flutter = new Float32Array(n);
      t.live = new Uint8Array(n); // needs matrix writes this frame
      for (let i = 0; i < n; i++) {
        const it = t.items[i];
        t.s[i] = it.s ?? env.alongTrack(it.x, it.z);
        t.trig[i] = TRIGGER_MIN + TRIGGER_SPAN * rnd();
        if (it.alwaysUp) { t.a[i] = 1; t.target[i] = 1; }
        if (t.tab) tabs.push(it);
      }
      for (const part of t.parts) {
        const m = new THREE.InstancedMesh(part.geometry, part.material, n);
        m.name = `scenery:${t.name}`;
        m.castShadow = !!part.cast;
        m.receiveShadow = part.receive !== false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const tinted = t.items.some((it) => it.tint);
        const c = new THREE.Color();
        for (let i = 0; i < n; i++) {
          if (tinted) m.setColorAt(i, c.set(t.items[i].tint || '#ffffff'));
          // Bounds from the upright pose (a folded prop stays inside the same sphere).
          writeMatrix(t, i, 1, 0, m);
        }
        m.computeBoundingSphere();
        for (let i = 0; i < n; i++) writeMatrix(t, i, t.a[i], 0, m);
        m.instanceMatrix.needsUpdate = true;
        env.group.add(m);
        t.meshes.push(m);
        meshes.push(m);
      }
    }
    if (tabs.length && tabGeometry) {
      tabMesh = new THREE.InstancedMesh(tabGeometry, tabMaterial, tabs.length);
      tabMesh.name = 'scenery:tabs';
      tabMesh.receiveShadow = true;
      tabs.forEach((it, i) => {
        const w = it.tabW ?? Math.max(1, it.sx * 1.2), d = it.tabD ?? Math.max(0.6, it.sz * 1.2);
        const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
        mat4.set(c * w, 0, s * d, it.x, 0, 1, 0, it.y + 0.06, -s * w, 0, c * d, it.z, 0, 0, 0, 1);
        tabMesh.setMatrixAt(i, mat4);
      });
      tabMesh.instanceMatrix.needsUpdate = true;
      tabMesh.computeBoundingSphere();
      env.group.add(tabMesh);
      meshes.push(tabMesh);
    }
  }

  // M = T(x, y, z) · Ry(yaw + twist) · Rx(-(1 - a)·90°) · S(sx, sy, sz·flatten)
  function writeMatrix(t, i, a, twist, mesh) {
    const it = t.items[i];
    const th = -(1 - a) * HALF_PI;
    const yaw = it.yaw + twist;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(th), st = Math.sin(th);
    let flat = 1;
    if (t.kind === 'volume') flat = 0.05 + 0.95 * Math.min(1, Math.max(0, a));
    const X = it.sx, Y = it.sy, Z = it.sz * flat;
    mat4.set(
      cy * X, sy * st * Y, sy * ct * Z, it.x,
      0, ct * Y, -st * Z, it.y + 0.02,
      -sy * X, cy * st * Y, cy * ct * Z, it.z,
      0, 0, 0, 1,
    );
    (mesh || t.meshes[0]).setMatrixAt(i, mat4);
    if (!mesh) for (let k = 1; k < t.meshes.length; k++) t.meshes[k].setMatrixAt(i, mat4);
  }

  // Current pose matrix of one instance (for attached animated parts such as windmill sails).
  function poseOf(type, i, out) {
    type.meshes[0].getMatrixAt(i, out);
    return out;
  }

  // A popup ramp lies folded into the road and rises as it is approached. Core's ramp mesh may
  // offer setUnfold(0..1) (LOOK lane); without it the whole mesh is hinged flat at its foot.
  function addRamp(entry) {
    const obj = entry.object3d;
    const r = entry.ramp;
    const len = r.length ?? 14, h = r.height ?? 2.5;
    const fn = typeof entry.setUnfold === 'function' ? entry.setUnfold
      : typeof obj?.setUnfold === 'function' ? obj.setUnfold : null;
    const unfold = fn ? (a) => fn.call(fn === entry.setUnfold ? entry : obj, a) : null;
    const rec = { obj, unfold, s: (r.t || 0) * L, theta: Math.atan2(h, len), a: 0, v: 0, target: 0, riseAhead: null };
    if (!unfold) obj.rotation.order = 'YXZ';
    ramps.push(rec);
    poseRamp(rec);
  }

  function poseRamp(r) {
    if (r.unfold) r.unfold(Math.min(1.25, Math.max(0, r.a)));   // core allows overshoot to 1.25
    else r.obj.rotation.x = r.theta * (1 - r.a);
  }

  // Result in springA / springV (no per-frame allocation).
  let springA = 0, springV = 0;
  function spring(a, v, target, dt) {
    const w = target ? UP_W : DOWN_W, z = target ? UP_Z : DOWN_Z;
    let t = dt;
    while (t > 1e-6) {
      const h = Math.min(MAX_SUBSTEP, t);
      v += (w * w * (target - a) - 2 * z * w * v) * h;
      a += v * h;
      if (!target && a < 0) { a = 0; v = 0; }
      t -= h;
    }
    springA = a; springV = v;
  }

  function queueEmit(it, size) {
    if (size < EMIT_MIN_SIZE || size <= pendingSize) return;
    pendingSize = size;
    pending.set(it.x, it.y + size * 0.5, it.z);
  }

  function update(dt, camS, lookBack, reduced) {
    for (const t of types) {
      const n = t.items.length;
      if (!n) continue;
      let dirty = false;
      for (let i = 0; i < n; i++) {
        const it = t.items[i];
        let target = t.target[i];
        if (!it.alwaysUp) {
          const ahead = wrap(t.s[i] - camS);
          if (!target) {
            if (ahead >= -FOLD_BEHIND && ahead <= t.trig[i]) target = 1;
          } else if ((ahead < -FOLD_BEHIND && !lookBack) || ahead > t.trig[i] + FOLD_AHEAD_SLACK) {
            target = 0;
          }
        }
        if (target !== t.target[i]) {
          t.target[i] = target;
          t.live[i] = 1;
          if (target) queueEmit(it, it.size);
        }
        if (!t.live[i] && t.flutter[i] <= 0) continue;
        let a = t.a[i], v = t.v[i];
        if (reduced) {
          a = target; v = 0; t.flutter[i] = 0;
        } else {
          const before = a;
          spring(a, v, target, dt);
          a = springA; v = springV;
          if (target && before < 1 && a >= 1 && t.flutterOn && t.flutter[i] <= 0) t.flutter[i] = FLUTTER_TIME;
        }
        let twist = 0;
        if (t.flutter[i] > 0) {
          t.flutter[i] = Math.max(0, t.flutter[i] - dt);
          const k = t.flutter[i] / FLUTTER_TIME;
          twist = FLUTTER_AMP * k * k * Math.sin((FLUTTER_TIME - t.flutter[i]) * FLUTTER_HZ * Math.PI * 2);
        }
        t.a[i] = a; t.v[i] = v;
        if (Math.abs(a - target) < 1e-3 && Math.abs(v) < 1e-3 && t.flutter[i] <= 0) {
          t.a[i] = a = target; t.v[i] = 0; t.live[i] = 0;
        }
        writeMatrix(t, i, a, twist, null);
        dirty = true;
      }
      if (dirty) for (const m of t.meshes) m.instanceMatrix.needsUpdate = true;
    }

    for (const r of ramps) {
      const ahead = wrap(r.s - camS);
      let target = r.target;
      if (!target && ahead >= -FOLD_BEHIND && ahead <= RAMP_TRIGGER) target = 1;
      else if (target && ((ahead < -FOLD_BEHIND && !lookBack) || ahead > RAMP_TRIGGER + FOLD_AHEAD_SLACK)) target = 0;
      if (target !== r.target) {
        r.target = target;
        if (target) { pendingSize = Math.max(pendingSize, 3); pending.copy(r.obj.position); }
      }
      const before = r.a;
      if (reduced) { r.a = target; r.v = 0; } else if (Math.abs(r.a - target) > 1e-4 || Math.abs(r.v) > 1e-4) {
        spring(r.a, r.v, target, dt);
        r.a = springA; r.v = springV;
        if (target && Math.abs(r.a - 1) < 1e-3 && Math.abs(r.v) < 1e-3) { r.a = 1; r.v = 0; }
      }
      // Distance ahead of the camera when the ramp came to rest upright (the test reads it).
      if (target && r.a === 1 && before !== 1) r.riseAhead = ahead;
      if (r.a !== before || r.unfold === null) poseRamp(r);
    }

    emitTimer -= dt;
    if (pendingSize > 0 && emitTimer <= 0) {
      const p = emitPos[emitSlot = (emitSlot + 1) % emitPos.length].copy(pending);
      game.events?.emit('popup', { pos: p, size: pendingSize });
      pendingSize = 0;
      emitTimer = EMIT_GAP;
    }
  }

  function dispose() {
    const geos = new Set();
    for (const m of meshes) { geos.add(m.geometry); m.parent?.remove(m); m.dispose(); }
    for (const g of geos) g.dispose();
    for (const r of ramps) { r.a = 1; poseRamp(r); }
    meshes.length = 0;
    ramps.length = 0;
  }

  return { addType, add, finalize, addRamp, update, poseOf, dispose, types, ramps };
}
