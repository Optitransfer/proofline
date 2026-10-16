// Public API used by the CLI and the MCP server.
import fs from 'node:fs';
import path from 'node:path';
import * as C from './contract.mjs';
import * as E from './engine.mjs';
import { record, readLog, verifyChain } from './evidence.mjs';
import { scanForbidden } from './forbidden.mjs';
import { spawnSync } from 'node:child_process';
import { git, readJson, approvalMarker } from './util.mjs';
import { resolveBase } from './checks.mjs';

export { C, E };

export function findRoot(start = process.cwd()) {
  const r = git(['rev-parse', '--show-toplevel'], start);
  return r.ok ? r.out : start;
}

export function init(root, { hooks = true, project, approvals } = {}) {
  const made = [];
  if (!fs.existsSync(C.contractPath(root))) { C.save(root, C.skeleton(project || path.basename(root))); made.push('proofline.json'); }
  fs.mkdirSync(path.join(root, '.proofline'), { recursive: true });
  if (approvals !== undefined) {
    if (typeof approvals !== 'string' || !approvals.trim()) throw new Error('--approvals needs a directory');
    const cfg = path.join(root, '.proofline', 'config.json');
    let cur = {}; try { cur = JSON.parse(fs.readFileSync(cfg, 'utf8')); } catch { cur = {}; }
    cur.approvals = path.resolve(approvals);
    fs.writeFileSync(cfg, JSON.stringify(cur, null, 2) + '\n');
    made.push('.proofline/config.json');
  }
  const gi = path.join(root, '.gitignore');
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!/^\.proofline\/?$/m.test(cur)) { fs.appendFileSync(gi, (cur && !cur.endsWith('\n') ? '\n' : '') + '.proofline/\n'); made.push('.gitignore'); }
  if (hooks) made.push(...installHooks(root));
  record(root, 'init', { made });
  return { root, made };
}

const HOOK_MARK = '# installed by proofline';
export const PREV_SUFFIX = '.proofline-prev';

/**
 * The hook script. A hook that was there before init is kept as <hook>.proofline-prev and runs first,
 * with the same arguments and stdin; if it fails, its exit code stands and the gate does not run.
 * No bypass variable is read here, by design.
 */
export function hookScript(h, node = process.execPath, bin = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'proofline.mjs')) {
  const gate = `"${node}" "${bin}" hook ${h} "$@"`;
  return [
    '#!/bin/sh',
    `${HOOK_MARK}; there is no skip/bypass variable`,
    `# If a ${h} hook was here before init, it was kept as ${h}${PREV_SUFFIX}: it runs first, and its refusal stands.`,
    `prev="$(dirname "$0")/${h}${PREV_SUFFIX}"`,
    'if [ -x "$prev" ]; then',
    '  input="$(mktemp)" || exit 1',
    `  trap 'rm -f "$input"' EXIT`,
    '  cat > "$input"',
    `  "$prev" "$@" < "$input" || { rc=$?; echo "proofline: ${h}${PREV_SUFFIX} refused (exit $rc)" >&2; exit $rc; }`,
    `  ${gate} < "$input"`,
    '  exit $?',
    'fi',
    `exec ${gate}`,
    '',
  ].join('\n');
}

export function installHooks(root) {
  const hd = git(['rev-parse', '--git-path', 'hooks'], root);
  if (!hd.ok) return [];
  const dir = path.resolve(root, hd.out);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const h of ['pre-commit', 'pre-push']) {
    const f = path.join(dir, h), prev = f + PREV_SUFFIX;
    let cur = null; try { cur = fs.readFileSync(f, 'utf8'); } catch {}
    if (cur !== null && !cur.includes(HOOK_MARK)) {
      // Never lose a hook: if both slots are taken by foreign hooks, stop and let the owner merge them.
      if (fs.existsSync(prev)) throw new Error(`${f} and ${prev} both exist and neither is proofline's; merge them into one, then run init again`);
      fs.renameSync(f, prev);
      out.push(`hooks/${h}${PREV_SUFFIX} (the existing ${h} hook, kept; it runs before the proofline gate)`);
    }
    fs.writeFileSync(f, hookScript(h), { mode: 0o755 });
    fs.chmodSync(f, 0o755);
    out.push(`hooks/${h}`);
  }
  return out;
}

