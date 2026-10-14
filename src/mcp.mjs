// Minimal MCP server (JSON-RPC 2.0 over newline-delimited stdio). Zero dependencies.
import readline from 'node:readline';
import * as P from './index.mjs';

const BASE = { type: 'string', description: 'The revision the task started from. Needed in a fresh clone unless task_next pinned it or HEAD carries a Proofline-Base: trailer.' };
const TOOLS = [
  { name: 'contract_create', description: 'Add a task contract (id, title, phase, depends_on, scope, criteria with deterministic verifiers). Returns validity problems; a task without verifiers cannot pass.', inputSchema: { type: 'object', properties: { task: { type: 'object' } }, required: ['task'] } },
  { name: 'task_next', description: 'Return the single next task (phase- and dependency-gated) with its full brief. Call this before starting any work.', inputSchema: { type: 'object', properties: {} } },
  { name: 'evidence_record', description: 'Record agent-side evidence (notes, commands you ran). Stored hash-chained, but never used to pass a gate: verify re-runs everything itself.', inputSchema: { type: 'object', properties: { type: { type: 'string' }, data: { type: 'object' } }, required: ['type'] } },
  { name: 'verify', description: 'Independently run every acceptance check for a task, plus forbidden-action, scope, wiring and claim checks. Returns decision and a corrective prompt.', inputSchema: { type: 'object', properties: { task: { type: 'string' }, claims: { type: 'string', description: 'Your status line(s): TASK-ID | status | commit | tests | measured vs target | missing' }, base: BASE }, required: ['task'] } },
  { name: 'gate', description: 'Release decision PASS/FAIL/BLOCKED with Markdown+JSON evidence report.', inputSchema: { type: 'object', properties: { task: { type: 'string' }, claims: { type: 'string' }, base: BASE }, required: ['task'] } },
  { name: 'report', description: 'Latest gate report for a task (Markdown).', inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] } },
  { name: 'status', description: 'Task and phase status, evidence-chain integrity.', inputSchema: { type: 'object', properties: {} } },
];

export function handle(root, msg) {
  const { id, method, params = {} } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return ok({ protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'proofline', version: '0.1.0' } });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    const a = params.arguments || {};
    try {
      let r;
      switch (params.name) {
        case 'contract_create': r = P.contractCreate(root, a.task); break;
        case 'task_next': r = P.taskNext(root); break;
        case 'evidence_record': r = P.evidenceRecord(root, a.type, a.data || {}); break;
        case 'verify': { const g = P.E.verifyTask(root, a.task, { claims: a.claims, base: a.base }); r = { ...g, corrective_prompt: P.E.steer(g, P.C.load(root)) }; break; }
        case 'gate': r = P.E.gate(root, a.task, { claims: a.claims, base: a.base }); break;
        case 'report': r = P.report(root, a.task); break;
        case 'status': r = P.status(root); break;
        default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool ${params.name}` } };
      }
      const text = r.brief ? r.brief + '\n\n' + JSON.stringify({ task: r.task, phase: r.phase }) : r.corrective_prompt ? `DECISION: ${r.decision}\n\n${r.corrective_prompt}\n\n${JSON.stringify({ decision: r.decision, failing: r.failing, blocked: r.blocked, measured: r.measured })}` : r.markdown || JSON.stringify(r, null, 2);
      return ok({ content: [{ type: 'text', text }], isError: false });
    } catch (e) { return ok({ content: [{ type: 'text', text: `error: ${e.message}` }], isError: true }); }
  }
  if (id === undefined) return null; // notification
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

export function serve(root) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
    const r = handle(root, msg);
    if (r) process.stdout.write(JSON.stringify(r) + '\n');
  });
  return new Promise((res) => rl.on('close', res));
}
