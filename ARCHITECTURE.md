# Kâğıt Kart — architecture contract

This file is the contract every module is written against. Several agents build
modules in parallel; anything left vague here comes back as an integration break.
If you need something the contract does not give you, **do not reach into another
module's files** — write it under `CORE_REQUESTS` in your report (see §15).

---------------------------------------------------------------------------------

## 1. The game in one paragraph

A Mario-Kart-style arcade kart racer (original IP — no Nintendo names, characters
or item names) whose world is a **pop-up book**. Each track is a chapter of the
book. The ground is the printed page; scenery (trees, houses, towers, bridges)
lies flat on the page and **folds up** as karts approach, with a springy overshoot
and a paper rustle. Karts, drivers and items are paper and stationery. Speed
classes are paper weights: **80 g / 120 g / 200 g**. UI copy is **Turkish**.

Content targets: 8 karts (1 player + 7 CPU), 8 characters, 4 tracks (a cup),
3 laps, modes Grand Prix / Single race / Time trial, 8 item types, drift with
three mini-turbo tiers, trick boosts off ramps, start boost, boost pads,
offroad, respawn by a paper crane, podium ceremony.

## 2. Hosting constraints (hard — the page is published to a sandboxed host)

- `index.html` is a page **body**: no `<!doctype>`, `<html>`, `<head>`, `<body>`
  tags. Put `<title>`, `<style>`, the import map and the entry `<script type="module">`
  directly in it. The host (and `tools/serve.py` locally) wraps it in
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport"
  content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>…`.
- External **scripts** only from `https://cdn.jsdelivr.net/npm/` (three.js:
  `three@0.186.0`, both `build/three.module.js` and `examples/jsm/…`, mapped in
  an import map: `"three"` and `"three/addons/"`). External **stylesheets** only
  from `https://fonts.googleapis.com` (fonts from `fonts.gstatic.com`). Every
  other host is silently blocked — no images, audio or fetches from the network.
  All assets are generated in code (CanvasTexture, BufferGeometry, WebAudio).
- Own files published alongside the page load by relative URL (`./src/…`).
  Inject module CSS at runtime from JS (`<style>` element) rather than adding
  `<link>` tags for own CSS.
- No `alert/confirm/prompt`, no `window.open`, no downloads, no print.
- Audio may only start after a user gesture — unlock on the first click/key/touch.
- `localStorage` may be missing or throw: wrap **every** access in try/catch and
  work without it (best times, settings).
- Must work at phone width with touch, and with a gamepad. `prefers-reduced-motion`
  is honoured (see §11).
- Fonts must render **Turkish glyphs** (ç ğ ı İ ö ş ü Â â). Pick faces with
  `latin-ext` coverage and verify by screenshot.

## 3. Layout and ownership

```
index.html                 core
src/main.js                core   boot, state machine, loops, wiring
src/core/                  core   config.js, rng.js, events.js, loop.js, math.js, storage.js
src/input/                 core   keyboard + gamepad → player controls; touch writes into it (UI)
src/track/trackBuilder.js  core   def → TrackData (samples, meshes)
src/track/trackQuery.js    core   position → track-relative info
src/track/defs/            TRACKS agent (core ships a placeholder meadow.js)
src/kart/                  core   Kart class, physics, kart-kart collisions
src/race/                  core   grid, countdown, laps, places, finish, GP points
src/render/                core   renderer, camera rig, materials, textures, post, sky
src/test/                  core   window.__kk test API
tools/                     core   serve.py, playtest.mjs, pw.mjs
src/ai/                    AI agent
src/items/                 ITEMS agent
src/audio/                 AUDIO agent
src/ui/                    UI agent (menus, HUD, touch controls, settings)
src/scenery/               TRACKS agent (scenery themes + pop-up system)
src/fx/                    FX agent
src/characters/            CHARACTERS agent (roster, kart + driver models, animation)
src/cinematics/            CINEMATICS agent (title scene, intro flyover, finish cam, podium)
```