export function contractCreate(root, spec) {
  const c = C.load(root);
  if (c.tasks.some((t) => t.id === spec.id)) throw new Error(`task ${spec.id} exists; contracts are amended by the owner, not overwritten`);
  const t = C.makeTask(spec);
  c.tasks.push(t);
  const errs = C.validate(c);
  C.save(root, c);
  record(root, 'contract_task_added', { task: t.id, hash: C.contractHash(c), valid: !errs.length });
  return { task: t, valid: errs.length === 0, problems: errs };
}

export function taskNext(root, { owner } = {}) {
  const settled = settleLanded(root);
  let c;
  try { c = C.load(root); } catch { c = { tasks: [] }; }
  const n = E.next(root, { owner, skip: c.tasks.map((t) => t.id).filter((id) => landedWhy(root, id)) });
  if (n.task && n.status === 'not_started') { const loaded = C.load(root);
    const base = resolveBase(root, C.defaultBase(loaded)) || git(['rev-parse', 'HEAD'], root).out;
    record(root, 'task_started', { task: n.task, base, ...(owner ? { owner } : {}) }); n.status = 'in_progress'; }
  if (n.task) {
    fs.writeFileSync(path.join(root, '.proofline', 'active'), n.task + '\n');
    n.base = readLog(root).find((e) => e.type === 'task_started' && e.data.task === n.task)?.data.base;
    if (n.base) n.brief += `\n\n## Base\nPinned at start: ${n.base}. The pin lives in the local .proofline/ log; in another clone, gate with \`--base ${n.base}\`, or end the task commit message with the trailer \`Proofline-Base: ${n.base}\`.`;
  }
  if (settled) {
    n.landed = settled.message;
    if (n.brief) n.brief = `${settled.message}\n\n${n.brief}`;
    else n.message = n.message ? `${settled.message}\n\n${n.message}` : settled.message;
  }
  return n;
}

export const activeTask = (root) => { try { return fs.readFileSync(path.join(root, '.proofline', 'active'), 'utf8').trim() || null; } catch { return null; } };

const activePath = (root) => path.join(root, '.proofline', 'active');

/** Task id named by a commit message: a (TASK-ID) subject suffix, else a Proofline-Task trailer. */
export function taskFromMessage(body, known) {
  const subject = String(body || '').split('\n')[0];
  const m = subject.match(/\(([A-Za-z][A-Za-z0-9-]*)\)\s*$/);
  if (m && known.has(m[1])) return m[1];
  const last = String(body || '').trim().split(/\n[ \t]*\n/).pop() || '';
  for (const line of last.split('\n')) {
    const t = line.match(/^Proofline-Task:[ \t]*(\S+)\s*$/);
    if (t && known.has(t[1])) return t[1];
  }
  return null;
}

/** Newest commit on origin/main that names `id`, or null. */
function namedHeadOnMain(root, id) {
  const log = git(['log', 'origin/main', '-z', '--format=%H%x1f%B'], root);
  if (!log.ok || !log.out) return null;
  const known = new Set([id]);
  for (const rec of log.out.split('\0')) {
    const i = rec.indexOf('\x1f');
    if (i < 0) continue;
    const sha = rec.slice(0, i).trim();
    if (taskFromMessage(rec.slice(i + 1), known)) return sha;
  }
  return null;
}

/**
 * A pushed criterion PASS in the latest report.
 * A PASS recorded at an older HEAD is stale once the task has new commits, so it does not count as landed.
 * A report with no head (a recorded PASS and nothing else) still counts.
 */
function pushedPass(root, id) {
  let head = null;
  let pass = false;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, '.proofline', 'reports', `${id}-latest.json`), 'utf8'));
    pass = (j.results || []).some((r) => r.type === 'pushed' && r.status === 'pass');
    if (typeof j.head === 'string' && /^[0-9a-f]{40}$/.test(j.head)) head = j.head;
  } catch { return false; }
  if (!pass) return false;
  if (!head) {
    const log = readLog(root);
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.type === 'gate' && e.data?.task === id && /^[0-9a-f]{40}$/.test(e.data.head || '')) { head = e.data.head; break; }
    }
  }
  if (!head) return true;
  return git(['rev-parse', 'HEAD'], root).out === head;
}

