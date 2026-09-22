# Kâğıt Kart — architecture contract (v2)

This file is the contract every module is written against. Several agents build
modules in parallel; anything left vague here comes back as an integration break.
If you need something the contract does not give you, **do not reach into another
module's files** — write it under `CORE_REQUESTS` in your final report (§17).

v2 folds in three independent reviews (integration seams, platform reality,
game feel). Numbers here are starting points tuned by play; the *shapes* are fixed.

---------------------------------------------------------------------------------

## 1. The game

A Mario-Kart-style arcade kart racer (original IP — no Nintendo names,
characters or item names) whose world is a **pop-up book**. Each track is a
chapter. The ground is the printed page; scenery lies flat on the page and
**folds up** ahead of the karts with a springy overshoot and a paper rustle.
Karts, drivers and items are paper and stationery. Speed classes are paper
weights **80 g / 120 g / 200 g**. Player-facing text is **Turkish**.

Content: 8 karts (1 player + 7 CPU), 8 characters, 4 tracks = one cup, 3 laps,
modes Grand Prix / Tek Yarış / Zamana Karşı (with ghost), 8 items, drift with
three mini-turbo tiers, trick boosts off ramps, slipstream, start boost, boost
pads, offroad, respawn by a paper crane, podium ceremony.

**Fixed ids** (nobody renames them):
- Characters: `tilki` (fox, player default), `kurbaga` (frog), `penguen`,
  `ayi` (bear), `kedi` (cat), `baykus` (owl), `tavsan` (rabbit), `ahtapot` (octopus).
