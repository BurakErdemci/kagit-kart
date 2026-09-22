// CORE STUB — the characters agent replaces this folder but keeps ROSTER and createKartVisual.
// Visual: box kart + sphere head, 3 draw calls. Local frame: origin at ground contact centre,
// +Z forward, +Y up, +X is the kart's left.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ROSTER = [
  { id: 'tilki', name: 'Fındık', animal: 'tilki', colors: { body: '#e8743b', accent: '#fbf6e9', kart: '#d9483b', detail: '#2d2a32' }, stats: { speed: 3, accel: 3, handling: 3, weight: 3, offroad: 3 }, voice: { pitch: 1.0 } },
  { id: 'kurbaga', name: 'Vırak', animal: 'kurbağa', colors: { body: '#7cbf5a', accent: '#f2e27a', kart: '#3f8f5a', detail: '#2d2a32' }, stats: { speed: 2, accel: 4, handling: 4, weight: 2, offroad: 3 }, voice: { pitch: 1.25 } },
  { id: 'penguen', name: 'Buzlu', animal: 'penguen', colors: { body: '#3b4252', accent: '#fbf6e9', kart: '#6c8ead', detail: '#f2a33a' }, stats: { speed: 3, accel: 2, handling: 4, weight: 3, offroad: 3 }, voice: { pitch: 1.1 } },
  { id: 'ayi', name: 'Bal', animal: 'ayı', colors: { body: '#8a5a3b', accent: '#e8c89a', kart: '#b5651d', detail: '#2d2a32' }, stats: { speed: 4, accel: 2, handling: 2, weight: 5, offroad: 2 }, voice: { pitch: 0.75 } },
  { id: 'kedi', name: 'Minnoş', animal: 'kedi', colors: { body: '#9aa0a8', accent: '#f6d6e0', kart: '#e56b6f', detail: '#2d2a32' }, stats: { speed: 3, accel: 4, handling: 3, weight: 2, offroad: 3 }, voice: { pitch: 1.3 } },
  { id: 'baykus', name: 'Gece', animal: 'baykuş', colors: { body: '#7a6a8f', accent: '#f2c14e', kart: '#4a4e8f', detail: '#2d2a32' }, stats: { speed: 4, accel: 3, handling: 2, weight: 3, offroad: 3 }, voice: { pitch: 0.9 } },
  { id: 'tavsan', name: 'Pıtır', animal: 'tavşan', colors: { body: '#f4efe6', accent: '#f2a7b8', kart: '#f2c14e', detail: '#2d2a32' }, stats: { speed: 2, accel: 5, handling: 3, weight: 1, offroad: 4 }, voice: { pitch: 1.4 } },
  { id: 'ahtapot', name: 'Mürekkep', animal: 'ahtapot', colors: { body: '#c05a8f', accent: '#f6d6e0', kart: '#5a3f8f', detail: '#2d2a32' }, stats: { speed: 3, accel: 3, handling: 2, weight: 4, offroad: 3 }, voice: { pitch: 0.85 } },
];

