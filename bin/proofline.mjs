#!/usr/bin/env node
// Proofline CLI. Exit codes: 0 PASS/ok, 1 FAIL, 2 BLOCKED, 3 usage error.
import fs from 'node:fs';
import * as P from '../src/index.mjs';
import { verifyChain, readLog } from '../src/evidence.mjs';
import { verifyReceipt } from '../src/verify-receipt.mjs';

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
const SWITCHES = ['fresh']; // never take a value: `verify --fresh T` keeps T as the task
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); if (v !== undefined) flags[k] = v; else if (!SWITCHES.includes(k) && argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true; }
  else pos.push(a);
}
const root = flags.root ? flags.root : P.findRoot();
const json = !!flags.json;
const print = (obj, text) => { process.stdout.write((json || text === undefined ? JSON.stringify(obj, null, 2) : text) + '\n'); };
const code = (d) => (d === 'PASS' ? 0 : d === 'BLOCKED' ? 2 : 1);
const owner = () => { if (flags.owner === true) throw new Error('--owner needs a name'); return flags.owner; };
const base = () => { if (flags.base === true) throw new Error('--base needs a revision'); return flags.base; };
const claims = () => flags['claims-file'] ? fs.readFileSync(flags['claims-file'], 'utf8') : flags.claims === true ? fs.readFileSync(0, 'utf8') : flags.claims;

const HELP = `proofline — independent V&V and delivery controller
  init [--no-hooks] [--approvals <dir>] create proofline.json, .proofline/, install git hooks;
                                        --approvals sets the directory of owner markers (re-runnable)
  contract create --from spec.json      add a task contract (or --id --title [--phase] [--owner n] [--depends a,b] [--scope g1,g2])
  contract validate | show
  next [--owner <name>]                 the single next task with its full brief (marks it active);
                                        --owner: only that owner's tasks and unowned ones
  brief <TASK> [--owner <name>] [--base <rev>]  brief for a task, with the base verify will use
                                        (refuses another owner's task)
  verify <TASK> [--claims "line"] [--base <rev>] [--fresh]   run every check independently; prints corrective prompt
  gate <TASK>|--all [--claims ...] [--base <rev>] [--fresh]  release decision PASS/FAIL/BLOCKED + report (.proofline/reports)
                                        --base: the revision the task started from (needed in a fresh clone
                                        unless \`next\` pinned it or HEAD carries a Proofline-Base: trailer)
                                        --fresh: run every check again, ignoring PASS results reused under
                                        defaults.reuse_results
  report <TASK>                         latest gate report
  status [--owner <name>]               task + phase status, evidence chain
  evidence record <type> --data '{..}' | evidence verify | evidence log
  verify-receipt <envelope> [--keys <dir>] [--sigstore] [--recompute --base <sha>]
                                        exit 0 verified, 1 failed or differs, 2 unknown key, 3 usage
  hook pre-commit|pre-push              (used by git hooks)
  mcp                                   MCP server on stdio
Global: --json  --root <dir>   Exit: 0 PASS, 1 FAIL, 2 BLOCKED, 3 usage`;

