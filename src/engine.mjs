// verify → steer → gate, plus project-cycle planning (status, next, brief).
import fs from 'node:fs';
import path from 'node:path';
import { git, writeJson, sha256, approvalMarker } from './util.mjs';
import * as C from './contract.mjs';
import { verifiers, resolveBase, changedFiles } from './checks.mjs';
import { scanForbidden } from './forbidden.mjs';
import { parseClaims, checkClaim } from './claims.mjs';
import { record, readLog, verifyChain } from './evidence.mjs';
import * as RC from './cache.mjs';
import { resolveIsolation, COVERAGE_LIMITS } from './isolate.mjs';

export const KNOWN_LIMITS = [
  'Proofline runs on the same machine as the agent: an agent with shell access could edit .proofline/ or proofline.json. The hash chain makes edits detectable, contract weakening vs the base revision is flagged, and CI re-verifies from a clean checkout; protect proofline.json with CODEOWNERS/branch protection for a hard boundary.',
  'git hooks can be skipped client-side with --no-verify; Proofline cannot prevent that locally. The CI workflow re-runs the gate on every push, so a skipped hook still fails visibly.',
  'Forbidden-pattern and wiring checks are static heuristics (regex + static import graph). Dynamic imports with computed paths and dependency injection are not followed.',
  'Red-green replays the new test against the base revision in a git worktree. Tests needing services or build steps need a "setup" command.',
  'Metric checks trust the bench script committed in the repo; a changed bench command is flagged as a contract change, but the bench itself is code under review.',
  'Contracts are JSON (zero dependencies). YAML is not parsed.',
  'With defaults.reuse_results on, a PASS of a command or metric check is reused on the same HEAD with a clean tree for up to reuse_max_age_h hours. Its key holds the verifier, HEAD, the node version and the env vars the command names, not gitignored files, other env vars or tools outside the repo; a check that depends on those needs --fresh.',
];

/** Where a task's work is pushed: its pushed criterion's remote/branch, else defaults.remote/branch, else origin/main. */
export function pushTarget(c, t, v = t.criteria.find((a) => a.verifier?.type === 'pushed')?.verifier) {
  return { remote: v?.remote || C.remoteOf(c), branch: v?.branch || C.branchOf(c) };
}

function taskById(c, id) { const t = c.tasks.find((x) => x.id === id); if (!t) throw new Error(`unknown task ${id}`); return t; }

export function headInfo(root) {
  const head = git(['rev-parse', 'HEAD'], root).out || null;
  const dirty = git(['diff', 'HEAD'], root).out + git(['ls-files', '--others', '--exclude-standard'], root).out;
  return { head, tree: sha256(dirty) };
}

/** `Proofline-Base: <rev>` in the trailer block (last paragraph) of the HEAD commit message, or null. */
export function baseTrailer(root) {
  const msg = git(['log', '-1', '--format=%B', 'HEAD'], root);
  if (!msg.ok) return null;
  const last = msg.out.trim().split(/\n[ \t]*\n/).pop() || '';
  const m = [...last.matchAll(/^Proofline-Base:[ \t]*(\S+)[ \t]*$/gim)].pop();
  return m ? m[1] : null;
}

/**
 * Where the base revision comes from, first match wins: --base, the task's own `base` in the contract,
 * the most recent base pinned when the task started (`proofline next`, and a later `next --base`),
 * a Proofline-Base trailer on HEAD, the default (defaults.base, else <defaults.remote>/<defaults.branch>).
 */
export function latestStart(root, taskId) {
  const log = readLog(root);
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'task_started' && e.data?.task === taskId && e.data.base) return e.data.base;
  }
  return null;
}

export function baseFor(root, c, t, explicit) {
  if (explicit) return { ref: explicit, source: '--base' };
  if (t.base) return { ref: t.base, source: 'contract' };
  const started = latestStart(root, t.id);
  if (started) return { ref: started, source: 'pinned at start' };
  const tr = baseTrailer(root);
  if (tr) return { ref: tr, source: 'commit trailer' };
  return { ref: C.defaultBase(c), source: 'default' };
}

