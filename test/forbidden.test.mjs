import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanForbidden } from '../src/forbidden.mjs';
import { DEFAULT_FORBIDDEN } from '../src/contract.mjs';
import { repo, write, commitAll, sh } from './helpers.mjs';

const SK = '.' + 'skip'; const NV = '--no-' + 'verify';
const T0 = "import test from 'node:test'; import assert from 'node:assert';\ntest('a', { timeout: 1000 }, () => { assert.equal(1, 1); assert.ok(true); });\n";
const scan = (r, extra = {}) => scanForbidden(r, 'origin/main', { ...DEFAULT_FORBIDDEN, ...extra });

test('detects skip, raised timeout, removed assertions', () => {
  const r = repo({ files: { 'test/a.test.mjs': T0 } });
  write(r, { 'test/a.test.mjs': `import test from 'node:test'; import assert from 'node:assert';\ntest${SK}('a', { timeout: 60000 }, () => { });\n` });
  const rules = scan(r).map((f) => f.rule);
  assert.ok(rules.includes('test_skip_only')); assert.ok(rules.includes('timeout_raise')); assert.ok(rules.includes('assertion_removal'));
});
test('detects deleted tests, --no-verify and bypass env vars', () => {
  const r = repo({ files: { 'test/a.test.mjs': T0 } });
  fs.rmSync(path.join(r, 'test/a.test.mjs'));
  write(r, { 'scripts/push.sh': `HIVEVAULT_ALLOW_PUBLIC_PUSH=1 git push ${NV}\n` });
  const rules = scan(r).map((f) => f.rule);
  for (const k of ['test_file_deletion', 'no_verify', 'bypass_env']) assert.ok(rules.includes(k), k);
});
test('protected values: lowering a test-scale cap is a silent scope cut', () => {
  const r = repo({ files: { 'bench/cfg.mjs': 'export const MAX_NOTES = 50000;\n' } });
  write(r, { 'bench/cfg.mjs': 'export const MAX_NOTES = 10000;\n' });
  const f = scan(r, { protected_values: [{ file: 'bench/cfg.mjs', pattern: 'MAX_NOTES = (\\d+)' }] });
  assert.equal(f[0].rule, 'protected_value'); assert.match(f[0].line, /50000 → 10000/);
});
test('clean diff has no findings', () => {
  const r = repo({ files: { 'test/a.test.mjs': T0 } });
  write(r, { 'src/x.mjs': 'export const x = 1;\n', 'test/b.test.mjs': T0 });
  assert.deepEqual(scan(r), []);
});
