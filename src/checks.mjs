// Deterministic verifiers. Each returns { status: pass|fail|flaky|error|blocked, detail, evidence }.
// "error" means the check could not be run (missing tool/file/base) and leads to BLOCKED, never PASS.
// "blocked" means it must not be run now (a metric on a busy machine) and also leads to BLOCKED.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, git, tail, pick, lastJson, matchAny } from './util.mjs';

/** The machine a metric runs on: 1-minute load average and CPU count. verifyTask takes a replacement as `machine`. */
export const readMachine = () => ({ load1: os.loadavg()[0], cpus: os.cpus().length });

/** `node --version` as the bench command would resolve it (same cwd and env), or null. */
function nodeVersion(root, env) {
  const r = run('node --version', { cwd: root, timeoutS: 30, env });
  return r.exit === 0 ? r.stdout.trim() : null;
}

export const TEST_FILE_RE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[mc]?[jt]sx?$/;
const sub = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

export function resolveBase(root, ref) {
  const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root);
  return r.ok ? r.out : null;
}

/** Changed files between base and the working tree (tracked + untracked). */
export function changedFiles(root, base) {
  const out = new Map();
  const d = git(['diff', '--name-status', '-M', base, '--'], root);
  for (const l of d.out.split('\n').filter(Boolean)) {
    const [st, a, b] = l.split('\t');
    out.set(b || a, st[0]);
  }
  for (const f of git(['ls-files', '--others', '--exclude-standard'], root).out.split('\n').filter(Boolean)) out.set(f, 'A');
  for (const f of [...out.keys()]) if (f.startsWith('.proofline/')) out.delete(f);
  return out;
}

/** Parse a unified diff (-U0) into per-file hunks of added/removed lines. */
export function diffHunks(root, base) {
  const d = git(['diff', '-U0', base, '--'], root).out;
  const files = [];
  let cur = null, hunk = null;
  for (const l of d.split('\n')) {
    if (l.startsWith('diff --git')) { cur = { file: l.split(' b/').pop(), hunks: [] }; files.push(cur); continue; }
    if (!cur) continue;
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('@@')) { hunk = { add: [], del: [] }; cur.hunks.push(hunk); continue; }
    if (!hunk) continue;
    if (l[0] === '+') hunk.add.push(l.slice(1)); else if (l[0] === '-') hunk.del.push(l.slice(1));
  }
  // untracked files count as fully added
  for (const f of git(['ls-files', '--others', '--exclude-standard'], root).out.split('\n').filter(Boolean)) {
    if (f.startsWith('.proofline/')) continue;
    let txt = ''; try { txt = fs.readFileSync(path.join(root, f), 'utf8'); } catch {}
    files.push({ file: f, hunks: [{ add: txt.split('\n'), del: [] }] });
  }
  return files;
}

function runCounted(cmd, root, v) {
  const r = run(cmd, { cwd: root, timeoutS: v.timeout_s || 900, env: v.env });
  const txt = r.stdout + '\n' + r.stderr;
  const num = (k) => { const m = txt.match(new RegExp(`^[#ℹ]\\s*${k}\\s+(\\d+)`, 'm')); return m ? +m[1] : undefined; };
  r.counts = { tests: num('tests'), pass: num('pass'), fail: num('fail'), skipped: num('skipped'), todo: num('todo'), cancelled: num('cancelled') };
  return r;
}

