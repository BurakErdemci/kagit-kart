// Roster + kart visuals (ARCHITECTURE.md §10.7). One SkinnedMesh per kart+driver = one draw call
// (+1 in the shadow pass). Per-character geometry and atlas texture are ref-counted so every
// race teardown returns renderer.info.memory to its pre-setup value; the CPU-side build and the
// painted canvas are kept for the next race.
import * as THREE from 'three';
import { paintAtlas } from './atlas.js';
import { buildModel, atlasSpec } from './models.js';
import { geometryFromArrays } from './paperkit.js';
import { createPose } from './animate.js';

// Stats are 1..5 summing to 15. config.kart weights them so a point of speed, accel or handling is worth
// about the same in a race (QA-1 #21); every pick was measured within ±0.65 s a race of the roster mean.
export const ROSTER = [
  { id: 'tilki', name: 'Tarçın', animal: 'tilki', colors: { body: '#e8792e', accent: '#fbf1df', kart: '#e8552b', detail: '#2e2b33' }, stats: { speed: 3, accel: 3, handling: 3, weight: 3, offroad: 3 }, voice: { pitch: 1.1 } },
  { id: 'kurbaga', name: 'Nilüfer', animal: 'kurbağa', colors: { body: '#86cc45', accent: '#e9f2a6', kart: '#2f9a55', detail: '#f39ac0' }, stats: { speed: 3, accel: 4, handling: 3, weight: 1, offroad: 4 }, voice: { pitch: 0.92 } },
  { id: 'penguen', name: 'Paytak', animal: 'penguen', colors: { body: '#2d3140', accent: '#fbfbf6', kart: '#3b82d9', detail: '#e2383f' }, stats: { speed: 4, accel: 2, handling: 2, weight: 3, offroad: 4 }, voice: { pitch: 1.18 } },
  { id: 'ayi', name: 'Pofuduk', animal: 'ayı', colors: { body: '#8b5a34', accent: '#e7c396', kart: '#f4bd2e', detail: '#c4622d' }, stats: { speed: 5, accel: 1, handling: 2, weight: 5, offroad: 2 }, voice: { pitch: 0.72 } },
  { id: 'kedi', name: 'Kömür', animal: 'kedi', colors: { body: '#2c2a33', accent: '#f5d33f', kart: '#d02f3f', detail: '#27a2b8' }, stats: { speed: 2, accel: 4, handling: 5, weight: 2, offroad: 2 }, voice: { pitch: 1.26 } },
  { id: 'baykus', name: 'Pervane', animal: 'baykuş', colors: { body: '#b3814a', accent: '#f1dfb8', kart: '#4a3d93', detail: '#d4a13d' }, stats: { speed: 3, accel: 3, handling: 4, weight: 2, offroad: 3 }, voice: { pitch: 0.95 } },
  { id: 'tavsan', name: 'Havuç', animal: 'tavşan', colors: { body: '#f5f1e8', accent: '#f3a3be', kart: '#ee6aa7', detail: '#f08a2e' }, stats: { speed: 2, accel: 5, handling: 4, weight: 1, offroad: 3 }, voice: { pitch: 1.36 } },
  { id: 'ahtapot', name: 'Mürekkep', animal: 'ahtapot', colors: { body: '#8e4cc2', accent: '#e2c2f5', kart: '#1fb5b0', detail: '#f5d547' }, stats: { speed: 3, accel: 2, handling: 4, weight: 4, offroad: 2 }, voice: { pitch: 0.85 } },
];

const BY_ID = Object.fromEntries(ROSTER.map((c) => [c.id, c]));
// Tracing-paper wash for the time-trial ghost: lifts the print toward a cool white.
const GHOST_GLOW = new THREE.Color('#5d7fb8').multiplyScalar(0.55);
const built = new Map(); // id → { atlas, model, inverses, sphere }   (CPU only, kept)
const gpu = new Map(); // id → { refs, geometry, texture }             (ref-counted)

function resolve(character) {
  if (typeof character === 'string') return BY_ID[character] || ROSTER[0];
  if (character && BY_ID[character.id]) return { ...BY_ID[character.id], ...character, colors: { ...BY_ID[character.id].colors, ...(character.colors || {}) } };
  return ROSTER[0];
}

function buildFor(ch) {
  let b = built.get(ch.id);
  if (b) return b;
  const atlas = paintAtlas(atlasSpec(ch), 'kk:' + ch.id);
  const model = buildModel(ch, atlas);
  const inverses = model.bones.map((d) => new THREE.Matrix4().makeTranslation(-d.pivot[0], -d.pivot[1], -d.pivot[2]));
  const g = geometryFromArrays(model.arrays);
  const sphere = g.boundingSphere.clone();
  sphere.radius = sphere.radius * 1.25 + 0.4; // streamers, tumble arcs and squash stay inside
  g.dispose();
  b = { atlas, model, inverses, sphere };
  built.set(ch.id, b);
  return b;
}

