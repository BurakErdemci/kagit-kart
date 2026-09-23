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

  // Card rail print, one panel per repeat (u = along, v = height; canvas top is v = 1): a top rail, a lower
  // rail and the fold crease at the panel's edge.
  const railC = maskCanvas(64, 64, (g) => {
    g.fillRect(0, 5, 64, 7);
    g.fillRect(0, 38, 64, 5);
    g.fillRect(0, 0, 3, 64);
    for (const y of [8.5, 40.5]) { g.beginPath(); g.arc(32, y, 2.2, 0, Math.PI * 2); g.fillStyle = '#000'; g.fill(); g.fillStyle = '#fff'; }
  });

  // Stacked page edges: one line per sheet, uneven weight (u = along the edge, 2 m; v = height, 8 m).
  const stackC = maskCanvas(64, 256, (g, w, h) => {
    let y = 1;
    while (y < h - 1) {
      g.globalAlpha = 0.35 + rand() * 0.65;
      const t = 0.6 + rand() * 1.1;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.33, y + (rand() - 0.5) * 1.2, w * 0.66, y + (rand() - 0.5) * 1.2, w, y);
      g.lineWidth = t;
      g.stroke();
      y += 2.2 + rand() * 2.4;
    }
    g.globalAlpha = 1;
  });

  // Printed wood grain for the desk: long wavering lines that part around a few knots.
  const woodC = maskCanvas(512, 512, (g, w, h) => {
    const knots = [];
    for (let k = 0; k < 4; k++) knots.push({ x: rand() * w, y: 40 + rand() * (h - 80), r: 8 + rand() * 14 });
    g.lineCap = 'round';
    for (let y0 = 3; y0 < h; y0 += 5 + rand() * 9) {
      const ph = rand() * 6.28, amp = 1 + rand() * 3, fr = (1 + Math.floor(rand() * 3)) * Math.PI * 2 / w;
      g.globalAlpha = 0.3 + rand() * 0.7;
      g.lineWidth = 0.8 + rand() * 1.6;
      g.beginPath();
      for (let x = 0; x <= w; x += 4) {
        let y = y0 + Math.sin(x * fr + ph) * amp;
        for (const kn of knots) {
          const dx = x - kn.x, dy = y - kn.y, d2 = dx * dx + dy * dy;
          y += Math.sign(dy || 1) * (kn.r * kn.r * 1.6) / (Math.sqrt(d2) + kn.r) * Math.exp(-d2 / (kn.r * kn.r * 16));
        }
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 0.8;
    for (const kn of knots) {
      for (let r = kn.r * 0.3; r < kn.r * 1.1; r += 3.5) {
        g.lineWidth = 1.2;
        g.beginPath(); g.ellipse(kn.x, kn.y, r * 1.7, r * 0.6, 0, 0, Math.PI * 2); g.stroke();
      }
    }
    g.globalAlpha = 1;
  });

  // Ramp sticker plates (clamped; the 1 px border stays empty so off-sticker UVs print nothing):
  // R = chevrons, G = die-cut sticker paper, B = its hard offset shadow. u = across, v = up the ramp.
  const rampC = canvas(256, 256);
  {
    const g = rampC.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    const rr = (x, y, w, h, r) => {
      g.beginPath();
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    };
    g.fillStyle = '#0000ff';
    rr(60, 30, 148, 196, 22); g.fill();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = '#00ff00';
    rr(52, 38, 148, 196, 22); g.fill();
    g.globalCompositeOperation = 'source-over';
    // chevrons pointing up the ramp: flipY maps the canvas top to v = 1 (the lip)
    g.strokeStyle = '#ffff00';
    g.lineWidth = 17;
    g.lineJoin = 'miter';
    for (const cy of [80, 128, 176]) {
      g.beginPath();
      g.moveTo(80, cy + 22); g.lineTo(126, cy - 14); g.lineTo(172, cy + 22);
      g.stroke();
    }
    // chevrons sit on the sticker: keep G under them so R wins, and clear the 1 px border
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 1); g.fillRect(0, 255, 256, 1); g.fillRect(0, 0, 1, 256); g.fillRect(255, 0, 1, 256);
  }

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
    stack: tex(stackC, { aniso }),
    rail: tex(railC, { aniso }),
    wood: tex(woodC, { aniso }),
    rampSticker: tex(rampC, { aniso, repeat: false }),
  };
  return textures;
}
