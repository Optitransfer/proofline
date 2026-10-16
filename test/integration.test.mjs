import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { runDemo } from '../examples/demo/demo.mjs';
import { repo, write, addTask, sh, BIN } from './helpers.mjs';
import * as P from '../src/index.mjs';

test('demo: claimed done without evidence FAILS, real work PASSES', () => {
  const d = runDemo.call(null);
  assert.equal(d.g1.decision, 'FAIL'); assert.equal(d.g2.decision, 'PASS');
});

test('CLI exit codes: 0 PASS, 1 FAIL, 2 BLOCKED; --json output', () => {
  const r = repo();
  addTask(r, { id: 'A', title: 'a', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  addTask(r, { id: 'B', title: 'b', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  addTask(r, { id: 'C', title: 'c', criteria: [{ verifier: { type: 'metric', cmd: 'node nope.mjs', key: 'x', op: '<', value: 1 } }] });
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a, '--root', r], { encoding: 'utf8' });
  // The work is uncommitted on top of origin/main, so that is the base the tasks started from.
  assert.equal(run('gate', 'A', '--base', 'origin/main').status, 0); assert.equal(run('gate', 'B', '--base', 'origin/main').status, 1); assert.equal(run('gate', 'C', '--base', 'origin/main').status, 2);
  const j = JSON.parse(run('gate', 'B', '--json', '--base', 'origin/main').stdout); assert.equal(j.decision, 'FAIL');
  assert.equal(JSON.parse(run('next', '--json').stdout).task, 'B', 'A is verified and the next task follows');
});

test('hooks: pre-commit refuses a skipped test; bypass env var does not help', () => {
  const r = repo({ hooks: true, files: { 'test/a.test.mjs': "import test from 'node:test';\ntest('a', () => {});\n" } });
  write(r, { 'test/a.test.mjs': "import test from 'node:test';\ntest" + ".skip('a', () => {});\n" });
  sh(r, 'add', '-A');
  const c = spawnSync('git', ['commit', '-m', 'x'], { cwd: r, encoding: 'utf8', env: { ...process.env, PROOFLINE_SKIP: '1', SKIP_HOOKS: '1', HUSKY: '0' } });
  assert.notEqual(c.status, 0); assert.match(c.stderr, /REFUSED/);
});

test('hooks: pre-push refuses when the active task does not gate PASS', () => {
  const r = repo({ hooks: true });
  addTask(r, { id: 'A', title: 'a', criteria: [{ verifier: { type: 'command', cmd: 'false' } }] });
  P.taskNext(r);
  sh(r, 'add', '-A'); sh(r, 'commit', '-q', '-m', 'c');
  const p = spawnSync('git', ['push', 'origin', 'main'], { cwd: r, encoding: 'utf8' });
  assert.notEqual(p.status, 0); assert.match(p.stderr, /pre-push: REFUSED/);
});

test('MCP server: initialize, tools/list, task_next and verify over stdio', async () => {
  const r = repo();
  addTask(r, { id: 'A', title: 'a', criteria: [{ verifier: { type: 'command', cmd: 'true' } }] });
  const p = spawn(process.execPath, [BIN, 'mcp', '--root', r]);
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'task_next', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'gate', arguments: { task: 'A' } } },
  ];
  let out = ''; p.stdout.on('data', (d) => (out += d));
  for (const m of msgs) p.stdin.write(JSON.stringify(m) + '\n');
  p.stdin.end();
  await new Promise((res) => p.on('close', res));
  const res = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(res.length, 4);
  assert.equal(res[0].result.serverInfo.name, 'proofline');
  assert.deepEqual(res[1].result.tools.map((t) => t.name).sort(), ['contract_create', 'evidence_record', 'gate', 'receipt', 'report', 'status', 'task_next', 'verify', 'verify_receipt']);
  assert.match(res[2].result.content[0].text, /# TASK A/);
  assert.match(res[3].result.content[0].text, /DECISION: PASS/);
});
