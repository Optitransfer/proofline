// Scope file -> unsigned proposal. Pure: reads the scope (and any --against contracts), returns bytes.
// The output is a fragment `proofline contract merge` accepts. It never writes proofline.json or a .sig.
import fs from 'node:fs';
import path from 'node:path';
import * as C from './contract.mjs';
import { sha256 } from './util.mjs';

export const SCOPE_SCHEMA = 'proofline-scope/1';

const CORE = ['id', 'title', 'phase', 'owner', 'depends_on', 'requirements', 'description', 'scope', 'criteria', 'stop_rules'];
const WRAP_KEYS = ['requirements', 'scope', 'criteria', 'stop_rules'];
const SCOPE_KEYS = ['schema', 'prefix', 'pad', 'proposal', 'owner_rules', 'defaults', 'prepend', 'append', 'external', 'tasks'];
const TASK_KEYS = ['id', 'n', 'title', 'phase', 'owner', 'depends_on', 'requirements', 'description', 'scope', 'acceptance', 'stop_rules', 'fields', 'inherit'];
const DEFAULT_KEYS = ['phase', 'owner', 'scope', 'stop_rules', 'fields'];
const ID_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Standard criteria a scope file may name with a single word. Same statements as `contract scaffold`. */
const STANDARD = {
  scope: () => ({ statement: 'Changes stay in scope', verifier: { type: 'scope' } }),
  pushed: () => ({ statement: 'Committed and pushed to main', verifier: { type: 'pushed' } }),
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v, what) => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${what} must be a list`);
  return clone(v);
};
const text = (v, what) => {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every((s) => typeof s === 'string')) return v.join(' ');
  throw new Error(`${what} must be a string or a list of strings`);
};

/** `{task}` in any string becomes the task id. Nothing else is expanded. */
function expand(v, id) {
  if (typeof v === 'string') return v.split('{task}').join(id);
  if (Array.isArray(v)) return v.map((x) => expand(x, id));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x, id)]));
  return v;
}

function unknownKeys(obj, allowed, where) {
  const bad = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (bad.length) throw new Error(`${where}: unknown key ${bad.join(', ')} (accepted: ${allowed.join(', ')})`);
}

function taskId(t, i, prefix, pad) {
  if (t.id !== undefined) {
    if (t.n !== undefined) throw new Error(`task ${i + 1}: give id or n, not both`);
    if (typeof t.id !== 'string' || !ID_RE.test(t.id)) throw new Error(`task ${i + 1}: id must match ${ID_RE}`);
    return t.id;
  }
  if (!Number.isInteger(t.n) || t.n < 0) throw new Error(`task ${i + 1}: needs an id, or n (a whole number) with a scope prefix`);
  if (!prefix) throw new Error(`task ${i + 1}: n needs a scope prefix`);
  return `${prefix}-${String(t.n).padStart(pad, '0')}`;
}

/** One acceptance item: a standard word, a command shorthand, or a criterion with its verifier. */
function criterion(item, where) {
  if (typeof item === 'string') {
    if (!STANDARD[item]) throw new Error(`${where}: "${item}" is not a standard criterion (${Object.keys(STANDARD).join(', ')})`);
    return criterion(STANDARD[item](), where);
  }
  if (!isObj(item)) throw new Error(`${where}: an acceptance item is a word or an object`);
  const { id, mandatory, statement, verifier, cmd, expect_exit, timeout_s, ...rest } = clone(item);
  if (typeof statement !== 'string' || !statement.trim()) throw new Error(`${where}: needs a statement`);
  let v = verifier;
  if (cmd !== undefined) {
    if (v !== undefined) throw new Error(`${where}: give cmd or verifier, not both`);
    v = { type: 'command', cmd, ...(expect_exit !== undefined ? { expect_exit } : {}), ...(timeout_s !== undefined ? { timeout_s } : {}) };
  } else if (expect_exit !== undefined || timeout_s !== undefined) throw new Error(`${where}: expect_exit and timeout_s go with cmd`);
  if (!isObj(v)) throw new Error(`${where}: needs a verifier (or cmd)`);
  if (mandatory !== undefined && typeof mandatory !== 'boolean') throw new Error(`${where}: mandatory must be true or false`);
  return { ...(id !== undefined ? { id } : {}), mandatory: mandatory !== false, statement, verifier: v, ...rest };
}

function inheritOf(t, where) {
  if (t.inherit === undefined || t.inherit === true) return new Set(WRAP_KEYS);
  if (t.inherit === false) return new Set();
  if (Array.isArray(t.inherit) && t.inherit.every((k) => WRAP_KEYS.includes(k))) return new Set(t.inherit);
  throw new Error(`${where}: inherit must be true, false or a list of ${WRAP_KEYS.join(', ')}`);
}

function wrapOf(spec, key) {
  const w = spec[key];
  if (w === undefined) return {};
  if (!isObj(w)) throw new Error(`${key} must be an object`);
  unknownKeys(w, WRAP_KEYS, key);
  return w;
}

/** Build one task. Key order is fixed so the bytes are stable. */
function buildTask(t, i, ctx) {
  const where = `task ${i + 1}`;
  if (!isObj(t)) throw new Error(`${where}: must be an object`);
  unknownKeys(t, TASK_KEYS, where);
  const id = taskId(t, i, ctx.prefix, ctx.pad);
  const at = `${where} (${id})`;
  if (typeof t.title !== 'string' || !t.title.trim()) throw new Error(`${at}: needs a title`);
  const d = ctx.defaults;
  const inherit = inheritOf(t, at);
  const wrap = (key, own) => [
    ...(inherit.has(key) ? list(ctx.prepend[key], `prepend.${key}`) : []),
    ...own,
    ...(inherit.has(key) ? list(ctx.append[key], `append.${key}`) : []),
  ];
  const phase = t.phase ?? d.phase ?? 'implement';
  if (!C.PHASES.includes(phase)) throw new Error(`${at}: unknown phase ${phase} (${C.PHASES.join(', ')})`);
  const owner = t.owner ?? d.owner;
  if (owner !== undefined && (typeof owner !== 'string' || !owner.trim())) throw new Error(`${at}: owner must be a name`);
  const deps = list(t.depends_on, `${at}: depends_on`).map((x) => (Number.isInteger(x) ? taskId({ n: x }, i, ctx.prefix, ctx.pad) : x));
  for (const x of deps) if (typeof x !== 'string' || !ID_RE.test(x)) throw new Error(`${at}: depends_on entry ${JSON.stringify(x)} is not a task id`);
  const requirements = wrap('requirements', list(t.requirements, `${at}: requirements`));
  const rawScope = clone(t.scope ?? d.scope);
  const { allow: ownAllow, ...scopeRest } = isObj(rawScope) ? rawScope : { allow: rawScope };
  const scope = wrap('scope', list(ownAllow, `${at}: scope`));
  if (!scope.length) throw new Error(`${at}: needs a scope (task scope or defaults.scope)`);
  const items = wrap('criteria', list(t.acceptance, `${at}: acceptance`));
  if (!items.length) throw new Error(`${at}: needs at least one acceptance check`);
  const criteria = items.map((x, k) => {
    const c = criterion(x, `${at} acceptance ${k + 1}`);
    return { id: c.id ?? `${id}-AC${String(k + 1).padStart(2, '0')}`, ...c };
  });
  let stops = wrap('stop_rules', list(t.stop_rules ?? d.stop_rules, `${at}: stop_rules`));
  if (!stops.length) stops = [...C.DEFAULT_STOP_RULES];
  const fields = { ...(clone(d.fields) || {}), ...(clone(t.fields) || {}) };
  const clash = Object.keys(fields).filter((k) => CORE.includes(k));
  if (clash.length) throw new Error(`${at}: fields may not set ${clash.join(', ')}`);
  const task = {
    id, title: t.title, phase, ...(owner !== undefined ? { owner } : {}),
    depends_on: deps, requirements, description: text(t.description, `${at}: description`),
    ...fields,
    scope: { allow: scope, ...scopeRest }, criteria, stop_rules: stops,
  };
  const out = expand(task, id);
  const seen = new Set();
  for (const c of out.criteria) {
    if (seen.has(c.id)) throw new Error(`${at}: duplicate criterion id ${c.id}`);
    seen.add(c.id);
  }
  return out;
}

function idsOf(file) {
  const c = C.loadFile(file);
  return (Array.isArray(c) ? c : c.tasks || []).map((t) => t.id);
}

/** A stand-in for a task that already exists elsewhere, so validate can resolve a dependency on it. */
const stub = (id) => ({ id, title: id, phase: 'intake', depends_on: [], scope: { allow: ['**'] }, criteria: [{ id: `${id}-S`, verifier: { type: 'scope' } }], stop_rules: ['stop'] });

/**
 * Decompose a parsed scope into a proposal. Throws (nothing returned) on a duplicate id, an unknown
 * dependency, a cycle, or a task `contract validate` would refuse. With lint: 'warn', the lint findings
 * (no scope criterion, no stop rules, a path outside scope, an expanding shell) come back as warnings.
 */
export function decompose(spec, { against = [], lint = 'error' } = {}) {
  if (!isObj(spec)) throw new Error('a scope file is a JSON object');
  unknownKeys(spec, SCOPE_KEYS, 'scope');
  if (spec.schema !== SCOPE_SCHEMA) throw new Error(`scope schema must be ${SCOPE_SCHEMA}`);
  const prefix = spec.prefix;
  if (prefix !== undefined && (typeof prefix !== 'string' || !ID_RE.test(prefix))) throw new Error(`prefix must match ${ID_RE}`);
  const pad = spec.pad ?? 2;
  if (!Number.isInteger(pad) || pad < 1 || pad > 6) throw new Error('pad must be a whole number from 1 to 6');
  const defaults = spec.defaults ?? {};
  if (!isObj(defaults)) throw new Error('defaults must be an object');
  unknownKeys(defaults, DEFAULT_KEYS, 'defaults');
  if (!Array.isArray(spec.tasks) || !spec.tasks.length) throw new Error('scope needs a non-empty tasks list');
  const ctx = { prefix, pad, defaults, prepend: wrapOf(spec, 'prepend'), append: wrapOf(spec, 'append') };
  const tasks = spec.tasks.map((t, i) => buildTask(t, i, ctx));

  const mine = new Set();
  for (const t of tasks) {
    if (mine.has(t.id)) throw new Error(`duplicate task id ${t.id} in the scope file`);
    mine.add(t.id);
  }
  const existing = new Map();
  for (const f of against) for (const id of idsOf(f)) if (!existing.has(id)) existing.set(id, f);
  for (const t of tasks) if (existing.has(t.id)) throw new Error(`duplicate task id ${t.id}: already in ${existing.get(t.id)}`);
  const external = list(spec.external, 'external');
  const known = new Set([...existing.keys(), ...external]);
  for (const t of tasks) for (const dep of t.depends_on) {
    if (!mine.has(dep) && !known.has(dep)) throw new Error(`${t.id}: depends on unknown ${dep} (not in this scope, --against or external)`);
  }

  const probe = { ...C.skeleton('scope'), tasks: [...[...known].filter((id) => !mine.has(id)).map(stub), ...tasks] };
  const structural = C.validate(probe);
  if (structural.length) throw new Error(`scope does not validate:\n${structural.join('\n')}`);
  const lintFindings = C.lint(probe).errors.filter((e) => !structural.includes(e));
  if (lintFindings.length && lint !== 'warn') throw new Error(`scope does not pass contract validate:\n${lintFindings.join('\n')}\n(--lint-warn reports these as warnings)`);

  const header = spec.proposal ?? {};
  if (!isObj(header)) throw new Error('proposal must be an object');
  const reserved = Object.keys(header).filter((k) => ['schema', 'status', 'owner_rules', 'tasks'].includes(k));
  if (reserved.length) throw new Error(`proposal may not set ${reserved.join(', ')}; decompose writes them`);
  const rules = list(spec.owner_rules, 'owner_rules');
  if (!rules.every((r) => typeof r === 'string' && r.trim())) throw new Error('owner_rules must be a list of sentences');
  const proposal = { schema: C.SCHEMA, status: 'proposed', ...clone(header), ...(rules.length ? { owner_rules: rules } : {}), tasks };
  const bytes = JSON.stringify(proposal, null, 2) + '\n';
  return { proposal, bytes, sha256: sha256(bytes), ids: tasks.map((t) => t.id), warnings: lint === 'warn' ? lintFindings : [] };
}

/** A path decompose refuses to write: any proofline.json, any signature, or the root contract itself. */
export function forbiddenOut(root, out) {
  const base = path.basename(out);
  if (base === 'proofline.json' || base.endsWith('.sig')) return true;
  return path.resolve(out) === path.resolve(C.contractPath(root));
}

/**
 * The CLI step: read the scope, decompose, then print, write (--out) or compare (--check).
 * With check, an out file whose bytes differ is reported and nothing is written.
 */
export function decomposeFile(root, scopePath, { out, against = [], check = false, lint } = {}) {
  let spec;
  try { spec = JSON.parse(fs.readFileSync(scopePath, 'utf8')); } catch (e) { throw new Error(`cannot read scope ${scopePath}: ${e.message}`); }
  const r = decompose(spec, { against, lint });
  if (!out) {
    if (check) throw new Error('--check needs --out');
    return { ...r, written: null, same: null };
  }
  if (forbiddenOut(root, out)) throw new Error(`refusing to write ${out}: decompose writes proposals, never proofline.json or a signature`);
  let have = null;
  try { have = fs.readFileSync(out, 'utf8'); } catch { have = null; }
  const same = have === r.bytes;
  if (check) return { ...r, written: null, same };
  if (!same) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, r.bytes);
  }
  return { ...r, written: out, same };
}
