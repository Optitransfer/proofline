// Opt-in isolation for command, red-green and metric checks.
// Off unless the caller passes isolated, or the process was started with --isolated.
// The image digest lives in the contract under test (a fixture in the TB-06 test), never invented here.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DIGEST = /^node:22\.11\.0@sha256:[0-9a-f]{64}$/;

/** Evasions the static checks do not catch. Each fixture directory uses one of these names. */
export const COVERAGE_LIMITS = [
  'computed-dynamic-import',
  'env-dependent-test',
  'benchmark-code-edited',
  'timeout-raised-through-config',
  'test-removed-by-rename',
  'test-weakened-by-snapshot',
  'suite-command-wrapper',
  'network-dependent-pass',
  'pre-generated-cache',
  'check-reads-contract',
];

export function imageDigest(contract) {
  const image = contract?.env?.image;
  return typeof image === 'string' && DIGEST.test(image) ? image : null;
}

function hasBin(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0;
}

export function runtimeName() {
  if (hasBin('docker')) return 'docker';
  if (hasBin('podman')) return 'podman';
  if (hasBin('bwrap')) return 'bwrap';
  return null;
}

function result(cmd, cwd, started, child) {
  const ms = Math.round(performance.now() - started);
  const timedOut = child.error?.code === 'ETIMEDOUT';
  return {
    cmd, cwd, ms, timedOut,
    exit: timedOut ? 124 : (child.status ?? 1),
    stdout: child.stdout || '',
    stderr: (child.stderr || '') + (child.error && !timedOut ? String(child.error) : ''),
  };
}

/** Run cmd with no network, a fresh HOME, and the repo read-only except declared paths. */
export function runInSandbox(cmd, { cwd, timeoutS = 600, env, image, runtime, writable = [] } = {}) {
  const started = performance.now();
  const extra = Object.entries(env || {}).filter(([k]) => k !== 'NODE_TEST_CONTEXT');
  let args;
  let bin = runtime;
  if (runtime === 'bwrap') {
    args = ['--unshare-net', '--die-with-parent', '--ro-bind', '/', '/', '--ro-bind', cwd, '/work', '--tmpfs', '/tmp', '--chdir', '/work', '--clearenv', '--setenv', 'HOME', '/tmp', '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin'];
    for (const rel of writable) args.push('--bind', path.resolve(cwd, rel), path.posix.join('/work', rel));
    for (const [k, val] of extra) args.push('--setenv', k, String(val));
    args.push('--', 'sh', '-c', cmd);
  } else {
    args = ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp', '-e', 'HOME=/tmp', '-v', `${cwd}:/work:ro`, '-w', '/work'];
    for (const rel of writable) args.push('-v', `${path.resolve(cwd, rel)}:/work/${rel}:rw`);
    for (const [k, val] of extra) args.push('-e', `${k}=${val}`);
    args.push('--entrypoint', 'sh', image, '-c', cmd);
  }
  const child = spawnSync(bin, args, { encoding: 'utf8', timeout: timeoutS * 1000, maxBuffer: 64 << 20 });
  return result(cmd, cwd, started, child);
}

/**
 * Isolation for one verify. Missing env.image refuses and names that item.
 * A runtime is probed only after the caller asked for isolation and the digest is present.
 */
export function resolveIsolation(contract, opts = {}) {
  const requested = opts.isolated === true || (opts.isolated !== false && process.argv.includes('--isolated'));
  if (!requested) return { isolated: false, env_digest: null, block: null, sandbox: null };
  const image = imageDigest(contract);
  if (!image) return { isolated: false, env_digest: null, block: 'env.image is required for --isolated', sandbox: null };
  const cwd = process.cwd();
  const runtime = runtimeName();
  if (!runtime) return { isolated: false, env_digest: null, block: 'no container runtime for --isolated', sandbox: null };
  const sandbox = (cmd, o) => runInSandbox(cmd, { ...o, image, runtime, writable: o.writable || [] });
  const ver = sandbox('node --version', { cwd, timeoutS: 60 });
  const nodeVer = (ver.stdout || '').trim().split('\n')[0] || 'unknown';
  const env_digest = `${image} runtime=${runtime} node=${nodeVer}`;
  return { isolated: true, env_digest, block: null, sandbox };
}
