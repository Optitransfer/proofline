import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COVERAGE_LIMITS } from '../src/isolate.mjs';

test('each evasion fixture is named in coverage_limits', () => {
  const root = path.resolve(import.meta.dirname, '../fixtures/evasions');
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.ok(dirs.length >= 10, `found ${dirs.length}`);
  for (const name of dirs) {
    assert.ok(COVERAGE_LIMITS.includes(name), `${name} is not named in coverage_limits`);
  }
});
