import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BIN, repo } from './helpers.mjs';

const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], {
  cwd, encoding: 'utf8', timeout: 2000,
});

const COMMANDS = [
  ['setup'],
  ['task', 'plain words'],
  ['init'],
  ['contract', 'create'],
  ['contract', 'merge'],
  ['contract', 'coverage'],
  ['contract', 'scaffold'],
  ['contract', 'approve'],
  ['contract', 'sign'],
  ['contract', 'verify-sig'],
  ['contract', 'propose'],
  ['contract', 'validate'],
  ['contract', 'show'],
  ['next'],
  ['brief'],
  ['verify'],
  ['gate'],
  ['report'],
  ['status'],
  ['evidence', 'record'],
  ['evidence', 'verify'],
  ['evidence', 'log'],
  ['verify-receipt'],
  ['receipt'],
  ['hook'],
  ['watch'],
  ['connect'],
  ['mcp'],
];

test('contract validate --file exits 2 and names the flag', () => {
  const r = repo();
  const res = run(['contract', 'validate', '--file', '/tmp/does-not-exist-proposal.json', '--root', r], r);
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /unknown flag --file/);
  assert.match(res.stderr, /accepted:/);
  assert.doesNotMatch(`${res.stdout}\n${res.stderr}`, /warning:/);
});

test('an unknown flag on each subcommand exits 2 and names the flag', () => {
  const r = repo();
  for (const args of COMMANDS) {
    const res = run([...args, '--not-a-real-flag', '--root', r], r);
    assert.equal(res.status, 2, `${args.join(' ')} ${res.stderr}`);
    assert.match(res.stderr, /unknown flag --not-a-real-flag/);
    assert.match(res.stderr, /accepted:/);
  }
});

test('accepted flags still run the command', () => {
  const r = repo();
  const validate = run(['contract', 'validate', '--root', r], r);
  assert.notEqual(validate.status, 2, validate.stderr);
  const shown = run(['contract', 'scaffold', '--title', 'A task', '--scope', 'src', '--root', r], r);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /"title": "A task"/);
  const status = run(['status', '--json', '--root', r], r);
  assert.notEqual(status.status, 2, status.stderr);
  assert.doesNotThrow(() => JSON.parse(status.stdout));
});
