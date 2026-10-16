import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { repo, BIN } from './helpers.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('propose writes the diff and the hash and changes nothing else', () => {
  const root = repo();
  const contract = path.join(root, 'proofline.json');
  const before = fs.readFileSync(contract);
  const statusBefore = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout;
  const r = spawnSync(process.execPath, [BIN, 'contract', 'propose', '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const hex = r.stdout.trim();
  assert.match(hex, /^[0-9a-f]{64}$/);
  const diffPath = path.join(root, '.proofline', 'proposals', `${hex}.diff`);
  const diff = fs.readFileSync(diffPath);
  assert.equal(sha256(diff), hex);
  assert.deepEqual(fs.readFileSync(contract), before);
  assert.equal(fs.existsSync(path.join(root, 'proofline.json.sig')), false);
  const statusAfter = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.equal(statusAfter, statusBefore);
});