/** Why an active task has landed, or null. Does not touch the active file. */
export function landedWhy(root, id) {
  let c;
  try { c = C.load(root); } catch { return null; }
  if (!c.tasks?.some((t) => t.id === id)) return null;
  const sha = namedHeadOnMain(root, id);
  if (sha) return { kind: 'head', sha };
  if (pushedPass(root, id)) return { kind: 'pushed' };
  return null;
}

function landedMessage(id, why) {
  if (why.kind === 'head') return `${id} landed: its head ${why.sha.slice(0, 8)} is an ancestor of origin/main. Cleared .proofline/active.`;
  return `${id} landed: its pushed criterion has a PASS record. Cleared .proofline/active.`;
}

/** Clear .proofline/active when that task has landed. Returns the sentence to report, or null. */
export function settleLanded(root) {
  const id = activeTask(root);
  if (!id) return null;
  const why = landedWhy(root, id);
  if (!why) return null;
  fs.rmSync(activePath(root), { force: true });
  return { task: id, message: landedMessage(id, why) };
}

function commitsOnPushLine(root, line) {
  const p = line.trim().split(/\s+/);
  if (p.length < 4) return [];
  const local = p[1];
  const remote = p[3];
  if (!/^[0-9a-f]{40}$/i.test(local) || /^0+$/.test(local)) return [];
  const spec = /^0+$/.test(remote) ? [local, '--not', '--remotes'] : [`${remote}..${local}`];
  const r = git(['rev-list', ...spec], root);
  if (!r.ok || !r.out) return [];
  return r.out.split('\n').filter(Boolean);
}

export function evidenceRecord(root, type, data, actor = 'agent') {
  // Agent-recorded evidence is stored as a claim-class event; it is never used to pass a gate.
  return record(root, `agent_${type}`, data, { actor });
}

/** Task and phase status; with `owner`, that owner's tasks and unowned ones (phases counted over them). */
export function status(root, { owner } = {}) {
  const all = C.load(root);
  C.checkOwner(all, owner);
  const c = owner ? { ...all, tasks: all.tasks.filter((t) => C.inLane(t, owner)) } : all;
  return { project: c.project, ...(owner ? { owner } : {}), tasks: E.taskStatus(root, c), phases: E.phaseStatus(root, c), chain: verifyChain(root), active: activeTask(root) };
}

/** Brief for one task, with the base verify and gate will use (`base`: as --base); with `owner`, another owner's task is refused. */
export function taskBrief(root, id, { owner, base } = {}) {
  const c = C.load(root);
  C.checkOwner(c, owner);
  const t = c.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`unknown task ${id}`);
  if (!C.inLane(t, owner)) throw new Error(`task ${id} is owned by ${t.owner}, not ${owner}`);
  return E.brief(c, t) + '\n\n' + E.baseBrief(root, c, t, base);
}

export function report(root, taskId) {
  const f = path.join(root, '.proofline', 'reports', `${taskId}-latest.md`);
  if (!fs.existsSync(f)) return { error: `no gate report for ${taskId}; run gate first` };
  return { markdown: fs.readFileSync(f, 'utf8'), json: readJson(path.join(root, '.proofline', 'reports', `${taskId}-latest.json`)) };
}

/** Bytes of the staged proofline.json, or null when it is not in the index. */
function stagedContract(root) {
  const r = spawnSync('git', ['cat-file', 'blob', ':proofline.json'], { cwd: root, maxBuffer: 64 << 20 });
  return r.status === 0 ? r.stdout : null;
}

/** Directory from `init --approvals`, stored in .proofline/config.json. Null when unset. */
export function approvalsDir(root) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(root, '.proofline', 'config.json'), 'utf8'));
    return typeof c.approvals === 'string' && c.approvals.trim() ? c.approvals : null;
  } catch { return null; }
}

/** pre-commit: forbidden actions + contract weakening of the staged contract vs HEAD. Fast.
 *  A weakening passes only when an approval marker named with the sha256 of those bytes exists.
 *  What else is staged does not matter. There is no bypass. */
