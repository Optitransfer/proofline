import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/contract.mjs';
import { repo, BIN } from './helpers.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('task writes a proposal from plain words that validate accepts, and prints its hash and next step', () => {
  const root = repo();
  const before = fs.readFileSync(path.join(root, 'proofline.json'));
  const out = execFileSync(process.execPath, [BIN, 'task', 'Add the export', '--root', root], { encoding: 'utf8' });
  const lines = out.trim().split(/\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^[0-9a-f]{64}$/);
  assert.equal(lines[1], `proofline contract approve ${lines[0]}`);
  const proposal = fs.readFileSync(path.join(root, '.proofline', 'proposals', lines[0]));
  assert.equal(sha256(proposal), lines[0]);
  const contract = JSON.parse(proposal.toString('utf8'));
  assert.deepEqual(C.validate(contract), []);
  assert.equal(contract.tasks.length, 1);
  assert.equal(contract.tasks[0].title, 'Add the export');
  assert.deepEqual(fs.readFileSync(path.join(root, 'proofline.json')), before);
});
