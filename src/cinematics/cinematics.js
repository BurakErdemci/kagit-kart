// Cinematics (ARCHITECTURE §10.8): owns cameraRig.override for every shot outside normal driving.
// createCinematics(game) → { update(frameDt), play(shot, opts) → Promise, stop(), dispose() }.
// play() always resolves: true when the shot completed, false when it was stopped or replaced.
// Out-of-race shots (title, select, podium) share one book-on-desk stage, built on first use and
// kept until dispose(); it is in the scene only while such a shot runs.
import * as THREE from 'three';
import { BOOK_THEME } from '../core/config.js';
import { easeInOutSine, lookQuaternion } from './campath.js';
import { createStage } from './stage.js';
import { createPodium } from './podium.js';
import { finishShot, introShot, podiumShot, selectShot, titleShot } from './shots.js';

// The book theme at golden hour: a low warm sun from the reader's left, cool lavender shade, a
// peach haze over the far desk. Paper and ink stay the book theme's, so the UI still matches.
export const STAGE_THEME = {
  ...BOOK_THEME,
  skyTop: '#7f9fcf',
  skyBottom: '#f6c690',
  fog: { color: '#efc79b', near: 55, far: 240 },
  sun: { dir: [-0.72, 0.53, 0.45], color: '#ffc47e', intensity: 2.5 },
  ambient: { color: '#9aa3d4', intensity: 0.95 },
};

const STAGE_SHADOW_EXTENT = 14;

const SHOTS = { title: titleShot, select: selectShot, intro: introShot, finish: finishShot, podium: podiumShot };

