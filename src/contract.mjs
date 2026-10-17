// Contract + plan model: proofline.json at the repo root (committed).
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, sha256, canon, git, matchAny } from './util.mjs';

export const SCHEMA = 'proofline/1';
export const PHASES = ['intake', 'design', 'plan', 'implement', 'verify', 'integrate', 'release', 'monitor'];
export const VERIFIERS = ['command', 'test_red_green', 'test_exists', 'metric', 'grep', 'wiring', 'scope', 'docs', 'pushed', 'file_exists'];
export const STATUS = {
  PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED',
};
// Task status vocabulary (derived, never self-declared)
export const TASK_STATUS = ['not_started', 'in_progress', 'verified', 'failed', 'blocked'];

/** Stop rules a scaffolded task carries. brief and steer still run when a loaded task has none. */
export const DEFAULT_STOP_RULES = [
  "If a criterion cannot pass without weakening a rule, widening a bypass list, or signing with a key that is not the owner's: STOP and report. Never mark a boundary criterion passed by hand.",
  'If the environment a criterion needs is missing (repository admin, the owner key, a container runtime, OIDC): report BLOCKED with the exact missing item.',
];

const KINDS = ['feature', 'docs', 'release'];

/** A path the scaffold can place inside scope. Prefer `prefer` when it already matches. */
function slotted(allow, prefer) {
  if (matchAny(prefer, allow)) return prefer;
  for (const g of allow) {
    if (g.endsWith('/**')) {
      const p = `${g.slice(0, -3)}/change.test.mjs`;
      if (matchAny(p, allow)) return p;
    }
  }
  return prefer;
}

export const DEFAULT_FORBIDDEN = {
  test_skip_only: true,          // .skip( .only( {skip: test.todo  it.skip  xit(
  timeout_raise: true,           // any numeric timeout increased in the diff
  assertion_removal: true,       // net loss of assert/expect lines in test files
  test_file_deletion: true,      // deleted test files
  no_verify: true,               // --no-verify / -n on git commit|push in added lines
  bypass_env: ['SKIP_HOOKS', 'HUSKY=0', 'PROOFLINE_SKIP', 'CI_SKIP'],
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
      "Done means ALL evidence: implemented as specified (task id), a test that FAILED before and passes now, suites green, measured number vs target, docs regenerated, committed AND pushed to the contract's branch.",
      'Never defer: no "later", "follow-up", "out of scope". If blocked: what blocks, what you tried, what you need; then continue with the next task.',
      'Root cause, then fix: file:line + mechanism. No weakening tests, raising timeouts, skips, relaxed assertions.',
      'No silent scope cuts: never lower targets, caps or test sizes without owner approval.',
      'Never bypass guards: no --no-verify, no bypass env vars, no skip flags.',
      "Deliver continuously: one task per commit, pushed to the contract's branch as it goes green.",
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
    // a spec may give the allow list, or the contract's own shape { allow: [...] }; either way one level of allow
    scope: { allow: Array.isArray(scope) ? scope : Array.isArray(scope?.allow) ? scope.allow : [String(scope)] },
    criteria: criteria.map((c, i) => ({ id: c.id || `${id}-AC${String(i + 1).padStart(2, '0')}`, mandatory: c.mandatory !== false, ...c })),
    stop_rules: stop_rules.length ? stop_rules : ['If any metric misses its threshold: STOP, report the measured number, a per-stage trace and file:line. Do not start the next task.'],
  };
}

/**
 * Print-ready task: standard criteria and the default stop rules, for an agent to fill in.
 * kind feature: a red-then-green test and the suite. docs: a grep. release: one command.
 * Scope and pushed are always present. Does not write the contract.
 */
export function scaffoldTask({ title, scope, kind = 'feature', id = 'TASK' } = {}) {
  if (!title || !String(title).trim()) throw new Error('scaffold needs a title');
  if (!KINDS.includes(kind)) throw new Error('--kind must be feature, docs or release');
  const allow = String(scope ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allow.length) throw new Error('scaffold needs a scope');
  const criteria = [];
  const add = (statement, verifier) => criteria.push({ statement, verifier });
  if (kind === 'docs') {
    const file = allow.find((g) => !/[*?]/.test(g)) || slotted(allow, 'README.md').replace(/change\.test\.mjs$/, 'change.md');
    add('the docs name the change', { type: 'grep', file, pattern: 'CHANGE', must: 'present' });
  } else if (kind === 'release') {
    add('the release check exits 0', { type: 'command', cmd: 'npm test', expect_exit: 0 });
  } else {
    add('the new behavior fails on the base and passes now', { type: 'test_red_green', test_file: slotted(allow, 'test/change.test.mjs'), cmd: 'node --test {test}' });
    add('suite green', { type: 'command', cmd: 'npm test', expect_exit: 0 });
  }
  add('Changes stay in scope', { type: 'scope' });
  add('Committed and pushed to main', { type: 'pushed' });
  return makeTask({ id, title, phase: kind === 'release' ? 'release' : 'implement', scope: allow, criteria, stop_rules: DEFAULT_STOP_RULES });
}