export function hookPreCommit(root) {
  // Do not clear here. The commit under way is not HEAD yet, so a PASS recorded at the
  // current head would look landed and the active task would be dropped before its own commit.
  const c = C.load(root);
  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
  if (!head.ok) return { ok: true, msg: 'first commit' };
  const f = scanForbidden(root, 'HEAD', { ...C.DEFAULT_FORBIDDEN, ...(c.forbidden || {}) });
  const staged = stagedContract(root);
  let w = [];
  let note = '';
  if (staged) {
    let cur; try { cur = JSON.parse(staged.toString('utf8')); } catch { return { ok: false, msg: 'staged proofline.json is not valid JSON' }; }
    let base = null; const s = git(['show', 'HEAD:proofline.json'], root); if (s.ok) try { base = JSON.parse(s.out); } catch {}
    w = C.weakenings(base, cur);
    if (w.length) {
      // Same check as verify and gate: a regular file named with the sha256 of these bytes.
      const mark = approvalMarker(root, staged);
      if (mark.approved) w = [];
      else note = [`sha256 ${mark.hex}`, mark.marker ? `marker ${mark.marker}` : 'marker (no approvals directory configured)'].join('\n');
    }
  } else if (git(['cat-file', '-e', 'HEAD:proofline.json'], root).ok) {
    // Removed from the index. There are no staged bytes, so no marker name can approve the removal.
    let base = null; const s = git(['show', 'HEAD:proofline.json'], root); if (s.ok) try { base = JSON.parse(s.out); } catch {}
    w = C.weakenings(base, { tasks: [] });
    note = 'staged proofline.json is absent, so no approval marker can be bound to its bytes';
  }
  const problems = [...f.map((x) => `forbidden ${x.rule}: ${x.file}: ${x.line} (${x.why})`), ...w.map((x) => `contract weakened: ${x}`), ...(note ? [note] : [])];
  return { ok: problems.length === 0, msg: problems.join('\n') };
}

/**
 * pre-push. A push is gated on the task its commits name ((TASK-ID) subject suffix or Proofline-Task trailer).
 * A commit that names none falls back to the active task. No active task and no named task is a refusal
 * that prints `proofline next`. An active task that has landed is cleared and never gated.
 * With no push lines (a direct call), the previous rule stands: the active task, else every in-progress or failed task.
 */
export function hookPrePush(root, { lines } = {}) {
  const settled = settleLanded(root);
  const c = C.load(root);
  const errs = C.validate(c);
  const note = settled?.message || '';
  const join = (...parts) => parts.flat().filter(Boolean).join('\n\n');
  if (errs.length) return { ok: false, msg: join(note, 'contract invalid:\n' + errs.join('\n')) };
  const haveLines = Array.isArray(lines) && lines.some((l) => l.trim());
  let ids = null;
  let refuse = '';
  if (haveLines) {
    const known = new Set(c.tasks.map((t) => t.id));
    const commits = [...new Set(lines.flatMap((l) => commitsOnPushLine(root, l)))];
    if (commits.length) {
      const named = [];
      let unnamed = false;
      for (const sha of commits) {
        const body = git(['log', '-1', '--format=%B', sha], root).out || '';
        const id = taskFromMessage(body, known);
        if (id) named.push(id);
        else unnamed = true;
      }
      const namedSet = new Set(named);
      ids = [...namedSet];
      const active = activeTask(root);
      if (unnamed && active && !landedWhy(root, active)) ids.push(active);
      if (!ids.length) {
        const started = readLog(root).some((e) => e.type === 'task_started');
        if (!started) {
          return { ok: true, msg: join(note, 'No task has a start record. Next step: proofline next') };
        }
        refuse = 'no active task and no commit names a task.\nNext step: proofline next';
      }
    }
  }
  if (!ids) {
    const st = E.taskStatus(root, c);
    const active = activeTask(root);
    ids = active ? [active] : Object.keys(st).filter((k) => st[k].status === 'in_progress' || st[k].status === 'failed');
    ids = ids.filter((id) => !landedWhy(root, id));
  }
  if (refuse) return { ok: false, msg: join(note, refuse) };
  const out = [];
  for (const id of ids) {
    if (!c.tasks.some((t) => t.id === id)) continue;
    const g = E.gate(root, id, { skipTypes: ['pushed'] });
    if (g.decision !== 'PASS') out.push(`${id}: ${g.decision}\n${g.corrective_prompt}`);
  }
  return { ok: out.length === 0, msg: join(note, out.join('\n\n')) };
}
