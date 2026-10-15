// Parse an agent's status report and check every claim against evidence. Claims are never trusted.
import { git, onRemote } from './util.mjs';

const DONE = /^(done|complete(d)?|verified|pass(ed)?|fixed|finished|green)$/i;
const HEDGE = /\b(should work|likely|probably|untested|not tested|later|follow[- ]?up|out of scope|defer(red)?|todo|next session|in a future)\b/i;

/** Lines: TASK-ID | status | commit | tests | measured vs target | missing */
export function parseClaims(text, taskIds) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    if (!raw.includes('|')) continue;
    const cells = raw.split('|').map((s) => s.trim()).filter((s, i, a) => !(s === '' && (i === 0 || i === a.length - 1)));
    if (cells.length < 2) continue;
    const id = cells[0].replace(/[*`]/g, '');
    if (taskIds && !taskIds.includes(id)) continue;
    out.push({ raw: raw.trim(), id, status: cells[1] || '', commit: cells[2] || '', tests: cells[3] || '', numbers: cells[4] || '', missing: cells[5] || '' });
  }
  return out;
}

/** results: per-task { decision, measured: {key: val}, metricLabels: {key: [aliases]} } */
export function checkClaim(root, claim, res, { requirePushed = false, remote = 'origin', branch = 'main' } = {}) {
  const issues = [];
  const claimedDone = DONE.test(claim.status.replace(/[^a-z]/gi, ''));
  if (claimedDone && res.decision !== 'PASS') issues.push(`claimed "${claim.status}" but the independent gate says ${res.decision}: ${res.failing.join('; ') || 'see report'}`);
  if (HEDGE.test(claim.raw)) issues.push(`hedged or deferred wording ("${claim.raw.match(HEDGE)[0]}"): not an acceptable status; never defer, report blocked with what you need`);
  const sha = (claim.commit.match(/\b[0-9a-f]{7,40}\b/i) || [])[0];
  if (claimedDone && !sha) issues.push('claimed done without a commit hash');
  if (sha) {
    const full = git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], root);
    if (!full.ok) issues.push(`commit ${sha} does not exist`);
    else {
      if (!git(['merge-base', '--is-ancestor', full.out, 'HEAD'], root).ok) issues.push(`commit ${sha} is not in HEAD's history`);
      if (requirePushed) {
        const o = onRemote(root, full.out, remote, branch);
        if (!o.ok) issues.push(`cannot check that commit ${sha} is on ${remote}/${branch}: ${o.err}`);
        else if (!o.contains) issues.push(`commit ${sha} is not on ${remote}/${branch}${o.unknown ? ` (its tip ${o.tip.slice(0, 8)} could not be fetched)` : ''}`);
      }
    }
  }
  const names = claim.tests.split(/[,;]+/).map((s) => s.trim().replace(/^`|`$/g, '')).filter((s) => s && !/^(-|n\/a|none)$/i.test(s));
  if (claimedDone && !names.length) issues.push('claimed done without naming the test(s) that prove it');
  for (const n of names) {
    const base = n.replace(/\s*\(.*\)$/, '').split(/\s+/)[0];
    if (!git(['grep', '-q', '-F', base], root).ok && !git(['ls-files', '--', `*${base}*`], root).out) issues.push(`named test "${base}" not found in the repo`);
  }
  const keys = Object.keys(res.measured || {});
  if (claimedDone && keys.length && !/\d/.test(claim.numbers)) issues.push(`task has metric targets (${keys.join(', ')}) but the claim gives no measured numbers`);
  for (const k of keys) {
    const aliases = [k, ...(res.metricLabels?.[k] || [])];
    for (const a of aliases) {
      const m = claim.numbers.match(new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\D{0,12}?(\\d+(?:\\.\\d+)?)', 'i'));
      if (!m) continue;
      const said = +m[1], got = res.measured[k];
      if (Math.abs(said - got) > Math.max(0.15 * Math.abs(got), 1)) issues.push(`claimed ${a} ${said} but measured ${got}`);
      break;
    }
  }
  return { claim: claim.raw, id: claim.id, ok: issues.length === 0, issues };
}