export function createCinematics(game) {
  let stage = null;
  let podium = null;
  let stageShown = false;
  let active = null;
  const pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), vfov: 50 };
  const blend = { t: 0, dur: 0, fromPos: new THREE.Vector3(), fromQuat: new THREE.Quaternion(), fromFov: 50 };
  const q = new THREE.Quaternion();
  const lead = new THREE.Vector3();

  const override = {
    // Where in-race shots want the shadow frustum (what the camera looks at). main.js still centres
    // it on the player; CORE_REQUEST: prefer override.sunTarget while it is set.
    sunTarget: null,
    update(frameDt, camera) {
      if (!active) return;
      active.shot.pose(pose);
      override.sunTarget = active.shot.inRace ? pose.look : null;
      lookQuaternion(pose.pos, pose.look, q);
      let fov = pose.vfov;
      if (blend.dur > 0) {
        blend.t += frameDt;
        const k = easeInOutSine(Math.min(1, blend.t / blend.dur));
        camera.position.lerpVectors(blend.fromPos, pose.pos, k);
        camera.quaternion.slerpQuaternions(blend.fromQuat, q, k);
        fov = blend.fromFov + (fov - blend.fromFov) * k;
        if (blend.t >= blend.dur) blend.dur = 0;
      } else {
        camera.position.copy(pose.pos);
        camera.quaternion.copy(q);
      }
      if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      // The renderer centres the shadow frustum shadowLead metres ahead of sunTarget along the view;
      // cancelling that lead keeps it fixed on the stage while the camera orbits, so shadows hold still.
      if (stageShown) {
        camera.getWorldDirection(lead).setY(0);
        if (lead.lengthSq() > 1e-6) lead.normalize().multiplyScalar(game.config.render.shadowLead);
        game.renderer.sunTarget.copy(stage.focus).sub(lead);
      }
    },
  };

  function ensureStage() {
    if (!stage) stage = createStage(game);
    return stage;
  }

  function ensurePodium() {
    ensureStage();
    if (!podium) {
      podium = createPodium(game, stage);
      stage.group.add(podium.group);
    }
    return podium;
  }

  // The race's shadow frustum (±40 m) is sized for a track; the book fits in ±14 m, which makes
  // shadow texels 2.9× finer on the close-ups. Prefers a core API; otherwise edits the public sun's
  // shadow camera and restores it when the stage leaves (CORE_REQUEST in the report).
  let savedShadow = null;
  function tightenShadows(on) {
    const r = game.renderer;
    if (typeof r.setShadowExtent === 'function') { r.setShadowExtent(on ? STAGE_SHADOW_EXTENT : null); return; }
    const cam = r.sun?.shadow?.camera;
    if (!cam) return;
    if (on && !savedShadow) {
      savedShadow = { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom };
      Object.assign(cam, { left: -STAGE_SHADOW_EXTENT, right: STAGE_SHADOW_EXTENT, top: STAGE_SHADOW_EXTENT, bottom: -STAGE_SHADOW_EXTENT });
      cam.updateProjectionMatrix();
    } else if (!on && savedShadow) {
      Object.assign(cam, savedShadow);
      cam.updateProjectionMatrix();
      savedShadow = null;
    }
  }

  function showStage() {
    ensureStage();
    if (!stageShown) {
      game.scene.add(stage.group);
      stageShown = true;
      tightenShadows(true);
    }
    game.renderer.setTheme(STAGE_THEME);
  }

  function hideStage() {
    if (!stageShown) return;
    game.scene.remove(stage.group);
    stageShown = false;
    tightenShadows(false);
  }

  function release() {
    if (game.cameraRig.override === override) game.cameraRig.override = null;
    blend.dur = 0;
  }

  // Ends the running shot. The stage leaves the scene with it: a race setup that follows in the same
  // tick takes its leak snapshot without our objects.
  function finishActive(ok) {
    const e = active;
    if (!e) return;
    active = null;
    try { e.shot.stop?.(); } catch (err) { console.error(`[cinematics] ${e.name}.stop threw`, err); }
    release();
    if (e.shot.stageMode) {
      hideStage();
    }
    if (!e.done) { e.done = true; e.resolve(ok); }
  }

  function play(name, opts = {}) {
    const fromStage = !!(active && active.shot.stageMode);
    finishActive(false);
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const make = SHOTS[name];
    if (!make) {
      resolve(false);
      return promise;
    }
    const entry = { name, shot: null, resolve, done: false };
    const ctx = {
      game,
      stage: ensureStage,
      podium: ensurePodium,
      fromStage,
      complete() { if (!entry.done) { entry.done = true; entry.resolve(true); } },
      end() { if (active === entry) finishActive(true); else if (!entry.done) { entry.done = true; entry.resolve(true); } },
    };
    active = entry;
    let shot = null;
    try {
      shot = make(ctx, opts || {});
    } catch (err) {
      console.error(`[cinematics] ${name} could not start`, err);
    }
    if (!shot) {
      active = null;
      release();
      if (!entry.done) { entry.done = true; resolve(false); }
      return promise;
    }
    entry.shot = shot;
    if (shot.stageMode) showStage(); else hideStage();
    const cam = game.camera;
    if (fromStage && shot.stageMode && shot.blendIn > 0 && !game.reducedMotion) {
      blend.fromPos.copy(cam.position);
      blend.fromQuat.copy(cam.quaternion);
      blend.fromFov = cam.fov;
      blend.t = 0;
      blend.dur = shot.blendIn;
    } else {
      blend.dur = 0;
    }
    game.cameraRig.override = override;
    return promise;
  }

  function stop() {
    finishActive(false);
  }

  function update(frameDt) {
    if (!active) return;
    const e = active;
    try {
      e.shot.update(frameDt);
    } catch (err) {
      console.error(`[cinematics] ${e.name} failed`, err);
      if (active === e) finishActive(false);
      return;
    }
    if (stageShown && active) stage.update(frameDt);
  }

  const offs = [
    game.events.on('menu', (e) => { if (active && active.shot.onMenu) active.shot.onMenu(e); }),
    // Boot-lifetime system: no Kart or track reference may outlive the race (§7).
    game.events.on('raceTeardown', () => { if (active && active.shot.inRace) finishActive(false); }),
  ];

  function dispose() {
    finishActive(false);
    for (const off of offs) off();
    offs.length = 0;
    podium?.dispose();
    podium = null;
    stage?.dispose();
    stage = null;
  }

  return {
    update, play, stop, dispose,
    get shot() { return active ? active.name : null; },
    // read by the UI (the title waits for the cover) and by tests
    get book() { return stage ? stage.book : null; },
    get pageChapter() { return stage ? stage.chapter : null; },
  };
}