function colored(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function createKartVisual(game, character, kart, opts = {}) {
  const ghost = !!opts.ghost;
  const mats = game.materials;
  const col = character.colors;

  const parts = [
    colored(new THREE.BoxGeometry(1.5, 0.42, 2.2).translate(0, 0.52, 0), col.kart),
    colored(new THREE.BoxGeometry(1.2, 0.22, 0.5).translate(0, 0.82, 0.95), col.accent), // nose
    colored(new THREE.BoxGeometry(1.1, 0.55, 0.18).translate(0, 1.0, -0.55), col.kart), // seat back
    colored(new THREE.CylinderGeometry(0.34, 0.4, 0.62, 8).translate(0, 1.04, -0.2), col.body), // torso
    colored(new THREE.BoxGeometry(1.6, 0.1, 0.36).translate(0, 0.95, -1.05), col.accent), // wing
  ];
  const bodyGeo = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  const wheelBase = new THREE.CylinderGeometry(0.3, 0.3, 0.34, 10).rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[0.78, 0.72], [-0.78, 0.72], [0.8, -0.74], [-0.8, -0.74]]) wheels.push(wheelBase.clone().translate(x, 0.3, z));
  const wheelGeo = mergeGeometries(wheels);
  wheelBase.dispose();
  wheels.forEach((g) => g.dispose());
  const headGeo = colored(new THREE.SphereGeometry(0.4, 12, 8).translate(0, 1.55, -0.15), col.body);
  const earA = colored(new THREE.ConeGeometry(0.13, 0.3, 5).translate(0.2, 1.95, -0.15), col.body);
  const earB = colored(new THREE.ConeGeometry(0.13, 0.3, 5).translate(-0.2, 1.95, -0.15), col.body);
  const snout = colored(new THREE.SphereGeometry(0.16, 8, 6).translate(0, 1.5, 0.22), col.accent);
  const headAll = mergeGeometries([headGeo, earA, earB, snout]);
  [headGeo, earA, earB, snout].forEach((g) => g.dispose());

  const unique = [];
  let bodyMat, wheelMat, headMat;
  if (ghost) {
    const o = { unique: true, vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, halftone: false };
    bodyMat = mats.paper('#ffffff', o);
    headMat = bodyMat;
    wheelMat = mats.paper(col.detail, { unique: true, transparent: true, opacity: 0.42, depthWrite: false, halftone: false });
    unique.push(bodyMat, wheelMat);
  } else {
    bodyMat = mats.paper('#ffffff', { vertexColors: true });
    headMat = bodyMat;
    wheelMat = mats.paper(col.detail);
  }

  const object3d = new THREE.Group();
  object3d.name = `kart:${character.id}${ghost ? ':ghost' : ''}`;
  const rig = new THREE.Group(); // animated child (spin, lean, squash)
  object3d.add(rig);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  const wheelsMesh = new THREE.Mesh(wheelGeo, wheelMat);
  const head = new THREE.Mesh(headAll, headMat);
  // Karts cast but do not receive: at 2048 texels over 110 m a hard shadow edge on small kart parts shows texel teeth.
  for (const m of [body, wheelsMesh, head]) { m.castShadow = !ghost; m.receiveShadow = false; rig.add(m); }

  const anchors = {
    wheelRL: new THREE.Object3D(), wheelRR: new THREE.Object3D(), exhaust: new THREE.Object3D(), head: new THREE.Object3D(),
  };
  anchors.wheelRL.position.set(0.8, 0.3, -0.74);
  anchors.wheelRR.position.set(-0.8, 0.3, -0.74);
  anchors.exhaust.position.set(0, 0.5, -1.1);
  anchors.head.position.set(0, 1.55, -0.15);
  for (const a of Object.values(anchors)) rig.add(a);

  let emotion = 'idle';
  let t = 0;
  let spin = 0;
  let flashT = 0;

  return {
    object3d,
    anchors,
    update(frameDt) {
      t += frameDt;
      if (kart) {
        if (kart.spinTime > 0) spin += frameDt * 14;
        else spin = 0;
        rig.rotation.y = spin;
        rig.rotation.z = kart.drift.active ? kart.drift.dir * 0.08 : 0;
        const blink = kart.graceTime > 0 && kart.spinTime <= 0 && Math.floor(t * 16) % 2 === 0;
        rig.visible = !blink;
        rig.position.y = kart.hop.active ? 0.05 : 0;
      } else {
        rig.rotation.y = emotion === 'dizzy' ? t * 6 : 0;
        rig.position.y = emotion === 'cheer' ? Math.abs(Math.sin(t * 6)) * 0.3 : Math.sin(t * 2) * 0.03;
      }
      if (flashT > 0) {
        flashT -= frameDt;
        rig.scale.setScalar(1 + Math.max(0, flashT) * 0.6);
      } else rig.scale.setScalar(1);
    },
    setEmotion(name) { emotion = name; },
    flash(color, duration = 0.08) { flashT = duration; },
    dispose() {
      bodyGeo.dispose();
      wheelGeo.dispose();
      headAll.dispose();
      unique.forEach((m) => m.dispose());
      object3d.parent?.remove(object3d);
    },
  };
}
