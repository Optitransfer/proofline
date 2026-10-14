import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as P from '../src/index.mjs';
import { handle } from '../src/mcp.mjs';
import { repo, write, addTask, commitAll, sh, BIN } from './helpers.mjs';

/** A task committed and pushed, then its work committed and pushed; returns a fresh clone of origin (no .proofline log). */
function published({ extra = { 'CHANGELOG.md': '# changes\n' }, message = 'FP: bench rig' } = {}) {
  const r = repo();
  addTask(r, { id: 'FP', title: 'bench rig', scope: ['bench/**'], criteria: [
    { verifier: { type: 'file_exists', path: 'bench/e2e.mjs' } },
    { verifier: { type: 'scope' } }] });
  commitAll(r, 'contract'); sh(r, 'push', '-q', 'origin', 'main');
  const start = sh(r, 'rev-parse', 'HEAD');
  sh(r, 'checkout', '-q', '-b', 'side'); sh(r, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'side'); sh(r, 'push', '-q', 'origin', 'side');
  const side = sh(r, 'rev-parse', 'HEAD'); sh(r, 'checkout', '-q', 'main');
  write(r, { 'bench/e2e.mjs': 'console.log(1);\n', ...extra });
  sh(r, 'add', '-A'); sh(r, 'commit', '-q', '--no-verify', '-m', typeof message === 'function' ? message(start, side) : message);
  sh(r, 'push', '-q', 'origin', 'main');
  const clone = path.join(path.dirname(r), 'fresh');
  sh(path.dirname(r), 'clone', '-q', path.join(path.dirname(r), 'o.git'), clone);
  return { clone, start };
}

test('fresh clone at origin/main with no pinned base is BLOCKED, never PASS', () => {
  const { clone } = published();
  const g = P.E.verifyTask(clone, 'FP');
  assert.equal(g.decision, 'BLOCKED');
  assert.equal(g.base_source, 'default');
  assert.match(g.blocked.join('\n'), /default base origin\/main is HEAD/);
  assert.match(P.E.steer(g, P.C.load(clone)), /--base <rev>.*proofline next/s);
});

test('with --base <parent> the fresh clone gets the real decision, scope violation included', () => {
  const { clone, start } = published();
  assert.equal(sh(clone, 'rev-parse', 'HEAD~1'), start);
  const g = P.E.verifyTask(clone, 'FP', { base: 'HEAD~1' });
  assert.equal(g.decision, 'FAIL');
  assert.equal(g.base_source, '--base');
  assert.equal(g.base, start);
  assert.match(g.failing.join('\n'), /FP-AC02 FAIL: changes outside the approved scope: CHANGELOG\.md/);
});

test('with --base <parent> an in-scope task commit PASSes', () => {
  const { clone } = published({ extra: {} });
  assert.equal(P.E.verifyTask(clone, 'FP').decision, 'BLOCKED');
  const g = P.E.verifyTask(clone, 'FP', { base: 'HEAD~1' });
  assert.equal(g.decision, 'PASS', g.blocked.concat(g.failing).join('\n'));
});

test('CLI and MCP take --base; the report says where the base came from', () => {
  const { clone, start } = published();
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a, '--root', clone], { encoding: 'utf8' });
  const blocked = run('gate', 'FP');
  assert.equal(blocked.status, 2, blocked.stdout + blocked.stderr);
  assert.match(blocked.stdout, /base: origin\/main = [0-9a-f]{8} \(default\)/);
  const real = run('gate', 'FP', '--base', 'HEAD~1');
  assert.equal(real.status, 1, real.stdout + real.stderr);
  assert.match(real.stdout, new RegExp(`base: HEAD~1 = ${start.slice(0, 8)} \\(--base\\)`));
  assert.match(fs.readFileSync(path.join(clone, '.proofline/reports/FP-latest.md'), 'utf8'), new RegExp(`- Base: HEAD~1 = ${start} \\(--base\\)`));
  const list = handle(clone, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const name of ['verify', 'gate']) assert.ok(list.result.tools.find((t) => t.name === name).inputSchema.properties.base, name);
  const mcp = handle(clone, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'verify', arguments: { task: 'FP', base: start } } });
  assert.match(mcp.result.content[0].text, /DECISION: FAIL/);
});

test('a Proofline-Base trailer on the task commit carries the base into a fresh clone', () => {
  const { clone, start } = published({ message: (s) => `FP: bench rig\n\nProofline-Base: ${s}\n` });
  const g = P.E.verifyTask(clone, 'FP');
  assert.equal(g.base_source, 'commit trailer');
  assert.equal(g.base, start);
  assert.equal(g.decision, 'FAIL');
  assert.match(g.failing.join('\n'), /CHANGELOG\.md/);
});

test('a Proofline-Base trailer that is unknown or not an ancestor of HEAD is BLOCKED', () => {
  const unknown = published({ message: 'FP: bench rig\n\nProofline-Base: 0123456789abcdef0123456789abcdef01234567\n' });
  let g = P.E.verifyTask(unknown.clone, 'FP');
  assert.equal(g.decision, 'BLOCKED');
  assert.match(g.blocked.join('\n'), /"0123456789abcdef0123456789abcdef01234567" \(commit trailer\) not found/);
  const sideways = published({ message: (s, side) => `FP: bench rig\n\nProofline-Base: ${side}\n` });
  g = P.E.verifyTask(sideways.clone, 'FP');
  assert.equal(g.decision, 'BLOCKED');
  assert.match(g.blocked.join('\n'), /Proofline-Base trailer on HEAD names [0-9a-f]{40}, which is not an ancestor of HEAD/);
});

test('next pins the base and the brief names it for other clones', () => {
  const r = repo();
  addTask(r, { id: 'T', title: 't', criteria: [{ verifier: { type: 'scope' } }] });
  const n = P.taskNext(r);
  const start = sh(r, 'rev-parse', 'origin/main');
  assert.equal(n.base, start);
  assert.ok(n.brief.includes(`--base ${start}`) && n.brief.includes(`Proofline-Base: ${start}`), n.brief.slice(-400));
  assert.equal(P.E.verifyTask(r, 'T').base_source, 'pinned at start');
});
