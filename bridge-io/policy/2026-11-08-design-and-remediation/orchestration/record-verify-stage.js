const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 13) { console.error('unexpected seq ' + s.seq + ' - aborting'); process.exit(1); }
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
s.seq = 14; s.updated_at = now;

const heads = {
  W1: '6d9728f52eb096199c4ace208435c8b8927e5140',
  W3: null,
  W4: 'c83af5e948fd578d2a8ed1355c5a0a81f2ec01fe',
  W6: 'a9edd90e92521c2c84da0b586f7191e5d52f45a5',
  W7: '7adbff4',
  W8: '0b8a7e89f987c1ffb6415110238e91514cd4aa9f',
};
const reviewSessions = {
  W1: '873b6235-2b37-5330-a808-52d8da54bf65',
  W4: '660f8ef3-e810-55ad-a9f8-4f28515fc9ea',
  W7: '032ce410-d72b-531a-abbf-e0ae59b36b97',
  W8: 'a0041da1-c933-5d36-a2b3-a61f84d0654f',
  W6: '02a7e3b3-75b0-5c7f-a89a-a9c01753c32c',
};
for (const pkt of s.plan.packets) {
  if (heads[pkt.id]) pkt.head_under_review = heads[pkt.id];
  if (reviewSessions[pkt.id]) {
    pkt.roles = Object.assign({}, pkt.roles, { reviewer: 'agent:worker-session ' + reviewSessions[pkt.id] + ' (independent of the implementer)' });
  }
  if (pkt.id === 'W6') {
    pkt.review_verdict = 'APPROVE';
    pkt.roles = Object.assign({}, pkt.roles, { verifier: 'agent:worker-session 3175c048-dafe-5df5-a28a-eb39be79c449 (independent of implementer and reviewer)' });
    pkt.status = 'verifying';
  }
  if (pkt.id === 'W7') pkt.status = 'in-review';
}

s.orchestration_findings.push({
  at: now, topic: 'W7 repair PROVED byte-reproducibility - a gate the implementer had called impossible now passes',
  fact: 'W7 HEAD is now 7adbff4 with two repair commits (e422ede fix(mobile) make the signed release APK byte-reproducible; 7adbff4 docs(mobile) record the reproducible hash and size). The fix is exactly the two in-scope packaging changes the orchestrator forensics indicated: `dependenciesInfo { includeInApk = false; includeInBundle = false }` in android {} removes the AGP dependency-metadata pair 0x504b4453 (the real randomized input), and `exclude **/*.map` in syncRemoteWebAssets removes the three source maps whose bytes embedded a random temp dir and absolute worktree paths. Two consecutive full clean cycles (pnpm --filter warsha-remote build; gradlew clean assembleRelease --no-daemon; sha256sum) produced the IDENTICAL SHA-256 ce60f2bd5183779de7fd6a3c7593e0a612e878c8a1c05960f308e06ea3ad01ff at 840,513 B (down from 1,312,517 B). The implementer verified the precache manifest in apps/remote/dist/sw.js lists 9 URLs and no .map entry, so precaching stays valid. INDEPENDENTLY RE-VERIFIED BY THE ORCHESTRATOR at 08:17Z: artifact size 840,513 B; sha256sum equals the recorded value exactly; apps/mobile/README.md contains that exact 64-hex token; the APK contains 0 *.map entries; the signing block now has exactly two pairs (0x7109871a v2 2570 B, 0x42726577 verity padding) with 0x504b4453 gone. 9 of 10 gates green; only G7.6 remains, which cannot pass by construction. The earlier PSS/randomized-signature conclusion was wrong and is retracted in the report.',
});
s.orchestration_findings.push({
  at: now, topic: 'W6 APPROVED by independent review; verification dispatched',
  fact: 'W6 review verdict APPROVE at 0772d50..a9edd90: 3 files +595/-18 matching the claim exactly, scope gate 0, no blockers, no majors. One MINOR product finding M1: the read-before-write guard ships unwired (FilesystemToolExecutor::new leaves read_guard None, agent_tools.rs:204-205, and warshad builds exactly that at crates/warshad/src/lib.rs:4865) while WorkProtectionPolicy::default() sets read_before_write: true (work_protection.rs:73) - so the product default policy is not honoured and wiring it as-is would block creating a brand-new file that can never have been read. Recorded as a follow-up, not a gate failure. An independent verifier was dispatched to re-run all 9 gates in its own clean detached worktree at a9edd90.',
});
s.orchestration_findings.push({
  at: now, topic: 'W1 and W4 implementation complete',
  fact: 'W1 HEAD 6d9728f, 5 commits, only the 9 allowed READMEs, +447/-99, all 13 gates reported green by the implementer. W4 HEAD c83af5e, 5 commits, 4 files +1241/-44, harness RPC_METHODS 44 -> 75, W9 client-subset-of-harness check added with a self-test mutant, client tests expanded; intake counts independently confirmed at BASE (88 daemon #[method] registrations, 17 client names with no harness stub, 44 pre-existing RPC_METHODS), and the report reconciles once-unstubbed-44 vs 31-stubs-added correctly (the harness answers every method the client SENDS, 61 client names). Independent reviews dispatched for both.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/014-verify.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq);
for (const pk of s.plan.packets) console.log(pk.id + ' ' + pk.status + ' head=' + (pk.head_under_review || '-'));
