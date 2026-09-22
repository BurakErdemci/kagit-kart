// CORE STUB — the tracks agent replaces this folder but keeps createScenery(game, def, track).
// A handful of paper cone trees beyond the offroad band, one InstancedMesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashString, mulberry32 } from '../core/rng.js';

function colored(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function createScenery(game, def, track) {
  const rand = mulberry32(hashString(def.id + ':trees'));
  const trunk = colored(new THREE.CylinderGeometry(0.35, 0.45, 2.2, 6).translate(0, 1.1, 0), '#8a5a3b');
  const crownA = colored(new THREE.ConeGeometry(2.6, 5.5, 7).translate(0, 4.6, 0), '#5f9e4f');
  const crownB = colored(new THREE.ConeGeometry(1.9, 3.8, 7).translate(0, 7.0, 0), '#74b35c');
  const geo = mergeGeometries([trunk, crownA, crownB]);
  trunk.dispose(); crownA.dispose(); crownB.dispose();
  const mat = game.materials.paper('#ffffff', { vertexColors: true });

  const info = track.createQueryInfo();
  const pt = {};
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const y = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  const matrices = [];
  const count = 90;
  for (let k = 0; k < count * 3 && matrices.length < count; k++) {
    const t = rand();
    const side = rand() < 0.5 ? -1 : 1;
    track.sampleAt(t, pt);
    const extra = 4 + rand() * 40;
    const lat = side * (pt.halfWidth + pt.offroad + extra);
    // unbanked right vector of the heading
    const hx = -Math.cos(pt.heading), hz = Math.sin(pt.heading);
    const px = pt.pos.x + hx * lat, pz = pt.pos.z + hz * lat;
    const probe = new THREE.Vector3(px, pt.pos.y, pz);
    track.query(probe, -1, info);
    if (Math.abs(info.lateral) < info.halfWidth + info.offroadWidth + 3) continue;
    if (info.edge === 'water' || info.edge === 'void') continue;
    const s = 0.7 + rand() * 0.6;
    sc.set(s, s * (0.85 + rand() * 0.4), s);
    q.setFromAxisAngle(y, rand() * Math.PI * 2);
    m4.compose(new THREE.Vector3(px, track.pageY, pz), q, sc);
    matrices.push(m4.clone());
  }
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  mesh.name = 'scenery:trees';
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  game.scene.add(mesh);

  return {
    update() {},
    dispose() {
      game.scene.remove(mesh);
      geo.dispose();
      mesh.dispose();
    },
  };
}
