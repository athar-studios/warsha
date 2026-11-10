const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 12) { console.error('unexpected seq ' + s.seq + ' - aborting'); process.exit(1); }
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
s.seq = 13; s.updated_at = now;

const reviews = { W6: '02a7e3b3-75b0-5c7f-a89a-a9c01753c32c', W8: 'a0041da1-c933-5d36-a2b3-a61f84d0654f' };
for (const pk of s.plan.packets) {
  if (reviews[pk.id]) {
    pk.roles = Object.assign({}, pk.roles, { reviewer: 'agent:worker-session ' + reviews[pk.id] + ' (independent of the implementer)' });
    pk.status = 'in-review';
    pk.head_under_review = pk.id === 'W6' ? 'a9edd90e92521c2c84da0b586f7191e5d52f45a5' : '0b8a7e89f987c1ffb6415110238e91514cd4aa9f';
  }
}

s.orchestration_findings.push({
  at: now, topic: 'W6 and W8 implementation reported; independent reviews dispatched',
  fact: 'W6 HEAD a9edd90: 3 files (+595/-18), 18 new tests (5+8+5) so warsha-pipeline 341 -> 359 which satisfies the >= 350 gate; the resumed session read the full diff, ran all 9 gates green on the first run and made NO code edits, so nothing was redone. W8 HEAD 0b8a7e8: 2 files (+178/-124) but the semantic diff with -w is only about +8/-1, the rest being re-indentation from wrapping the map body one JSX level deeper; the fix moves the connectors description outside the Ledger and renders the Ledger only when integrations.length > 0, so the empty catalogue renders no list element at all. W8 recorded four decisions, including that SettingsScreenIntegrations.test.tsx already existed at BASE and was extended append-only (no existing test weakened), and that the description must stay unconditional because gating it would delete visible text and move pixels. Two independent reviewer sessions were created (W6 02a7e3b3, W8 a0041da1).',
});
s.orchestration_findings.push({
  at: now, topic: 'Linux gate harness built and validated',
  fact: 'orchestration/run-linux-gate.sh verifies one commit in a throwaway clean worktree at /root/verify-<label> on the authoritative WSL x86_64 host: it refuses to run while 5173/5174 already have a listener (both projects use reuseExistingServer:false so a concurrent run yields false failures and could orphan dev servers), fetches objects from the Windows checkout additively without pushing and without touching /root/warsha-visual, installs with --frozen-lockfile, runs the named Playwright project with the repo fontconfig pin, then records snapshot_writes and dirty_after. Validated end-to-end at the planner commit in --list-only mode: install exit 0, desktop "Total: 793 tests in 6 files", remote "Total: 91 tests in 2 files", snapshot_writes 0, dirty_after 0 - i.e. it reproduces the G0 listing exactly. Environment matches G0: CI unset, 3 workers.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/013-review.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq);
for (const pk of s.plan.packets) console.log(pk.id + ' ' + pk.status);
