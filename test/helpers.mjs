import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as P from '../src/index.mjs';

export const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const BIN = path.resolve(import.meta.dirname, '..', 'bin', 'proofline.mjs');

/** Fresh repo with an origin, an initial commit and proofline initialised (no hooks unless asked). */
export function repo({ hooks = false, files = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-test-'));
  const origin = path.join(tmp, 'o.git'), r = path.join(tmp, 'r');
  sh(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(tmp, 'clone', '-q', origin, r);
  sh(r, 'config', 'user.email', 't@t'); sh(r, 'config', 'user.name', 't'); sh(r, 'checkout', '-q', '-b', 'main');
  write(r, { 'package.json': '{ "type": "module" }\n', ...files });
  // The seed commit is the repository, not a task. Hooks go on after it is on origin,
  // so the first push is not refused for naming no task.
  P.init(r, { hooks: false, project: 't' });
  sh(r, 'add', '-A'); sh(r, 'commit', '-q', '--no-verify', '-m', 'init'); sh(r, 'push', '-q', 'origin', 'main');
  if (hooks) P.installHooks(r);
  return r;
}
export function write(r, files) { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), s); } }
export function addTask(r, spec) { const c = P.C.load(r); c.tasks.push(P.C.makeTask(spec)); P.C.save(r, c); }
export function commitAll(r, m = 'wip') { sh(r, 'add', '-A'); sh(r, 'commit', '-q', '--no-verify', '-m', m); }

/** Commit the setup contract and point origin/main at it, so the default base already contains that write. */
export function commitBeforeBase(r) {
  commitAll(r, 'contract');
  const head = sh(r, 'rev-parse', 'HEAD');
  const origin = sh(r, 'remote', 'get-url', 'origin');
  // The bare origin fetches the commit. A client push would run the hook this fixture is not testing.
  sh(origin, 'fetch', '-q', r, 'HEAD:refs/heads/main');
  sh(r, 'update-ref', 'refs/remotes/origin/main', head);
}

/** One empty commit so HEAD~1 is the commit that already holds the setup contract. */
export function parentAfterContract(r) {
  sh(r, 'commit', '-q', '--allow-empty', '-m', 'work');
}