const forbiddenOn = (f) => ['test_skip_only', 'timeout_raise', 'assertion_removal', 'test_file_deletion', 'no_verify'].some((k) => f[k] !== false) || (f.bypass_env || []).length > 0 || (f.protected_values || []).length > 0;

/** The base for a task, resolved, with the reasons it cannot be used (each one BLOCKS the gate). */
export function taskBase(root, c, t, explicit) {
  const { ref, source } = baseFor(root, c, t, explicit);
  const base = resolveBase(root, ref);
  const problems = [];
  if (!base) problems.push(`base revision "${ref}" (${source}) not found`);
  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], root).out;
  if (base && head && source === 'commit trailer' && (base === head || !git(['merge-base', '--is-ancestor', base, head], root).ok))
    problems.push(`base: the Proofline-Base trailer on HEAD names ${ref}, which is not an ancestor of HEAD ${head.slice(0, 8)}`);
  // With no pinned or passed base, a default base at (or ahead of) HEAD gives an empty diff: every diff check would pass on nothing.
  const diffBased = t.criteria.some((a) => ['scope', 'test_red_green'].includes(a.verifier?.type)) || forbiddenOn({ ...C.DEFAULT_FORBIDDEN, ...(c.forbidden || {}) });
  if (base && head && source === 'default' && diffBased && git(['merge-base', '--is-ancestor', head, base], root).ok)
    problems.push(`base: no base is pinned for ${t.id}, and the default base ${ref} is ${base === head ? 'HEAD' : 'ahead of HEAD'} (${base.slice(0, 8)}), so the diff does not hold this work and the forbidden scan, scope, red-green and weakening checks would see nothing`);
  return { ref, source, base, problems };
}

/** One line when the working contract differs from `explicit` (or the default base) and no marker approves it. */
export function unapprovedContractChange(root, explicit) {
  const c = C.load(root);
  const ref = explicit || C.defaultBase(c);
  const base = resolveBase(root, ref);
  if (!base) return null;
  const s = git(['show', `${base}:proofline.json`], root);
  if (!s.ok) return null;
  let baseContract;
  try { baseContract = JSON.parse(s.out); } catch { return null; }
  if (C.contractHash(baseContract) === C.contractHash(c)) return null;
  let raw;
  try { raw = fs.readFileSync(path.join(root, 'proofline.json')); } catch { return null; }
  if (approvalMarker(root, raw).approved) return null;
  const weak = C.weakenings(baseContract, c);
  return weak.length
    ? `contract weakened vs base (needs owner approval): ${weak.join('; ')}`
    : 'contract bytes changed vs base (needs owner approval)';
}

const BASE_NEXT = 'gate against the revision the task started from: pass --base <rev> (for one commit, its parent), or start the task with `proofline next`, which pins the base. Do not pick a base that hides part of the work.';

/** The "## Base" section of a brief: which base verify and gate will use, and whether they can. */
export function baseBrief(root, c, t, explicit) {
  const b = taskBase(root, c, t, explicit);
  const L = [`## Base`, `verify and gate compare the working tree with ${b.ref} = ${b.base?.slice(0, 8) || 'not found'} (${b.source}).`];
  if (b.problems.length) L.push(`As things stand the gate is BLOCKED: ${b.problems.join('; ')}.`, `Next step: ${BASE_NEXT}`);
  return L.join('\n');
}

