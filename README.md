# Kâğıt Kart

A browser kart racer set inside a pop-up book. Scenery folds up out of the page as
you drive toward it; the karts, drivers and items are paper and stationery.

- Plain ES modules, no build step. three.js from jsdelivr via an import map.
- Everything else is procedural: geometry, paper textures, sound and music.
- `index.html` is written as a page *body* (no `<html>`/`<head>`), because the
  publishing host wraps it in its own skeleton. `tools/serve.py` applies the same
  wrapper locally so dev and publish render identically.

## The number that says it works

Written before the first commit (working agreement §3):

> **An automated autopilot run finishes a 3-lap, 8-kart race on every track with
> 0 console errors, and the player's view renders at a mean of >= 60 fps on this
> machine (RX 6750 XT, Chromium via Playwright).**

`tools/playtest.mjs` measures it and prints one JSON line per track. The fps half
is only meaningful with the GPU path active — the script prints the WebGL
renderer string, and a SwiftShader/software renderer invalidates the fps number.

Whether it is *worth showing* is the owner's call, not a metric.

## Run

```bash
python tools/serve.py 8765        # http://127.0.0.1:8765
node tools/playtest.mjs --port 8765
```

See `ARCHITECTURE.md` for the module contract.
