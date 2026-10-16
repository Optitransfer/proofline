import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, sh, commitAll, BIN } from './helpers.mjs';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

function contractWith(cmd) {
  const c = P.C.skeleton('t');
  c.tasks.push(P.C.makeTask({
    id: 'T-01', title: 'one command',
    criteria: [{ statement: 'runs', verifier: { type: 'command', cmd } }],
  }));
  return c;
}

/** Commit a contract, then stage a command change. Returns the repo and the sha256 of the staged bytes. */
function stagedChange() {
  const r = repo({ hooks: false });
  P.C.save(r, contractWith('node t.mjs'));
  commitAll(r, 'contract');
  sh(r, 'config', 'core.autocrlf', 'false');
  P.C.save(r, contractWith('node t.mjs --changed'));
  sh(r, 'add', 'proofline.json');
  const file = fs.readFileSync(path.join(r, 'proofline.json'));
  const blob = execFileSync('git', ['cat-file', 'blob', ':proofline.json'], { cwd: r });
  assert.equal(sha256(file), sha256(blob), 'the marker names the index blob, which must match the file bytes');
  return { r, hex: sha256(blob) };
}

function marker(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '');
}

test('a contract change is refused without the marker for the staged bytes', () => {
  const { r, hex } = stagedChange();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-approve-'));
  P.init(r, { hooks: false, approvals: dir });
  const no = P.hookPreCommit(r);
  assert.equal(no.ok, false);
  assert.match(no.msg, /command changed/);
  assert.match(no.msg, new RegExp(`sha256 ${hex}`));
  assert.match(no.msg, new RegExp(path.join(dir, hex).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  marker(dir, sha256('other bytes'));
  const other = P.hookPreCommit(r);
  assert.equal(other.ok, false);
  assert.match(other.msg, new RegExp(`sha256 ${hex}`));
});

test('the marker for the staged bytes passes, including beside a code file, and other bytes do not', () => {
  const { r, hex } = stagedChange();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-approve-'));
  P.init(r, { hooks: false, approvals: dir });
  fs.writeFileSync(path.join(r, 'code.mjs'), 'export const n = 1;\n');
  sh(r, 'add', 'code.mjs');
  marker(dir, hex);
  const yes = P.hookPreCommit(r);
  assert.equal(yes.ok, true, yes.msg);

  const alone = stagedChange();
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-approve-'));
  P.init(alone.r, { hooks: false, approvals: dir2 });
  const refused = P.hookPreCommit(alone.r);
  assert.equal(refused.ok, false);
  marker(dir2, alone.hex);
  assert.equal(P.hookPreCommit(alone.r).ok, true);
});

test('with no approvals directory configured, every contract change is refused', () => {
  const { r, hex } = stagedChange();
  const no = P.hookPreCommit(r);
  assert.equal(no.ok, false);
  assert.match(no.msg, new RegExp(`sha256 ${hex}`));
  assert.match(no.msg, /no approvals directory configured/);
});

test('removing proofline.json from the index is refused, because no marker can name bytes that are not staged', () => {
  const r = repo({ hooks: false });
  P.C.save(r, contractWith('node t.mjs'));
  commitAll(r, 'contract');
  sh(r, 'rm', '--cached', '-q', 'proofline.json');
  const no = P.hookPreCommit(r);
  assert.equal(no.ok, false);
  assert.match(no.msg, /staged proofline.json is absent/);
  assert.match(no.msg, /no approval marker can be bound/);
});

test('proofline hook pre-commit prints the sha256 and the marker path', () => {
  const { r, hex } = stagedChange();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-approve-'));
  P.init(r, { hooks: false, approvals: dir });
  let err = '';
  try {
    execFileSync(process.execPath, [BIN, 'hook', 'pre-commit', '--root', r], { encoding: 'utf8' });
    assert.fail('the hook should refuse');
  } catch (e) {
    err = `${e.stdout || ''}\n${e.stderr || ''}`;
    assert.equal(e.status, 1);
  }
  assert.match(err, new RegExp(`sha256 ${hex}`));
  assert.match(err, new RegExp(path.join(dir, hex).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