export function verifyTask(root, taskId, opts = {}) {
  const { claims, only, skipTypes = [], base: explicitBase, machine, fresh = false } = opts;
  const c = C.load(root);
  const t = taskById(c, taskId);
  const iso = resolveIsolation(c, opts);
  const errs = C.validate(c);
  // Base is pinned when the task starts, so pushing the work does not move the goalposts.
  const { ref: baseRef, source: baseSource, base, problems: baseProblems } = taskBase(root, c, t, explicitBase);
  const ctx = { root, contract: c, task: t, base, changed: base ? changedFiles(root, base) : new Map(), measured: {}, machine, baseline: c.baseline?.metrics, tolerancePct: c.defaults?.regression_tolerance_pct, flakyReruns: c.defaults?.flaky_reruns ?? 1, sandbox: iso.sandbox };
  const results = [];
  const reuse = RC.settings(c);
  for (const a of t.criteria) {
    if (only && !only.includes(a.id)) continue;
    if (skipTypes.includes(a.verifier.type)) continue;
    let r;
    const sandboxed = ['command', 'test_red_green', 'metric'].includes(a.verifier.type);
    if (iso.block && sandboxed) {
      r = { status: 'error', detail: iso.block };
    } else {
      // Reuse (opt-in): a command or metric PASS recorded on this HEAD with a clean tree is not run again; --fresh runs it.
      const k = reuse.on && RC.REUSABLE.includes(a.verifier.type) ? RC.keyFor(root, a.verifier, ctx) : null;
      const hit = k && !fresh ? RC.lookup(root, k.key, reuse) : null;
      if (hit) {
        r = RC.reusedResult(hit);
        if (a.verifier.type === 'metric') ctx.measured[a.verifier.name || a.verifier.key] = hit.data.evidence.measured;
      } else {
        try { r = verifiers[a.verifier.type](a.verifier, ctx); } catch (e) { r = { status: 'error', detail: `verifier crashed: ${e.message}` }; }
        // Only a PASS is stored, and only if the tree is still the one the check started on and the log is intact.
        if (k && r.status === 'pass' && RC.keyFor(root, a.verifier, ctx)?.key === k.key && verifyChain(root).ok) RC.store(root, k, t.id, a, r);
      }
    }
    const heuristic = a.verifier.type === 'grep' || a.verifier.type === 'wiring';
    results.push({ id: a.id, statement: a.statement, mandatory: a.mandatory !== false, type: a.verifier.type, ...(heuristic ? { heuristic: true } : {}), ...r });
  }
  const rules = { ...C.DEFAULT_FORBIDDEN, ...(c.forbidden || {}) };
  const forbidden = scanForbidden(root, base, rules);
  let baseContract = null;
  if (base) { const s = git(['show', `${base}:proofline.json`], root); if (s.ok) try { baseContract = JSON.parse(s.out); } catch {} }
  const weak = C.weakenings(baseContract, c);
  // The forbidden scan skips proofline.json (it declares the deny-list); a contract change is reported here instead.
  let contractChange = !base ? 'unknown' : !baseContract ? 'added' : C.contractHash(baseContract) === C.contractHash(c) ? 'unchanged' : 'changed';
  const fields = baseContract ? C.contractFieldChanges(baseContract, c) : [];
  let marker = null;
  const hashChanged = contractChange === 'changed';
  const approveChange = () => {
    if (!hashChanged) return false;
    let raw = null;
    try { raw = fs.readFileSync(path.join(root, 'proofline.json')); } catch { raw = null; }
    const mark = approvalMarker(root, raw);
    if (!mark.approved) return false;
    marker = mark.marker;
    contractChange = 'approved';
    return true;
  };
  const chain = verifyChain(root);

  const blocked = [], failing = [];
  if (errs.length) blocked.push(...errs.map((e) => `contract invalid: ${e}`));
  blocked.push(...baseProblems);
  if (!chain.ok) blocked.push(`evidence log tampered at entry ${chain.at}: ${chain.reason}`);
  if (hashChanged && !approveChange()) {
    // One blocked line. weakenings() is the explanation, so a real weakening stays length 1.
    if (weak.length) blocked.push(`contract weakened vs base (needs owner approval): ${weak.join('; ')}`);
    else blocked.push('contract bytes changed vs base (needs owner approval)');
  } else if (!hashChanged) {
    for (const w of weak) blocked.push(`contract weakened vs base (needs owner approval): ${w}`);
  }
  for (const r of results) {
    if (r.status === 'error') blocked.push(`${r.id}: could not run: ${r.detail}`);
    else if (r.status === 'blocked') blocked.push(`${r.id}: ${r.detail}`);
    else if (r.mandatory && r.status !== 'pass') failing.push(`${r.id} ${r.status.toUpperCase()}: ${r.detail}`);
  }
  for (const f of forbidden) failing.push(`forbidden ${f.rule} in ${f.file}: ${f.line}`);
  let decision = blocked.length ? 'BLOCKED' : failing.length ? 'FAIL' : 'PASS';

  const metricLabels = {};
  for (const a of t.criteria) if (a.verifier.type === 'metric') metricLabels[a.verifier.name || a.verifier.key] = a.verifier.labels || [];
  const claimResults = [];
  if (claims) {
    const res = { decision, failing: [...blocked, ...failing], measured: ctx.measured, metricLabels };
    const needPush = t.criteria.some((a) => a.verifier.type === 'pushed');
    for (const cl of parseClaims(claims, [t.id])) claimResults.push(checkClaim(root, cl, res, { requirePushed: needPush, ...pushTarget(c, t) }));
    for (const cr of claimResults) if (!cr.ok) failing.push(...cr.issues.map((i) => `claim mismatch: ${i}`));
    if (claimResults.some((x) => !x.ok) && decision === 'PASS') decision = 'FAIL';
  }
  const hi = headInfo(root);
  // Is this HEAD already on the push target? The pushed criterion says so when it ran; otherwise (skipped, or the
  // task has none) a clean tree whose HEAD equals the local <remote>/<branch> ref counts. No network call here.
  const pr = results.find((r) => r.type === 'pushed');
  const tgt = pushTarget(c, t);
  const pushed = pr ? pr.status === 'pass'
    : !!hi.head && !git(['status', '--porcelain'], root).out.split('\n').some((l) => l && !l.includes('.proofline/')) && git(['rev-parse', '--verify', '--quiet', `refs/remotes/${tgt.remote}/${tgt.branch}^{commit}`], root).out === hi.head;
  const reused = results.filter((r) => r.reused).map((r) => ({ id: r.id, type: r.type, ts: r.reused.ts, entry: r.reused.entry }));
  return { isolated: iso.isolated, env_digest: iso.env_digest, heuristic: true, coverage_limits: COVERAGE_LIMITS, pushed, task: t.id, title: t.title, phase: t.phase, decision, base, base_ref: baseRef, base_source: baseSource, ...hi, contract_hash: C.contractHash(c), results, reuse: !reuse.on ? 'off' : fresh ? 'fresh' : 'on', reused, forbidden, weakenings: weak, contract_fields: fields, contract_change: contractChange, marker, blocked, failing, measured: ctx.measured, claims: claimResults, changed: [...ctx.changed.keys()], ts: new Date().toISOString() };
}

