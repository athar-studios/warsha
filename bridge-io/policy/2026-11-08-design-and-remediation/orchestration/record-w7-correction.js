const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 11) { console.error('unexpected seq ' + s.seq + ' - aborting, no write'); process.exit(1); }
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
s.seq = 12;
s.updated_at = now;

const w7 = s.plan.packets.find(p => p.id === 'W7');
w7.roles = Object.assign({}, w7.roles, {
  implementer: 'agent:worker-session 691ba20c-8683-5271-a42c-4ecb0163f78f (repair iteration 1; original session 07731194 was archived)',
});
w7.status = 'repair';
w7.repair_iteration = 1;
s.repair.iteration = 1;
s.repair.open_findings = [
  'W7-R1: the report\'s G7.5 analysis is factually wrong (v2 signature is deterministic 0x0104, not randomized PSS); the observed drift is AGP dependency metadata + non-reproducible source maps. Repair: disable dependenciesInfo, exclude **/*.map from the packaged assets, then prove two consecutive rebuilds give an identical SHA-256 and record that hash.',
];

s.orchestration_findings.push({
  at: now, topic: 'ROOT CAUSE of the 02:40Z mass failure: the conversations were ARCHIVED',
  fact: 'Attempting to message the W7 implementer session returned CHAT_SESSION_CONFLICT with details.state = "archived". That explains every CHAT_SESSION_CONFLICT the orchestrator hit on the five lost implementer sessions: read, wait, message and stop all fail because the conversations are archived, not because they are wedged. So those sessions cannot wake up and cannot be a second writer - the earlier double-writer risk is CLOSED. The reason the sessions were archived at 02:40Z is still undetermined (no host power event; simultaneous across all sessions). Recovery is therefore by creating a new conversation that resumes from the worktree, which is what was done for W1, W3, W4, W6, W8 and now W7.',
});
s.orchestration_findings.push({
  at: now, topic: 'W7 G7.5 CORRECTION - not a gate defect; it is an in-scope implementation fix',
  fact: 'The orchestrator parsed the Apk Signing Block of the W7 artifact read-only. (1) Signer #1 uses signature algorithm id 0x0104 = RSASSA-PKCS1-v1_5 with SHA2-512, 512-byte signature: DETERMINISTIC, no PSS salt. The implementer report\'s randomization theory was wrong. (2) The block holds exactly three id-value pairs: v2 (2570 B value at offsets 1306136..1308706), AGP DEPENDENCY METADATA id 0x504b4453 (344 B value at 1308718..1309062), verity padding (1114 B). The implementer\'s measured differing range 1308724..1309062 lies entirely inside the AGP dependency-metadata value (its last 338 bytes), and the whole v2 signature block was byte-identical between builds. AGP encrypts that metadata block with a random session key per build - the real drift source. (3) A second drift source: three source maps ship inside the APK (index-*.js.map 1707300 B, sw.js.map 3599 B, workbox-*.js.map 147250 B); sw.js.map has a random per-build temp dir in sources and embeds absolute worktree paths, so the APK hash also depends on the worktree path - which would make GC.12 fail on the integration tree even with a deterministic signature. Both sources are packaging decisions inside W7 allowed scope apps/mobile/**: `dependenciesInfo { includeInApk = false; includeInBundle = false }` plus excluding **/*.map from the syncRemoteWebAssets task. Repair iteration 1 was dispatched to prove byte-identical rebuilds before recording any hash. Consequence: G7.5 is satisfiable without editing any gate, and the G7.5 item is removed from the owner-decision list.',
});

s.owner_decisions_required = (s.owner_decisions_required || []).filter(d => d.id === 'OD1');
s.owner_decisions_required.push({
  id: 'OD2', at: now, topic: 'W7 gate G7.6 is self-referential and can never pass',
  blocking: ['W7 G7.6'], blocking_scope: 'W7 acceptance only - W1/W3/W4/W6/W8 and the integration sweep are unaffected',
  question: 'How should G7.6 be resolved?',
  evidence: 'The frozen gate is: grep -rniE \'storePassword|keyPassword|WARSHA_KEYSTORE_PASSWORD=|WARSHA_KEY_PASSWORD=\' <evidence>/packets/W7, expect exit 1. That directory contains prompt.md, whose own gate-definition line contains those exact tokens, so the grep always matches. Re-verified by the orchestrator at 07:27Z: the frozen command exits 0 and the only matching file is packets/W7/prompt.md; excluding prompt.md exits 1, i.e. no implementer-authored evidence contains any secret.',
  options_for_owner: [
    'Amend the scan to exclude the brief itself (for example --exclude=prompt.md), which matches the gate intent.',
    'Move the packet brief out of the scanned directory in a future run.',
    'Accept the intent-check result (exit 1 with prompt.md excluded) as the verdict, recorded explicitly as a gate defect rather than a pass.',
  ],
  why_owner: 'No agent may edit, narrow or re-word a frozen gate, and re-passing a gate by redefinition is not a repair (ENGINEERING_POLICY section 1 Phase 6 and section 5). The orchestrator recorded the defect instead of touching the gate.',
  orchestrator_action: 'NOT performed - no gate edited, no prompt moved, no workaround applied.',
});
s.owner_decisions_required.push({
  id: 'OD3', at: now, topic: 'W7 gate G7.3 names a launcher that does not exist on Windows',
  blocking: [], blocking_scope: 'none - informational, the substantive check passes',
  question: 'No action strictly required; recorded for the owner\'s visibility.',
  evidence: 'G7.3 names the Unix `apksigner` script; Windows Android build-tools ship only apksigner.bat. The real .bat was run with the same arguments and verified the signature. packets/W7/prompt.md section 3 explicitly sanctions apksigner(.bat), so the gate text and the brief disagree. The gate text was not edited.',
  why_owner: 'Recording only; a future planner should align the gate text with the brief.',
  orchestrator_action: 'NOT performed - gate text untouched; the substantive verification is real.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/012-repair.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq + ' repair.iteration=' + s.repair.iteration);
console.log('owner decisions: ' + s.owner_decisions_required.map(d => d.id).join(', '));
for (const pk of s.plan.packets) console.log(pk.id + ' ' + pk.status);
