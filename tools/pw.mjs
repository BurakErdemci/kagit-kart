// Resolves the globally installed Playwright (no project dependency) and launches Chromium on the
// real GPU.
//
// Measured on this machine (Windows 11, AMD RX 6750 XT, Playwright 1.61.1, Chromium 149 headless shell):
//   no flags            → "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) ...), SwiftShader driver)"  (software)
//   --use-angle=d3d11   → "ANGLE (AMD, AMD Radeon RX 6750 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)"      (hardware)
//   --enable-gpu        → same hardware string
// Either flag alone is enough in headless mode; both are passed, plus --ignore-gpu-blocklist so a
// driver blocklist entry cannot silently fall back to SwiftShader. If headless still reports a software
// renderer, launch() retries headed with the window parked off-screen.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';

export const GPU_FLAGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
export const STEADY_FLAGS = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];
export const SOFTWARE_RE = /SwiftShader|llvmpipe|Software|Basic Render/i;

let cached = null;
export function loadPlaywright() {
  if (cached) return cached;
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const require = createRequire(path.join(root, 'noop.js'));
  cached = require('playwright');
  return cached;
}

export async function probeRenderer(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return 'no-webgl2';
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
  } finally {
    await page.close();
  }
}

// Returns { browser, mode: 'headless'|'headed-offscreen', flags, renderer }.
export async function launch({ extraArgs = [], forceHeaded = false } = {}) {
  const { chromium } = loadPlaywright();
  const flags = [...GPU_FLAGS, ...STEADY_FLAGS, ...extraArgs];
  if (!forceHeaded) {
    const browser = await chromium.launch({ headless: true, args: flags });
    const renderer = await probeRenderer(browser);
    if (!SOFTWARE_RE.test(renderer)) return { browser, mode: 'headless', flags, renderer };
    await browser.close();
  }
  const headedFlags = [...flags, '--window-position=-2400,0', '--window-size=1280,720'];
  const browser = await chromium.launch({ headless: false, args: headedFlags });
  const renderer = await probeRenderer(browser);
  return { browser, mode: 'headed-offscreen', flags: headedFlags, renderer };
}