/** Corrective prompt tied to each failed criterion. */
export function steer(v, c) {
  const t = taskById(c, v.task);
  if (v.decision === 'PASS') {
    const p = pushTarget(c, t), h = v.head?.slice(0, 8);
    const nums = Object.entries(v.measured).map(([k, x]) => `${k}=${x}`).join(', ') || '-';
    const gateCmd = (hash) => `proofline gate ${v.task}${v.base_source === '--base' ? ` --base ${v.base}` : ''} --claims "${v.task} | done | ${hash} | <tests> | ${nums} | -"`;
    if (!v.pushed) return `${v.task}: PASS on ${h}, not pushed yet. Commit (one task per commit) and push to ${p.remote} ${p.branch} with hooks on; the pre-push hook gates it again. Then report it:\n${gateCmd('<hash>')}`;
    if (v.claims.length && v.claims.every((x) => x.ok)) return `${v.task}: PASS, verified on the pushed HEAD ${h} (${p.remote}/${p.branch}), and the claims match the evidence. The task is done. Next task: \`proofline next\`.`;
    return `${v.task}: PASS, verified on the pushed HEAD ${h} (${p.remote}/${p.branch}). Nothing is left to commit. Report it, naming the tests that prove it:\n${gateCmd(h)}`;
  }
  const L = [`PROOFLINE CORRECTIVE INSTRUCTION for ${v.task} (${t.title}): gate ${v.decision}`, `Revision ${v.head?.slice(0, 8)} vs base ${v.base?.slice(0, 8) || v.base_ref} (${v.base_source}). Do NOT report this task as done. Fix in this order:`, ''];
  let n = 1;
  for (const b of v.blocked) L.push(`${n++}. BLOCKED: ${b}\n   Next step: ${b.startsWith('base: ')
    ? BASE_NEXT
    : /^[^:]+: machine busy:/.test(b) ? 'stop the other load (suites, benches, builds) and gate again on an idle machine. Do not change max_load_per_cpu.'
    : 'resolve the blocker (restore the contract, commit the missing rig/tool, or ask the owner). Do not work around it.'}`);
  for (const r of v.results.filter((x) => x.mandatory && !['pass', 'error', 'blocked'].includes(x.status))) {
    const a = t.criteria.find((x) => x.id === r.id);
    const how = {
      command: () => `Run \`${a.verifier.cmd}\`. Find the root cause of each failure (file:line + mechanism) and fix the cause. Re-run until exit ${a.verifier.expect_exit ?? 0}.`,
      test_red_green: () => `The test ${a.verifier.test_file} must FAIL on the base and PASS now. If it passes on base it does not test the change: assert the outcome (what), not the mechanism (how).`,
      test_exists: () => `Write ${a.verifier.test_file}${a.verifier.test_name ? ` containing "${a.verifier.test_name}"` : ''}.`,
      metric: () => `Run \`${a.verifier.cmd}\` and get a per-stage trace of where the time goes. Target ${a.verifier.key} ${a.verifier.op} ${a.verifier.value}. Do not change the threshold or the bench.`,
      grep: () => `Make ${a.verifier.file} ${a.verifier.must === 'absent' ? 'no longer contain' : 'contain'} /${a.verifier.pattern}/${a.verifier.why ? ` (${a.verifier.why})` : ''}.`,
      wiring: () => `Call ${a.verifier.symbol} from the default path starting at ${a.verifier.entry}. Code that is built but not reachable does not count.`,
      scope: () => `Revert changes outside scope or ask the owner to amend the contract.`,
      docs: () => `Run \`${a.verifier.cmd}\` and commit the regenerated ${a.verifier.paths.join(', ')}.`,
      pushed: () => { const p = pushTarget(c, t, a.verifier); return `Commit everything and \`git push ${p.remote} ${p.branch}\` (hooks on; never --no-verify).`; },
      file_exists: () => `Create ${a.verifier.path}.`,
    }[a.verifier.type]();
    L.push(`${n++}. ${r.id} [${r.type}] ${r.status.toUpperCase()}: ${a.statement || ''}\n   Evidence: ${r.detail.split('\n')[0]}\n   Next step: ${how}`);
  }
  for (const f of v.forbidden) L.push(`${n++}. FORBIDDEN ${f.rule} in ${f.file}: ${f.line}\n   Why: ${f.why}. Next step: revert it and fix the underlying cause.`);
  for (const cr of v.claims.filter((x) => !x.ok)) L.push(`${n++}. CLAIM REJECTED: "${cr.claim}"\n   ${cr.issues.join('\n   ')}\n   Next step: report only what the evidence shows.`);
  L.push('', 'STOP RULES:', ...(Array.isArray(t.stop_rules) ? t.stop_rules : []).map((s) => `- ${s}`), '- After fixing, call verify again. Max corrective cycles: ' + (c.defaults?.max_corrective_cycles ?? 3) + '; after that report BLOCKED with root cause, what you tried, what you need.');
  return L.join('\n');
}

