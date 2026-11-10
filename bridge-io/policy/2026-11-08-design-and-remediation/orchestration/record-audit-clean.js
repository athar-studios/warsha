const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 52) { console.error('unexpected seq ' + s.seq); process.exit(1); }
s.seq = 53;
s.updated_at = now;

s.evidence_audit = {
  at: now,
  result: 'CLEAN - 0 problems',
  checks: {
    gates_with_verdicts: 108,
    judged_gates_with_a_real_non_empty_log: 106,
    deliberately_log_less: '2 (G3.9 and G5.11 - blocked on OD1, never run, and no log is claimed for them)',
    tally_agrees_between_acceptance_and_verdict: true,
    checkpoints: '52, monotonic, last seq matches state seq',
    secrets: '299 text artifacts scanned - no sk- key or private-key block found',
    handover_docs_present: 'OWNER_DECISIONS.md, COMPLETION_AUDIT.md, PHASE_B_NEXT_RUN.md, verdict.json, state.json, acceptance.json',
  },
  how_it_was_fixed: 'The first audit run reported 12 problems. Two were my audit script being wrong about blocked gates. Ten were REAL: every G7.* verdict cited a log file that did not exist. I re-derived all ten gates from a real shell on the integrated tree (G7.1, G7.2, G7.3, G7.4, G7.5, G7.6, G7.7, G7.A, G7.P, G7.S) and they all now have genuine logs. G7.2 BUILD SUCCESSFUL; G7.3 apksigner Verifies with CN=Warsha Remote; G7.5 grep exit 0 against the real 842,981-byte APK.',
};

s.orchestration_findings.push({
  at: now,
  topic: 'EVIDENCE AUDIT CLEAN - and it caught 10 verdicts that cited logs which did not exist',
  fact:
    'I audited the evidence set rather than assuming it was sound, and the audit found 12 problems. Two were artifacts of the audit itself (it did not exempt the two blocked gates that were legitimately never run). TEN WERE REAL: every G7.* verdict recorded a log path under gates/ that had never been written - the same "a claim with no artifact" failure I had already caught once for the 13 G1 gates. I re-derived all ten W7 gates on the integrated tree from a real shell: G7.1 remote build exit 0; G7.2 BUILD SUCCESSFUL (the first attempt failed in 9s only because ANDROID_HOME was unset in that shell - an environment gap, recorded in the log alongside the success); G7.3 apksigner.bat Verifies with CN=Warsha Remote and the expected certificate digest; G7.4 = 2 assets; G7.5 grep exit 0 against the real 842,981-byte APK after an earlier escaped-quoting derivation produced a FALSE exit 1 (both recorded); G7.6 exits 0 as the known self-referential defect with its intent check documented; G7.7 = 0; G7.A and G7.P clean; G7.S = 0 for W7 own delta. I also removed the log fields from G3.9 and G5.11, which were never run - claiming a log for an unrun gate is the same fault in miniature. Final audit: 108 gates, 106 with real non-empty logs, the 2 without being the two blocked gates, tally consistent between acceptance.json and verdict.json, 52 monotonic checkpoints, 299 text artifacts scanned with no secret, all six handover documents present, ZERO problems.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/053-audited.json', JSON.stringify(s, null, 2) + '\n');

const v = JSON.parse(fs.readFileSync(dir + 'verdict.json', 'utf8'));
v.evidence_audit = {
  result: 'CLEAN - 0 problems',
  judged_gates_with_real_log: '106 of 108; the 2 without are G3.9 and G5.11, blocked on OD1 and never run (no log claimed)',
  note: 'Ten G7.* verdicts originally cited logs that did not exist; all ten were re-derived and now have genuine logs. Two harness faults on the way (unset ANDROID_HOME producing a false G7.2 failure, and escaped quoting producing a false G7.5 failure) are recorded inside those logs rather than hidden.',
};
fs.writeFileSync(dir + 'verdict.json', JSON.stringify(v, null, 2) + '\n');

console.log('seq=' + s.seq + ' | evidence audit: CLEAN');
console.log('gates: ' + Object.entries((() => { const t = {}; for (const g of JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8')).gates) t[g.verdict] = (t[g.verdict] || 0) + 1; return t; })()).map(([k, n]) => k + '=' + n).join(' '));
