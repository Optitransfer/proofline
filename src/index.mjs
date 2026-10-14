// Public API used by the CLI and the MCP server.
import fs from 'node:fs';
import path from 'node:path';
import * as C from './contract.mjs';
import * as E from './engine.mjs';
import { record, readLog, verifyChain } from './evidence.mjs';
import { scanForbidden } from './forbidden.mjs';
import { git, readJson } from './util.mjs';
import { resolveBase } from './checks.mjs';

export { C, E };

export function findRoot(start = process.cwd()) {
  const r = git(['rev-parse', '--show-toplevel'], start);
  return r.ok ? r.out : start;
}

export function init(root, { hooks = true, project } = {}) {
  const made = [];
  if (!fs.existsSync(C.contractPath(root))) { C.save(root, C.skeleton(project || path.basename(root))); made.push('proofline.json'); }
  fs.mkdirSync(path.join(root, '.proofline'), { recursive: true });
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
  const n = E.next(root, { owner });
  if (n.task && n.status === 'not_started') { const c = C.load(root);
    const base = resolveBase(root, C.defaultBase(c)) || git(['rev-parse', 'HEAD'], root).out;
    record(root, 'task_started', { task: n.task, base, ...(owner ? { owner } : {}) }); n.status = 'in_progress'; }
  if (n.task) {
    fs.writeFileSync(path.join(root, '.proofline', 'active'), n.task + '\n');
    n.base = readLog(root).find((e) => e.type === 'task_started' && e.data.task === n.task)?.data.base;
    if (n.base) n.brief += `\n\n## Base\nPinned at start: ${n.base}. The pin lives in the local .proofline/ log; in another clone, gate with \`--base ${n.base}\`, or end the task commit message with the trailer \`Proofline-Base: ${n.base}\`.`;
  }
  return n;
}

export const activeTask = (root) => { try { return fs.readFileSync(path.join(root, '.proofline', 'active'), 'utf8').trim() || null; } catch { return null; } };

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

/** pre-commit: forbidden actions + contract weakening in the working tree vs HEAD. Fast. */
export function hookPreCommit(root) {
  const c = C.load(root);
  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
  if (!head.ok) return { ok: true, msg: 'first commit' };
  const f = scanForbidden(root, 'HEAD', { ...C.DEFAULT_FORBIDDEN, ...(c.forbidden || {}) });
  let base = null; const s = git(['show', 'HEAD:proofline.json'], root); if (s.ok) try { base = JSON.parse(s.out); } catch {}
  const w = C.weakenings(base, c);
  const msgs = [...f.map((x) => `forbidden ${x.rule}: ${x.file}: ${x.line} (${x.why})`), ...w.map((x) => `contract weakened: ${x}`)];
  return { ok: msgs.length === 0, msg: msgs.join('\n') };
}

/** pre-push: the active task (or every in-progress task) must gate PASS on this exact HEAD. */
export function hookPrePush(root) {
  const c = C.load(root);
  const errs = C.validate(c);
  if (errs.length) return { ok: false, msg: 'contract invalid:\n' + errs.join('\n') };
  const st = E.taskStatus(root, c);
  const ids = activeTask(root) ? [activeTask(root)] : Object.keys(st).filter((k) => st[k].status === 'in_progress' || st[k].status === 'failed');
  const out = [];
  for (const id of ids) {
    if (!c.tasks.some((t) => t.id === id)) continue;
    const g = E.gate(root, id, { skipTypes: ['pushed'] });
    if (g.decision !== 'PASS') out.push(`${id}: ${g.decision}\n${g.corrective_prompt}`);
  }
  return { ok: out.length === 0, msg: out.join('\n\n') };
}
