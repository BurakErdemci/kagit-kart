// Keyboard + gamepad (polled per animation frame) + the touch object UI writes, merged into the
// player's controls. Menu navigation presses are exposed per frame on `input.nav`.

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyX', 'KeyE'],
  lookBack: ['KeyC'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
  back: ['Escape', 'Backspace'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
  restart: ['KeyR'],
};
const MAPPED = new Set(Object.values(KEYS).flat());

// Standard gamepad mapping (ARCHITECTURE.md §13).
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const STICK_DEAD = 0.18;
const deadzone = (v) => (Math.abs(v) < STICK_DEAD ? 0 : (v - Math.sign(v) * STICK_DEAD) / (1 - STICK_DEAD));
const NAV_REPEAT_DELAY = 0.4;
const NAV_REPEAT_RATE = 0.12;

export function createInput(game) {
  const held = new Set();
  const framePressed = new Set(); // keydown (incl. repeats) since last poll
  const frameFresh = new Set(); // keydown without repeat since last poll
  const latch = { drift: false, item: false };
  const touchLatch = { drift: false, item: false, prevDrift: false, prevItem: false };
  const stickNav = { dir: null, t: 0, next: 0 };
  const padPrevHeld = new Set();

  const input = {
    nav: { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false },
    pad: { connected: false, id: '', axes: [0, 0], held: new Set(), pressed: new Set(), values: new Float32Array(17) },
    touch: { steer: 0, throttle: 0, brake: 0, drift: false, item: false, lookBack: false },
    device: 'keyboard', // last device that produced input: 'keyboard' | 'gamepad' | 'touch'
    // Tests may set this to a partial controls object; it replaces the player's input each step.
    testControls: null,
    keyHeld: (code) => held.has(code),
    keyPressed: (code) => frameFresh.has(code),
    anyPressed: (name) => anyIn(frameFresh, KEYS[name]),
    poll,
    readPlayer,
    dispose,
  };

  function menuPhase() {
    return game.phase === 'title' || game.phase === 'menu' || game.phase === 'boot';
  }

  function isTypingTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKeyDown(e) {
    if (isTypingTarget(e.target)) return;
    const code = e.code;
    held.add(code);
    framePressed.add(code);
    if (!e.repeat) {
      frameFresh.add(code);
      if (KEYS.drift.includes(code)) latch.drift = true;
      if (KEYS.item.includes(code)) latch.item = true;
    }
    input.device = 'keyboard';
    if (MAPPED.has(code) && !menuPhase()) e.preventDefault();
  }

  function onKeyUp(e) {
    held.delete(e.code);
  }

  function onBlur() {
    held.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  function anyHeld(list) {
    for (let i = 0; i < list.length; i++) if (held.has(list[i])) return true;
    return false;
  }

  function anyIn(set, list) {
    for (let i = 0; i < list.length; i++) if (set.has(list[i])) return true;
    return false;
  }

  function pollPad() {
    const pad = input.pad;
    pad.pressed.clear();
    let gp = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected && p.mapping === 'standard') { gp = p; break; }
      }
    } catch {
      gp = null;
    }
    if (!gp) {
      pad.connected = false;
      pad.held.clear();
      pad.axes[0] = pad.axes[1] = 0;
      padPrevHeld.clear();
      return;
    }
    pad.connected = true;
    pad.id = gp.id;
    pad.held.clear();
    for (let i = 0; i < gp.buttons.length && i < 17; i++) {
      const b = gp.buttons[i];
      const v = b ? b.value : 0;
      pad.values[i] = v;
      if (b && (b.pressed || v > 0.5)) pad.held.add(i);
    }
    for (const i of pad.held) if (!padPrevHeld.has(i)) pad.pressed.add(i);
    padPrevHeld.clear();
    for (const i of pad.held) padPrevHeld.add(i);
    pad.axes[0] = deadzone(gp.axes[0] || 0);
    pad.axes[1] = deadzone(gp.axes[1] || 0);
    if (pad.pressed.size || Math.abs(pad.axes[0]) > 0.3 || Math.abs(pad.axes[1]) > 0.3) input.device = 'gamepad';
    if (pad.pressed.has(PAD.RB)) latch.drift = true;
    if (pad.pressed.has(PAD.X) || pad.pressed.has(PAD.LB)) latch.item = true;
  }

  function pollStickNav(dt) {
    const x = input.pad.axes[0], y = input.pad.axes[1];
    let dir = null;
    if (Math.abs(x) > 0.55 || Math.abs(y) > 0.55) {
      dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    }
    if (dir !== stickNav.dir) {
      stickNav.dir = dir;
      stickNav.t = 0;
      stickNav.next = NAV_REPEAT_DELAY;
      return dir;
    }
    if (!dir) return null;
    stickNav.t += dt;
    if (stickNav.t >= stickNav.next) {
      stickNav.next += NAV_REPEAT_RATE;
      return dir;
    }
    return null;
  }

  // Called once per animation frame, in every phase.
  function poll(frameDt = 0) {
    pollPad();
    const pp = input.pad.pressed;
    const stick = input.pad.connected ? pollStickNav(frameDt) : null;
    const nav = input.nav;
    nav.up = anyIn(framePressed, KEYS.up) || pp.has(PAD.UP) || stick === 'up';
    nav.down = anyIn(framePressed, KEYS.down) || pp.has(PAD.DOWN) || stick === 'down';
    nav.left = anyIn(framePressed, KEYS.left) || pp.has(PAD.LEFT) || stick === 'left';
    nav.right = anyIn(framePressed, KEYS.right) || pp.has(PAD.RIGHT) || stick === 'right';
    nav.confirm = anyIn(frameFresh, KEYS.confirm) || pp.has(PAD.A);
    nav.back = anyIn(frameFresh, KEYS.back) || pp.has(PAD.B);
    nav.pause = anyIn(frameFresh, KEYS.pause) || pp.has(PAD.START);

    // Touch drift/item presses latch until one step consumes them.
    const t = input.touch;
    if (t.drift && !touchLatch.prevDrift) touchLatch.drift = true;
    if (t.item && !touchLatch.prevItem) touchLatch.item = true;
    touchLatch.prevDrift = !!t.drift;
    touchLatch.prevItem = !!t.item;
  }

  // Called after the frame's systems have read nav/keyPressed.
  function endFrame() {
    framePressed.clear();
    frameFresh.clear();
  }
  input.endFrame = endFrame;

  // Called once per fixed step for the (non-autopilot) player.
  function readPlayer(out) {
    const pad = input.pad;
    const t = input.touch;

    let kSteer = (anyHeld(KEYS.right) ? 1 : 0) - (anyHeld(KEYS.left) ? 1 : 0);
    let pSteer = 0;
    if (pad.connected) {
      pSteer = pad.axes[0];
      if (pad.held.has(PAD.LEFT)) pSteer = -1;
      if (pad.held.has(PAD.RIGHT)) pSteer = 1;
    }
    const tSteer = t.steer || 0;
    let steer = kSteer;
    if (Math.abs(pSteer) > Math.abs(steer)) steer = pSteer;
    if (Math.abs(tSteer) > Math.abs(steer)) steer = tSteer;

    const kThrottle = anyHeld(KEYS.up) ? 1 : 0;
    const pThrottle = pad.connected ? Math.max(pad.held.has(PAD.A) ? 1 : 0, pad.values[PAD.RT]) : 0;
    const throttle = Math.max(kThrottle, pThrottle, t.throttle || 0);

    const kBrake = anyHeld(KEYS.down) ? 1 : 0;
    const pBrake = pad.connected ? Math.max(pad.held.has(PAD.B) ? 1 : 0, pad.values[PAD.LT]) : 0;
    const brake = Math.max(kBrake, pBrake, t.brake || 0);

    const drift = anyHeld(KEYS.drift) || (pad.connected && pad.held.has(PAD.RB)) || !!t.drift ||
      latch.drift || touchLatch.drift;
    const item = anyHeld(KEYS.item) || (pad.connected && (pad.held.has(PAD.X) || pad.held.has(PAD.LB))) ||
      !!t.item || latch.item || touchLatch.item;
    const lookBack = anyHeld(KEYS.lookBack) || (pad.connected && pad.held.has(PAD.Y)) || !!t.lookBack;
    latch.drift = latch.item = false;
    touchLatch.drift = touchLatch.item = false;

    out.steer = Math.max(-1, Math.min(1, steer));
    out.throttle = Math.max(0, Math.min(1, throttle));
    out.brake = Math.max(0, Math.min(1, brake));
    out.drift = drift;
    out.item = item;
    out.lookBack = lookBack;

    if (game.settings.autoAccelerate && game.phase !== 'countdown' && out.brake < 0.5) out.throttle = 1;

    if (input.testControls) Object.assign(out, input.testControls);
    return out;
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  }

  return input;
}