- Tracks / cup order: `meadow` (Papatya Çayırı), `bosphorus` (Boğaz Gecesi),
  `glacier` (Buzul Geçidi), `desk` (Yazı Masası — the reader's desk, final chapter).
- Items: `rocket`, `rocket3`, `gum`, `plane`, `homing`, `ink`, `foil`, `scissors`.

## 2. Hosting constraints (hard — published to a sandboxed host)

- `index.html` is a page **body**: no `<!doctype>`, `<html>`, `<head>`, `<body>`.
  Order inside it: `<title>` first (the host scans only the first 8 KB), the import
  map, `<style>`, then `<script type="module" src="./src/main.js">`.
- The host wraps it in `<!doctype html><html><head><meta charset="utf-8"><meta
  name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`
  **plus a CSS reset**: light `color-scheme`; `:root` padded top/bottom by the
  safe-area insets; `body{margin:0;font:14px system-ui;background:#fafaf7}`;
  `img{max-width:100%}`; `[hidden]{display:none!important}`. `tools/serve.py`
  injects the identical wrapper. The game root is `position:fixed; inset:0`,
  `html, body { height:100% }` (never `100vh`), body background painted by us.
  Screens toggle with `el.hidden`. HUD edges add `env(safe-area-inset-*)`.
- Only a plain `#anchor` reaches the published page — no query strings. Nothing
  player-facing may depend on URL parameters (the test API is `window.__kk`).
- Scripts: only the specifiers `'three'` → `https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js`
  and `'three/addons/'` → `https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/`.
  Never import a jsdelivr URL directly, `three/src/*`, `three/webgpu` or
  `three/tsl`. Before using an addon open it and confirm every import is `'three'`
  or relative (known bad: `objects/SkyMesh.js`, anything under `jsm/tsl/`).
  `utils/BufferGeometryUtils.js` is fine.
- **No external assets of any kind — owner's rule (22 Sep 2026): "dışarıdan asset
  kullanma, tamamen kodla üret her şeyi".** No model, texture, image, sound, music
  or font files from anywhere: not from the network, not from disk, not from AI
  generators (Meshy, Higgsfield, image_gen). No web fonts (no Google Fonts link).
  Every asset is generated in code at runtime: geometry, CanvasTextures, WebAudio,
  and lettering (§13). three.js is a library, not an asset. Own module CSS is
  injected from JS as a `<style>` element.
- No `alert/confirm/prompt`, `window.open`, downloads, print, `THREE.Clock`
  (deprecated in r186; time comes from `loop.js` / `performance.now()`).
- `document.documentElement.lang = 'tr'` is set by main.js before any UI.
  Case changes use `toLocaleUpperCase('tr')` / `toLocaleLowerCase('tr')` only.
- Audio unlock: core installs one capture-phase listener on `window` for
  `pointerup`, `touchend`, `click`, `keydown` that calls `audio.unlock()`
  synchronously; it stays armed until `ctx.state === 'running'` and re-arms when
  the page becomes visible. The title screen asks for a click/tap ("Başlamak için
  dokun"), which also focuses the frame (`canvas.tabIndex = 0; canvas.focus()`).
- Published file count ≤ 150; prefer fewer, larger modules.

## 3. Layout and ownership

```
index.html                  core
src/main.js                 core   boot, state machine, loop, lifecycle, api
src/core/                   core   config.js rng.js events.js loop.js math.js storage.js
src/input/                  core   keyboard, gamepad, touch merge, menu nav
src/track/trackBuilder.js   core   def → TrackData (+ road, curbs, walls, pads, ramps meshes)
src/track/trackQuery.js     core
src/track/defs/             TRACKS (core ships placeholder meadow.js + index.js)
src/kart/                   core   Kart class, physics, collisions, ghost recorder
src/race/                   core   grid, countdown, laps, places, finish, GP, TT
src/render/                 core   renderer, camera rig, materials, textures, post, sky
src/test/                   core   window.__kk
tools/                      core   serve.py, pw.mjs, playtest.mjs (+ tools/scenarios/<agent>.mjs by agents)
src/ai/                     AI
src/items/                  ITEMS
src/audio/                  AUDIO
src/ui/                     UI
src/scenery/                TRACKS
src/fx/                     FX
src/characters/             CHARACTERS
src/cinematics/             CINEMATICS
```

Core ships a **working stub** in every agent folder exporting exactly the
factory in §10, so the game runs end to end before any agent starts. An agent
replaces its folder but keeps the exports and their contracts.

Cross-folder imports: only the entry exports named in §10 (`characters/characters.js`
`ROSTER`/`createKartVisual`, `track/defs/index.js` `TRACKS`/`CUP`, `ui/lettering.js`) and core's
public modules (`core/*`, `render/materials.js`, `track/trackQuery.js`). Never
import another agent's internal files.

## 4. Units, axes, time, randomness

- Meters, seconds, radians. three.js Y-up. For heading `h`: forward
  `(sin h, 0, cos h)`, right `(-cos h, 0, sin h)`. Increasing `h` turns **left**;
  `controls.steer = +1` steers **right** (decreases `h`). Track `lateral` is
  positive to the right of travel. Use `math.js` `forwardOf(h)`, `rightOf(h)`,
  `headingOf(vec)` — never re-derive.
- Simulation fixed step **1/120 s** (`config.STEP`). Frame dt is clamped to
  0.1 s and at most `8 × timeScale` steps run per frame. Rendering interpolates
  kart and projectile transforms with `alpha`. Visual-only systems use frame dt.
- Paused ⇒ systems receive `frameDt = 0`.
- RNG: `game.rng.fork(name)` returns an independent mulberry32 stream; core
  creates `rng.ai`, `rng.items`, `rng.grid` at race setup from the race seed.
  **Code that runs per frame must never touch a simulation stream** — use
  `Math.random` or a cosmetic fork. Same seed + same inputs ⇒ same race.
- No per-step allocations in hot paths: reuse module-level vectors.

## 5. The `game` object (created in main.js)

```js
game = {
  THREE, config, rng, events, storage,
  renderer, scene, camera, cameraRig, materials, post,
  settings, reducedMotion, touch, quality, fontsReady,   // see §13, §15
  input,                        // §13
  phase,                        // 'boot'|'title'|'menu'|'intro'|'countdown'|'race'|'finishing'|'results'|'podium'
  menuScreen,                   // 'title'|'mode'|'class'|'character'|'track'|'settings'|'controls' (UI sets via api)
  paused,
  time, raceTime,               // since boot / since GO
  track, trackDef, karts, player, ghost,
  race,                         // §14
  gp,                           // { active, cup:[trackId], index, standings:{charId:points}, lastPlaces:{charId:place}, totalTimes:{charId:s} }
  mode, cls,                    // 'gp'|'single'|'tt', '80'|'120'|'200'
  selection,                    // { characterId, trackId, cls, mode } last menu choice
  systems: { ai, items, audio, ui, scenery, fx, cinematics },
  api,                          // §6
}
```

## 6. `game.api` (the only way UI and tests change game flow)

```
startRace({ mode, track, cls, character, laps = 3, seed, autopilot = false, cpuCount = 7, skipIntro = false }) → Promise (resolves at countdown start)
startGP({ cls, character, seed })          // cup race 1
nextRace()                                 // GP: next cup track, or podium after the last
restartRace()                              // single/TT anytime; GP: no points awarded, standings restored
quitToTitle()
setPaused(bool)                            // emits 'pause'
setMenuScreen(screen, { characterId, trackId } = {})   // emits 'menu'; cinematics shows the matching shot
setSelection(partial)                      // updates game.selection
skipCinematic()                            // resolves the running cinematic now
unlockAudio()                              // also installed as the gesture listener (§2)
setSetting(key, value)                     // persists (storage) + applies + emits 'settings'
toggleMute()
```

## 7. Race lifecycle (main.js is the only caller)

**Setup** (`startRace`, `nextRace`, `restartRace`):
1. teardown of the previous race if any (below)
2. `game.track = buildTrack(def)` (adds its meshes), `renderer.setTheme(def.theme)`
3. create karts (grid §14) and their visuals: `visual = createKartVisual(game, character, kart)`, then **core** `scene.add(visual.object3d)`
4. create per-race systems in order: `scenery`, `ai`, `items`, `fx`
5. emit `raceSetup { track, karts, def, mode, cls }`
6. `await renderer.compileAsync(scene, camera)` with a hidden instance of every item/FX/scenery material present
7. phase `intro` → `cinematics.play('intro', { track })` (skip if `skipIntro`) → phase `countdown`

**Teardown** (next setup, `quitToTitle`, podium):
1. emit `raceTeardown {}`
2. dispose per-race systems: `fx`, `items`, `ai`, `scenery`
3. per kart: core `scene.remove(visual.object3d)`, `visual.dispose()`
4. `track.dispose()`, `game.karts = []`, `game.track = null`, `renderer.setTheme(null)`
5. debug check: event listener counts and `renderer.info.memory` return to the pre-setup values; a leak is logged with `console.error` (it fails the playtest).

**Rules**: every `dispose()` removes every Object3D it added, disposes the
geometries/unique materials it created and calls every `off()` it received.
Boot-lifetime systems (`ui`, `audio`, `cinematics`) drop every Kart/track
reference on `raceTeardown` and rebind on `raceSetup`.

**Phases and the fixed step**: steps run in `countdown` (karts pinned; controls
read for start boost/revving), `race`, `finishing` and `results` (in `results`
every kart is on autopilot and `race.update` no longer classifies — the world
keeps moving behind the results screen). Steps do not run in `title`, `menu`,
`intro`, `podium` or while paused.

**Podium** happens after teardown on cinematics' own scene group with the
built-in book theme; cinematics adds/removes its own objects on play/stop.

## 8. Kart (`src/kart/kart.js`)

Fields (read by all; written by core unless marked):

```
id (=== character.id), index, name, character, isPlayer, autopilot
controls, prevControls   { steer:-1..1, throttle:0..1, brake:0..1, drift, item, lookBack }  (edges = cur && !prev)
pos, prevPos, quat, prevQuat          quat = visual orientation (yaw + ground tilt + drift yaw offset)
heading, vel, speed, grounded, airTime, up
trackInfo                              last TrackQuery result
lap (0 before first crossing; 1..laps racing; > laps finished), lapTimes[], bestLap, lapStartTime
progress   (lap-1)·length + dist from the start line — may decrease; ranking key
maxProgress   monotonic; lap validation. Per-step |Δprogress| ≤ 2·speed·STEP + 1 m
place, finished, finishTime
item, itemCount (1..3), itemHeld (gum trailing), roulette (s left), rouletteDuration      ← ITEMS writes
drift { active, dir, charge, tier }    tier 1 blue, 2 orange, 3 purple
draft { charge }                       slipstream charge 0..1
boostTime, boostStrength, boostSource
spinTime, spinCause, graceTime, invincibleTime, inkTime
respawn { active, stage: 'lift'|'carry'|'drop'|null, t }
offroad, surface ('road'|'offroad'|'boost'|'ice'|'sand'|'out'), outTime
stats { speed, accel, handling, weight, offroad }   1..5, sum 15
visual
```

Methods — the only way other systems change a kart's motion:

```
applyBoost(duration, strength = 1, source = 'item')   // remaining = max, strength = max while active; emits 'boost'
spinOut(cause, byKart = null)                          // no-op if isImmune(); emits 'hit'
setInvincible(duration)                                // foil: immune, top speed ×1.15, knocks others
setGrace(duration)                                     // immune only; visual blinks
applyInk(duration)                                     // emits 'inked'
startRespawn()                                         // emits 'respawn'
isImmune()                                             // invincibleTime || graceTime || respawn.active || spinTime > 0
```

### 8.1 Physics numbers (config.js; tune by feel, keep the shape)

| thing | value |
|---|---|
| top speed by class | 80 g 20, 120 g 25, 200 g 30 m/s; ±3% per `speed` point from 3 |
| acceleration | 0→80% top in 2.2 s; ±8% time per `accel` point |
| brake / reverse | brake decel 22 m/s² after brake held 0.2 s; reverse max 6 m/s |
| steering yaw rate | 2.4 rad/s at ≤ 8 m/s → 1.3 rad/s at top speed (linear); ±6% per `handling` point |
| steering input ramp | digital to full in 0.10 s, back in 0.06 s |
| grip | lateral velocity damped hard (arcade); ice ×0.35 grip |
| drift start | drift pressed while steering, speed > 9 m/s → hop vy 3.2 m/s; direction = sign(steer) at any point before landing; none ⇒ hop only |
| drift yaw | neutral 1.1, steering in 1.7, steering out 0.45 rad/s |
| drift charge | ×1.0 neutral, ×1.5 in, ×0.6 out; paused while offroad; tiers at 1.0 / 2.2 / 3.5 s |
| drift cancel | speed < 7 m/s, wall hit, spin-out |
| drift visual yaw | 28° ± 10° with steer (in `quat`, not `heading`) |
| boost | top ×(1 + 0.35·strength), reaches boosted top in 0.3 s, ignores offroad cap |
| boost table (duration/strength) | tier1 0.45/1, tier2 0.9/1, tier3 1.4/1, start 1.0/1, weak start 0.4/1, trick 0.8/1, pad 1.0/1 (re-trigger refreshes), rocket 1.3/1.15, draft 0.9/0.6, respawn-launch 0.5/1 |
| slipstream | ≤ 14 m behind another kart, ±12° cone of its heading, speed ≥ 60% top, charge 1.2 s → `applyBoost(0.9, 0.6, 'draft')` |
| offroad | speed cap 55% (±4 pp per `offroad` point); sand 80% cap, yaw −10% |
| out | beyond the offroad band: cap 35%; 2.0 s continuously out ⇒ respawn |
| gravity / air | 18 m/s²; grounded if gap < 0.35 m and not on a ramp lip sample; air yaw 30% of ground |
| ramps | profile = linear rise over `length`, height drops back at the lip; trick window: drift pressed 0.25 s before the lip → 0.3 s after leaving ground; trick boost on landing |
| walls | tangential ×0.92, normal reflected ×0.25; impact > 45° ⇒ speed ×0.6 + steer lock 0.2 s; scraping −8 m/s²; drift cancels |
| kart–kart | sphere r 1.1 m; separation impulse 4 m/s split by inverse mass (mass ×(1 ± 0.15 per `weight` point)); speed loss ≤ 5%; 0.2 s pair cooldown; foil holder spins the other (`spinOut('foil')`) |
| spin table | gum 0.9 s → speed 40%; plane/homing 1.3 s tumble → 10%; scissors 1.8 s flattened → 0; foil ram 0.9 s → 40%; burnout 0.8 s stall |
| grace | 1.0 s after a spin ends; 1.5 s after a respawn drop |
| respawn | lift 0.6 s, carry 0.8 s, drop 0.5 s. Target = last sample where the kart was onRoad and grounded ≥ 0.5 s, lateral clamped to ±0.5·halfWidth, heading = tangent, speed 0; throttle within 0.25 s of touchdown ⇒ respawn-launch boost |
| stuck watchdog | speed < 1.5 m/s with throttle > 0.5 for 3 s ⇒ `startRespawn()` (AI/autopilot only) |

## 9. Tracks

### 9.1 Definition (`src/track/defs/<id>.js`, default export)

```js
{
  id, chapter, name, subtitle, laps: 3,
  points: [[x, y, z], ...],     // closed centripetal Catmull–Rom, y = height
  halfWidth: 10,                // number or per-point array
  bank: null,                   // per-point degrees or null
  offroad: 12,                  // number or per-point
  edges: [{ from, to, side: 'both'|'left'|'right', type: 'wall'|'void'|'water'|'none' }],
  surfaces: [{ from, to, side, type: 'ice'|'sand' }],
  boostPads: [{ t, lateral }],  // pad 4 m wide × 6 m long
  itemRows: [{ t, count }],     // count 5 when halfWidth ≥ 10, else 4
  ramps: [{ t, length: 14, height: 2.5, trick: true, popup: true }],
  startT: 0,
  theme: { paper, ink, road, roadLine, curbA, curbB, offroad, wall, desk,
           skyTop, skyBottom, fog: { color, near, far /* ≥ 180 */ },
           sun: { dir: [x, y, z], color, intensity }, ambient: { color, intensity },
           accents: [...] },
  music: { tempo, scale, mood },
  scenery: '<theme id>',
}
```

`t` = fraction of the lap by distance (0..1) from the sample nearest `points[0]`.

**Layout rules** (trackBuilder warns with `console.warn` — the playtest counts them):
- Lap length **1000–1400 m** (40–55 s at 120 g; race ≈ 2:15–2:45).
- Minimum centreline radius `halfWidth + offroad + 4` m.
- Road segments that are not consecutive stay ≥ `2·(halfWidth + offroad) + 6` m
  apart unless their heights differ by ≥ 6 m.
- ≥ 2 corners with ≥ 80 m continuous arc (tier-3 drifts), 3–5 tier-2 corners.
- ≥ 50 m of straight-ish road (±15°) after every ramp.
- One rocket-only shortcut (15–40 m of offroad) per track.
- Typical `halfWidth` 9–11, 8 only in technical sections.
- Below every track lies the **desk**: falling off the page lands visually on a
  giant desk surface (`theme.desk`), not into empty sky.

### 9.2 TrackData (`game.track`, built by core)

```
def, length, sampleCount, spacing (~1 m)
samples (typed arrays): px py pz  tx ty tz  rx ry rz  ux uy uz  halfWidth offroad dist
                        edgeLeft edgeRight (codes) surface (code) rampLip (0/1)
checkpoints: [0.25, 0.5, 0.75], killY, bounds (Box3)
objects: { road, curbs, ground, walls, startLine, boostPads, ramps }
gridSlots(n) → [{ pos, heading }]      2 columns, 6 m rows, behind startT
sampleAt(t, out) → { pos, tangent, right, up, halfWidth }
query(pos, hintIndex, out) → { index, t, dist, lateral, halfWidth, offroadWidth, onRoad, surface, groundY, up, tangent, right, edge }
rampMeshes: [{ ramp, object3d }]       TRACKS may animate popup ramps visually; collision is always full height
dispose()
```

`query` does a local search around a valid hint and a spatial-grid lookup when
the hint is −1 or the result jumps. `groundY` is the road height carried flat to
the edge. Everyone uses `query` — never re-implement nearest-point search.

## 10. System interfaces

```js
// ai/ai.js                         per race
export function createAI(game) → { update(dt), dispose() }
// items/items.js                   per race
export function createItems(game) → { update(dt), updateVisual(frameDt, alpha), dispose(),
  hazards: [{ kind:'gum', pos, radius }], boxes: [{ pos, active }],
  projectiles: [{ kind, pos, owner, target }] }            // read-only views, updated each step
// scenery/scenery.js               per race
export function createScenery(game, def, track) → { update(frameDt, camera), dispose() }
// fx/fx.js                         per race
export function createFX(game) → { update(frameDt, alpha), dispose() }
// audio/audio.js                   boot
export function createAudio(game) → { unlock(), update(frameDt), dispose() }
// ui/ui.js                         boot
export function createUI(game) → { update(frameDt), dispose() }
// cinematics/cinematics.js         boot
export function createCinematics(game) → { update(frameDt), play(shot, opts) → Promise, stop(), dispose() }
// characters/characters.js
export const ROSTER = [...]
export function createKartVisual(game, character, kart /* Kart | null */, opts = { ghost: false }) → visual
// track/defs/index.js
export const TRACKS = { meadow, bosphorus, glacier, desk }; export const CUP = ['meadow','bosphorus','glacier','desk']
```

**Per fixed step** (phases in §7, not paused):
1. input → player controls (autopilot: AI instead)
2. `ai.update(STEP)`
3. `kart.step(STEP)` for each kart
4. kart–kart collisions (incl. foil knocks), slipstream
5. `items.update(STEP)`
6. `race.update(STEP)`
7. `controls → prevControls`

**Per frame**: core writes each `visual.object3d` position/quaternion from the
interpolated pos/quat → `visual.update` → `items.updateVisual` →
`cinematics.update` → `cameraRig.update` (unless the override claimed it) →
`scenery.update` → `fx.update` → `ui.update` → `audio.update` → render.

### 10.1 AI
Writes controls for CPU karts and autopilot karts. Racing line from track
samples; per-driver line offset; drifts long corners (rivals reach tier 2+);
uses items with a random hold of 0.5–4 s and at most one item aimed at the
player per 6 s per CPU; avoids `items.hazards`; steering noise ±0.3 while
`inkTime > 0`; stuck watchdog (§8.1).
**Skill tiers** per race from `rng.ai`: 2 rivals 0.92, 3 midfield 0.80, 2 back
0.68 — skill scales corner speed, drift tier, mistake chance per corner
(4–15%), item reaction. Autopilot = 0.92.
**Rubber-band**: CPU top-speed multiplier `clamp(1 + k·gap/100, 0.95, 1.06)`,
gap = metres behind the player (+) or ahead (−), k = 0.05/0.04/0.03 for
80/120/200 g; off within 20 m of the player; never more than 3% above the
player's unboosted top speed.

### 10.2 Items
Behaviour and numbers:
- Odds by place (%): P1 gum 50 plane 40 rocket 10 · P2 gum 30 plane 35 rocket 20
  homing 10 ink 5 · P3 gum 15 plane 25 rocket 25 homing 20 ink 10 rocket3 5 ·
  P4 plane 15 rocket 25 homing 25 ink 15 rocket3 15 foil 5 · P5 plane 10 rocket
  20 homing 25 ink 15 rocket3 20 foil 7 scissors 3 · P6 rocket 15 homing 20 ink 15
  rocket3 30 foil 12 scissors 8 · P7 homing 15 ink 10 rocket3 40 foil 25 scissors
  10 · P8 homing 10 ink 5 rocket3 45 foil 30 scissors 10. If the gap to the
  leader is < 25 m use at most the P3 row.
- Boxes: folded paper cubes at `itemRows`, respawn 1.2 s, no pickup while holding
  an item or during roulette (1.6 s).
- `rocket` `applyBoost(1.3, 1.15, 'item')`; `rocket3` three uses.
- `gum` dropped behind; holding the item button trails it as a rear shield
  (`itemHeld`), release drops it; blocks one plane/homing.
- `plane` 1.7× class top speed, 6 s, 4 wall bounces, owner immune 0.4 s.
- `homing` 1.45× class top speed, follows samples until within 25 m of its target
  (the kart ahead), max turn 4 rad/s, blocked by a trailed gum.
- `ink` 3.5 s on every kart ahead; player's splat covers ≤ 55% of the screen (UI draws it on `inked`).
- `foil` `setInvincible(7)`; knocks are core collision.
- `scissors` at most one active; none in the first 20 s of a race or within 15 s
  of the previous; flies along the track to the leader; 6 m splash; dodged by an
  active boost at impact.
- Throw backward when `brake > 0.5` or `lookBack` is held at the item press edge.
- Time trial: the player starts with `rocket3`, no boxes.
- Items never writes `controls`. It emits `threat { kart, kind, eta }` at 1.5 s
  and 0.5 s before a homing/scissors impact on the targeted kart.

### 10.3 Audio
All synthesized (WebAudio). Engine for the player always and the three nearest
CPUs with distance attenuation; drift squeal; tier-up clicks at +4/+7/+12
semitones; boost whoosh; item sounds; hit per cause; box pickup; roulette
ticks; threat lock tick (rising); countdown beeps; paper rustle on `popup`
(rate-limited); finish fanfare; UI clicks. Music: procedural per track from
`def.music`, faster on `finalLap`, plus title/menu, results and podium themes.
Audio picks music itself from `phase`, `raceSetup`, `finalLap`, `pause` (ducks)
and `settings` (volumes). It never handles keys (mute is `api.toggleMute`).

### 10.4 UI
DOM overlay. Screens: title (book cover; "Başlamak için dokun"), mode, class,
character (stats bars; the 3D turntable is cinematics'), track (single/TT),
settings, controls, pause (Devam / Yeniden başla / Ayarlar / Kontroller / Menüye
dön), HUD (place, lap, time, item slot + roulette + count + held, minimap from
`game.track.samples` and kart positions, threat marker on `threat`, ink splat on
`inked`, "SON TUR", wrong-way, lap-line page-corner flip), countdown and start
grade ("Harika çıkış!"), finish, results, GP standings, podium captions, TT split
vs ghost at checkpoints. Menus navigate with `game.input.nav` (never its own key
listeners for game keys). Calls `game.api.*` only.
**Touch** (Pointer Events only): `touch-action:none; user-select:none;
-webkit-touch-callout:none` on the game root; each finger tracked by
`pointerId` with `setPointerCapture`; `pointercancel`/`lostpointercapture`
release; `contextmenu` prevented. Writes `game.input.touch`. **Teaching**: on the
first race (storage flag) a controls card for the active device during the
countdown; one-time contextual hints (first corner: "Drift: Space basılı tut +
yön"; first tier-1 spark: "Bırak → turbo"; first trick ramp: "Rampanın ucunda
drift'e bas"; first item: "X ile kullan, ↓ + X geriye at"). Portrait on a phone
is playable (horizontal FOV); show a one-time "Yatay çevirirsen daha iyi" hint.

### 10.5 Scenery (TRACKS agent)
Themes in `src/scenery/themes/<id>.js`, imported statically by `scenery.js`.
Props are **decorative and never collide**: place them beyond
`halfWidth + offroad` or behind a `wall` edge. Pop-up system
(`scenery/popup.js`): props are hinged at the base, rest folded flat, and
**unfold when 70–110 m ahead along the track** (≈ 3 s at 120 g, spread by prop
index so a wave ripples forward) with a spring overshoot ~0.5 s; fold back only
when > 60 m behind and never during look-back. Large backdrop layers stay up.
Reduced motion: snap instead of spring. Emits `popup { pos, size }` (throttled
to ≤ 6/s). ≥ 1 ramp per track visually unfolds from the page as it is
approached (finishes ≥ 40 m before the kart). Instancing/merging to stay in
budget (§16). Also the ground dressing, backdrops, sky details and the desk.

### 10.6 FX
Pooled, few draw calls. Drift sparks by tier colour from `anchors.wheelRL/RR`
(tier-up burst ≥ 12 particles + 0.08 s body tint flash — the flash via a
visual method, §10.7), boost flames at `anchors.exhaust`, slipstream wind
streaks while `draft.charge > 0`, offroad debris in `theme.offroad`/`theme.paper`
tones only (never blue/orange/purple), hop dust, landing puff, hit stars,
wall-scrape sparks, boost speed lines, finish confetti, the paper crane carrying
a respawning kart. Particle materials: `depthWrite:false`.

### 10.7 Characters
`ROSTER` entries: `{ id, name, animal, colors: { body, accent, kart, detail },
stats: { speed, accel, handling, weight, offroad } (1..5, sum 15), voice: { pitch } }`
in the fixed id order of §1.
`createKartVisual(game, character, kart | null, { ghost })` → `{ object3d,
anchors: { wheelRL, wheelRR, exhaust, head }, update(frameDt, alpha),
setEmotion(name), flash(color, duration), dispose() }`.
- **Local frame**: origin at ground contact centre, +Z forward, +Y up; body
  2.2 m long × 1.5 m wide × 1.6 m tall with driver (±10%); wheels at y ≈ 0.3,
  exhaust at z ≈ −1.1.
- **Core** positions `object3d` and adds/removes it; the visual only animates
  children (wheel spin, steer, lean in drift, squash on landing, hop, spin-out
  by cause — gum slip, plane tumble, scissors flattened then popping back —
  grace blink at 8 Hz, look-back, finish cheer if place ≤ 3 else sad).
- With `kart === null` (title, select, podium) the visual idles and
  `setEmotion('idle'|'cheer'|'sad'|'dizzy')` drives it. `{ ghost: true }` gives a
  translucent paper look for the time-trial ghost.
- Budget: ≤ 8 draw calls per kart+driver on high, ≤ 5 on medium/low (merge static
  parts, shared materials).

### 10.8 Cinematics
Owns `cameraRig.override` (nobody else sets it). Shots: `title` (a kart on an
open book page, slow orbit), `select { characterId }` (turntable of that
character; reacts to `menu` events), `intro { track }` (~6 s flyover, skippable),
`finish { kart }` (orbit around the player), `podium { top3: [{ characterId, points }] }`
(paper podium, confetti, cheer/sad emotions). main.js calls `play`/`stop` on
phase changes; UI only calls `api.setMenuScreen` / `api.skipCinematic`.
Out-of-race shots use `renderer.setTheme(BOOK_THEME)` and `renderer.sunTarget`.

## 11. Events (`game.events`)

`on(name, fn)` returns `off`. Synchronous; handlers must be cheap. Every `off`
received by a per-race system or visual is called in its `dispose()`.

| name | payload | by |
|---|---|---|
| `phase` | `{ from, to }` | core |
| `menu` | `{ screen, characterId, trackId }` | core (api) |
| `settings` | `{ key, value }` | core |
| `quality` | `{ level }` | core |
| `pause` | `{ paused }` | core |
| `raceSetup` | `{ track, karts, def, mode, cls }` | core |
| `raceTeardown` | `{}` | core |
| `countdown` | `{ n }` 3,2,1, then 0 = GO | race |
| `raceStart` | `{}` | race |
| `lap` | `{ kart, lap, lapTime }` lap just started (2..laps) | race |
| `finalLap` | `{ kart }` | race |
| `checkpoint` | `{ kart, index, split }` split vs ghost best (TT) or null | race |
| `finish` | `{ kart, place, time }` | race |
| `raceEnd` | `{ results }` | race |
| `place` | `{ kart, place, prev }` | race |
| `wrongWay` | `{ kart, on }` | race |
| `drift` | `{ kart, state: 'start'|'tier'|'release'|'cancel', tier }` | kart |
| `draft` | `{ kart, state: 'charge'|'boost' }` | kart |
| `hop` `trick` | `{ kart }` | kart |
| `boost` | `{ kart, source: 'drift'|'item'|'pad'|'start'|'trick'|'draft'|'respawn', duration, grade? }` | kart / race |
| `land` | `{ kart, airTime }` | kart |
| `wallHit` | `{ kart, speed }` | kart |
| `bump` | `{ a, b, impulse }` | kart |
| `hit` | `{ kart, cause, by }` | kart |
| `respawn` | `{ kart, stage: 'lift'|'carry'|'drop' }` | kart |
| `inked` | `{ kart, duration }` | kart |
| `itemBox` `itemGet` `itemUse` | `{ kart, pos }` / `{ kart, item }` / `{ kart, item, backward }` | items |
| `projectile` | `{ kind, pos, owner, target, state: 'spawn'|'bounce'|'lock'|'hit'|'expire' }` | items |
| `threat` | `{ kart, kind, eta }` | items |
| `popup` | `{ pos, size }` | scenery |
| `uiClick` | `{}` | ui |

## 12. Rendering and materials (`src/render/`, core)

- `renderer.js`: WebGL2, `antialias: true`, `outputColorSpace = SRGBColorSpace`,
  `shadowMap.type = BasicShadowMap` (hard); one sun that follows
  `renderer.sunTarget` (core sets it to the player), snapped to shadow texels;
  map 2048 high / 1024 medium / off low. Only karts and props taller than 1.5 m
  cast. `setTheme(theme | null)` sets fog, sky, sun, ambient, ink colour.
  Camera near 0.3, far 900.
- `post.js`: scene → one `WebGLRenderTarget({ type: HalfFloatType, samples: high ? 4 : 0,
  depthTexture: new DepthTexture(w, h, UnsignedIntType) })` (UnsignedByteType +
  sRGB fallback without `EXT_color_buffer_float`) → one full-screen
  ShaderMaterial: depth-discontinuity **ink outlines** in the theme ink colour,
  paper grain multiply, slight vignette, ending with `#include <tonemapping_fragment>`
  and `#include <colorspace_fragment>`. No `renderer.setEffects()`. Off on low.
- `materials.js` — the only way to make surfaces:
  `paper(color, { halftone = true, map, side, flat = true, unique = false })`,
  `ink()`, `emissive(color)`, `textures.{ grain, dots, roadLines, checker }`.
  Variants live in `material.defines` with `customProgramCacheKey = () => 'paper:' + key`.
  3-band gradient map (3-texel DataTexture, Nearest, no mipmaps). Halftone dots
  in the darkest band **and in received shadow** (`shadowmask_pars_fragment`,
  `getShadowMask()`), sized by the shared uniform `uDotPx = 6 · pixelRatio`
  (updated on resize/quality change).
  **Cached materials are read-only**: never mutate or dispose them; for per-object
  changes use `{ unique: true }` and dispose that one. FX may create its own
  `ShaderMaterial`/`PointsMaterial`. Colour CanvasTextures use `SRGBColorSpace`;
  masks stay `NoColorSpace`; every custom ShaderMaterial ends with the tonemapping
  and colorspace chunks; the sky dome uses `fog: false`.
- `camera.js` (`cameraRig`): yaw follows `heading` + 0.3 × drift visual offset
  (half-life 0.12 s) so the drift angle stays visible; position half-life 0.10 s
  horizontal, 0.25 s vertical (0.4 s airborne); distance 6.5 m (+0.8 boosting),
  height 2.6 m, look-at 5 m ahead and 1.0 m up. **Horizontal FOV** 90° at rest,
  95° at top speed, 102° boosting; vertical FOV derived from aspect, clamped
  50–75°. Shake on hits (setting + reduced motion gated). Look-back is a rig mode.
  `override` belongs to cinematics; `debugMode` ('top'|'side') belongs to tests and
  wins over everything.

## 13. Input, settings, fonts

`game.input` (core, polled every animation frame in every phase):
- `nav` — per-frame presses `{ up, down, left, right, confirm, back, pause }` from
  keyboard and gamepad; UI reads it.
- `pad` — `{ connected, axes: [lx, ly], held: Set, pressed: Set }`, standard
  mapping only (A0 B1 X2 Y3 LB4 RB5 LT6 RT7 Back8 Start9 Up12 Down13 Left14 Right15);
  only core calls `getGamepads()`, inside try/catch.
- `touch` — `{ steer, throttle, brake, drift, item, lookBack }` written by UI.
- Keys: ←/→ or A/D steer, ↑/W throttle, ↓/S brake, **Space** drift (Shift
  optional), **X / E** item (never Ctrl), C look back, Esc/P pause, M mute,
  R restart (TT). `preventDefault` on mapped keys outside menus. Only core acts on
  pause/mute keys (→ `api.setPaused` / `api.toggleMute`).
- Player controls = OR of buttons; steer/throttle/brake from the source with the
  largest magnitude. Touch `drift`/`item` presses are latched until one step
  consumes them. `settings.autoAccelerate` forces throttle 1 when brake < 0.5,
  **except during the countdown** (the start boost uses the real input).
- Auto-pause on `visibilitychange` hidden, window blur and
  `gamepaddisconnected` during countdown/race.

`game.settings` via `storage.js` (`get(key, fallback)`, `set(key, value)`, JSON,
prefix `kk1:`, every access in try/catch including the `localStorage` lookup,
in-memory fallback): `{ musicVolume: 0.7, sfxVolume: 0.9, reducedMotion: 'auto',
cameraShake: true, quality: 'auto', touchControls: 'auto', autoAccelerate: false,
showFps: false, seenTutorial: false }`. Changed only through `api.setSetting`.
`game.reducedMotion` (bool) is resolved by core from the setting and the media
query. `game.touch` (bool) is resolved by core from the setting, `(pointer:
coarse)` and the first `pointerdown` with `pointerType === 'touch'`.

Lettering (owner's choice, 22 Sep 2026: display type drawn in code, body text in
the system font):
- **Body text** uses the system stack `config.fonts.body =
  'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'` (all cover
  Turkish). Nothing is downloaded; `game.fontsReady` is an already-resolved Promise
  kept for compatibility.
- **Display lettering** — the logo, place numbers, lap/countdown numerals, banners
  ("SON TUR", "BİTİŞ"), menu headings, chapter titles on signs — is drawn
  procedurally as **cut-paper letters**: each glyph built from vector strokes/
  polygons, cut with slightly irregular edges, a paper fill, a hard offset shadow,
  per-letter deterministic tilt and a small colour-plate offset. The UI agent owns
  it in `src/ui/lettering.js` and it must cover A–Z plus Ç Ğ İ I Ö Ş Ü Â, digits,
  `. : / ! ? - '` and lowercase-to-uppercase via `toLocaleUpperCase('tr')`. API:
  `drawLettering(ctx2d, text, { x, y, size, colors, seed, align })` for canvases
  and `letteringElement(text, opts) → HTMLElement` (inline SVG) for the DOM. Other
  modules that paint text into CanvasTextures (scenery signs, cinematics captions)
  import `ui/lettering.js` — the one allowed cross-folder import from `src/ui/`.
  Until it exists, they fall back to `config.fonts.body` bold.

## 14. Race rules (`src/race/`, core)

```
game.race = { laps, state: 'countdown'|'running'|'finishing'|'done', countdown: 3|2|1|0|null,
              finishOrder: [charId], results: null | Result[], bestLapTime, waitLeft, startGrade }
Result = { kartId, characterId, place, time, estimated, bestLap, points, totalPoints }
```
Core writes `game.gp.standings` before emitting `raceEnd`.

- Grid: 2 columns behind the line. GP race 1 and single race: player starts last;
  later GP races by reverse standings. TT: solo. CPU drivers = ROSTER minus the
  player's pick, ordered by `rng.grid`.
- Countdown 3-2-1-GO at 1 s steps; pausing freezes it. **Start boost**: judged on
  the last throttle press edge before GO with throttle held at GO: −1.00…−0.65 s
  ⇒ 1.0 s boost, grade `'perfect'` ("Harika çıkış!"); −0.65…−0.30 s ⇒ 0.4 s,
  `'good'`; pressed during "3" ⇒ burnout; else nothing.
- Laps count only after checkpoints 0.25/0.5/0.75 in order (`maxProgress`).
- Places by `progress`; `place` events for every change.
- Player finishes ⇒ autopilot; wait up to 12 s for CPUs, then estimate the rest
  from remaining distance at their recent pace (`estimated: true`).
- GP points `[15, 12, 10, 8, 6, 4, 2, 1]`; ties broken by better last-race place,
  then lower total time. Restart in GP awards nothing and restores standings.
- Wrong way after 1.5 s facing backwards along the track.
- TT: best lap/race per track + class + character in storage; the ghost of the
  best run is recorded at 20 Hz (pos + heading) and replayed with a
  `{ ghost: true }` visual; `checkpoint` events carry the split.

## 15. Quality

`settings.quality: 'auto'` starts `high` (`medium` on coarse pointer). Render
size capped by pixel count: high ≤ 2.4 MP, medium ≤ 1.4 MP, low ≤ 0.9 MP with
`pixelRatio = min(devicePixelRatio, sqrt(cap / cssPixels))`. Auto measures the
refresh interval in the menu (median rAF delta over 1 s), then during racing
drops one level per 3 s window while mean frame time > 1.2 × that interval;
never raises mid-race. Emits `quality`.

## 16. Budget

Race view: `renderer.info.render.calls` for the whole frame **including the
shadow pass** ≤ 250; triangles ≤ 700k. Per kart + driver ≤ 8 calls (high).
Items + FX ≤ 20. Scenery ≤ 120 (InstancedMesh / merged geometry). No per-frame
allocation in hot loops; textures generated once.

## 17. Test API, playtest and rules for agents

`window.__kk` (core):
```
ready, errors[]                 window.onerror + console.error + unhandledrejection
warnings[]                      console.warn (trackBuilder layout warnings land here)
game                            read-only by convention
startRace(opts) → Promise       same opts as api.startRace (autopilot for the player)
startGP({ index, standings, cls, character, seed })
simulate(seconds) → state()     synchronous fixed steps, no render
renderFrame()                   one render (after simulate)
state() → { phase, raceTime, player, karts:[{ id, place, lap, progress, finished, finishTime,
            pos, speed, item, drift, boostTime, spinTime }] }
giveItem(kartIndex, itemId), teleport(kartIndex, t, lateral)
finishNow()                     classify everyone, go to results
playShot(name, opts) → Promise
setTimeScale(n)                 1..16
setCamera(mode)                 'chase'|'top'|'side'|null  (debugMode)
perf() → { fps, frameMsP95, drawCalls, shadowCalls, triangles, renderer }
events() → [{ t, name, kartId, detail }]   last 300
listenerCount()
stats() → { driftReleases:{kartId:{t1,t2,t3}}, itemUses:{kartId:n}, placeChanges, lapTimes:{kartId:[]} }
```

`tools/pw.mjs` resolves the globally installed Playwright (`npm root -g` +
`createRequire`; no new dependencies) and launches Chromium with the flags that
give a **hardware** ANGLE renderer on this machine (documented in the file);
`playtest.mjs` fails when `perf().renderer` matches
`/SwiftShader|llvmpipe|Software|Basic Render/i`. It serves the page itself if the
port is free and always stops what it started. Per track it reports:
`{ track, finished, raceTime, lapTimes, errors, warnings, fpsMean, frameMsP95,
drawCalls, shadowCalls, triangles, renderer, winnerToLastSpread, placeChanges,
driftTier2PerLapPerCpu, itemUsesPerCpu, autopilotPlace }` and warns when outside:
autopilot lap 38–58 s at 120 g; CPU winner-to-last ≤ 25 s; ≥ 2 tier-2+ drift
releases per lap per CPU; ≥ 15 place changes; ≥ 4 item uses per CPU; autopilot top
4 on ≥ 3 of 4 tracks; zero trackBuilder layout warnings. A touch smoke run uses
`newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })`.

**Rules for every agent**
- Touch only files your task owns (§3). Need a
  core change? Don't make it — list it under `CORE_REQUESTS` with the exact API.
- **Verify in the real browser**: run the page, run a scenario (your own in
  `tools/scenarios/<agent>.mjs` is welcome), take screenshots and **open them and
  look** (the Read tool shows images). Zero console errors and zero leaks are the
  floor, not the goal.
- Use your assigned dev-server port; at most one server and one browser at a time;
  stop both before you finish.
- No commits (the architect commits). No new npm/pip dependencies.
- English in code and comments; Turkish in player-facing text. Comments only where
  they carry what the code cannot say.

## 18. Visual language (everyone)

Owner's criterion: *"does an outsider say this looks one of a kind, or does it
read as a template?"* The character is **a pop-up book**, and every choice
answers to it:
- **Shadows have no blur** — hard offset shadows everywhere (world and UI).
- **Systematic tilt** — UI cards and labels sit at small deterministic angles
  (e.g. `rotate(±0.4–1.6deg)` from a fixed cycle), never all square.
- **Designed irregularity, not randomness** — variation from index-based cycles
  or seeded streams, so a re-render never jumps.
- **Print texture** — paper grain, halftone dots, visible folds, slight
  misregistration of colour plates; display type is cut-paper lettering (§13).
- **Every motion does a job** — pop-ups reveal the road ahead, the page turn is
  the scene transition, banners slam in once. No idle decorative animation.
- **Reduced motion** — with `prefers-reduced-motion` or the setting: no screen
  shake, pop-ups snap instead of spring, transitions become cuts; gameplay
  motion is unchanged.
- Ground palette per chapter; UI is two-tone (a mid-dark ink shell + muted paper
  cards) — neither pure black nor bright white. Saturated colour is spent on
  things that need attention (item slot, place, warnings); indicators stay calm.