const reusedFrom = (x) => `reused from ${x.ts} (evidence entry ${x.entry})`;

/** Each failed or flaky command criterion with the test names its evidence recorded, one line per run (both when it re-ran). */
function failingTestLines(v) {
  const L = [];
  for (const r of v.results.filter((x) => x.type === 'command' && ['fail', 'flaky'].includes(x.status) && x.evidence)) {
    L.push(`- ${r.id} [command] ${r.status.toUpperCase()}`);
    const e = r.evidence;
    for (const [label, x] of e.first ? [['first run', e.first], ['re-run', e.rerun]] : [['run', e]]) {
      if (!x?.failing) continue;
      const n = x.failing_total ?? x.failing.length;
      L.push(`  - ${label} (exit ${x.exit}): ${n ? `${n} failed${x.failing_total ? ` (first ${x.failing.length} recorded)` : ''}: ${x.failing.join(', ')}` : 'none named'}`);
    }
  }
  return L.length ? L : ['- none'];
}

function reportMd(v, c, prompt) {
  const row = (r) => `| ${r.id} | ${r.type} | ${r.mandatory ? 'yes' : 'no'} | ${r.status.toUpperCase()} | ${r.detail.split('\n')[0].replace(/\|/g, '\\|')} |`;
  return [`# Proofline gate: ${v.task} is **${v.decision}**`, '', `- Task: ${v.title} (phase ${v.phase})`, `- Revision: ${v.head} (tree ${v.tree.slice(0, 12)})`, `- Base: ${v.base_ref} = ${v.base} (${v.base_source})`, `- Contract hash: ${v.contract_hash}`, `- Time: ${v.ts}`, '',
    '## Acceptance criteria', '', '| ID | Verifier | Mandatory | Result | Evidence |', '|---|---|---|---|---|', ...v.results.map(row), '',
    '## Failing tests', '', ...failingTestLines(v), '',
    '## Reused results', '', ...(v.reused.length ? v.reused.map((x) => `- ${x.id} [${x.type}]: ${reusedFrom(x)}; not run again in this gate`) : [`- none${{ off: ' (defaults.reuse_results is off)', fresh: ' (--fresh)' }[v.reuse] || ''}`]), '',
    '## Measured', '', ...(Object.keys(v.measured).length ? Object.entries(v.measured).map(([k, x]) => `- ${k}: ${x}`) : ['- none']), '',
    '## Forbidden actions', '', ...(v.forbidden.length ? v.forbidden.map((f) => `- ${f.rule} in ${f.file}: \`${f.line}\` (${f.why})`) : ['- none detected']),
    `- proofline.json is not scanned (it declares the deny-list); vs base it is ${v.contract_change}${v.contract_change === 'approved' ? `, approved, marker ${v.marker}: ${v.weakenings.join('; ')}` : v.contract_change === 'added' || v.contract_change === 'changed' ? `, judged by the weakening check: ${v.weakenings.length} weakening(s)` : ''}`, '',
    '## Blockers', '', ...(v.blocked.length ? v.blocked.map((b) => `- ${b}`) : ['- none']), '',
    '## Claims vs evidence', '', ...(v.claims.length ? v.claims.map((x) => `- ${x.ok ? 'OK' : 'REJECTED'}: \`${x.claim}\`${x.ok ? '' : '\n  - ' + x.issues.join('\n  - ')}`) : ['- no claim submitted']), '',
    `## Scope (${v.changed.length} changed files)`, '', ...v.changed.slice(0, 50).map((f) => `- ${f}`), '',
    '## Corrective instruction', '', '```', prompt, '```', '',
    '## Status vocabulary', '', '- PASS: every mandatory criterion passed on this exact revision, with fresh evidence or a PASS reused from this revision on a clean tree (listed under Reused results); no forbidden action; claims match.', '- FAIL: a mandatory criterion failed or was flaky, a forbidden action was found, or a claim contradicts the evidence.', '- BLOCKED: a check could not run, the contract was weakened, or the evidence log was tampered with. Needs the owner.', '',
    '## Known limits', '', ...KNOWN_LIMITS.map((k) => `- ${k}`), ''].join('\n');
}

