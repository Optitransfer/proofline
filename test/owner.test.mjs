import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as P from '../src/index.mjs';
import { handle } from '../src/mcp.mjs';
import { repo, addTask, BIN } from './helpers.mjs';

const ok = [{ verifier: { type: 'command', cmd: 'true' } }];
/** Three tasks in one phase: owner b first, then owner a, then unowned. */
function lanes({ owners } = {}) {
  const r = repo();
  if (owners) { const c = P.C.load(r); c.defaults.owners = owners; P.C.save(r, c); }
  addTask(r, { id: 'B-1', title: 'b one', owner: 'b', criteria: ok });
  addTask(r, { id: 'A-1', title: 'a one', owner: 'a', criteria: ok });
  addTask(r, { id: 'U-1', title: 'anyone', criteria: ok });
  return r;
}

test('an owner on a task survives makeTask and contract create', () => {
  const t = P.C.makeTask({ id: 'X', title: 'x', owner: 'a', criteria: ok });
  assert.equal(t.owner, 'a');
  assert.equal('owner' in P.C.makeTask({ id: 'Y', title: 'y', criteria: ok }), false, 'no owner key unless one is given');
});

test('validate refuses an owner outside defaults.owners, and any owner is fine without the list', () => {
  const r = lanes({ owners: ['a', 'b'] });
  assert.deepEqual(P.C.validate(P.C.load(r)), []);
  const c = P.C.load(r); c.tasks[0].owner = 'zed';
  assert.match(P.C.validate(c).join('\n'), /B-1: owner zed is not in defaults\.owners \(a, b\)/);
  delete c.defaults.owners;
  assert.deepEqual(P.C.validate(c), []);
  c.defaults.owners = 'a';
  assert.match(P.C.validate(c).join('\n'), /defaults\.owners must be a list of names/);
});

test('next --owner returns the owner\'s task or an unowned one, never another owner\'s', () => {
  const r = lanes({ owners: ['a', 'b'] });
  assert.equal(P.E.next(r).task, 'B-1', 'without --owner, next is unchanged');
  let n = P.taskNext(r, { owner: 'a' });
  assert.equal(n.task, 'A-1'); assert.match(n.brief, /Owner: a/);
  assert.equal(P.E.gate(r, 'A-1').decision, 'PASS');
  assert.equal(P.taskNext(r, { owner: 'a' }).task, 'U-1');
  assert.equal(P.E.gate(r, 'U-1').decision, 'PASS');
  n = P.taskNext(r, { owner: 'a' });
  assert.equal(n.task ?? null, null); assert.match(n.message, /B-1/);
  assert.equal(P.taskNext(r, { owner: 'b' }).task, 'B-1');
});

test('next --owner still waits on another owner\'s dependency', () => {
  const r = repo();
  addTask(r, { id: 'B-1', title: 'b one', owner: 'b', criteria: ok });
  addTask(r, { id: 'A-1', title: 'a one', owner: 'a', depends_on: ['B-1'], criteria: ok });
  const n = P.taskNext(r, { owner: 'a' });
  assert.equal(n.task, null); assert.match(n.message, /A-1 \(waits on B-1\)/);
});

test('status and brief take --owner; CLI and MCP pass it through', () => {
  const r = lanes({ owners: ['a', 'b'] });
  assert.deepEqual(Object.keys(P.status(r, { owner: 'a' }).tasks).sort(), ['A-1', 'U-1']);
  assert.deepEqual(Object.keys(P.status(r).tasks).sort(), ['A-1', 'B-1', 'U-1']);
  const run = (...a) => spawnSync(process.execPath, [BIN, ...a, '--root', r], { encoding: 'utf8' });
  assert.equal(JSON.parse(run('next', '--owner', 'a', '--json').stdout).task, 'A-1');
  assert.deepEqual(Object.keys(JSON.parse(run('status', '--owner', 'a', '--json').stdout).tasks).sort(), ['A-1', 'U-1']);
  const theirs = run('brief', 'B-1', '--owner', 'a');
  assert.equal(theirs.status, 3); assert.match(theirs.stderr, /B-1 is owned by b, not a/);
  assert.equal(run('brief', 'U-1', '--owner', 'a').status, 0);
  const stranger = run('next', '--owner', 'zed');
  assert.equal(stranger.status, 3); assert.match(stranger.stderr, /zed is not in defaults\.owners/);
  const list = handle(r, { jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools;
  for (const name of ['task_next', 'status']) assert.ok(list.find((t) => t.name === name).inputSchema.properties.owner, name);
  const call = (name, args) => handle(r, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }).result.content[0].text;
  assert.match(call('task_next', { owner: 'b' }), /# TASK B-1/);
  assert.deepEqual(Object.keys(JSON.parse(call('status', { owner: 'b' })).tasks).sort(), ['B-1', 'U-1']);
});
