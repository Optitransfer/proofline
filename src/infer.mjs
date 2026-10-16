// Zero-config suite inference. Commands come from the base revision, never from the change under test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, run } from './util.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('./inference.json', import.meta.url), 'utf8'));
const CHANGED = RULES.changed_tests.map((s) => new RegExp(s));

export function inferenceRules() { return RULES; }

export function isChangedTest(file) {
  return CHANGED.some((re) => re.test(file));
}

function rel(dir, name) { return dir ? `${dir}/${name}` : name; }

function hasAt(root, base, file) {
  return git(['cat-file', '-e', `${base}:${file}`], root).ok;
}

function show(root, base, file) {
  const s = git(['show', `${base}:${file}`], root);
  return s.ok ? s.out : null;
}

function readWorktree(root, file) {
  try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; }
}

export function nodeCommand(pkg) {
  const script = pkg?.scripts?.test;
  if (typeof script === 'string' && script.trim()) return script.trim();
  const dev = pkg?.devDependencies || {};
  if (dev.vitest) return RULES.node.fallback_commands.vitest;
  if (dev.jest) return RULES.node.fallback_commands.jest;
  return null;
}

function toolchainOk(bin) {
  if (!bin) return true;
  const r = spawnSync('bash', ['-lc', `command -v ${bin}`], { encoding: 'utf8' });
  return r.status === 0;
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Suites declared by the manifests at `base`. `dir` is a repo-relative directory. */
export function suitesFromBase(root, base, dir = '') {
  const out = [];
  const pkgPath = rel(dir, 'package.json');
  if (hasAt(root, base, pkgPath)) {
    const command = nodeCommand(parseJson(show(root, base, pkgPath)));
    if (command) out.push({ id: 'node', manifest: pkgPath, command, toolchain: null });
  }
  const cargo = rel(dir, 'Cargo.toml');
  if (hasAt(root, base, cargo)) out.push({ id: 'rust', manifest: cargo, command: RULES.rust.command, toolchain: RULES.rust.toolchain });
  const pyIni = rel(dir, 'pytest.ini');
  const pyProj = rel(dir, 'pyproject.toml');
  const pyText = hasAt(root, base, pyProj) ? show(root, base, pyProj) : null;
  if (hasAt(root, base, pyIni) || (pyText && /\[tool\.pytest/.test(pyText))) {
    out.push({ id: 'python', manifest: hasAt(root, base, pyIni) ? pyIni : pyProj, command: RULES.python.command, toolchain: RULES.python.toolchain });
  }
  const gomod = rel(dir, 'go.mod');
  if (hasAt(root, base, gomod)) out.push({ id: 'go', manifest: gomod, command: RULES.go.command, toolchain: RULES.go.toolchain });
  const gradle = rel(dir, 'build.gradle');
  if (hasAt(root, base, gradle)) out.push({ id: 'gradle', manifest: gradle, command: null, toolchain: null });
  const tree = git(['ls-tree', '--name-only', base, dir || '.'], root);
  if (tree.ok && tree.out.split('\n').some((n) => n.endsWith('.sln'))) {
    const file = tree.out.split('\n').find((n) => n.endsWith('.sln'));
    out.push({ id: 'dotnet', manifest: file, command: null, toolchain: null });
  }
  return out;
}

export function changedTests(root, base) {
  const s = git(['diff', '--name-only', base], root);
  const names = s.ok ? s.out.split('\n').filter(Boolean) : [];
  return names.filter(isChangedTest);
}

function scriptOf(text) {
  const v = parseJson(text)?.scripts?.test;
  return typeof v === 'string' ? v : null;
}

/** A test-command change against `base`. The command that runs stays the base command. */
export function testCommandFindings(root, base) {
  const findings = [];
  const push = (file, line) => findings.push({
    rule: 'test_command_changed', file, line,
    why: 'the test command is taken from the base revision',
  });
  const baseScript = scriptOf(show(root, base, 'package.json'));
  const headScript = scriptOf(readWorktree(root, 'package.json'));
  if (baseScript !== headScript && (baseScript !== null || headScript !== null)) {
    push('package.json', `${baseScript ?? ''} -> ${headScript ?? ''}`);
  }
  for (const file of ['Cargo.toml', 'pytest.ini']) {
    const old = show(root, base, file);
    const now = readWorktree(root, file);
    if (old === null && now === null) continue;
    if ((old ?? '').trim() !== (now ?? '').trim()) push(file, 'manifest changed');
  }
  const diff = git(['diff', '--name-only', base, '--', '.github/workflows'], root);
  for (const file of (diff.ok ? diff.out.split('\n').filter(Boolean) : [])) push(file, 'workflow changed');
  return findings;
}

function runCmd(cwd, command) {
  const r = run(command, { cwd, timeoutS: 180 });
  return { exitCode: r.exit, ran: true };
}

function runAtBase(root, base, command) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-infer-'));
  const add = git(['worktree', 'add', '--detach', '--quiet', dir, base], root);
  if (!add.ok) { fs.rmSync(dir, { recursive: true, force: true }); return null; }
  try { return runCmd(dir, command); }
  finally {
    git(['worktree', 'remove', '--force', dir], root);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Infer a receipt with no contract. Nothing inferable returns L0 and exit 2, and does not throw.
 * A missing toolchain is `blocked`, not `pass`.
 */
export function receiptZeroConfig(root, { base } = {}) {
  const l0 = (reason, extra = {}) => ({ level: 'L0', exitCode: 2, reason, suites: [], changed: [], findings: [], ...extra });
  if (!base) return l0('no base revision');
  let suites, changed, findings;
  try {
    suites = suitesFromBase(root, base);
    changed = changedTests(root, base);
    findings = testCommandFindings(root, base);
  } catch (e) {
    return l0(String(e?.message || e));
  }
  if (!suites.length) return { ...l0('nothing inferable'), findings };
  const ran = [];
  for (const s of suites) {
    if (!s.command || (s.toolchain && !toolchainOk(s.toolchain))) {
      ran.push({ ...s, status: 'blocked', ran: false, exitCode: null });
      continue;
    }
    const head = runCmd(root, s.command);
    const baseRun = runAtBase(root, base, s.command);
    ran.push({
      ...s,
      status: head.exitCode === 0 ? 'pass' : 'fail',
      ran: true,
      exitCode: head.exitCode,
      baseExitCode: baseRun ? baseRun.exitCode : null,
    });
  }
  if (!ran.some((s) => s.ran)) {
    return { level: 'L0', exitCode: 0, reason: 'nothing ran', suites: ran, changed, findings };
  }
  return {
    level: 'L1',
    exitCode: ran.some((s) => s.status === 'fail') ? 1 : 0,
    reason: '',
    suites: ran,
    changed,
    findings,
  };
}
