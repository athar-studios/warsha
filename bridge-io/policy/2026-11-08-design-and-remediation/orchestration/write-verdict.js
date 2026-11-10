const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));
const byV = {};
for (const g of ap.gates) byV[g.verdict] = (byV[g.verdict] || 0) + 1;

const v = {
  schema: 'warsha-run/v1#verdict',
  run_id: s.run_id,
  generated_at: now,
  integration_tip: 'a9dad9a',
  base_commit: '0772d502002562505c6438ae712abca7a7328d84',
  dev_commit: '642ae95',
  verdict: 'NOT ACCEPTED',
  accepted: false,
  reason:
    'The run is not green and cannot become green without owner decisions. Two frozen ' +
    'linux-capture-host gate groups are unsatisfiable by any agent action: the 40 stale remote ' +
    'baselines (OD1) and the self-referential G7.6 (OD2). W5 is held back on a genuine conflict ' +
    'between two frozen gates (OD4). The recorded G0 baseline was never all-green by design. ' +
    'No gate was edited, narrowed or re-worded to change any outcome, and dev was never touched.',
  gate_tally: byV,
  gate_total: ap.gates.length,
  merged: [
    { checkpoint: 'C0', tip: '5abe5ef', packets: ['W8'] },
    { checkpoint: 'C1', tip: '99a7c03', packets: ['W1', 'W6', 'W7', 'W4'] },
    { checkpoint: 'C1.5', tip: '406240a', packets: ['W3'] },
    { checkpoint: 'C2a', tip: 'c2709169', packets: ['W2'] },
    { checkpoint: 'C2b', tip: 'a9dad9a', packets: ['W2 repair iteration 2'] },
  ],
  held_back: [
    {
      packet: 'W5',
      status: 'implemented + review APPROVE + 14/14 worktree gates',
      blocked_on: 'OD4',
      rehearsal:
        'scratch/od4-rehearsal ffd19e7 with OD4 option 1 applied measures desktop 793 passed / 0 failed / ' +
        '0 snapshot writes, desktop unit 464 >= 451, @warsha/ui 181 at APP_LENGTH_BUDGET=0',
    },
  ],
  gate_headlines: {
    G0:
      'fail - recorded baseline truth at the planner commit: desktop 793 listed / 785 passed / 8 failed, ' +
      'remote 91 listed / 51 passed / 40 failed',
    desktop_pixel_neutrality:
      'proven three times on the capture host: G8.4, G3.8 and G4.9 each measured 793 passed / 0 failed ' +
      'with zero snapshot writes',
    GC_provisional:
      'GC.1, GC.2, GC.3, GC.5, GC.6, GC.7, GC.8, GC.9 and GC.11 pass at the C2a/C2b tips but are ' +
      'PROVISIONAL and must be re-run at the final tip',
    'GC.4':
      'partial - all four stages exit 0, but desktop is 446 against the stated floor of 451 because W5 ' +
      '(which adds 18 tests) is unmerged',
    'GC.10':
      'cannot pass - needs desktop 793/0 (reachable and rehearsed) AND remote 91/0 (blocked on OD1)',
    'GC.12':
      'measured and FAILS by sequencing: the remote bundle changed on the integrated tree ' +
      '(index.html 5ce10767 -> 16a7bf9c, sw.js b100e927 -> 1a9fb2ca), so the APK SHA-256 recorded in ' +
      'apps/mobile/README.md can no longer match. The APK must be rebuilt and the hash re-recorded AFTER ' +
      'W5 merges (OD5).',
  },
  integrity: {
    frozen_gates_edited: 0,
    snapshots_touched: 0,
    secrets_in_evidence:
      'gitleaks: no leaks found, 120 commits / ~50 MB; the provider key pasted into chat never entered any revision',
    pushed: false,
    published: false,
    released: false,
    dev_merged: false,
    gates_with_verdict_but_missing_log: 0,
    evidence_audit:
      'An audit found 13 G1.* verdicts with no log file; the orchestrator re-ran all 13 at 6d9728f and ' +
      'they reproduce their frozen expectation.',
  },
  orchestrator_errors_disclosed: [
    'Called the G5.10 failure a pixel regression; it was a string-coupled e2e assertion (retracted, checkpoint 028).',
    'Briefed W2 to fix a fence inside the planner-owned docs/designs/DESIGN_SYSTEM_V2.md; corrected before W2 acted (checkpoint 033).',
    'Recorded 13 W1 gate verdicts without log files; re-derived them (checkpoint 038).',
    'An own-harness quoting bug manufactured a false G1.4 failure; caught by reading the log body, not the exit code.',
  ],
  blocked_on: (s.owner_decisions_required || []).map((d) => ({ id: d.id, topic: d.topic })),
  next_step:
    'Owner approves OD4 (option 1). Then: merge W5 -> INT-2 -> full GC.1-GC.12 at the final tip -> ' +
    'OD1 baseline refresh -> OD5 APK rebuild and hash re-record -> owner acceptance -> merge to dev.',
};

fs.writeFileSync(dir + 'verdict.json', JSON.stringify(v, null, 2) + '\n');
console.log('verdict.json written: ' + v.verdict);
console.log('gates: ' + JSON.stringify(byV) + ' / total ' + ap.gates.length);
console.log('blocked_on: ' + v.blocked_on.map((d) => d.id).join(', '));
