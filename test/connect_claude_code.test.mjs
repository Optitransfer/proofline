import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const BIN = path.resolve(import.meta.dirname, '..', 'bin', 'proofline.mjs');

function connect(home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, 'connect', 'claude-code'], {
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('connect timed out')); }, 15000);
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}

test('settings merge keeps existing hooks and does not add a second copy', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-claude-'));
  const file = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = {
    model: 'keep',
    hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo start' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'hivevault hook stop' }] }],
    },
  };
  fs.writeFileSync(file, JSON.stringify(before, null, 2) + '\n');
  const first = await connect(home);
  assert.equal(first.code, 0, first.err);
  const merged = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(merged.model, 'keep');
  assert.deepEqual(merged.hooks.SessionStart, before.hooks.SessionStart);
  assert.equal(merged.hooks.Stop.length, 2);
  assert.equal(merged.hooks.Stop[0].hooks[0].command, 'hivevault hook stop');
  assert.equal(merged.hooks.Stop[1].hooks[0].command, 'proofline hook stop');
  const second = await connect(home);
  assert.equal(second.code, 0, second.err);
  const again = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(again.hooks.Stop.length, 2);
});
