import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, BIN } from './helpers.mjs';
import { decompose } from '../src/decompose.mjs';
import { sha256 } from '../src/util.mjs';

const FIX = path.resolve(import.meta.dirname, '..', 'fixtures', 'decompose');
const SCOPE = path.join(FIX, 'example-project.scope.json');
const GOLDEN = path.join(FIX, 'example-project.proposal.json');
const REQS = path.join(FIX, 'REQUIREMENTS.md');
const scope = () => JSON.parse(fs.readFileSync(SCOPE, 'utf8'));
const cli = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pl-decompose-'));

test('decompose output is byte-identical to the golden file, run after run and however the scope is formatted', () => {
  const golden = fs.readFileSync(GOLDEN, 'utf8');
  assert.equal(decompose(scope()).bytes, golden);
  const dir = tmp();
  const compact = path.join(dir, 'compact.scope.json');
  fs.writeFileSync(compact, JSON.stringify(scope()));
  const a = cli(['contract', 'decompose', SCOPE, '--root', dir], dir);
  const b = cli(['contract', 'decompose', compact, '--root', dir], dir);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, golden);
  assert.equal(b.stdout, golden);
  const out = cli(['contract', 'decompose', SCOPE, '--out', 'p.json', '--root', dir], dir);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.split('\n')[0], sha256(golden));
  assert.equal(fs.readFileSync(path.join(dir, 'p.json'), 'utf8'), golden);
});

test('ids, criterion numbering, prepend/append, defaults and {task} follow the scope', () => {
  const { proposal } = decompose(scope());
  assert.deepEqual(proposal.tasks.map((t) => t.id), ['EX-01', 'EX-02', 'EX-DOCS']);
  const [one, two, docs] = proposal.tasks;
  assert.deepEqual(one.criteria.map((c) => c.id), ['EX-01-AC01', 'EX-01-AC02', 'EX-01-AC03', 'EX-01-AC04']);
  assert.deepEqual(one.criteria.slice(2).map((c) => c.verifier.type), ['scope', 'pushed']);
  assert.ok(one.criteria.every((c) => c.mandatory === true));
  assert.deepEqual(one.criteria[1].verifier, { type: 'command', cmd: 'npm test', expect_exit: 0, timeout_s: 120 });
  assert.deepEqual(two.depends_on, ['EX-01']);
  assert.equal(two.estimate_days, 2);
  assert.equal(one.estimate_days, 1);
  assert.equal(one.owner, 'OWNER');
  assert.deepEqual(one.requirements, ['REQ-GREET', 'REQ-QUALITY']);
  assert.equal(docs.criteria[0].id, 'EX-DOCS-USAGE');
  assert.equal(docs.stop_rules.length, 2);
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.schema, 'proofline/1');
});

test('a duplicate id is refused, inside the scope and against an existing contract, and nothing is written', () => {
  const s = scope();
  s.tasks[1].n = 1;
  delete s.tasks[1].depends_on;
  assert.throws(() => decompose(s), /duplicate task id EX-01 in the scope file/);

  const r = repo();
  const contract = path.join(r, 'proofline.json');
  const c = JSON.parse(fs.readFileSync(contract, 'utf8'));
  c.tasks.push({ id: 'EX-02', title: 'taken', phase: 'implement', depends_on: [], scope: { allow: ['**'] }, criteria: [{ id: 'EX-02-AC01', verifier: { type: 'scope' } }], stop_rules: ['stop'] });
  fs.writeFileSync(contract, JSON.stringify(c, null, 2) + '\n');
  const before = fs.readFileSync(contract);
  const res = cli(['contract', 'decompose', SCOPE, '--against', 'proofline.json', '--out', 'docs/proposals/p.json', '--root', r], r);
  assert.equal(res.status, 3);
  assert.match(res.stderr, /duplicate task id EX-02: already in/);
  assert.equal(fs.existsSync(path.join(r, 'docs/proposals/p.json')), false);
  assert.deepEqual(fs.readFileSync(contract), before);
});

test('an unknown dependency, a cycle and a task validate would refuse are all refused', () => {
  const s = scope();
  s.tasks[2].depends_on = ['EX-99'];
  assert.throws(() => decompose(s), /EX-DOCS: depends on unknown EX-99/);
  s.external = ['EX-99'];
  assert.doesNotThrow(() => decompose(s));
  const loop = scope();
  loop.tasks[0].depends_on = ['EX-DOCS'];
  assert.throws(() => decompose(loop), /dependency cycle/);
  const bare = scope();
  bare.append = {};
  assert.throws(() => decompose(bare), /no scope criterion/);
  assert.equal(decompose(bare, { lint: 'warn' }).warnings.length, 3);
  const phase = scope();
  phase.tasks[0].phase = 'someday';
  assert.throws(() => decompose(phase), /unknown phase someday/);
});

test('decompose never writes proofline.json or a signature, and --check reports drift without writing', () => {
  const r = repo();
  const contract = path.join(r, 'proofline.json');
  const before = fs.readFileSync(contract);
  for (const out of ['proofline.json', 'sub/proofline.json', 'proofline.json.sig', 'p.sig']) {
    const res = cli(['contract', 'decompose', SCOPE, '--out', out, '--root', r], r);
    assert.equal(res.status, 3, out);
    assert.match(res.stderr, /never proofline\.json or a signature/);
  }
  assert.deepEqual(fs.readFileSync(contract), before);
  assert.equal(fs.existsSync(path.join(r, 'sub')), false);
  const stale = path.join(r, 'p.json');
  fs.writeFileSync(stale, '{}\n');
  const check = cli(['contract', 'decompose', SCOPE, '--out', 'p.json', '--check', '--root', r], r);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /differs from the scope/);
  assert.equal(fs.readFileSync(stale, 'utf8'), '{}\n');
  assert.equal(cli(['contract', 'decompose', SCOPE, '--out', 'p.json', '--root', r], r).status, 0);
  assert.equal(cli(['contract', 'decompose', SCOPE, '--out', 'p.json', '--check', '--root', r], r).status, 0);
  assert.deepEqual(fs.readFileSync(contract), before);
});

test('the proposal round-trips through contract merge, then validate and coverage pass', () => {
  const r = repo();
  const made = cli(['contract', 'decompose', SCOPE, '--out', 'docs/proposals/example.json', '--root', r], r);
  assert.equal(made.status, 0, made.stderr);
  const proposal = JSON.parse(fs.readFileSync(path.join(r, 'docs/proposals/example.json'), 'utf8'));
  const merged = cli(['contract', 'merge', 'docs/proposals/example.json', '--owners', 'OWNER=alice', '--root', r], r);
  assert.equal(merged.status, 0, merged.stderr);
  const after = fs.readFileSync(path.join(r, 'proofline.json'), 'utf8');
  assert.equal(merged.stdout.trim(), sha256(after));
  const c = JSON.parse(after);
  const want = proposal.tasks.map((t) => ({ ...t, owner: 'alice' }));
  assert.deepEqual(c.tasks.slice(-3), want);
  assert.ok(c.owner_rules.includes(proposal.owner_rules[0]));
  const valid = cli(['contract', 'validate', '--root', r], r);
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.match(valid.stdout, /contract valid/);
  const cov = cli(['contract', 'coverage', REQS, '--root', r], r);
  assert.equal(cov.status, 0, cov.stdout);
  assert.match(cov.stdout, /^REQ-QUALITY EX-01,EX-02,EX-DOCS$/m);
  const again = cli(['contract', 'merge', 'docs/proposals/example.json', '--root', r], r);
  assert.equal(again.status, 3);
  assert.match(again.stderr, /duplicate task id EX-01/);
});
