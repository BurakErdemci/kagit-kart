// CORE STUB — the cinematics agent replaces this folder but keeps
// createCinematics(game) → { update(frameDt), play(shot, opts) → Promise, stop(), dispose() }.
// No camera override here; play resolves immediately.
export function createCinematics() {
  return {
    update() {},
    play() { return Promise.resolve(); },
    stop() {},
    dispose() {},
  };
}