export function gate(root, taskId, opts = {}) {
  const c = C.load(root);
  if (opts.claims) record(root, 'claim', { task: taskId, text: opts.claims }, { actor: 'agent' });
  const v = verifyTask(root, taskId, opts);
  const prompt = steer(v, c);
  const dir = path.join(root, '.proofline', 'reports');
  const stamp = v.ts.replace(/[:.]/g, '-');
  const json = { ...v, corrective_prompt: prompt, known_limits: KNOWN_LIMITS };
  writeJson(path.join(dir, `${taskId}-${stamp}.json`), json);
  fs.writeFileSync(path.join(dir, `${taskId}-${stamp}.md`), reportMd(v, c, prompt));
  writeJson(path.join(dir, `${taskId}-latest.json`), json);
  fs.writeFileSync(path.join(dir, `${taskId}-latest.md`), reportMd(v, c, prompt));
  const e = record(root, 'gate', { task: taskId, decision: v.decision, head: v.head, tree: v.tree, base: v.base, base_source: v.base_source, contract_hash: v.contract_hash, failing: v.failing, blocked: v.blocked, measured: v.measured, ...(v.reused.length ? { reused: v.reused.map((x) => `${x.id}: ${reusedFrom(x)}`) } : {}) });
  return { ...json, evidence_seq: e.seq, report: path.join(dir, `${taskId}-latest.md`) };
}

