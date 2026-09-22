// CORE STUB — the items agent replaces this folder but keeps createItems(game) and its read-only views.
// No boxes; every kart keeps item = null.
export function createItems(game) {
  return {
    hazards: [],
    boxes: [],
    projectiles: [],
    update() {
      for (const k of game.karts) { k.item = null; k.itemCount = 0; k.itemHeld = false; }
    },
    updateVisual() {},
    dispose() {},
  };
}