Core ships a **working stub** for every agent folder, exporting exactly the
factory named in §9 with trivial behaviour, so the game runs end to end before
any agent starts. An agent replaces its folder's contents but keeps the export.

## 4. Units, axes, time

- Meters, seconds, radians. three.js Y-up. For heading `h`, forward is
  `(sin h, 0, cos h)` and the kart's right is `(-cos h, 0, sin h)` (forward × up).
  Increasing `h` turns the kart **left**; `controls.steer = +1` means steer
  **right**, so it decreases `h`. Track `lateral` is positive to the right of the
  direction of travel. Use the `math.js` helpers `forwardOf(h)`, `rightOf(h)`,
  `headingOf(vec)`; never re-derive these.
- **Simulation is fixed-step at 1/120 s** (`config.STEP`). Rendering runs per
  animation frame and **interpolates** kart/projectile transforms between the
  previous and current step (`alpha`). Anything purely visual (particles, UI,
  scenery pop-ups, camera) runs on the variable frame dt.
- Seeded RNG (`game.rng`, mulberry32) for anything that affects the simulation —
  item rolls, AI decisions, grid order. `Math.random` only for pure cosmetics.
  Same seed + same inputs ⇒ same race (the test harness depends on it).
- No per-step allocation in hot paths: reuse module-level `Vector3`s.

## 5. The `game` object (single shared context, created in main.js)

```js
game = {
  THREE, config, rng, events,            // events: on(name, fn) → off(), emit(name, payload)
  renderer, scene, camera, cameraRig,    // cameraRig.override: null | (dt, camera) => bool (true = I positioned it)
  materials,                             // render/materials.js API (§10)
  settings,                              // persisted user settings (§12)
  phase,                                 // 'boot'|'title'|'menu'|'intro'|'countdown'|'race'|'finishing'|'results'|'podium'
  paused,                                // bool, separate from phase
  time, raceTime,                        // seconds since boot / since GO (0 before GO)
  track,                                 // TrackData (§7) or null
  trackDef,                              // the def object
  karts: [],                             // Kart[] (§6), index 0..7
  player,                                // the player's Kart
  race,                                  // race manager state (§13)
  gp,                                    // { cup:[trackId...], index, standings:{kartId:points}, active }
  mode, cls,                             // 'gp'|'single'|'tt', '80'|'120'|'200'
  systems: { ai, items, audio, ui, scenery, fx, cinematics },
  api: { startRace(opts), restartRace(), nextRace(), quitToTitle(), setPaused(b), toMenu() },
  quality,                               // 'high'|'medium'|'low' (§14)
  touch,                                 // bool: touch UI active
}
```

## 6. Kart contract (`src/kart/kart.js`)

Fields (read by everyone, written only by core unless noted):

```
id, index, name, character (roster entry), isPlayer, autopilot (bool)
controls      { steer:-1..1, throttle:0..1, brake:0..1, drift:bool, item:bool, lookBack:bool }
prevControls  same shape, copied by core at the end of each step (edges = cur && !prev)
pos, prevPos  Vector3 (interpolate with alpha for render)
quat, prevQuat  Quaternion — visual orientation (yaw + ground tilt + drift yaw offset)
heading       yaw of travel, radians
vel           Vector3 world velocity
speed         signed forward speed m/s
grounded, airTime, up (Vector3 ground normal)
trackInfo     last TrackQuery result (index, dist, lateral, onRoad, surface, halfWidth)
lap           0 before first crossing of the start line, 1..laps racing, > laps finished
progress      monotonic race progress in meters (ranking key)
place         1..8, finished, finishTime
item          null | item id (§9.2); itemCount (for triples); roulette: 0 | seconds left   ← ITEMS writes
drift         { active, dir: -1|1, charge, tier: 0..3 }   tier 1 blue, 2 orange, 3 purple
boostTime, boostSource, spinTime, invincibleTime, inkTime, respawn { active, t, stage }
offroad (bool), surface ('road'|'offroad'|'boost'|'ice'|'sand'|'out')
stats         { speed, accel, handling, weight, offroad }  1..5 from the roster
visual        object returned by characters.createKartVisual (§9.7); visual.object3d is in the scene
```

