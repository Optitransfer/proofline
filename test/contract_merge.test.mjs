import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repo, BIN } from './helpers.mjs';
import { sha256 } from '../src/util.mjs';

const OLD = '{ "id": "OLD", "title": "KEEP-THIS-EXACT", "phase": "implement", "criteria": [{ "id": "OLD-AC01", "verifier": { "type": "scope" } }], "stop_rules": ["stop"], "scope": { "allow": ["**"] } }';

test('merge appends tasks and new owner rules, refuses a duplicate id, keeps existing bytes, prints the sha256', () => {
  const r = repo();
  const file = path.join(r, 'proofline.json');
  fs.writeFileSync(file, `{
  "schema": "proofline/1",
  "project": "p",
  "tasks": [
    ${OLD}
  ],
  "owner_rules": [
    "rule-a"
  ]
}
`);
  const frag = path.join(r, 'frag.json');
  fs.writeFileSync(frag, JSON.stringify({
    tasks: [{ id: 'NEW', title: 'n', owner: 'lane', phase: 'implement', scope: { allow: ['src/**'] }, criteria: [{ verifier: { type: 'scope' } }], stop_rules: ['stop'] }],
    owner_rules: ['rule-a', 'rule-b'],
  }));
  const out = execFileSync(process.execPath, [BIN, 'contract', 'merge', 'frag.json', '--owners', 'lane=mgillr', '--root', r], { encoding: 'utf8' }).trim();
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(out, sha256(after));
  assert.ok(after.includes(OLD));
  const parsed = JSON.parse(after);
  assert.deepEqual(parsed.tasks.map((t) => t.id), ['OLD', 'NEW']);
  assert.equal(parsed.tasks[0].title, 'KEEP-THIS-EXACT');
  assert.equal(parsed.tasks[1].owner, 'mgillr');
  assert.deepEqual(parsed.owner_rules, ['rule-a', 'rule-b']);
  const snap = fs.readFileSync(file);
  let failed = false;
  try {
    execFileSync(process.execPath, [BIN, 'contract', 'merge', 'frag.json', '--root', r], { encoding: 'utf8' });
  } catch (e) {
    failed = true;
    assert.equal(e.status, 3);
    assert.match(String(e.stderr), /duplicate task id NEW/);
  }
  assert.equal(failed, true);
  assert.deepEqual(fs.readFileSync(file), snap);
});
