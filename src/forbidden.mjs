// Forbidden-action scan over the diff (base → working tree). Deterministic, pattern based.
import fs from 'node:fs';
import path from 'node:path';
import { git, matchAny } from './util.mjs';
import { TEST_FILE_RE, diffHunks } from './checks.mjs';

const SKIP_RE = /\.(skip|only|todo)\s*\(|\{\s*(skip|only|todo)\s*:\s*(true|['"`])|\b(xit|xdescribe|fit|fdescribe)\s*\(|\btest\.todo\b|@pytest\.mark\.skip|\bt\.skip\s*\(/;
const TIMEOUT_RE = /timeout[^\d\n]{0,24}(\d[\d_]*)/i;
const ASSERT_RE = /\bassert\b|\bexpect\s*\(|\bt\.(is|ok|deepEqual|equal|throws|true|false)\b/;
const NOVERIFY_RE = /(--no-verify\b|\bgit\s+(commit|push)\b[^\n]*\s-n\b)/;

export function scanForbidden(root, base, rules = {}) {
  const findings = [];
  if (!base) return findings;
  const ign = rules.ignore_paths || [];
  const files = diffHunks(root, base).filter((f) => !matchAny(f.file, ign));
  for (const f of files) {
    const isTest = TEST_FILE_RE.test(f.file);
    let addA = 0, delA = 0;
    for (const h of f.hunks) {
      for (const l of h.add) {
        if (rules.test_skip_only !== false && isTest && SKIP_RE.test(l)) findings.push({ rule: 'test_skip_only', file: f.file, line: l.trim(), why: 'skipping/focusing tests hides failures' });
        if (rules.no_verify !== false && NOVERIFY_RE.test(l)) findings.push({ rule: 'no_verify', file: f.file, line: l.trim(), why: 'bypasses hooks/guards' });
        for (const e of rules.bypass_env || []) if (l.includes(e)) findings.push({ rule: 'bypass_env', file: f.file, line: l.trim(), why: `guard-bypass variable ${e}` });
        if (isTest && ASSERT_RE.test(l)) addA++;
      }
      for (const l of h.del) if (isTest && ASSERT_RE.test(l)) delA++;
      if (rules.timeout_raise !== false) {
        const num = (ls) => ls.map((l) => l.match(TIMEOUT_RE)).filter(Boolean).map((m) => +m[1].replace(/_/g, ''));
        const before = num(h.del), after = num(h.add);
        if (before.length && after.length && Math.max(...after) > Math.max(...before)) findings.push({ rule: 'timeout_raise', file: f.file, line: `${Math.max(...before)} → ${Math.max(...after)}`, why: 'raising a timeout treats the symptom; find why it is slow' });
      }
    }
    if (rules.assertion_removal !== false && isTest && delA > addA) findings.push({ rule: 'assertion_removal', file: f.file, line: `-${delA} +${addA} assertion lines`, why: 'net loss of assertions weakens the test' });
  }
  if (rules.test_file_deletion !== false) {
    for (const l of git(['diff', '--name-status', base, '--'], root).out.split('\n').filter(Boolean)) {
      const [st, a] = l.split('\t');
      if (st === 'D' && TEST_FILE_RE.test(a) && !matchAny(a, ign)) findings.push({ rule: 'test_file_deletion', file: a, line: 'deleted', why: 'deleting a test removes coverage (e.g. a crash guard)' });
    }
  }
  for (const pv of rules.protected_values || []) {
    const re = new RegExp(pv.pattern, 'm');
    const old = git(['show', `${base}:${pv.file}`], root);
    let now = ''; try { now = fs.readFileSync(path.join(root, pv.file), 'utf8'); } catch {}
    const a = old.ok ? old.out.match(re) : null, b = now.match(re);
    if (a && !b) findings.push({ rule: 'protected_value', file: pv.file, line: `/${pv.pattern}/ removed`, why: pv.why || 'protected value removed' });
    else if (a && b) {
      const x = +a[1], y = +b[1];
      if ((pv.direction || 'no_decrease') === 'no_decrease' ? y < x : y > x) findings.push({ rule: 'protected_value', file: pv.file, line: `${x} → ${y}`, why: pv.why || 'silent scope cut (cap/size/target changed)' });
    }
  }
  return findings;
}
