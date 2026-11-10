const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 10) { console.error('unexpected seq ' + s.seq + ' - aborting, no write'); process.exit(1); }
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
s.seq = 11;
s.updated_at = now;

const fresh = {
  W1: '55bcd7b2-0f05-5d4c-a4e9-20539b91eff4',
  W3: 'dc6a0e20-4eec-550e-a8ad-aac7ce3d0461',
  W4: '9a75b617-a937-55b7-a0a3-9b956e11dba9',
  W6: 'd9c706e3-ce07-5541-afec-cd1402e33d4e',
  W8: 'cc06f2a5-f106-5265-a0aa-2efdeb815a07',
};
const lost = {
  W1: 'fe8cc9d5-db52-5728-af43-03c5f842838b',
  W3: '22daf01a-79e1-53da-ac0b-936bdc397d4b',
  W4: '8175c995-25f7-5131-a7c1-be3326ade25e',
  W6: '672991ad-3892-5d7e-aac5-24d69942e7d9',
  W7: '07731194-268c-5996-a910-e55c8df0a4a2',
  W8: '88df3754-5680-5891-a86b-56323178746c',
};
for (const pk of s.plan.packets) {
  if (fresh[pk.id]) {
    pk.roles = Object.assign({}, pk.roles, {
      implementer: 'agent:worker-session ' + fresh[pk.id] + ' (resumed from disk after the 02:40Z mass failure)',
      previous_implementer_sessions: [ 'agent:worker-session ' + lost[pk.id] + ' (lost 02:40Z, work preserved on disk)' ],
    });
    pk.status = 'implementing';
  }
  if (pk.id === 'W7') {
    pk.roles = Object.assign({}, pk.roles, {
      implementer: 'agent:worker-session ' + lost.W7 + ' (finished its deliverable and report before the 02:40Z failure)',
      reviewer: 'agent:worker-session 6b2b946d-52a9-5f67-a75d-0febcc583e78 (independent of the implementer)',
    });
    pk.status = 'in-review';
  }
}

s.orchestration_findings.push({
  at: now, topic: 'MASS WORKER FAILURE at 02:40Z and recovery from disk',
  fact: 'Every worker conversation (W1, W3, W4, W6, W7, W8) and the first W7 reviewer ended in failed state within about 26 seconds of each other (02:40:10Z to 02:40:37Z) while their revisions had been climbing normally; a first W7 reviewer created at 02:40:11Z failed immediately with an empty message. The cause is UNDETERMINED. No sleep, resume, boot or shutdown event exists in the host System log for the previous 14 hours and the last boot was 2026-11-01, so a host power event is ruled out. Simultaneity plus the earlier "authentication expired" failures of the Agent-tool path suggest a shared credential or service-side expiry, but that is a hypothesis only. Replacement sessions created at 07:3xZ DO execute (the W7 reviewer was observed running 18 tool calls), so the fault was not permanent. The owner returned at about 07:26Z and reported all subagents failed.',
});
s.orchestration_findings.push({
  at: now, topic: 'work survived on disk - verified with explicit git commands at 07:27Z',
  fact: 'Nothing was lost. W1: 3 commits (a9e5a4d 260a013 763f6ff) + 12/4 uncommitted README.md lines. W3: 1 commit f0a5e84 (16 files, +937/-118), clean tree. W4: 2 commits (d969e0e 081ec5b) + 356/4 uncommitted lines in packages/client/src/index.ts and index.test.ts. W6: 3 commits (44658b8 ef7471d a9edd90), clean tree. W7: 3 commits (b1d9368 d3256a8 5a18a14) and a 11334-byte report. W8: worktree at base with zero commits and zero edits (genuinely not started). Replacement implementers were told to RESUME from the observed state, not redo it, and to stop and report if commits or edits they did not make appear.',
});
s.orchestration_findings.push({
  at: now, topic: 'DOUBLE-WRITER RISK from the lost sessions - open, mitigated, not eliminated',
  fact: 'The five lost implementer sessions (W1 fe8cc9d5, W3 22daf01a, W4 8175c995, W6 672991ad, W8 88df3754) cannot be read, waited on or stopped: every call returns CHAT_SESSION_CONFLICT. The orchestrator had sent each of them a resume message BEFORE realising they were unrecoverable, so they sit in an opening state and could in principle start executing and write into the same worktree as the replacement. Mitigation: each replacement brief contains an explicit single-writer check (compare git log and git diff --stat before every edit and commit; stop and report a blocker on any foreign change). Residual risk is therefore detectable, not impossible. If a worktree shows commits or edits that no live session claims, treat that packet as contaminated and re-verify from the diff.',
});
s.orchestration_findings.push({
  at: now, topic: 'keep-awake guard evaluated and not used',
  fact: 'A SetThreadExecutionState keep-awake script was written (orchestration/keep-awake.ps1, non-persistent, 10 hour hard cap, changes no power setting) and started, then stopped, because the System log showed no sleep or restart event that could explain the failure. It remains available if a later failure does correlate with sleep.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/011-implement.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq + ' phase=' + s.phase);
for (const pk of s.plan.packets) console.log(pk.id + ' ' + pk.status + ' | ' + ((pk.roles && pk.roles.implementer) || 'n/a'));
