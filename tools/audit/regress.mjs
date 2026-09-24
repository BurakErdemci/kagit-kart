// Audit regression suite: runs every scenario in tools/audit/regressions through tools/audit/probe.mjs
// (one process each, AUDIT_ROOT = this repo) and prints name | rc | detail.
//   node tools/audit/regress.mjs [name-filter ...]
// rc per scenario follows probe.mjs: 0 fixed, 1 the flaw reproduces, 2 could not measure.
// Exits 0 only when every scenario exits 0. Scenarios run one after another: several of them measure
// real compile and input timing, which parallel browsers on one GPU would distort.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(root, 'tools', 'audit', 'regressions');
const probe = path.join(root, 'tools', 'audit', 'probe.mjs');
const filters = process.argv.slice(2);

const names = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.slice(0, -4))
  .filter((n) => !filters.length || filters.some((s) => n.includes(s)))
  .sort();
if (!names.length) {
  console.error('no regression scenarios matched');
  process.exit(2);
}

const lastLine = (s) => String(s || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
const rows = [];
for (const name of names) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [probe, path.join(dir, `${name}.mjs`)], {
    cwd: root, env: { ...process.env, AUDIT_ROOT: root }, encoding: 'utf8', timeout: 300_000,
  });
  const rc = r.status ?? 2;
  const detail = rc === 2 ? lastLine(r.stderr) || lastLine(r.stdout) || String(r.error || 'no output') : lastLine(r.stdout);
  rows.push({ name, rc, detail, s: Math.round((Date.now() - t0) / 1000) });
  console.error(`${name}: rc ${rc} (${rows.at(-1).s} s)`);
}

const w = Math.max(...rows.map((r) => r.name.length));
console.log(`${'name'.padEnd(w)} | rc | detail`);
console.log(`${'-'.repeat(w)}-|----|-------`);
for (const r of rows) console.log(`${r.name.padEnd(w)} | ${String(r.rc).padStart(2)} | ${r.detail}`);
const failed = rows.filter((r) => r.rc !== 0).length;
console.log(`\n${rows.length - failed}/${rows.length} scenarios pass`);
process.exit(failed ? 1 : 0);
