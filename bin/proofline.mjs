#!/usr/bin/env node
// Proofline CLI. Exit codes: 0 PASS/ok, 1 FAIL, 2 BLOCKED, 3 usage error.
import fs from 'node:fs';
import path from 'node:path';
import * as P from '../src/index.mjs';
import { verifyChain, readLog } from '../src/evidence.mjs';
import { verifyReceipt } from '../src/verify-receipt.mjs';
import { buildReceipt } from '../src/receipt.mjs';
import { connectClaudeCode, hookStop } from '../src/hook-stop.mjs';
import * as G from '../src/guided.mjs';
import * as S from '../src/signature.mjs';

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
const SWITCHES = ['fresh']; // never take a value: `verify --fresh T` keeps T as the task
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); if (v !== undefined) flags[k] = v; else if (!SWITCHES.includes(k) && argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true; }
  else pos.push(a);
}
// --version (or -v) on its own prints the installed package version and exits 0, before any repository is read.
if ((pos.length === 0 && flags.version === true && Object.keys(flags).length === 1) || (argv.length === 1 && argv[0] === '-v')) {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}
const root = flags.root ? flags.root : P.findRoot();
const json = !!flags.json;
const print = (obj, text) => { process.stdout.write((json || text === undefined ? JSON.stringify(obj, null, 2) : text) + '\n'); };
const code = (d) => (d === 'PASS' ? 0 : d === 'BLOCKED' ? 2 : 1);

function ownerGate(root) {
  const r = S.verifyContractSignature(root);
  if (!r.armed || r.ok) return true;
  console.error(`proofline: contract not owner-signed\n${r.detail}`);
  process.exitCode = 2;
  return false;
}
const owner = () => { if (flags.owner === true) throw new Error('--owner needs a name'); return flags.owner; };
const base = () => { if (flags.base === true) throw new Error('--base needs a revision'); return flags.base; };
const claims = () => flags['claims-file'] ? fs.readFileSync(flags['claims-file'], 'utf8') : flags.claims === true ? fs.readFileSync(0, 'utf8') : flags.claims;

const HELP = `proofline: independent V&V and delivery controller
  setup [--agent claude-code|none]      init, hooks, the owner key, approvals at .proofline/approvals
  task "<plain words>"                  write a proposal from those words and print its hash
  contract approve [<hash>]             show the diff; on y write the marker and apply the bytes
  contract sign                          write proofline.json.sig with the owner key
  contract verify-sig                    check the owner signature
  contract propose                       write proposals/<sha256>.diff and print the hash
  watch [TASK]                          print the active task until the gate is PASS
  init [--no-hooks] [--approvals <dir>] create proofline.json, .proofline/, install git hooks;
                                        --approvals sets the directory of owner markers (re-runnable)
  contract create --from spec.json      add a task contract (or --id --title [--phase] [--owner n] [--depends a,b] [--scope g1,g2])
  contract scaffold --title ... --scope a,b [--kind feature|docs|release] [--id TASK]
                                        print a task with the standard criteria and stop rules
  contract merge <fragment.json> [--owners a=b,c=d]
                                        append tasks and new owner rules; prints the sha256
  contract coverage <REQUIREMENTS.md> [--contracts a.json,b.json]
                                        one line per requirement id, or MISSING
  contract validate | show              validate also warns when a grep already matches on the base revision
  next [--owner <name>] [--base <rev>]  the single next task with its full brief (marks it active);
                                        --owner limits the lane; --base re-pins the base
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
  receipt [--role <name>] [--base <rev>] [--vault]
                                        one receipt for the revision; --vault writes the note when a daemon answers
  hook pre-commit|pre-push              (used by git hooks)
  hook stop                             read a Stop hook payload on stdin; one receipt for new commits, or silence
  connect claude-code                   merge a Stop hook into ~/.claude/settings.json, after any hook already there
  mcp                                   MCP server on stdio
  --version                             print the installed version
Global: --json  --root <dir>   Exit: 0 PASS, 1 FAIL, 2 BLOCKED, 3 usage`;

const GLOBAL_FLAGS = ['json', 'root'];
const ACCEPTED_FLAGS = {
  setup: ['agent'],
  task: [],
  init: ['approvals', 'no-hooks'],
  'contract create': ['from', 'id', 'title', 'phase', 'owner', 'description', 'depends', 'scope'],
  'contract merge': ['owners'],
  'contract coverage': ['contracts'],
  'contract scaffold': ['title', 'scope', 'kind', 'id'],
  'contract approve': [],
  'contract sign': [],
  'contract verify-sig': [],
  'contract propose': [],
  'contract validate': ['base'],
  'contract show': [],
  next: ['owner', 'base'],
  brief: ['owner', 'base'],
  verify: ['claims', 'claims-file', 'base', 'fresh'],
  gate: ['claims', 'claims-file', 'base', 'fresh', 'all', 'ci', 'skip-pushed'],
  report: [],
  status: ['owner'],
  'evidence record': ['data'],
  'evidence verify': [],
  'evidence log': [],
  'verify-receipt': ['keys', 'sigstore', 'recompute', 'base'],
  receipt: ['base', 'role', 'task', 'vault'],
  hook: [],
  watch: [],
  connect: [],
  mcp: [],
};

