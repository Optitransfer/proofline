import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { record, readLog, verifyChain, logPath } from '../src/evidence.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pl-ev-'));

test('evidence log is hash-chained and verifies', () => {
  const d = dir();
  for (let i = 0; i < 5; i++) record(d, 'x', { i });
  const v = verifyChain(d);
  assert.equal(v.ok, true); assert.equal(v.entries, 5);
  assert.equal(readLog(d)[3].prev, readLog(d)[2].hash);
});

test('editing an entry breaks the chain', () => {
  const d = dir(); record(d, 'gate', { decision: 'FAIL' }); record(d, 'x', {});
  const f = logPath(d); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('FAIL', 'PASS'));
  const v = verifyChain(d); assert.equal(v.ok, false); assert.equal(v.at, 0);
});

test('deleting an entry breaks the chain', () => {
  const d = dir(); record(d, 'a', {}); record(d, 'b', {}); record(d, 'c', {});
  const f = logPath(d); const lines = fs.readFileSync(f, 'utf8').split('\n'); lines.splice(1, 1); fs.writeFileSync(f, lines.join('\n'));
  assert.equal(verifyChain(d).ok, false);
});