// ---------- project cycle ----------
export function taskStatus(root, c = C.load(root)) {
  const log = readLog(root);
  const st = {};
  for (const t of c.tasks) st[t.id] = { status: 'not_started' };
  for (const e of log) {
    if (e.type === 'task_started' && st[e.data.task]?.status === 'not_started') st[e.data.task] = { status: 'in_progress' };
    if (e.type === 'gate' && st[e.data.task]) st[e.data.task] = { status: e.data.decision === 'PASS' ? 'verified' : e.data.decision === 'BLOCKED' ? 'blocked' : 'failed', head: e.data.head, seq: e.seq };
  }
  return st;
}

export function phaseStatus(root, c = C.load(root)) {
  const st = taskStatus(root, c);
  return C.PHASES.map((p) => {
    const ts = c.tasks.filter((t) => t.phase === p);
    return { phase: p, tasks: ts.length, verified: ts.filter((t) => st[t.id].status === 'verified').length, open: ts.length > 0 && ts.some((t) => st[t.id].status !== 'verified') };
  });
}

/**
 * The next task. With `owner`, only that owner's tasks and unowned ones are handed out, and the phase gate
 * applies to that lane; depends_on still waits on any owner's task.
 */
export function next(root, { owner, skip = [] } = {}) {
  const c = C.load(root);
  C.checkOwner(c, owner);
  const st = taskStatus(root, c);
  const skipSet = new Set(skip);
  // A skipped task has landed. It does not stay active, and it does not keep its phase or its dependents waiting.
  const open = (t) => st[t.id].status !== 'verified' && !skipSet.has(t.id);
  const lane = c.tasks.filter((t) => C.inLane(t, owner));
  const order = (C.topo(c.tasks) || c.tasks).filter((t) => C.inLane(t, owner));
  const firstOpenPhase = C.PHASES.find((p) => lane.some((t) => t.phase === p && open(t)));
  if (!firstOpenPhase && owner) {
    const others = c.tasks.filter((t) => !C.inLane(t, owner) && st[t.id].status !== 'verified' && !skipSet.has(t.id)).map((t) => `${t.id} (${t.owner})`);
    return { done: true, owner, message: `Every task for ${owner} and every unowned task is verified.${others.length ? ` Open for other owners: ${others.join(', ')}.` : ' Run `proofline gate --all` before release.'}` };
  }
  if (!firstOpenPhase) return { done: true, message: 'All tasks verified. Run `proofline gate --all` before release.' };
  for (const t of order) {
    if (!open(t)) continue;
    if (t.phase !== firstOpenPhase) continue; // phase gate: earlier phases must be fully verified
    const deps = (t.depends_on || []).filter((d) => st[d]?.status !== 'verified' && !skipSet.has(d));
    if (deps.length) continue;
    return { done: false, task: t.id, phase: t.phase, status: st[t.id].status, brief: brief(c, t, st) };
  }
  const waiting = order.filter((t) => open(t)).map((t) => `${t.id} (waits on ${(t.depends_on || []).filter((d) => st[d]?.status !== 'verified' && !skipSet.has(d)).join(', ') || 'phase gate'})`);
  return { done: false, task: null, message: `No task${owner ? ` for ${owner}` : ''} is unblocked in phase ${firstOpenPhase}: ${waiting.join('; ')}` };
}

