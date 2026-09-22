// CORE STUB — the audio agent replaces this folder but keeps createAudio(game) → { unlock, update, dispose }.
// Core keeps its gesture listener armed until `ctx.state === 'running'`, so the real module exposes `ctx`.
export function createAudio() {
  return {
    ctx: null,
    unlock() {},
    update() {},
    dispose() {},
  };
}
