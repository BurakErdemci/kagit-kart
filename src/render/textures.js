// Procedural textures, generated once at boot. Masks (R channel = coverage) stay NoColorSpace;
// colour textures use SRGBColorSpace.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { color = false, repeat = true, aniso = 1, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.needsUpdate = true;
  return t;
}

function maskCanvas(w, h, draw) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  draw(g, w, h);
  return c;
}

export function createTextures(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const rand = mulberry32(1234);

  // Paper grain: fine speckle plus a few longer fibres, centred slightly below white.
  const grainC = canvas(256, 256);
  {
    const g = grainC.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 214 + rand() * 41;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.18;
    for (let k = 0; k < 140; k++) {
      g.strokeStyle = rand() < 0.5 ? '#9a9a9a' : '#ffffff';
      g.lineWidth = 0.6 + rand();
      const x = rand() * 256, y = rand() * 256, a = rand() * Math.PI, l = 6 + rand() * 18;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rand() - 0.5) * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  }

  const dotsC = maskCanvas(64, 64, (g) => {
    g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.fill();
  });

  // One dash period across the full road width: u = lateral 0..1, v = one period along the road.
  const roadC = maskCanvas(128, 256, (g, w, h) => {
    g.fillRect(w * 0.035, 0, w * 0.022, h);
    g.fillRect(w * (1 - 0.057), 0, w * 0.022, h);
    g.fillRect(w * 0.5 - w * 0.014, h * 0.1, w * 0.028, h * 0.45);
    // printing imperfections: a few light speckles in the lines' ink
    g.fillStyle = '#000';
    for (let k = 0; k < 40; k++) g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  });

  const checkerC = canvas(64, 64);
  {
    const g = checkerC.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      g.fillStyle = (x + y) % 2 ? '#2d2a32' : '#fbf6e9';
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }

  const stripesC = maskCanvas(8, 64, (g, w, h) => { g.fillRect(0, 0, w, h / 2); });

  const chevronC = maskCanvas(64, 64, (g, w, h) => {
    g.lineWidth = 9;
    g.lineJoin = 'miter';
    for (const oy of [16, 48]) {
      g.beginPath();
      g.moveTo(8, oy + 12); g.lineTo(32, oy - 8); g.lineTo(56, oy + 12);
      g.stroke();
    }
  });

  const hatchC = maskCanvas(128, 128, (g) => {
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    for (let k = 0; k < 70; k++) {
      const x = rand() * 128, y = rand() * 128, l = 3 + rand() * 5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.3) * 2, y - l);
      g.stroke();
      if (rand() < 0.5) { g.beginPath(); g.moveTo(x + 2, y); g.lineTo(x + 3.5, y - l * 0.8); g.stroke(); }
    }
  });

  // Printed page: faint grid every 64 px plus sparse little flowers/crosses.
  const gridC = maskCanvas(256, 256, (g) => {
    g.globalAlpha = 0.55;
    g.lineWidth = 1.5;
    for (let k = 0; k <= 256; k += 64) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.stroke();
      g.beginPath(); g.moveTo(0, k); g.lineTo(256, k); g.stroke();
    }
    g.globalAlpha = 1;
    g.lineWidth = 1.4;
    for (let k = 0; k < 22; k++) {
      const x = rand() * 256, y = rand() * 256, r = 2 + rand() * 3;
      if (rand() < 0.6) {
        for (let p = 0; p < 5; p++) {
          const a = p * Math.PI * 2 / 5;
          g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.55, 0, Math.PI * 2); g.stroke();
        }
      } else {
        g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
      }
    }
  });

  const wavesC = maskCanvas(128, 128, (g) => {
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    for (let row = 0; row < 6; row++) {
      const y0 = 10 + row * 21;
      const off = (row % 2) * 20;
      for (let x = -40 + off; x < 128; x += 40) {
        g.beginPath();
        g.moveTo(x, y0);
        g.quadraticCurveTo(x + 10, y0 - 7, x + 20, y0);
        g.stroke();
      }
    }
  });

  // Fence: vertical slats with a top rail (u = along wall, v = height).
  const fenceC = maskCanvas(64, 64, (g) => {
    g.fillRect(0, 0, 64, 8);
    g.fillRect(4, 0, 10, 64);
    g.fillRect(36, 0, 10, 64);
  });

  const textures = {
    grain: tex(grainC, { aniso }),
    dots: tex(dotsC),
    roadLines: tex(roadC, { aniso }),
    checker: tex(checkerC, { color: true, aniso, nearest: false }),
    stripes: tex(stripesC, { aniso }),
    chevrons: tex(chevronC, { aniso }),
    hatch: tex(hatchC, { aniso }),
    grid: tex(gridC, { aniso }),
    waves: tex(wavesC, { aniso }),
    fence: tex(fenceC, { aniso }),
  };
  return textures;
}