try {
  const [cmd, sub] = pos;
  switch (cmd) {
    case 'init': {
      if (flags.approvals === true) throw new Error('--approvals needs a directory');
      const r = P.init(root, { hooks: !flags['no-hooks'], approvals: flags.approvals });
      print(r, `initialised ${root}${r.made.map((m) => `\n  ${m}`).join('')}`);
      break;
    }
    case 'contract': {
      if (sub === 'create') {
        const spec = flags.from ? JSON.parse(fs.readFileSync(flags.from, 'utf8')) : { id: flags.id, title: flags.title, phase: flags.phase, owner: owner(), description: flags.description || '', depends_on: flags.depends ? String(flags.depends).split(',') : [], scope: flags.scope ? String(flags.scope).split(',') : undefined, criteria: [] };
        const specs = Array.isArray(spec) ? spec : spec.tasks || [spec];
        const out = specs.map((s) => P.contractCreate(root, s));
        print(out, out.map((o) => `${o.task.id}: ${o.valid ? 'valid' : 'INCOMPLETE — ' + o.problems.join('; ')}`).join('\n'));
        process.exitCode = out.every((o) => o.valid) ? 0 : 1;
      } else if (sub === 'validate') { const e = P.C.validate(P.C.load(root)); print({ valid: !e.length, problems: e }, e.length ? e.join('\n') : 'contract valid'); process.exitCode = e.length ? 1 : 0; }
      else if (sub === 'show') print(P.C.load(root));
      else { console.error(HELP); process.exitCode = 3; }
      break;
    }
    case 'next': { const n = P.taskNext(root, { owner: owner() }); print(n, n.brief || n.message); break; }
    case 'brief': { const b = P.taskBrief(root, sub, { owner: owner(), base: base() }); print({ brief: b }, b); break; }
    case 'verify': case 'gate': {
      const c = P.C.load(root);
      const ids = flags.all ? c.tasks.map((t) => t.id) : flags.ci ? (c.ci?.tasks || []) : [sub || P.activeTask(root)].filter(Boolean);
      if (!ids.length) { if (flags.ci) { const e = P.C.validate(c); print({ decision: e.length ? 'FAIL' : 'PASS', problems: e }, e.length ? e.join('\n') : 'contract valid; no ci.tasks'); process.exitCode = e.length ? 1 : 0; break; } throw new Error('which task? (proofline next)'); }
      const outs = ids.map((id) => P.E.gate(root, id, { claims: claims(), base: base(), fresh: flags.fresh === true, skipTypes: flags['skip-pushed'] || flags.ci ? ['pushed'] : [] }));
      const worst = outs.some((o) => o.decision === 'BLOCKED') ? 'BLOCKED' : outs.some((o) => o.decision === 'FAIL') ? 'FAIL' : 'PASS';
      print(outs.length === 1 ? outs[0] : { decision: worst, gates: outs.map((o) => ({ task: o.task, decision: o.decision, failing: o.failing, blocked: o.blocked })) },
        outs.map((o) => `== ${o.task}: ${o.decision}\n  base: ${o.base_ref} = ${o.base?.slice(0, 8) || 'not found'} (${o.base_source})\n${o.results.map((r) => `  ${r.status.toUpperCase().padEnd(5)} ${r.id} [${r.type}] ${r.detail.split('\n')[0]}`).join('\n')}${o.forbidden.length ? '\n  forbidden: ' + o.forbidden.map((f) => `${f.rule}@${f.file}`).join(', ') : ''}\n  report: ${o.report}\n\n${o.corrective_prompt}`).join('\n\n') + `\n\nDECISION: ${worst}`);
      process.exitCode = code(worst);
      break;
    }
    case 'report': { const r = P.report(root, sub); print(r, r.markdown || r.error); process.exitCode = r.error ? 1 : 0; break; }
    case 'status': { const s = P.status(root, { owner: owner() }); print(s, Object.entries(s.tasks).map(([k, v]) => `${k.padEnd(14)} ${v.status}`).join('\n') + '\n\n' + s.phases.map((p) => `${p.phase.padEnd(10)} ${p.verified}/${p.tasks}${p.open ? ' (open)' : ''}`).join('\n') + `\n\nevidence chain: ${s.chain.ok ? 'intact' : 'BROKEN'} (${s.chain.entries ?? '?'} entries); active: ${s.active || '-'}`); break; }
    case 'evidence': {
      if (sub === 'record') print(P.evidenceRecord(root, pos[2] || 'note', flags.data ? JSON.parse(flags.data) : {}));
      else if (sub === 'verify') { const v = verifyChain(root); print(v, v.ok ? `chain intact: ${v.entries} entries, head ${v.head.slice(0, 16)}` : `CHAIN BROKEN at ${v.at}: ${v.reason}`); process.exitCode = v.ok ? 0 : 2; }
      else if (sub === 'log') print(readLog(root));
      else { console.error(HELP); process.exitCode = 3; }
      break;
    }
    case 'verify-receipt': {
      if (!sub) { console.error(HELP); process.exitCode = 3; break; }
      const r = await verifyReceipt(sub, {
        root, keys: flags.keys === true ? undefined : flags.keys, sigstore: flags.sigstore === true,
        recompute: flags.recompute === true, base: flags.base === true ? undefined : flags.base,
      });
      print(r, r.message);
      process.exitCode = r.exitCode;
      break;
    }
    case 'hook': {
      const r = sub === 'pre-commit' ? P.hookPreCommit(root) : sub === 'pre-push' ? P.hookPrePush(root) : null;
      if (!r) { process.exitCode = 3; break; }
      if (!r.ok) { console.error(`proofline ${sub}: REFUSED\n${r.msg}\n(There is no bypass. Fix the cause.)`); process.exitCode = 1; }
      break;
    }
    case 'mcp': await import('../src/mcp.mjs').then((m) => m.serve(root)); break;
    default: console.log(HELP); process.exitCode = cmd ? 3 : 0;
  }
} catch (e) { console.error(`proofline: ${e.message}`); process.exitCode = 3; }