export function brief(c, t, st = {}) {
  const v = (a) => a.verifier;
  const crit = t.criteria.map((a, i) => {
    const x = v(a); const how = {
      command: () => `run \`${x.cmd}\` → exit ${x.expect_exit ?? 0}${x.max_skipped !== undefined ? `, ≤ ${x.max_skipped} skipped` : ''}${x.min_tests ? `, ≥ ${x.min_tests} tests` : ''}, no hung/cancelled tests`,
      test_red_green: () => `write \`${x.test_file}\`${x.test_name ? ` ("${x.test_name}")` : ''} FIRST; Proofline replays it on the base revision where it must FAIL, then on your tree where it must PASS (\`${x.cmd}\`)`,
      test_exists: () => `\`${x.test_file}\` exists${x.test_name ? ` with "${x.test_name}"` : ''}`,
      metric: () => `\`${x.cmd}\` → \`${x.key}\` ${x.op} ${x.value}${c.baseline?.metrics?.[x.name || x.key] !== undefined ? ` (baseline ${c.baseline.metrics[x.name || x.key]})` : ''}`,
      grep: () => `${x.file} ${x.must === 'absent' ? 'must not contain' : 'must contain'} /${x.pattern}/${x.why ? `: ${x.why}` : ''}`,
      wiring: () => `\`${x.symbol}\` must be called on the default path from ${x.entry}`,
      scope: () => `only change: ${(x.allow || t.scope.allow).join(', ')}`,
      docs: () => `\`${x.cmd}\` leaves no diff in ${x.paths.join(', ')}`,
      pushed: () => { const p = pushTarget(c, t, x); return `committed, tree clean, HEAD == ${p.remote}/${p.branch} or a commit under it`; },
      file_exists: () => `${x.path} exists`,
    }[x.type]();
    return `${i + 1}. **${a.id}**${a.mandatory === false ? ' (advisory)' : ''}: ${a.statement || ''}\n   Verifier (${x.type}): ${how}`;
  }).join('\n');
  const f = { ...C.DEFAULT_FORBIDDEN, ...(c.forbidden || {}) };
  return [`# TASK ${t.id}: ${t.title}`, ...(t.owner !== undefined ? [`Owner: ${t.owner}.`] : []), `Phase: ${t.phase}. Depends on: ${(t.depends_on || []).join(', ') || 'none'} (all verified). Requirements: ${(t.requirements || []).join(', ') || '-'}.`, '',
    t.description || '', '', `## Scope (allowed paths)\n${t.scope.allow.map((s) => `- ${s}`).join('\n')}`, '',
    `## Acceptance criteria (each is checked independently; your report is not evidence)\n${crit}`, '',
    '## Mandatory loop', '1. Write the failing test(s) first and run them: paste the failing output.', '2. Implement the cause-level fix on the default path (wired in, default config).', `3. \`proofline verify ${t.id}\` → fix until PASS. Read the corrective instruction it prints.`, `4. Commit (one task per commit), push to ${pushTarget(c, t).remote} ${pushTarget(c, t).branch} with hooks on.`, `5. \`proofline gate ${t.id} --claims "<your report line>"\` and paste the report.`, '',
    '## Forbidden (detected automatically)', `- skip/only/todo in tests; raising timeouts; net removal of assertions; deleting tests; --no-verify; env bypasses (${(f.bypass_env || []).join(', ')}); lowering protected values (${(f.protected_values || []).map((p) => p.file).join(', ') || 'none configured'}); editing thresholds/commands/criteria in proofline.json.`, '',
    '## Owner rules', ...(c.owner_rules || []).map((r) => `- ${r}`), '',
    '## Stop rules', ...(Array.isArray(t.stop_rules) ? t.stop_rules : []).map((s) => `- ${s}`), '',
    '## Report line (exact format)', `${t.id} | done/partial/not done/blocked | <commit> | <test names> | <metric=value vs target> | <what is missing>`].join('\n');
}
