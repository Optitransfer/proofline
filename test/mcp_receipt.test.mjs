import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { receiptZeroConfig } from '../src/infer.mjs';
import { verifyReceipt } from '../src/verify-receipt.mjs';

const BIN = path.resolve(import.meta.dirname, '..', 'bin', 'proofline.mjs');
const sh = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function fixture() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-mcp-'));
  sh(r, ['init', '-q', '-b', 'main']);
  sh(r, ['config', 'user.email', 't@t']);
  sh(r, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(r, 'test'));
  fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }) + '\n');
  fs.writeFileSync(path.join(r, 'test', 'ok.test.mjs'), "import test from 'node:test';\ntest('ok', () => {});\n");
  sh(r, ['add', '-A']);
  sh(r, ['commit', '-q', '-m', 'suite']);
  const base = sh(r, ['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(path.join(r, 'not-json.txt'), 'not json\n');
  return { r, base };
}

function ask(root, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, 'mcp', '--root', root], {
      env: { ...process.env, HIVEVAULT_URL: 'http://127.0.0.1:1', HIVEVAULT_TOKEN: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`mcp timed out\n${out}\n${err}`));
    }, 60000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`mcp exited ${code}\n${out}\n${err}`));
      else resolve(out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    });
    for (const message of messages) child.stdin.write(JSON.stringify(message) + '\n');
    child.stdin.end();
  });
}

test('receipt and verify_receipt are listed and answer over stdio', async () => {
  const { r, base } = fixture();
  const replies = await ask(r, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'receipt', arguments: { task: 'T', base, role: 'claude-code', vault: true } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'verify_receipt', arguments: { path: path.join(r, 'not-json.txt') } } },
  ]);
  assert.equal(replies.length, 4);
  const names = replies[1].result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['contract_create', 'evidence_record', 'gate', 'receipt', 'report', 'status', 'task_next', 'verify', 'verify_receipt']);
  const receipt = JSON.parse(replies[2].result.content[0].text);
  assert.deepEqual(receipt, receiptZeroConfig(r, { base }));
  assert.equal(receipt.level, 'L1');
  assert.equal(receipt.exitCode, 0);
  const checked = JSON.parse(replies[3].result.content[0].text);
  assert.deepEqual(checked, await verifyReceipt(path.join(r, 'not-json.txt'), { root: r }));
  assert.equal(checked.exitCode, 1);
  assert.equal(checked.message, 'envelope is not JSON');
});
