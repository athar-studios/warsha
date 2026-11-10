const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 50) { console.error('unexpected seq ' + s.seq); process.exit(1); }
s.seq = 51;
s.updated_at = now;

const od1 = s.owner_decisions_required.find((d) => d.id === 'OD1');
od1.root_cause_located = {
  at: now,
  rpc: 'runs.subscribe - packages/client/src/index.ts:1492 subscribeRun, decoded by decodeRunStreamSync',
  harness: 'apps/remote/e2e/harness.ts (182 lines); its entire stub surface is declared at line 77 as rpc: [health, runs.list] - so 2 of roughly 75 daemon methods are stubbed',
  consequence: 'the Run screen correctly reports that its stream ended, which is what the Reconnect banner is',
  why_not_fixed_here: 'Making the harness daemon-true is Phase B content: DESIGN_SYSTEM_V2 section 9 lists "harness stub shapes made daemon-true" under the visual wave, and decision D1 puts Phase B outside this run and under owner authority. Doing it now would also be scope expansion into a new packet mid-run.',
  spec_written: 'PHASE_B_NEXT_RUN.md - the exact RPC, file, line, why the refresh must come after, the packet gates to freeze, and the things not to do.',
};

s.orchestration_findings.push({
  at: now,
  topic: 'OD1 root cause located precisely - and it is why the refresh must wait for Phase B',
  fact:
    'I traced the reconnect banner to its cause rather than leaving it as an observation. The remote client calls runs.subscribe (packages/client/src/index.ts:1492, decodeRunStreamSync), but apps/remote/e2e/harness.ts declares its whole stubbed RPC surface on one line (line 77) as rpc: [health, runs.list]. So the harness answers 2 of roughly 75 daemon methods and the Run screen is right to say the stream ended. That makes the 40 remote diffs a MIXTURE: genuine new product surface (the Add-a-project form on Projects, the Run panel) AND an artifact that exists only because the harness is thin. Refreshing the baselines now would freeze the artifact. Making the harness daemon-true is explicitly Phase B per design-spec section 9 and owner-reserved per D1, so I did not do it; instead I wrote PHASE_B_NEXT_RUN.md specifying the exact method, file and line, the order of operations, the gates a future packet should freeze (including extending wire check W9 to the remote harness, which currently has no equivalent), and the things that must not be done (no refresh to legitimise the banner, no daemon-untrue stub, no widening into apps/remote/src).',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/051-od1-cause.json', JSON.stringify(s, null, 2) + '\n');

const v = JSON.parse(fs.readFileSync(dir + 'verdict.json', 'utf8'));
v.od1_root_cause =
  'runs.subscribe is unstubbed: apps/remote/e2e/harness.ts:77 declares rpc: [health, runs.list], i.e. 2 of ~75 daemon methods. The reconnect banner is therefore a harness artifact, and refreshing baselines before closing that gap would freeze the artifact. Phase B spec written to PHASE_B_NEXT_RUN.md.';
fs.writeFileSync(dir + 'verdict.json', JSON.stringify(v, null, 2) + '\n');

console.log('seq=' + s.seq + ' OD1 root cause recorded');
console.log('handover docs:');
for (const f of ['OWNER_DECISIONS.md', 'COMPLETION_AUDIT.md', 'PHASE_B_NEXT_RUN.md', 'verdict.json', 'state.json']) {
  console.log('  ' + f + ' — ' + fs.statSync(dir + f).size + ' B');
}