export const FAILING_CAP = 100;
const ANSI_RE = /\x1b\[[0-9;]*m/g;
// TAP: `not ok <n> - <name>`, subtests indented. node writes a `#` inside a name as `\#`, so an unescaped ` #` starts the directive.
const TAP_FAIL_RE = /^\s*not ok\s+\d+(?:\s+-)?(?:\s+(.*))?$/;
const TAP_DIRECTIVE_RE = /(?:^|\s)#\s*(\w*)/;
// spec and dot reporters: `✖ <name> (<ms>ms)`. The duration comes last, except for a todo or skip, which node marks with
// ` # <reason>` (or `# TODO`, `# SKIP`) after it. The `failing tests:` and `Failed tests:` summaries repeat these lines.
const SPEC_FAIL_RE = /^\s*\u2716\s+(.*)\s\(\d+(?:\.\d+)?ms\)(\s+#.*)?$/;

/**
 * Names of the failed tests anywhere in a run's output, in order of first appearance, without repeats, todos or skips.
 * At most `cap` names; `failing_total` is set only when there were more.
 */
export function failingTests(text, cap = FAILING_CAP) {
  const seen = new Set();
  for (const line of String(text).replace(ANSI_RE, '').split(/\r?\n/)) {
    let m = line.match(TAP_FAIL_RE), name;
    if (m) {
      const rest = m[1] || '', d = rest.match(TAP_DIRECTIVE_RE);
      if (!d || !/^(todo|skip)/i.test(d[1])) name = (d ? rest.slice(0, d.index) : rest).replace(/\\([\\#])/g, '$1');
    } else if ((m = line.match(SPEC_FAIL_RE)) && !m[2]) name = m[1];
    if (name && name.trim()) seen.add(name.trim());
  }
  const all = [...seen];
  return all.length > cap ? { failing: all.slice(0, cap), failing_total: all.length } : { failing: all };
}

const ev = (r) => ({ cmd: r.cmd, exit: r.exit, ms: r.ms, counts: r.counts, timedOut: r.timedOut, ...failingTests(r.stdout + '\n' + r.stderr), out_tail: tail(r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : ''), 1200) });
/** "12 tests failed: a, b, ... and 2 more" from a run's evidence (first 10 names), or '' when it names none. */
const named = (e) => {
  const n = e.failing_total ?? e.failing.length, show = e.failing.slice(0, 10);
  return n ? `${n} test${n === 1 ? '' : 's'} failed: ${show.join(', ')}${n > show.length ? ` and ${n - show.length} more` : ''}` : '';
};

export const verifiers = {
  command(v, ctx) {
    const expect = v.expect_exit ?? 0;
    let r = runCounted(v.cmd, ctx.root, v);
    const first = ev(r), firstExit = r.exit;
    if (r.exit === 127) return { status: 'error', detail: `command not found: ${v.cmd}`, evidence: first };
    const tooMany = (r2) => {
      const c = r2.counts; const p = [];
      if ((c.cancelled || 0) > 0) p.push(`${c.cancelled} cancelled/hung`);
      if (v.max_skipped !== undefined && (c.skipped || 0) + (c.todo || 0) > v.max_skipped) p.push(`${(c.skipped || 0) + (c.todo || 0)} skipped/todo > allowed ${v.max_skipped}`);
      if (v.min_tests !== undefined && (c.tests ?? c.pass ?? 0) < v.min_tests) p.push(`only ${c.tests ?? c.pass ?? 0} tests ran, contract requires ≥ ${v.min_tests} (tests deleted or not discovered?)`);
      return p;
    };
    if (r.exit === expect && !tooMany(r).length) return { status: 'pass', detail: `exit ${r.exit} in ${r.ms} ms`, evidence: first };
    if (r.exit === expect) return { status: 'fail', detail: [...tooMany(r), named(first)].filter(Boolean).join('; '), evidence: first };
    // Both runs keep their failing names: on a flaky result the first run's list is the tests that flapped.
    for (let i = 0; i < (ctx.flakyReruns ?? 1); i++) {
      r = runCounted(v.cmd, ctx.root, v);
      if (r.exit === expect && !tooMany(r).length) return { status: 'flaky', detail: `failed (exit ${firstExit}${named(first) ? `; ${named(first)}` : ''}) then passed on re-run ${i + 1}: flaky, not a pass. Root-cause the non-determinism.`, evidence: { first, rerun: ev(r) } };
    }
    const rerun = ev(r), n = named(rerun.failing.length ? rerun : first);
    return { status: 'fail', detail: `exit ${r.exit} (expected ${expect})${r.timedOut ? ', timed out' : ''}; failed again on re-run, so it is real${n ? `; ${n}` : ''}`, evidence: { first, rerun } };
  },

  file_exists(v, ctx) {
    return fs.existsSync(path.join(ctx.root, v.path)) ? { status: 'pass', detail: `${v.path} exists` } : { status: 'fail', detail: `${v.path} does not exist in the repo` };
  },

  test_exists(v, ctx) {
    const f = path.join(ctx.root, v.test_file);
    if (!fs.existsSync(f)) return { status: 'fail', detail: `test file ${v.test_file} not found` };
    if (v.test_name && !fs.readFileSync(f, 'utf8').includes(v.test_name)) return { status: 'fail', detail: `test "${v.test_name}" not found in ${v.test_file}` };
    return { status: 'pass', detail: 'test present' };
  },

  /** The test must exist now, FAIL at the base revision (with the new test copied in), and PASS now. */
  test_red_green(v, ctx) {
    const exists = verifiers.test_exists(v, ctx);
    if (exists.status !== 'pass') return exists;
    if (!ctx.base) return { status: 'error', detail: 'base revision unresolved; cannot prove red-green' };
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'proofline-base-'));
    try {
      const add = git(['worktree', 'add', '--detach', '--force', wt, ctx.base], ctx.root);
      if (!add.ok) return { status: 'error', detail: `git worktree add failed: ${add.err}` };
      for (const f of [v.test_file, ...(v.support_files || [])]) {
        fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
        fs.copyFileSync(path.join(ctx.root, f), path.join(wt, f));
      }
      if (v.setup) run(v.setup, { cwd: wt, timeoutS: 900 });
      const cmd = sub(v.cmd, { test: v.test_file, name: v.test_name || '' });
      const red = runCounted(cmd, wt, v);
      const green = runCounted(cmd, ctx.root, v);
      const evd = { base: ctx.base, red: ev(red), green: ev(green) };
      if (red.exit === 127 || green.exit === 127) return { status: 'error', detail: 'test command not found', evidence: evd };
      if (red.exit === 0) return { status: 'fail', detail: `test PASSES on base ${ctx.base.slice(0, 8)} without the change: it does not prove the change (tests how, not what?)`, evidence: evd };
      if (green.exit !== 0) return { status: 'fail', detail: `test fails on the current tree (exit ${green.exit})`, evidence: evd };
      if (v.test_name && !(green.stdout + green.stderr).includes(v.test_name)) return { status: 'fail', detail: `"${v.test_name}" did not appear in the run output: it was not executed`, evidence: evd };
      return { status: 'pass', detail: `red on base (exit ${red.exit}), green now`, evidence: evd };
    } finally {
      git(['worktree', 'remove', '--force', wt], ctx.root);
      fs.rmSync(wt, { recursive: true, force: true });
    }
  },

  metric(v, ctx) {
    // One bench run serves every metric criterion that uses the same command (benches are slow).
    // The load is read before the run: a number taken on a busy machine is not evidence either way.
    ctx.cmdCache ??= {};
    const ck = v.cmd + JSON.stringify(v.env || {});
    const max = ctx.contract?.defaults?.max_load_per_cpu;
    const { r, machine } = ctx.cmdCache[ck] ??= (() => {
      const m = (ctx.machine || readMachine)();
      const machine = { load1: m.load1, cpus: m.cpus, load_per_cpu: +(m.load1 / Math.max(1, m.cpus)).toFixed(2), node: nodeVersion(ctx.root, v.env) };
      if (typeof max === 'number' && m.load1 / Math.max(1, m.cpus) > max) return { r: null, machine };
      return { r: run(v.cmd, { cwd: ctx.root, timeoutS: v.timeout_s || 1800, env: v.env }), machine };
    })();
    const on = `load ${machine.load1.toFixed(2)} / ${machine.cpus} CPUs, node ${machine.node || 'not found'}`;
    if (!r) return { status: 'blocked', detail: `machine busy: load ${machine.load1.toFixed(2)} over ${machine.cpus} CPUs = ${machine.load_per_cpu.toFixed(2)} per CPU > max_load_per_cpu ${max}; the bench was not run. Re-run when the machine is idle.`, evidence: { cmd: v.cmd, machine } };
    let data;
    if (v.output_file) { try { data = JSON.parse(fs.readFileSync(path.resolve(ctx.root, sub(v.output_file, process.env)), 'utf8')); } catch {} }
    else data = lastJson(r.stdout);
    const e = { cmd: v.cmd, exit: r.exit, ms: r.ms, machine, out_tail: tail(r.stdout + r.stderr, 800) };
    if (r.exit === 127) return { status: 'error', detail: `bench command not found: ${v.cmd} (is the bench rig committed in the repo?)`, evidence: e };
    if (data === undefined) return { status: 'error', detail: `no JSON output from bench (exit ${r.exit})`, evidence: e };
    const val = pick(data, v.key);
    e.key = v.key; e.measured = val; e.threshold = `${v.op} ${v.value}`;
    if (typeof val !== 'number') return { status: 'error', detail: `metric ${v.key} missing from bench output`, evidence: e };
    const ok = { '<': val < v.value, '<=': val <= v.value, '>': val > v.value, '>=': val >= v.value, '==': val === v.value }[v.op];
    const name = v.name || v.key;
    ctx.measured[name] = val;
    const b = ctx.baseline?.[name];
    let reg = '';
    if (typeof b === 'number' && b !== 0) {
      const tol = (ctx.tolerancePct ?? 20) / 100;
      const worse = v.op.startsWith('<') ? val > b * (1 + tol) : v.op.startsWith('>') ? val < b * (1 - tol) : false;
      e.baseline = b;
      if (worse) reg = ` REGRESSION vs baseline ${b} (> ${ctx.tolerancePct ?? 20}%)`;
    }
    if (!ok) return { status: 'fail', detail: `${name} = ${val}, needs ${v.op} ${v.value}${reg} (${on})`, evidence: e };
    if (reg) return { status: 'fail', detail: `${v.key} = ${val} meets threshold but${reg} (${on})`, evidence: e };
    return { status: 'pass', detail: `${v.key} = ${val} ${v.op} ${v.value} (${on})`, evidence: e };
  },

  grep(v, ctx) {
    const f = path.join(ctx.root, v.file);
    if (!fs.existsSync(f)) return { status: 'fail', detail: `${v.file} not found` };
    const txt = fs.readFileSync(f, 'utf8');
    const re = new RegExp(v.pattern, v.flags || 'm');
    const m = txt.match(re);
    const want = (v.must || 'present') === 'present';
    if (!!m === want) return { status: 'pass', detail: `/${v.pattern}/ ${want ? 'present' : 'absent'} in ${v.file}`, evidence: m ? { line: txt.slice(0, m.index).split('\n').length, text: m[0] } : undefined };
    return { status: 'fail', detail: `/${v.pattern}/ ${want ? 'NOT found' : 'still present'} in ${v.file}${v.why ? ` (${v.why})` : ''}` };
  },

  /** The symbol must be referenced (not just defined) in a file reachable by static imports from the default entry point. */
  wiring(v, ctx) {
    const entry = path.join(ctx.root, v.entry);
    if (!fs.existsSync(entry)) return { status: 'fail', detail: `entry ${v.entry} not found` };
    const seen = new Map([[entry, null]]); const q = [entry];
    const exts = ['', '.mjs', '.js', '.cjs', '.ts', '/index.mjs', '/index.js', '/index.ts'];
    const defRe = new RegExp(`(function\\*?|class|const|let|var)\\s+${v.symbol}\\b|^\\s*(async\\s+)?${v.symbol}\\s*\\([^)]*\\)\\s*\\{`, 'm');
    const useRe = new RegExp(`\\b${v.symbol}\\b`);
    while (q.length) {
      const f = q.shift(); let src = '';
      try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const uses = src.split('\n').filter((l) => useRe.test(l) && !defRe.test(l) && !/^\s*(\/\/|\*|import\b|export\s*\{)/.test(l));
      if (uses.length) {
        const chain = []; for (let x = f; x; x = seen.get(x)) chain.unshift(path.relative(ctx.root, x));
        return { status: 'pass', detail: `${v.symbol} used on the default path: ${chain.join(' → ')}`, evidence: { chain, line: uses[0].trim().slice(0, 200) } };
      }
      for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|require\(\s*['"](\.[^'"]+)['"]\s*\)|^\s*import\s+['"](\.[^'"]+)['"]/gm)) {
        const spec = m[1] || m[2] || m[3] || m[4];
        for (const e of exts) {
          const p = path.resolve(path.dirname(f), spec + e);
          if (fs.existsSync(p) && fs.statSync(p).isFile()) { if (!seen.has(p)) { seen.set(p, f); q.push(p); } break; }
        }
      }
    }
    return { status: 'fail', detail: `${v.symbol} is not referenced from the default path (${v.entry}; ${seen.size} files reachable). Built but not wired in.` };
  },

  scope(v, ctx) {
    if (!ctx.base) return { status: 'error', detail: 'base unresolved; cannot compute scope' };
    const allow = v.allow || ctx.task.scope?.allow || ['**'];
    const out = [...ctx.changed.keys()].filter((f) => !matchAny(f, allow));
    return out.length ? { status: 'fail', detail: `changes outside the approved scope: ${out.join(', ')}`, evidence: { outside: out, allow } } : { status: 'pass', detail: `${ctx.changed.size} changed files, all in scope` };
  },

  docs(v, ctx) {
    const r = run(v.cmd, { cwd: ctx.root, timeoutS: v.timeout_s || 300 });
    if (r.exit !== 0) return { status: r.exit === 127 ? 'error' : 'fail', detail: `docs generator exit ${r.exit}`, evidence: ev(r) };
    const st = git(['status', '--porcelain', '--', ...v.paths], ctx.root).out;
    return st ? { status: 'fail', detail: `generated docs differ from what is committed:\n${st}`, evidence: { changed: st } } : { status: 'pass', detail: 'docs regenerated, no diff' };
  },

  pushed(v, ctx) {
    const branch = v.branch || ctx.contract.defaults?.branch || 'main';
    const remote = v.remote || ctx.contract.defaults?.remote || 'origin';
    const dirty = git(['status', '--porcelain'], ctx.root).out.split('\n').filter((l) => l && !l.includes('.proofline/'));
    if (dirty.length) return { status: 'fail', detail: `working tree not clean (${dirty.length} paths); work held locally`, evidence: { dirty: dirty.slice(0, 20) } };
    const head = git(['rev-parse', 'HEAD'], ctx.root).out;
    const ls = git(['ls-remote', remote, `refs/heads/${branch}`], ctx.root);
    if (!ls.ok) return { status: 'error', detail: `cannot reach ${remote}: ${ls.err}` };
    const rh = ls.out.split(/\s/)[0];
    return rh === head ? { status: 'pass', detail: `HEAD ${head.slice(0, 8)} is ${remote}/${branch}` } : { status: 'fail', detail: `HEAD ${head.slice(0, 8)} not pushed: ${remote}/${branch} is ${(rh || 'missing').slice(0, 8)}` };
  },
};
