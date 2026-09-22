// Time-trial ghost: the player is recorded at 20 Hz (pos + heading); the best run replays with a
// { ghost: true } visual. Data is plain JSON so it fits in storage.
import * as THREE from 'three';

export function createGhostRecorder(hz) {
  const frames = [];
  const checkpoints = [];
  let next = 0;
  return {
    frames,
    checkpoints,
    record(kart, raceTime) {
      if (raceTime < next) return;
      next += 1 / hz;
      frames.push(kart.pos.x, kart.pos.y, kart.pos.z, kart.heading);
    },
    mark(raceTime) {
      checkpoints.push(raceTime);
    },
    toData(total, lapTimes) {
      // Rounded once here so the stored JSON stays small: cm for positions, mrad for heading.
      const out = new Array(frames.length);
      for (let i = 0; i < frames.length; i++) {
        const q = i % 4 === 3 ? 1000 : 100;
        out[i] = Math.round(frames[i] * q) / q;
      }
      return { hz, frames: out, checkpoints: checkpoints.map((t) => Math.round(t * 1000) / 1000), total, lapTimes: lapTimes.slice() };
    },
  };
}

const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);

export function createGhostPlayer(game, data, visual) {
  const f = data.frames;
  const count = Math.floor(f.length / 4);
  const obj = visual.object3d;
  obj.visible = false;
  return {
    data,
    visual,
    update(raceTime) {
      if (count < 2) return;
      const u = raceTime * data.hz;
      const i = Math.floor(u);
      if (i < 0 || i >= count - 1) { obj.visible = false; return; }
      const a = u - i;
      const o = i * 4, p = o + 4;
      obj.visible = true;
      obj.position.set(
        f[o] + (f[p] - f[o]) * a,
        f[o + 1] + (f[p + 1] - f[o + 1]) * a,
        f[o + 2] + (f[p + 2] - f[o + 2]) * a,
      );
      let dh = f[p + 3] - f[o + 3];
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      _q.setFromAxisAngle(_y, f[o + 3] + dh * a);
      obj.quaternion.copy(_q);
    },
    // split vs the ghost at checkpoint k (lap-major, 3 per lap)
    splitAt(k, raceTime) {
      const t = data.checkpoints[k];
      return t == null ? null : raceTime - t;
    },
  };
}
