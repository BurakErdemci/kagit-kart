// Chase rig (ARCHITECTURE.md §12). `override` belongs to cinematics: an object with
// update(frameDt, camera) that owns the camera while set. `debugMode` ('top'|'side') belongs to tests
// and wins over everything.
import * as THREE from 'three';
import { clamp, damp, dampAngle, forwardOf, smoothstep } from '../core/math.js';

const DEG = Math.PI / 180;

export function createCameraRig(game, camera) {
  const cfg = game.config.camera;
  const fwd = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const look = new THREE.Vector3();
  const shakeOff = new THREE.Vector3();
  const kartPos = new THREE.Vector3();

  const rig = {
    target: null, // Kart; defaults to game.player
    override: null,
    debugMode: null,
    lookBack: false,
    yaw: 0,
    hfov: cfg.hfovRest,
    shakeAmount: 0,
    shakeTime: 0,
    pos: new THREE.Vector3(),
    off: new THREE.Vector3(),
    height: 0,
    initialized: false,
    update,
    snap,
    shake,
    setHorizontalFov,
    dispose,
  };

  function setHorizontalFov(hfovDeg) {
    const aspect = camera.aspect || 1;
    const v = 2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) / aspect) / DEG;
    camera.fov = clamp(v, cfg.vfovMin, cfg.vfovMax);
    camera.updateProjectionMatrix();
  }

  // Gated by settings and reduced motion. Core shakes on the followed kart's hits and wall impacts;
  // other systems call it only for extra jolts of their own.
  function shake(amount = 0.3) {
    if (!game.settings.cameraShake || game.reducedMotion) return;
    rig.shakeAmount = Math.max(rig.shakeAmount, amount);
  }

  const followed = (k) => !!k && !rig.override && !rig.debugMode && k === (rig.target || game.player);
  const offs = [
    game.events.on('hit', (e) => { if (followed(e.kart)) shake(cfg.shakeHit); }),
    game.events.on('wallHit', (e) => {
      if (!followed(e.kart)) return;
      const hard = clamp(((e.speed || 0) * Math.sin(e.angle || 0)) / 20, 0, 1);
      shake(cfg.shakeWall * (0.35 + 0.65 * hard));
    }),
  ];
  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
  }

  function kartVisualPos(k) {
    if (k.visual && k.visual.object3d) return kartPos.copy(k.visual.object3d.position);
    return kartPos.copy(k.pos);
  }

  function snap() {
    rig.initialized = false;
  }

  function driftVisualOffset(k) {
    return k.visualYaw || 0;
  }

  function update(frameDt) {
    const k = rig.target || game.player;
    if (rig.debugMode && k) {
      const p = kartVisualPos(k);
      if (rig.debugMode === 'top') {
        camera.position.set(p.x, p.y + 90, p.z + 0.01);
        camera.up.set(0, 0, 1);
        camera.lookAt(p);
        camera.up.set(0, 1, 0);
      } else {
        forwardOf(k.heading, fwd);
        camera.position.set(p.x + fwd.z * 14, p.y + 2.5, p.z - fwd.x * 14);
        camera.lookAt(p.x, p.y + 0.8, p.z);
      }
      setHorizontalFov(70);
      return;
    }
    if (rig.override) {
      rig.override.update(frameDt, camera);
      rig.initialized = false;
      return;
    }
    if (!k) return;

    const p = kartVisualPos(k);
    const dt = Math.min(frameDt, 0.1);
    const targetYaw = k.heading + cfg.driftYawShare * driftVisualOffset(k);
    const lb = rig.lookBack || (k.controls && k.controls.lookBack && !k.autopilot);
    const boosting = k.boostTime > 0;

    if (!rig.initialized) {
      rig.yaw = targetYaw;
      forwardOf(rig.yaw, fwd);
      rig.off.set(-fwd.x * cfg.distance, 0, -fwd.z * cfg.distance);
      rig.pos.set(p.x + rig.off.x, 0, p.z + rig.off.z);
      rig.height = p.y + cfg.height;
      rig.hfov = cfg.hfovRest;
      rig.initialized = true;
    } else {
      rig.yaw = dampAngle(rig.yaw, targetYaw, cfg.yawHalfLife, dt);
    }

    forwardOf(rig.yaw, fwd);
    const dist = cfg.distance + (boosting ? cfg.boostDistance : 0);
    // Damp the offset from the kart, not the absolute position: a world-space follow lags by
    // speed × 0.14 s (≈ 4 m at top speed) and the kart shrinks on screen.
    desired.set(-fwd.x * dist, 0, -fwd.z * dist);
    rig.off.x = damp(rig.off.x, desired.x, cfg.posHalfLife, dt);
    rig.off.z = damp(rig.off.z, desired.z, cfg.posHalfLife, dt);
    rig.pos.set(p.x + rig.off.x, 0, p.z + rig.off.z);
    const hl = k.grounded ? cfg.heightHalfLife : cfg.airHeightHalfLife;
    rig.height = damp(rig.height, p.y + cfg.height, hl, dt);

    // FOV: 90° rest → 95° at top speed → 102° boosting (horizontal).
    const top = k.topSpeed || 25;
    const sp = clamp(Math.abs(k.speed) / top, 0, 1.2);
    let hf = cfg.hfovRest + (cfg.hfovTop - cfg.hfovRest) * smoothstep(0.3, 1.0, sp);
    if (boosting) hf = cfg.hfovBoost;
    rig.hfov = damp(rig.hfov, hf, cfg.fovHalfLife, dt);

    // Keep the camera above the ground under it so it never clips the road on crests.
    const camY = Math.max(rig.height, p.y + 1.2);

    if (lb) {
      forwardOf(k.heading, fwd);
      camera.position.set(p.x + fwd.x * cfg.lookBackDistance, p.y + cfg.height * 0.9, p.z + fwd.z * cfg.lookBackDistance);
      look.set(p.x - fwd.x * cfg.lookAhead, p.y + cfg.lookHeight, p.z - fwd.z * cfg.lookAhead);
    } else {
      camera.position.set(rig.pos.x, camY, rig.pos.z);
      look.set(p.x + fwd.x * cfg.lookAhead, p.y + cfg.lookHeight, p.z + fwd.z * cfg.lookAhead);
    }

    if (rig.shakeAmount > 0.001) {
      rig.shakeTime += dt;
      const a = rig.shakeAmount;
      shakeOff.set(Math.sin(rig.shakeTime * 71) * a, Math.sin(rig.shakeTime * 53 + 1) * a * 0.6, Math.sin(rig.shakeTime * 67 + 2) * a);
      camera.position.add(shakeOff);
      rig.shakeAmount = damp(rig.shakeAmount, 0, 1 / cfg.shakeDecay, dt);
    }

    camera.lookAt(look);
    setHorizontalFov(rig.hfov);
  }

  return rig;
}
