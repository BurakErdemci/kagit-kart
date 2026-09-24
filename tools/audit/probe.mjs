// Audit probe runner: boots the game from AUDIT_ROOT in a real-GPU browser and runs one scenario.
//   node tools/audit/probe.mjs <scenario.mjs>
// The scenario's default export is async ({ page, root, errors, sleep }) => ({ live, detail }).
// Exit codes follow the audit finding contract: 1 the flaw reproduces, 0 it does not, 2 inconclusive
// (the game did not boot, the scenario threw, or it ran out of time).
// Needs network (three.js comes from jsdelivr) and Playwright, so audit lanes write probes against it
// and the architect runs them.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.env.AUDIT_ROOT || process.cwd());
const scenarioPath = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inconclusive = (why) => { console.error(`inconclusive: ${why}`); process.exit(2); };
if (!scenarioPath) inconclusive('usage: node tools/audit/probe.mjs <scenario.mjs>');

const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const server = spawn(process.platform === 'win32' ? 'python' : 'python3', [path.join(root, 'tools', 'serve.py'), String(port)],
  { cwd: root, stdio: 'ignore' });
let browser = null;
const hardStop = setTimeout(() => { cleanup(); inconclusive('timed out after 240 s'); }, 240_000);
function cleanup() {
  try { server.kill(); } catch { /* already gone */ }
}

try {
  const { launch } = await import(pathToFileURL(path.join(root, 'tools', 'pw.mjs')).href);
  const scenario = (await import(pathToFileURL(path.resolve(scenarioPath)).href)).default;
  await sleep(1200);
  ({ browser } = await launch({}));
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  try {
    await page.waitForFunction(() => window.__kk && window.__kk.ready, null, { timeout: 30_000 });
  } catch {
    throw Object.assign(new Error(`game did not boot; errors: ${errors.slice(0, 3).join(' | ')}`), { inconclusive: true });
  }
  const result = await scenario({ page, root, errors, sleep });
  console.log(`${result.live ? 'LIVE' : 'not reproduced'}: ${result.detail || ''}`);
  await browser.close();
  cleanup();
  clearTimeout(hardStop);
  process.exit(result.live ? 1 : 0);
} catch (e) {
  try { if (browser) await browser.close(); } catch { /* closing a dead browser */ }
  cleanup();
  clearTimeout(hardStop);
  inconclusive(e.inconclusive ? e.message : `scenario threw: ${e && e.stack || e}`);
}
