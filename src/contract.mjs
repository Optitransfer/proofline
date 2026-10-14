// Contract + plan model: proofline.json at the repo root (committed).
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, sha256, canon } from './util.mjs';

export const SCHEMA = 'proofline/1';
export const PHASES = ['intake', 'design', 'plan', 'implement', 'verify', 'integrate', 'release', 'monitor'];
export const VERIFIERS = ['command', 'test_red_green', 'test_exists', 'metric', 'grep', 'wiring', 'scope', 'docs', 'pushed', 'file_exists'];
export const STATUS = {
  PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED',
};
// Task status vocabulary (derived, never self-declared)
export const TASK_STATUS = ['not_started', 'in_progress', 'verified', 'failed', 'blocked'];

export const DEFAULT_FORBIDDEN = {
  test_skip_only: true,          // .skip( .only( {skip: test.todo  it.skip  xit(
  timeout_raise: true,           // any numeric timeout increased in the diff
  assertion_removal: true,       // net loss of assert/expect lines in test files
  test_file_deletion: true,      // deleted test files
  no_verify: true,               // --no-verify / -n on git commit|push in added lines
  bypass_env: ['HIVEVAULT_ALLOW_PUBLIC_PUSH', 'SKIP_HOOKS', 'HUSKY=0', 'PROOFLINE_SKIP', 'CI_SKIP'],
  protected_values: [],          // [{file, pattern (one capture group, a number), direction: "no_decrease"|"no_increase"}]
};

export const contractPath = (root) => path.join(root, 'proofline.json');

export function load(root) {
  const c = readJson(contractPath(root));
  if (!c) throw new Error(`no proofline.json in ${root} (run: proofline init)`);
  return c;
}
export const save = (root, c) => writeJson(contractPath(root), c);
export const contractHash = (c) => sha256(canon(c));

export function skeleton(project = path.basename(process.cwd())) {
  return {
    schema: SCHEMA,
    project,
    owner_rules: [
      'Done means ALL evidence: implemented as specified (task id), a test that FAILED before and passes now, suites green, measured number vs target, docs regenerated, committed AND pushed to main.',
      'Never defer: no "later", "follow-up", "out of scope". If blocked: what blocks, what you tried, what you need; then continue with the next task.',
      'Root cause, then fix: file:line + mechanism. No weakening tests, raising timeouts, skips, relaxed assertions.',
      'No silent scope cuts: never lower targets, caps or test sizes without owner approval.',
      'Never bypass guards: no --no-verify, no bypass env vars, no skip flags.',
      'Deliver continuously: one task per commit, pushed to main as it goes green.',
      'Honest reporting: TASK-ID | status | commit | tests | measured vs target | missing.',
    ],
    defaults: { base: 'origin/main', branch: 'main', flaky_reruns: 1, max_corrective_cycles: 3, regression_tolerance_pct: 20 },
    forbidden: { ...DEFAULT_FORBIDDEN },
    baseline: { metrics: {} },
    phases: PHASES.map((id) => ({ id })),
    tasks: [],
  };
}

/** Turn a task description into a contract task. Criteria that cannot be machine-verified are flagged so freeze refuses. */
export function makeTask({ id, title, phase = 'implement', owner, depends_on = [], requirements = [], description = '', scope = ['**'], criteria = [], stop_rules = [] }) {
  if (!id || !title) throw new Error('task needs id and title');
  return {
    id, title, phase, ...(owner !== undefined ? { owner } : {}), depends_on, requirements, description,
    scope: { allow: scope },
    criteria: criteria.map((c, i) => ({ id: c.id || `${id}-AC${String(i + 1).padStart(2, '0')}`, mandatory: c.mandatory !== false, ...c })),
    stop_rules: stop_rules.length ? stop_rules : ['If any metric misses its threshold: STOP, report the measured number, a per-stage trace and file:line. Do not start the next task.'],
  };
}

const isName = (x) => typeof x === 'string' && x.trim() !== '';

/** A task belongs to an owner's lane when it is theirs or has no owner. No owner given: every task. */
export const inLane = (t, owner) => !owner || t.owner === undefined || t.owner === owner;

/** The remote and branch the work is pushed to, and the default base: defaults.base, else <remote>/<branch>. */
export const remoteOf = (c) => c.defaults?.remote || 'origin';
export const branchOf = (c) => c.defaults?.branch || 'main';
export const defaultBase = (c) => c.defaults?.base || `${remoteOf(c)}/${branchOf(c)}`;

/** An --owner name must be in defaults.owners when the contract has that list. */
export function checkOwner(c, owner) {
  if (owner === undefined) return;
  if (!isName(owner)) throw new Error('--owner needs a name');
  const owners = c.defaults?.owners;
  if (Array.isArray(owners) && !owners.includes(owner)) throw new Error(`owner ${owner} is not in defaults.owners (${owners.join(', ')})`);
}

