import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/index.mjs';
import { repo, sh, commitAll, BIN } from './helpers.mjs';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

function prepared() {
  const root = repo({ hooks: true });
  const approvals = path.join(root, '.proofline', 'approvals');
  P.init(root, { hooks: true, approvals });
  const c = P.C.skeleton('t');
  c.tasks.push(P.C.makeTask({
    id: 'T-01', title: 'one command',
    criteria: [{ statement: 'runs', verifier: { type: 'command', cmd: 'node t.mjs' } }],
  }));
  P.C.save(root, c);
  commitAll(root, 'contract');
  sh(root, 'config', 'core.autocrlf', 'false');
  const current = fs.readFileSync(path.join(root, 'proofline.json'), 'utf8');
  const next = current.replace('node t.mjs', 'node t.mjs --changed');
  const hex = sha256(next);
  const dir = path.join(root, '.proofline', 'proposals');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, hex), next);
  return { root, approvals, current, next, hex };
}

function approve(root, hex, input) {
  return execFileSync(process.execPath, [BIN, 'contract', 'approve', hex, '--root', root], { encoding: 'utf8', input });
}

test('approve shows the diff; N or an empty line applies nothing', () => {
  const { root, current, hex } = prepared();
  for (const input of ['N\n', '\n']) {
    const out = approve(root, hex, input);
    assert.match(out, /node t\.mjs --changed/);
    assert.match(out, /nothing applied/);
    assert.equal(fs.readFileSync(path.join(root, 'proofline.json'), 'utf8'), current);
  }
  assert.equal(fs.existsSync(path.join(root, '.proofline', 'approvals', hex)), false);
});

test('on y the marker is the proposal hash and the bytes apply; the hook accepts that and refuses it without the marker', () => {
  const { root, approvals, next, hex } = prepared();
  const out = approve(root, hex, 'y\n');
  assert.match(out, /node t\.mjs --changed/);
  assert.match(out, new RegExp(`applied ${hex}`));
  assert.equal(fs.readFileSync(path.join(root, 'proofline.json'), 'utf8'), next);
  const marker = path.join(approvals, hex);
  const st = fs.lstatSync(marker);
  assert.equal(st.isFile(), true);
  assert.equal(st.isSymbolicLink(), false);
  sh(root, 'add', 'proofline.json');
  const blob = execFileSync('git', ['cat-file', 'blob', ':proofline.json'], { cwd: root });
  assert.equal(sha256(blob), hex);
  const yes = P.hookPreCommit(root);
  assert.equal(yes.ok, true, yes.msg);
  fs.rmSync(marker);
  const no = P.hookPreCommit(root);
  assert.equal(no.ok, false);
  assert.match(no.msg, /command changed/);
  let refused;
  try {
    execFileSync(process.execPath, [BIN, 'hook', 'pre-commit', '--root', root], { encoding: 'utf8' });
  } catch (e) { refused = e; }
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /command changed/);
});