function acquire(game, ch, b) {
  let a = gpu.get(ch.id);
  if (!a) {
    const texture = new THREE.CanvasTexture(b.atlas.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, game.renderer.capabilities.getMaxAnisotropy());
    texture.name = 'kart.atlas.' + ch.id;
    const geometry = geometryFromArrays(b.model.arrays);
    geometry.name = 'kart.' + ch.id;
    a = { refs: 0, geometry, texture };
    gpu.set(ch.id, a);
  }
  a.refs++;
  return a;
}

function release(id) {
  const a = gpu.get(id);
  if (!a) return;
  if (--a.refs > 0) return;
  a.geometry.dispose();
  a.texture.dispose();
  gpu.delete(id);
}

// Unique per visual: flash() and the foil shimmer write its emissive; disposed with the visual.
function makeMaterial(game, texture, ghost) {
  const paper = game.materials.paper;
  return ghost
    ? paper('#d5e4ff', { map: texture, unique: true, flat: true, halftone: false, transparent: true, opacity: 0.42, depthWrite: true })
    : paper(0xffffff, { map: texture, unique: true, flat: true, halftone: true });
}

export function createKartVisual(game, character, kart = null, opts = {}) {
  const ch = resolve(character);
  const ghost = !!(opts && opts.ghost);
  const b = buildFor(ch);
  const res = acquire(game, ch, b);
  const model = b.model;

  const material = makeMaterial(game, res.texture, ghost);
  const mesh = new THREE.SkinnedMesh(res.geometry, material);
  mesh.name = 'kart.body';
  const bones = model.bones.map((d) => { const bone = new THREE.Bone(); bone.name = d.name; return bone; });
  model.bones.forEach((d, i) => {
    const pp = d.parent >= 0 ? model.bones[d.parent].pivot : [0, 0, 0];
    bones[i].position.set(d.pivot[0] - pp[0], d.pivot[1] - pp[1], d.pivot[2] - pp[2]);
    if (d.parent >= 0) bones[d.parent].add(bones[i]);
  });
  mesh.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones, b.inverses.map((m) => m.clone()));
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.boundingSphere = b.sphere.clone();
  mesh.castShadow = !ghost;
  mesh.receiveShadow = false;

  const anchors = {};
  for (const [name, a] of Object.entries(model.anchors)) {
    const o = new THREE.Object3D();
    o.name = 'anchor.' + name;
    const pv = model.bones[a.bone].pivot;
    o.position.set(a.pos[0] - pv[0], a.pos[1] - pv[1], a.pos[2] - pv[2]);
    bones[a.bone].add(o);
    anchors[name] = o;
  }

  const object3d = new THREE.Group();
  object3d.name = 'kart:' + ch.id + (ghost ? ':ghost' : '');
  const rig = new THREE.Group();
  rig.name = 'kart.rig';
  object3d.add(rig);
  rig.add(mesh);

  const seed = ROSTER.findIndex((c) => c.id === ch.id) + (kart ? kart.index * 0.37 : 0) + (ghost ? 0.5 : 0);
  const pose = createPose(model, bones, rig, mesh, object3d, ghost ? GHOST_GLOW : null, seed);
  const classes = game.config.classes;
  const env = { ghost, reducedMotion: false, topSpeed: 25, spins: game.config.kart.spins };

  const offs = [];
  if (kart) {
    for (const name of ['trick', 'bump', 'wallHit']) {
      offs.push(game.events.on(name, (e) => {
        if (e.kart === kart || e.a === kart || e.b === kart) pose.onEvent(name, e);
      }));
    }
  }

  let disposed = false;
  const visual = {
    object3d,
    anchors,
    character: ch,
    kart,
    ghost,
    update(frameDt) {
      if (disposed) return;
      env.reducedMotion = !!game.reducedMotion;
      env.topSpeed = kart ? kart.baseTop : (classes[game.cls] || classes[120]).top;
      pose.update(frameDt || 0, kart, env);
    },
    setEmotion(name) { pose.setEmotion(name); },
    flash(color, duration) { pose.flash(color, duration); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      offs.length = 0;
      rig.remove(mesh);
      object3d.remove(rig);
      skeleton.dispose();
      material.dispose();
      release(ch.id);
    },
  };
  pose.update(0, kart, env);
  return visual;
}