/** Double-quoted `sh -c` / `bash -c` whose quotes contain `$`. The verifier runs bash -c itself, so an outer shell would expand `$` first. */
function expandingShell(cmd) {
  if (typeof cmd !== 'string') return false;
  const m = cmd.match(/(?:^|[;&|]\s*)(?:sh|bash)\s+-c\s+"([^"]*)"/);
  return !!(m && m[1].includes('$'));
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
  const reuse = c.defaults?.reuse_results, maxAge = c.defaults?.reuse_max_age_h;
  if (reuse !== undefined && typeof reuse !== 'boolean') errs.push('defaults.reuse_results must be true or false');
  if (maxAge !== undefined && !(typeof maxAge === 'number' && maxAge > 0)) errs.push('defaults.reuse_max_age_h must be a positive number of hours');
  const owners = c.defaults?.owners;
  if (owners !== undefined && !(Array.isArray(owners) && owners.every(isName))) errs.push('defaults.owners must be a list of names');
  const ids = new Set();
  for (const t of c.tasks || []) {
    if (ids.has(t.id)) errs.push(`duplicate task id ${t.id}`);
    ids.add(t.id);
    if (!PHASES.includes(t.phase)) errs.push(`${t.id}: unknown phase ${t.phase}`);
    if (t.owner !== undefined && !isName(t.owner)) errs.push(`${t.id}: owner must be a name`);
    else if (t.owner !== undefined && Array.isArray(owners) && !owners.includes(t.owner)) errs.push(`${t.id}: owner ${t.owner} is not in defaults.owners (${owners.join(', ')})`);
    if (!(Array.isArray(t.scope?.allow) && t.scope.allow.every((g) => typeof g === 'string' && g))) errs.push(`${t.id}: scope.allow must be a list of path patterns`);
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

/** The shapes contract validate refuses, on top of validate(). The hook keeps validate() so a fixture without these fields still gates. */
function lintErrors(c) {
  const errors = [];
  for (const t of c.tasks || []) {
    if (!Array.isArray(t.stop_rules) || !t.stop_rules.length || t.stop_rules.some((s) => typeof s !== 'string' || !s.trim())) errors.push(`${t.id}: no stop_rules`);
    if (!(t.criteria || []).some((a) => a?.verifier?.type === 'scope')) errors.push(`${t.id}: no scope criterion`);
    const allow = Array.isArray(t.scope?.allow) ? t.scope.allow : [];
    for (const a of t.criteria || []) {
      const v = a.verifier;
      if (!v) continue;
      for (const key of ['file', 'path', 'test_file', 'entry']) {
        const rel = v[key];
        if (typeof rel !== 'string' || !rel || !allow.length) continue;
        if (!matchAny(rel, allow)) errors.push(`${t.id}/${a.id}: ${key} ${rel} is outside scope`);
      }
      if (expandingShell(v.cmd)) errors.push(`${t.id}/${a.id}: command is a double-quoted sh -c or bash -c that contains $`);
    }
  }
  return errors;
}

/** Structural errors from validate, the scaffold lint, and a warning when a grep already matches on the base revision. */
export function lint(c, { root, base } = {}) {
  const errors = [...validate(c), ...lintErrors(c)];
  const warnings = [];
  if (!root || !base) return { errors, warnings };
  const rev = git(['rev-parse', '--verify', `${base}^{commit}`], root);
  if (!rev.ok) return { errors, warnings };
  const sha = rev.out;
  for (const t of c.tasks || []) {
    for (const a of t.criteria || []) {
      const v = a.verifier;
      if (v?.type !== 'grep' || typeof v.file !== 'string' || typeof v.pattern !== 'string') continue;
      const shown = git(['show', `${sha}:${v.file}`], root);
      if (!shown.ok) continue;
      let re;
      try { re = new RegExp(v.pattern, v.flags || 'm'); } catch { continue; }
      if (re.test(shown.out)) warnings.push(`${t.id}/${a.id}: grep /${v.pattern}/ already matches ${v.file} on ${sha}`);
    }
  }
  return { errors, warnings };
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

/** Fields whose canonical bytes differ. This is the refusal. weakenings() stays the explanation. */
export function contractFieldChanges(base, cur) {
  if (!base || !cur) return [];
  if (contractHash(base) === contractHash(cur)) return [];
  const out = [];
  const walk = (a, b, path) => {
    if (Object.is(a, b)) return;
    const aArr = Array.isArray(a);
    const bArr = Array.isArray(b);
    if (aArr || bArr) {
      const left = aArr ? a : [];
      const right = bArr ? b : [];
      const n = Math.max(left.length, right.length);
      for (let i = 0; i < n; i++) {
        const id = (right[i] && right[i].id) || (left[i] && left[i].id) || String(i);
        walk(left[i], right[i], path ? `${path}/${id}` : String(id));
      }
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) walk(a[k], b[k], path ? `${path}/${k}` : k);
      return;
    }
    const shown = (v) => (v === undefined ? "absent" : JSON.stringify(v));
    out.push(`${path}: ${shown(a)} -> ${shown(b)}`);
  };
  walk(base, cur, "");
  return out;
}

export function loadFile(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

/** End index of the JSON array named `key`, so an append can keep every byte before it. */
function arrayEnd(text, key) {
  const marker = `"${key}"`;
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const bracket = text.indexOf('[', at);
  if (bracket < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = bracket; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

function insertValues(text, key, values) {
  if (!values.length) return text;
  const end = arrayEnd(text, key);
  if (end == null) throw new Error(`no ${key} array`);
  const body = text.slice(text.lastIndexOf('[', end) + 1, end);
  const lines = values.map((v) => '    ' + JSON.stringify(v)).join(',\n');
  const chunk = body.trim() ? `,\n${lines}` : `\n${lines}\n  `;
  return text.slice(0, end) + chunk + text.slice(end);
}

function ownerTable(spec) {
  const map = new Map();
  if (!spec) return map;
  for (const pair of String(spec).split(',')) {
    const [from, to] = pair.split('=').map((s) => s.trim());
    if (from && to) map.set(from, to);
  }
  return map;
}

/** The contract text with tasks appended. A duplicate id throws and the caller writes nothing. Existing bytes stay. */
export function appendTaskText(text, tasks) {
  const current = JSON.parse(text);
  const have = new Set((current.tasks || []).map((t) => t.id));
  for (const t of tasks) {
    if (!t.id || have.has(t.id)) throw new Error(`duplicate task id ${t.id || '(missing)'}`);
    have.add(t.id);
  }
  return insertValues(text, 'tasks', tasks);
}

/**
 * Append a fragment's tasks and new owner rules. A duplicate id is refused and the file is left untouched.
 * Existing bytes stay. The return is the sha256 of the file after the append.
 */
export function mergeContract(root, fragmentPath, { owners } = {}) {
  const fragment = loadFile(fragmentPath);
  const tasks = (Array.isArray(fragment) ? fragment : fragment.tasks || []).map((t) => ({ ...t }));
  const rules = Array.isArray(fragment) ? [] : (fragment.owner_rules || []).filter((r) => typeof r === 'string');
  const map = ownerTable(owners);
  for (const t of tasks) if (typeof t.owner === 'string' && map.has(t.owner)) t.owner = map.get(t.owner);
  const file = contractPath(root);
  const before = fs.readFileSync(file, 'utf8');
  const current = JSON.parse(before);
  const haveRules = new Set(current.owner_rules || []);
  const freshRules = rules.filter((r) => !haveRules.has(r));
  let next = appendTaskText(before, tasks);
  if (freshRules.length) {
    if (arrayEnd(next, 'owner_rules') == null) throw new Error('no owner_rules array');
    next = insertValues(next, 'owner_rules', freshRules);
  }
  if (next !== before) fs.writeFileSync(file, next);
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), added: tasks.map((t) => t.id), owner_rules: freshRules };
}

/** One line per requirement id: the tasks that name it, or MISSING. An id a task names that the file does not list is unknown. */
export function coverageReport(root, requirementsPath, { contracts } = {}) {
  const text = fs.readFileSync(requirementsPath, 'utf8');
  const ids = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^- ([^:]+):/);
    if (m) ids.push(m[1].trim());
  }
  const known = new Set(ids);
  const covered = new Map(ids.map((id) => [id, []]));
  const unknown = [];
  const files = contracts && contracts.length ? contracts : [contractPath(root)];
  for (const f of files) {
    const c = loadFile(f);
    for (const t of c.tasks || []) {
      for (const req of t.requirements || []) {
        if (known.has(req)) covered.get(req).push(t.id);
        else unknown.push(`${req} unknown ${t.id}`);
      }
    }
  }
  const lines = ids.map((id) => {
    const tasks = covered.get(id);
    return tasks.length ? `${id} ${tasks.join(',')}` : `${id} MISSING`;
  });
  lines.push(...unknown);
  const ok = !lines.some((l) => l.endsWith(' MISSING') || l.includes(' unknown '));
  return { ok, lines };
}