function refuseUnknownFlags(cmd, sub) {
  if (!cmd) return;
  const key = sub ? `${cmd} ${sub}` : cmd;
  const accepted = ACCEPTED_FLAGS[key] ?? ACCEPTED_FLAGS[cmd];
  if (!accepted) return;
  const allow = new Set([...GLOBAL_FLAGS, ...accepted]);
  const bad = Object.keys(flags).filter((k) => !allow.has(k));
  if (!bad.length) return;
  const named = bad.map((k) => `--${k}`).join(', ');
  const ok = [...allow].sort().map((k) => `--${k}`).join(', ');
  console.error(`proofline: unknown flag ${named}\naccepted: ${ok}`);
  process.exit(2);
}

try {
  const [cmd, sub] = pos;
  refuseUnknownFlags(cmd, sub);
  switch (cmd) {
    case 'setup': {
      const agent = flags.agent === undefined ? 'none' : flags.agent;
      if (agent === true) throw new Error('unknown agent\nNext step: proofline setup --agent none');
      process.stdout.write(G.setup(root, { agent: String(agent) }));
      break;
    }
    case 'task': {
      process.stdout.write(G.task(root, pos.slice(1).join(' ')));
      break;
    }
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
      } else if (sub === 'validate') {
        const loaded = P.C.load(root);
        const { errors, warnings } = P.C.lint(loaded, { root, base: base() || P.C.defaultBase(loaded) });
        const lines = [...errors, ...warnings.map((w) => `warning: ${w}`)];
        print({ valid: !errors.length, problems: errors, warnings }, lines.length ? lines.join('\n') : 'contract valid');
        process.exitCode = errors.length ? 1 : 0;
      } else if (sub === 'merge') {
        const frag = pos[2];
        if (!frag) throw new Error('contract merge needs a fragment file');
        const owners = flags.owners && flags.owners !== true ? String(flags.owners) : '';
        const out = P.C.mergeContract(root, path.resolve(root, frag), { owners });
        print(out, out.sha256);
      } else if (sub === 'coverage') {
        const req = pos[2];
        if (!req) throw new Error('contract coverage needs a requirements file');
        const contracts = flags.contracts && flags.contracts !== true ? String(flags.contracts).split(',').map((s) => s.trim()).filter(Boolean) : [];
        const out = P.C.coverageReport(root, path.resolve(root, req), { contracts: contracts.map((f) => path.resolve(root, f)) });
        print(out, out.lines.join('\n'));
        process.exitCode = out.ok ? 0 : 1;
      } else if (sub === 'scaffold') {
        if (typeof flags.title !== 'string') throw new Error('scaffold needs --title');
        if (typeof flags.scope !== 'string') throw new Error('scaffold needs --scope');
        const kind = flags.kind && flags.kind !== true ? String(flags.kind) : 'feature';
        const id = typeof flags.id === 'string' ? flags.id : 'TASK';
        const task = P.C.scaffoldTask({ title: flags.title, scope: flags.scope, kind, id });
        print(task, JSON.stringify(task, null, 2));
      }
      else if (sub === 'sign') process.stdout.write(S.signContract(root));
      else if (sub === 'verify-sig') {
        const r = S.verifyContractSignature(root);
        if (!r.ok) { console.error(`proofline: contract not owner-signed\n${r.detail}`); process.exitCode = 2; }
        else process.stdout.write(`${r.detail}\n`);
      }
      else if (sub === 'propose') process.stdout.write(S.proposeContract(root));
      else if (sub === 'approve') {
        process.stdout.write(G.approve(root, pos[2]));
      }
      else if (sub === 'show') print(P.C.load(root));
      else { console.error(HELP); process.exitCode = 3; }
      break;
    }
    case 'next': {
      if (!ownerGate(root)) break;
      const n = P.taskNext(root, { owner: owner(), ...(flags.base === undefined ? {} : { base: base() }) }); print(n, n.brief || n.message); break;
    }
    case 'brief': {
      if (!ownerGate(root)) break;
      const b = P.taskBrief(root, sub, { owner: owner(), base: base() }); print({ brief: b }, b); break;
    }
    case 'verify': case 'gate': {
      if (!ownerGate(root)) break;
      const requested = sub;
      const settled = P.settleLanded(root);
      if (settled && !flags.all && !flags.ci && (!requested || requested === settled.task)) {
        print({ landed: true, task: settled.task }, settled.message);
        break;
      }
      const c = P.C.load(root);
      const ids = flags.all ? c.tasks.map((t) => t.id) : flags.ci ? (c.ci?.tasks || []) : [requested || P.activeTask(root)].filter(Boolean);
      if (!ids.length) {
        if (flags.ci) {
          // Clearing ci.tasks is still a contract change. Refuse it before the empty-list short-circuit.
          const refusal = P.E.unapprovedContractChange(root, base());
          if (refusal) { print({ decision: 'BLOCKED', blocked: [refusal] }, `${refusal}\n\nDECISION: BLOCKED`); process.exitCode = 2; break; }
          const e = P.C.validate(c); print({ decision: e.length ? 'FAIL' : 'PASS', problems: e }, e.length ? e.join('\n') : 'contract valid; no ci.tasks'); process.exitCode = e.length ? 1 : 0; break;
        }
        throw new Error('which task? (proofline next)');
      }
      const outs = ids.map((id) => P.E.gate(root, id, { claims: claims(), base: base(), fresh: flags.fresh === true, skipTypes: flags['skip-pushed'] || flags.ci ? ['pushed'] : [] }));
      const worst = outs.some((o) => o.decision === 'BLOCKED') ? 'BLOCKED' : outs.some((o) => o.decision === 'FAIL') ? 'FAIL' : 'PASS';
      const note = settled ? `${settled.message}\n\n` : '';
      print(outs.length === 1 ? outs[0] : { decision: worst, gates: outs.map((o) => ({ task: o.task, decision: o.decision, failing: o.failing, blocked: o.blocked })) },
        note + outs.map((o) => `== ${o.task}: ${o.decision}\n  base: ${o.base_ref} = ${o.base?.slice(0, 8) || 'not found'} (${o.base_source})\n${o.results.map((r) => `  ${r.status.toUpperCase().padEnd(5)} ${r.id} [${r.type}] ${r.detail.split('\n')[0]}`).join('\n')}${o.forbidden.length ? '\n  forbidden: ' + o.forbidden.map((f) => `${f.rule}@${f.file}`).join(', ') : ''}\n  report: ${o.report}\n\n${o.corrective_prompt}`).join('\n\n') + `\n\nDECISION: ${worst}`);
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
    case 'receipt': {
      const r = await buildReceipt(root, {
        base: flags.base === true ? undefined : flags.base,
        role: flags.role === true ? undefined : flags.role,
        task: flags.task === true ? undefined : flags.task,
        vault: flags.vault === true,
      });
      print(r);
      break;
    }
    case 'hook': {
      if ((sub === 'pre-commit' || sub === 'pre-push') && !ownerGate(root)) break;
      if (sub === 'stop') {
        let payload = {};
        try {
          const raw = fs.readFileSync(0, 'utf8');
          if (raw.trim()) payload = JSON.parse(raw);
        } catch { break; }
        const where = flags.root ? root : (payload.cwd || root);
        const out = await hookStop(where, payload);
        if (out.receipts.length === 1) print(out.receipts[0]);
        break;
      }
      let lines;
      if (sub === 'pre-push' && !process.stdin.isTTY) lines = fs.readFileSync(0, 'utf8').split('\n').filter((l) => l.trim());
      const pushUrl = typeof pos[3] === 'string' ? pos[3] : undefined;
      const r = sub === 'pre-commit' ? P.hookPreCommit(root) : sub === 'pre-push' ? P.hookPrePush(root, { lines, pushUrl }) : null;
      if (!r) { process.exitCode = 3; break; }
      if (!r.ok) { console.error(`proofline ${sub}: REFUSED\n${r.msg}\n(There is no bypass. Fix the cause.)`); process.exitCode = 1; }
      else if (r.msg) console.error(r.msg);
      break;
    }
    case 'watch': {
      process.exitCode = G.watch(root, sub);
      break;
    }
    case 'connect': {
      if (sub !== 'claude-code') { console.error(HELP); process.exitCode = 3; break; }
      const r = connectClaudeCode();
      if (!r.ok) { console.error(`proofline connect: ${r.reason}`); process.exitCode = 1; break; }
      print(r, `hook installed in ${r.file}`);
      break;
    }
    case 'mcp': await import('../src/mcp.mjs').then((m) => m.serve(root)); break;
    default: console.log(HELP); process.exitCode = cmd ? 3 : 0;
  }
} catch (e) { console.error(`proofline: ${e.message}`); process.exitCode = 3; }