Methods (the only way other systems change a kart's motion):

```
applyBoost(duration, strength = 1, source = 'item')   // stacks by max(), emits 'boost'
spinOut(cause, byKart = null)                          // no-op if immune; emits 'hit'
setInvincible(duration)                                // foil: immune + faster + knocks others
applyInk(duration)                                     // emits 'inked'
startRespawn()                                         // paper crane lift, emits 'respawn'
isImmune()                                             // invincible || respawning || spinTime > 0
```

Physics targets (tune by feel, keep the shape): top speed by class 80 g 20, 120 g
25, 200 g 30 m/s, scaled by stats (±3% per point from 3). Acceleration reaches
80% of top speed in ~2.2 s. Offroad caps speed at ~55% unless boosting. Drift:
pressing drift while steering above 9 m/s gives a small hop, then a drift in the
steer direction; steering *into* the drift tightens it and charges faster.
Charge thresholds ~1.0 / 2.2 / 3.5 s for tiers 1/2/3; releasing gives a boost of
0.45 / 0.9 / 1.4 s. Boost: +35% top speed and strong acceleration. Ramps flagged
`trick` give a 0.8 s boost on landing if drift was pressed near the lip. Wall
hits keep ~65% speed and slide along the wall. Kart–kart: sphere radius ~1.1 m,
push apart weighted by `stats.weight`. Spin-out: ~1.1 s, no control, speed
bleeds to ~20%. Falling below `track.killY` or leaving through a void/water edge
starts a respawn: crane lifts for 1.4 s, sets the kart on the last safe sample.

## 7. Tracks

### 7.1 Track definition (`src/track/defs/<id>.js`, default export)

```js
{
  id: 'meadow', chapter: 1, name: 'Papatya Çayırı', subtitle: 'Bölüm 1',
  laps: 3,
  points: [[x, y, z], ...],     // closed centripetal Catmull–Rom, >= 12 pts, 25–90 m apart, y = height
  halfWidth: 8,                 // number or per-point array (road half width, m)
  bank: null,                   // per-point degrees or null
  offroad: 12,                  // drivable offroad beyond the road edge, m (number or per-point)
  edges: [{ from: 0, to: 1, side: 'both', type: 'wall' }],   // t ranges; type 'wall'|'void'|'water'|'none'
  surfaces: [],                 // [{ from, to, type: 'ice'|'sand', side:'both'|'left'|'right' }] on the road
  boostPads: [{ t, lateral }],  // lateral in m from centre (+ = right)
  itemRows: [{ t, count: 4 }],
  ramps: [{ t, length: 14, height: 2.5, trick: true }],      // added to the centreline height
  startT: 0,
  theme: {                      // colours as '#rrggbb'
    paper, ink, road, roadLine, curbA, curbB, offroad, wall,
    skyTop, skyBottom, fog: { color, near, far },
    sun: { dir: [x, y, z], color, intensity }, ambient: { color, intensity },
    accents: ['#..', ...]
  },
  music: { tempo, scale, mood },  // hint for AUDIO
  scenery: 'meadow',              // theme id for src/scenery/themes/<id>.js
}
```

`t` everywhere is the fraction of the lap **by distance** (0..1), measured from
the sample nearest `points[0]`. Start/finish line is at `startT`.

### 7.2 TrackData (built by core, `game.track`)

```
def, length (m), sampleCount, spacing (~1 m)
samples: typed arrays, one entry per sample —
  px,py,pz  tx,ty,tz (tangent)  rx,ry,rz (right, banked)  ux,uy,uz (up)
  halfWidth, offroad, dist (cumulative m), edgeLeft, edgeRight (edge type codes),
  surface (code), rampLip (0/1)
checkpoints: [t...]  (0.25, 0.5, 0.75 by default)
killY, bounds (Box3)
objects: { road, curbs, ground, walls, startLine }   — Object3Ds in the scene
gridSlots(n) → [{ pos, heading }]   — 2 columns, 6 m rows, behind startT
sampleAt(t) → { pos, tangent, right, up, halfWidth }   (interpolated)
```

### 7.3 TrackQuery (`src/track/trackQuery.js`)

`track.query(pos, hintIndex = -1, out)` → `{ index, t, dist, lateral, halfWidth,
offroadWidth, onRoad, surface, groundY, up, tangent, right, edge }`. Local search
around a valid hint; spatial-grid lookup when the hint is `-1` or the result
jumps. `groundY` is the road height carried flat across the offroad to the edge.
`surface` is `'out'` beyond `halfWidth + offroad`. Karts keep their last index
as the hint. Everyone who needs track-relative info (AI, items, FX, cinematics)
calls this — never re-implement nearest-point search.

## 8. Events (`game.events`)

`on(name, fn)` returns an unsubscribe function. Payloads are plain objects;
`kart` is a Kart. Emitting is synchronous — handlers must be cheap.

| name | payload | emitted by |
|---|---|---|
| `phase` | `{ from, to }` | core |
| `countdown` | `{ n }` 3,2,1 then 0 = GO | race |
| `raceStart` | `{}` | race |
| `lap` | `{ kart, lap }` lap just started (2..laps) | race |
| `finalLap` | `{ kart }` | race |
| `finish` | `{ kart, place, time }` | race |
| `raceEnd` | `{ results }` all karts classified | race |
| `place` | `{ kart, place, prev }` (every kart) | race |
| `wrongWay` | `{ kart, on }` | race |
| `drift` | `{ kart, state: 'start'|'tier'|'release'|'cancel', tier }` | kart |
| `hop` | `{ kart }` | kart |
| `boost` | `{ kart, source: 'drift'|'item'|'pad'|'start'|'trick', duration }` | kart |
| `trick` | `{ kart }` | kart |
| `land` | `{ kart, airTime }` | kart |
| `wallHit` | `{ kart, speed }` | kart |
| `bump` | `{ a, b, impulse }` | kart |
| `hit` | `{ kart, cause, by }` cause 'plane'|'homing'|'gum'|'scissors'|'foil'|'burnout' | kart |
| `respawn` | `{ kart, stage: 'lift'|'drop' }` | kart |
| `inked` | `{ kart, duration }` | kart |
| `itemBox` | `{ kart, pos }` | items |
| `itemGet` | `{ kart, item }` roulette finished | items |
| `itemUse` | `{ kart, item }` | items |
| `projectile` | `{ kind, pos, owner, state: 'spawn'|'bounce'|'hit'|'expire' }` | items |
| `popup` | `{ pos, size }` a scenery piece started unfolding near the camera | scenery |
| `uiClick` | `{}` | ui |

## 9. System interfaces (factories and update order)

Every system is created once per race (or once at boot where noted) by main.js:

```js
// ai/ai.js
export function createAI(game) → { update(dt) , dispose() }
// items/items.js
export function createItems(game) → { update(dt), updateVisual(frameDt, alpha), dispose() }
// audio/audio.js       (created once at boot)
export function createAudio(game) → { unlock(), update(frameDt), setTrackMusic(def | null), dispose() }
// ui/ui.js             (created once at boot)
export function createUI(game) → { update(frameDt), dispose() }
// scenery/scenery.js
export function createScenery(game, def, track) → { update(frameDt, camera), dispose() }
// fx/fx.js
export function createFX(game) → { update(frameDt, alpha), dispose() }
// characters/characters.js
export const ROSTER = [...]            // §9.7
export function createKartVisual(game, character, kart) → visual
// cinematics/cinematics.js (created once at boot)
export function createCinematics(game) → { update(frameDt), play(shot, opts) → Promise, stop(), dispose() }
```

**Per fixed step** (only while phase is `countdown`, `race` or `finishing` and not paused):
1. `input` writes player controls (autopilot: AI writes them instead)
2. `ai.update(STEP)` writes CPU (and autopilot) controls
3. each `kart.step(STEP)` — motion, track query, drift, boost, jumps, walls, respawn
4. kart–kart collisions
5. `items.update(STEP)` — boxes, roulette, projectiles, hits
6. `race.update(STEP)` — checkpoints, laps, places, finish, wrong way
7. copy `controls` → `prevControls`

**Per frame**: `scenery.update`, `items.updateVisual`, kart visuals (`visual.update`),
`fx.update`, `cinematics.update`, `cameraRig.update` (unless an override claims the
camera), `ui.update`, `audio.update`, render.

During `countdown` karts are pinned in place (controls are still read for the
start boost and revving). Outside racing phases the fixed step does not run.

### 9.1 AI
Writes `kart.controls` for CPU karts and for any kart with `autopilot = true`
(the test harness drives the player that way). Uses `track.query` and the track
samples for a racing line; per-driver skill, line offset and mistakes seeded
from `game.rng`; mild rubber-banding by class; drifts long corners; uses items
(`kart.item` + press `controls.item`); avoids gum and recovers from walls.
Must finish races on every track in autopilot — that is the playtest.

### 9.2 Items
Item ids: `'rocket'` (boost), `'rocket3'`, `'gum'` (dropped trap; hold item to
trail it as a rear shield), `'plane'` (straight, bounces off walls, ~6 s),
`'homing'` (seeks the kart ahead), `'ink'` (blinds every kart ahead: player gets
a screen splat — UI draws it on `inked`; CPUs wobble), `'foil'` (invincible
~7 s, faster, knocks karts it touches), `'scissors'` (flies along the track to
the leader, hits it and karts near it). Item boxes are folded paper cubes at
`itemRows`; they respawn ~2 s after being taken. Roulette ~1.6 s. Odds by place
(front: gum/plane/rocket; back: rocket3/homing/foil/scissors). Using an item with
`controls.brake > 0.5` throws it backward where that makes sense. Items owns
projectile meshes and the box meshes; it calls kart methods (§6) for effects.
Time trial: player starts with `rocket3`, no boxes.

### 9.3 Audio
All sound synthesized with WebAudio. Engine per kart (player always; the three
nearest CPUs with distance attenuation), drift squeal by tier, boost whoosh,
item sounds, hits, box pickup, roulette ticks, countdown beeps, paper rustle on
`popup` (rate-limited), crowd/fanfare on finish, UI clicks. Music: a procedural
sequencer per track from `def.music`, faster on the final lap (like the genre
convention), menu and results themes. Respect `settings.musicVolume`,
`settings.sfxVolume`, mute key M. `unlock()` is called by UI on the first gesture.

### 9.4 UI
DOM overlay above the canvas. Screens: title (book cover), mode select, class
(80/120/200 g), character select (3D preview is CINEMATICS' job; UI shows the
stats), track/cup select, settings, pause, HUD (place, lap, time, item slot with
roulette, minimap, speed-independent), countdown, "SON TUR", finish, results,
GP standings, podium captions. Touch controls (steer area + drift + item +
brake, auto-accelerate toggle) write into `game.input.touch` (§12). Keyboard and
gamepad navigation of menus. Visual language §11. Calls `game.api.*` only.

### 9.5 Scenery (TRACKS agent)
`createScenery(game, def, track)` builds the theme for `def.scenery`: ground
dressing, props, backdrop layers, sky details. Props register with the pop-up
system (`scenery/popup.js`): each prop is hinged at its base and rests folded
flat; it unfolds (spring with overshoot, ~0.5 s) when within `popRadius` of the
camera and ahead of it, and may fold back down well behind. Large backdrop
layers stay up. Emits `popup`. Uses `game.materials` and instancing/merging to
stay inside the budget (§14). The TRACKS agent also authors the 4 track defs.

### 9.6 FX
Particles and screen effects on the frame dt: drift sparks by tier colour from
the rear wheels, boost flames at the exhaust, offroad paper confetti/dust, hop
dust, landing puff, hit stars, wall-scrape sparks, speed lines during boost,
finish confetti, the paper crane that carries respawning karts. Pooled, one or a
few draw calls (instanced points/quads). Reads kart state + events.

### 9.7 Characters
`ROSTER`: 8 entries `{ id, name, animal, colors: { body, accent, kart, detail },
stats: { speed, accel, handling, weight, offroad } (1..5, each entry sums to 15),
voice: { pitch } }`. `createKartVisual(game, character, kart)` returns
`{ object3d, anchors: { wheelRL, wheelRR, exhaust, head }, update(frameDt, alpha),
setEmotion(name), dispose() }` — anchors are Object3Ds FX reads world positions
from. Visual reacts to kart state: wheel spin, steer, body lean in drift, squash
on landing, spin-out tumble, look back, celebration on finish. Karts and
drivers are papercraft: flat-shaded folded planes, visible folds, ink outline.

### 9.8 Cinematics
Owns camera shots through `cameraRig.override`: title backdrop scene (a kart on
an open book page, slow orbit), character-select preview turntable, pre-race
flyover (~6 s, skippable), finish orbit around the player, podium ceremony (top
three on a paper podium, confetti). `play(shot)` resolves when the shot ends.

## 10. Rendering and materials (`src/render/`, core)

- `renderer.js`: WebGL2, `outputColorSpace = SRGB`, hard shadows from one
  directional sun that follows the player (shadow map 2048 high / 1024 medium /
  off low), fog from the theme, gradient sky dome.
- `post.js`: one full-screen pass after the scene render — depth-discontinuity
  **ink outlines** (theme ink colour), paper grain multiply, slight vignette.
  Off on `low`.
- `materials.js` — the only way to make surfaces:
  `paper(color, { halftone = true, map, side, flat = true })` → cached toon-style
  material: 3 hard light bands, the darkest band and received shadows printed
  as **screen-space halftone dots** in the ink colour; `ink()` flat ink colour;
  `emissive(color)` for glow bits; `textures.grain`, `textures.dots`,
  `textures.roadLines`, `textures.checker` (CanvasTextures, generated once).
  Materials are cached by key — never `new MeshStandardMaterial` in agent code.
- `camera.js` (`cameraRig`): chase camera ~6.5 m behind, ~2.6 m up, looks ahead;
  critically damped follow; FOV 64 → 74 while boosting; small shake on hits
  (setting); look-back view; respects `override`.

## 11. Visual language (everyone)

Owner's criterion: *"does an outsider say this looks one of a kind, or does it
read as a template?"* The character is **a pop-up book**, and every choice
answers to it:
- **Shadows have no blur** — hard offset shadows everywhere (world and UI).
- **Systematic tilt** — UI cards and labels sit at small deterministic angles
  (e.g. `rotate(±0.4–1.6deg)` from a fixed cycle), never all square.
- **Designed irregularity, not randomness** — variation from index-based cycles
  or the seeded RNG, so a re-render never jumps.
- **Print texture** — paper grain, halftone dots, visible folds, slight
  misregistration of colour plates on UI type.
- **Every motion does a job** — pop-ups reveal the road ahead, the page turn is
  the scene transition, banners slam in once. No idle decorative animation.
- **Reduced motion** — with `prefers-reduced-motion` or the setting: no screen
  shake, pop-ups snap instead of spring, transitions become cuts; gameplay
  motion is unchanged.
- Ground palette per chapter; UI is two-tone (a mid-dark ink shell + muted paper
  cards) — neither pure black nor bright white. Saturated colour is spent on
  things that need attention (item slot, place, warnings).

## 12. Input and settings

`game.input` (core): `{ keyboard, gamepad, touch: { steer, throttle, brake, drift,
item, active } }`. Keys: ←/→ or A/D steer, ↑/W throttle, ↓/S brake/reverse,
Space or Shift drift, X/E/Ctrl item, C look back, Esc/P pause, M mute, R restart
(time trial). Gamepad: stick/d-pad steer, A throttle, B brake, RB/RT drift,
LB/X item, Y look back, Start pause. Touch is written by UI.

`game.settings` (core, persisted in try/catch): `{ musicVolume: 0.7, sfxVolume:
0.9, reducedMotion: auto, cameraShake: true, quality: 'auto', touchControls:
'auto', autoAccelerate: false (touch default true), showFps: false }`.

## 13. Race rules (`src/race/`, core)

Grid: 2 columns behind the line; GP race 1 player starts last, later races by
reverse standings; single race player starts last; time trial solo. Countdown
3-2-1-GO at 1 s steps. **Start boost**: throttle first pressed within 0.35 s
after "1" appears → 1 s boost at GO; pressed before "2" → burnout (short spin).
Laps count only after checkpoints 0.25/0.5/0.75 in order. Places by `progress`.
When the player finishes, the player's kart goes on autopilot; the race waits up
to 12 s for CPUs, then estimates the rest from remaining distance and pace. GP
points `[15, 12, 10, 8, 6, 4, 2, 1]`. Wrong-way after 1.5 s facing backwards.
Best lap/race times per track and class stored per character in time trial.

## 14. Performance budget and quality

Race view: ≤ 250 draw calls, ≤ 700k triangles, no per-frame allocations in hot
loops, textures generated once. Quality `'auto'` starts `high` (`medium` on
coarse pointer), measures the first 4 s of racing and drops a level if the mean
frame time > 18 ms. Pixel ratio ≤ 2 (high), ≤ 1.5 (medium), 1 (low).

## 15. Test API and rules for agents

`window.__kk` (core, always present):
```
ready, errors[]                         // window.onerror + console.error + unhandledrejection
startRace({ track, cls, character, mode, laps, seed, autopilot, cpuCount, skipIntro }) → Promise (resolves at countdown)
simulate(seconds)                       // synchronous fixed steps, no render; returns state()
state() → { phase, raceTime, player, karts:[{ id, name, place, lap, progress, finished,
            finishTime, pos:[x,y,z], speed, item, drift, boostTime, spinTime }] }
setTimeScale(n)                         // frame-driven speed multiplier (1..16)
perf() → { fps, frameMsP95, drawCalls, triangles, renderer }   // renderer = WebGL UNMASKED_RENDERER
setCamera(mode)                         // 'chase'|'top'|'side' for screenshots
events()                                // last 200 emitted events {t, name}
```
`tools/playtest.mjs` drives it with the globally installed Playwright (resolved
by `tools/pw.mjs`; no new npm dependencies). It serves the page with
`tools/serve.py`, runs autopilot races, collects errors, fps and screenshots into
`tools/out/`.

**Rules for every agent**
- Touch only the files your task owns. Needed a core change? Don't make it —
  list it under `CORE_REQUESTS` in your final report with the exact API you need.
- **Verify in the real browser.** Run the page, run a playtest scenario, take
  screenshots, **open them and look** (the Read tool shows images). Zero console
  errors is the floor, not the goal.
- Use the dev-server port assigned in your task; stop the server and close every
  browser you started before you finish. Start at most one server and one browser
  at a time.
- Do not commit; the architect commits. No new npm/pip dependencies.
- English in code, identifiers and comments; Turkish in player-facing text.
  Comments only where they carry something the code cannot say.
