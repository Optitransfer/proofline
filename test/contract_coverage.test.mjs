import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repo, BIN } from './helpers.mjs';

function run(r, args) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args, '--root', r], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

test('coverage prints covered and MISSING ids across several contracts and exits 1 on a gap or an unknown id', () => {
  const r = repo();
  fs.writeFileSync(path.join(r, 'REQ.md'), '- R1: one\n- R2: two\n\nnot a requirement\n');
  fs.writeFileSync(path.join(r, 'a.json'), JSON.stringify({ tasks: [{ id: 'A', requirements: ['R1'] }] }));
  fs.writeFileSync(path.join(r, 'b.json'), JSON.stringify({ tasks: [{ id: 'B', requirements: ['R9'] }] }));
  const gap = run(r, ['contract', 'coverage', 'REQ.md', '--contracts', 'a.json,b.json']);
  assert.equal(gap.code, 1);
  assert.match(gap.stdout, /^R1 A$/m);
  assert.match(gap.stdout, /^R2 MISSING$/m);
  assert.match(gap.stdout, /^R9 unknown B$/m);

  fs.writeFileSync(path.join(r, 'REQ.md'), '- R1: one\n');
  fs.writeFileSync(path.join(r, 'a.json'), JSON.stringify({ tasks: [{ id: 'A', requirements: ['R1'] }, { id: 'C', requirements: ['R1'] }] }));
  const ok = run(r, ['contract', 'coverage', 'REQ.md', '--contracts', 'a.json']);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /^R1 A,C$/m);
});
