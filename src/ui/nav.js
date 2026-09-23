// Focus handling shared by every interactive screen: game.input.nav presses move focus spatially
// (by on-screen position), the mouse hovers, and a real click or tap confirms.

export class FocusList {
  constructor(ctx, { onBack = null, onFocus = null } = {}) {
    this.ctx = ctx;
    this.items = [];
    this.index = -1;
    this.onBack = onBack;
    this.onFocus = onFocus;
    this.offs = [];
  }

  // items: [{ el, confirm?, left?, right?, up?, down?, data? }]
  set(items, index = 0) {
    this.release();
    this.items = items;
    this.index = -1;
    items.forEach((it, i) => {
      const el = it.el;
      el.classList.add('kk-focusable');
      const enter = (e) => { if (e.pointerType === 'mouse') this.focus(i); };
      // Keyboard-synthesised clicks (detail 0) are ignored: keys arrive through game.input.nav.
      const click = (e) => {
        if (e.detail === 0) return;
        e.preventDefault();
        this.focus(i, true);
        this.confirm();
      };
      el.addEventListener('pointerenter', enter);
      el.addEventListener('click', click);
      this.offs.push(() => { el.removeEventListener('pointerenter', enter); el.removeEventListener('click', click); });
    });
    if (items.length) this.focus(Math.max(0, Math.min(items.length - 1, index)), true);
  }

  release() {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  get current() { return this.items[this.index] || null; }

  focus(i, silent = false) {
    if (i === this.index || !this.items[i]) return;
    const prev = this.items[this.index];
    if (prev) prev.el.classList.remove('is-focus');
    this.index = i;
    const it = this.items[i];
    it.el.classList.add('is-focus');
    if (!silent) this.ctx.click();
    if (this.onFocus) this.onFocus(it, i);
    if (it.onFocus) it.onFocus(it, i);
  }

  confirm() {
    const it = this.current;
    if (it && it.confirm) { this.ctx.click(); it.confirm(it); }
  }

  move(dir) {
    const cur = this.current;
    if (!cur) { this.focus(0); return; }
    if (cur[dir]) { cur[dir](cur); return; }
    const a = cur.el.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    let best = -1, bestScore = Infinity;
    this.items.forEach((it, i) => {
      if (i === this.index || it.el.offsetParent === null) return;
      const b = it.el.getBoundingClientRect();
      const vx = b.left + b.width / 2 - ax, vy = b.top + b.height / 2 - ay;
      const along = vx * dx + vy * dy;
      if (along <= 4) return;
      const across = Math.abs(vx * dy - vy * dx);
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) this.focus(best);
    // Nothing further that way: vertical moves continue in list order (two-column forms wrap to the next column).
    else if (dir === 'down' && this.items[this.index + 1]) this.focus(this.index + 1);
    else if (dir === 'up' && this.index > 0) this.focus(this.index - 1);
  }

  handle(nav) {
    if (!nav) return false;
    if (nav.up) this.move('up');
    else if (nav.down) this.move('down');
    else if (nav.left) this.move('left');
    else if (nav.right) this.move('right');
    if (nav.confirm) { this.confirm(); return true; }
    if (nav.back && this.onBack) { this.ctx.click(); this.onBack(); return true; }
    return nav.up || nav.down || nav.left || nav.right;
  }
}