/** Validation: returns list of problems (empty == valid). */
export function validate(c) {
  const errs = [];
  if (c.schema !== SCHEMA) errs.push(`schema must be ${SCHEMA}`);
  if (c.defaults?.remote !== undefined && !isName(c.defaults.remote)) errs.push('defaults.remote must be a remote name (a string)');
  const maxLoad = c.defaults?.max_load_per_cpu;
  if (maxLoad !== undefined && !(typeof maxLoad === 'number' && maxLoad > 0)) errs.push('defaults.max_load_per_cpu must be a positive number');
  const owners = c.defaults?.owners;
  if (owners !== undefined && !(Array.isArray(owners) && owners.every(isName))) errs.push('defaults.owners must be a list of names');
  const ids = new Set();
  for (const t of c.tasks || []) {
    if (ids.has(t.id)) errs.push(`duplicate task id ${t.id}`);
    ids.add(t.id);
    if (!PHASES.includes(t.phase)) errs.push(`${t.id}: unknown phase ${t.phase}`);
    if (t.owner !== undefined && !isName(t.owner)) errs.push(`${t.id}: owner must be a name`);
    else if (t.owner !== undefined && Array.isArray(owners) && !owners.includes(t.owner)) errs.push(`${t.id}: owner ${t.owner} is not in defaults.owners (${owners.join(', ')})`);
    if (!t.criteria?.length) errs.push(`${t.id}: no acceptance criteria`);
    for (const a of t.criteria || []) {
      const v = a.verifier;
      if (!v || !VERIFIERS.includes(v.type)) { errs.push(`${t.id}/${a.id}: needs a deterministic verifier (one of ${VERIFIERS.join(', ')})`); continue; }
      const need = { command: ['cmd'], test_red_green: ['test_file', 'cmd'], test_exists: ['test_file'], metric: ['cmd', 'key', 'op', 'value'], grep: ['file', 'pattern'], wiring: ['entry', 'symbol'], docs: ['cmd', 'paths'], file_exists: ['path'] }[v.type] || [];
      for (const k of need) if (v[k] === undefined) errs.push(`${t.id}/${a.id}: ${v.type} verifier missing "${k}"`);
      if (v.type === 'metric' && !['<', '<=', '>', '>=', '=='].includes(v.op)) errs.push(`${t.id}/${a.id}: bad op ${v.op}`);
    }
  }
  for (const t of c.tasks || []) for (const d of t.depends_on || []) if (!ids.has(d)) errs.push(`${t.id}: depends on unknown ${d}`);
  if (topo(c.tasks || []) === null) errs.push('dependency cycle in task graph');
  return errs;
}

export function topo(tasks) {
  const by = new Map(tasks.map((t) => [t.id, t])); const out = []; const st = new Map();
  const visit = (id) => {
    if (st.get(id) === 2) return true; if (st.get(id) === 1) return false;
    st.set(id, 1);
    for (const d of by.get(id)?.depends_on || []) if (by.has(d) && !visit(d)) return false;
    st.set(id, 2); out.push(by.get(id)); return true;
  };
  // stable: phase order, then declaration order
  const ordered = [...tasks].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
  for (const t of ordered) if (!visit(t.id)) return null;
  return out;
}

const looser = (op, before, after) => (op.startsWith('<') ? after > before : op.startsWith('>') ? after < before : after !== before);

/** Compare a base contract to the current one: anything weakened needs the owner. */
export function weakenings(base, cur) {
  if (!base) return [];
  const out = [];
  const bt = new Map((base.tasks || []).map((t) => [t.id, t]));
  for (const [id, b] of bt) {
    const t = (cur.tasks || []).find((x) => x.id === id);
    if (!t) { out.push(`task ${id} removed from contract`); continue; }
    for (const a of b.criteria || []) {
      const n = t.criteria.find((x) => x.id === a.id);
      if (!n) { out.push(`${id}/${a.id} criterion removed`); continue; }
      if (a.mandatory && !n.mandatory) out.push(`${id}/${a.id} made non-mandatory`);
      if (a.verifier?.type !== n.verifier?.type) out.push(`${id}/${a.id} verifier type changed ${a.verifier?.type}→${n.verifier?.type}`);
      if (a.verifier?.type === 'metric' && (a.verifier.op !== n.verifier.op || looser(a.verifier.op, a.verifier.value, n.verifier.value)))
        out.push(`${id}/${a.id} threshold loosened ${a.verifier.key} ${a.verifier.op} ${a.verifier.value} → ${n.verifier.op} ${n.verifier.value}`);
      if (a.verifier?.cmd && n.verifier?.cmd && a.verifier.cmd !== n.verifier.cmd) out.push(`${id}/${a.id} command changed: "${a.verifier.cmd}" → "${n.verifier.cmd}"`);
    }
  }
  const bl = base.defaults?.max_load_per_cpu, cl = cur.defaults?.max_load_per_cpu;
  if (typeof bl === 'number' && cl === undefined) out.push(`defaults.max_load_per_cpu removed (was ${bl})`);
  else if (typeof bl === 'number' && !(cl <= bl)) out.push(`defaults.max_load_per_cpu raised ${bl} → ${cl}`);
  const bf = base.forbidden || {}; const cf = cur.forbidden || {};
  for (const k of Object.keys(bf)) if (bf[k] && (cf[k] === false || cf[k] === undefined)) out.push(`forbidden rule ${k} disabled`);
  for (const e of bf.bypass_env || []) if (!(cf.bypass_env || []).includes(e)) out.push(`bypass env ${e} removed from forbidden list`);
  return out;
}

export function loadFile(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
