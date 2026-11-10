const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 49) { console.error('unexpected seq ' + s.seq); process.exit(1); }
s.seq = 50;
s.updated_at = now;

const od1 = s.owner_decisions_required.find((d) => d.id === 'OD1');
od1.visual_evidence = {
  at: now,
  pack: 'od1-visual-review/ — 40 cases x expected/actual/diff = 120 PNGs (4.4 MB), copied from the OD4 rehearsal run on the capture host. Zero baseline files created, changed or deleted.',
  index: 'od1-visual-review/INDEX.md — 40 cases across 5 screen states: needs-you 12, needs-you-dense 4, needs-you-permission 4, projects 8, run 12 (0 unparsed folder names).',
  observed: [
    'projects 390x844 en light: the diff highlights exactly the new "Add a project" form (name, description, Create button); the board above is unchanged. This case is genuine added product surface from b3dc490 — a refresh would be correct.',
    'run 390x844 en light: the actual render is a coherent deliberate screen (header, daemon online, budget, Current run, Project runs list, Run panel with run id/status/stage/last update, Open the gates inbox with "1 gate waiting on you") BUT it also shows a banner: "The event stream stopped. Nothing you sent was lost. — Reconnect".',
  ],
  changed_recommendation:
    'Do NOT refresh all 40 baselines yet. Refreshing now would enshrine that reconnect banner as the expected look of the Run screen. The banner is a HARNESS STUB GAP (the e2e harness does not stub the event-stream method), not a product defect, and DESIGN_SYSTEM_V2 section 9 already assigns "harness stub shapes made daemon-true" to Phase B. Correct order: close the stub gap, then refresh the affected baselines on the capture host with the set named, then re-run GC.10 and GC.12.',
  caveat: 'I opened two diff images and one actual render, not all 40. The remaining needs-you (20) and the rest of projects/run are unexamined beyond their diff-density numbers.',
};

s.orchestration_findings.push({
  at: now,
  topic:
    'OD1 material corrected by looking at the images: a baseline refresh would currently enshrine a harness-gap error banner',
  fact:
    'I had been describing all 40 remote failures as "stale baselines / added product surface" on the strength of diff magnitudes and git history. To make OD1 genuinely decidable I assembled the failure artifacts the rehearsal left behind (40 cases x expected/actual/diff = 120 PNGs) into od1-visual-review/ with an INDEX.md, and then actually LOOKED at two of them. Projects 390x844 en light: the diff is exactly the new "Add a project" form, board unchanged — genuine new surface, refresh correct. Run 390x844 en light: the render is coherent and includes the new Run panel (run id, status, stage, last update) and the gates-inbox button, but it ALSO shows "The event stream stopped. Nothing you sent was lost. — Reconnect". That banner exists because the e2e harness does not stub the event-stream method; it is a harness stub gap, not a product defect, and section 9 of the design spec already lists "harness stub shapes made daemon-true" under Phase B. CONSEQUENCE: refreshing the baselines today would freeze that reconnect banner as the expected visual truth of the Run screen. The recommendation therefore changes from "name the set and refresh" to "close the stub gap first, then refresh". I had been one step away from recommending a refresh that would have baked an error state into the contract. Only 3 of the 40 images were examined, and the caveat is recorded.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/050-od1-evidence.json', JSON.stringify(s, null, 2) + '\n');

const v = JSON.parse(fs.readFileSync(dir + 'verdict.json', 'utf8'));
v.od1_visual_evidence = {
  pack: 'od1-visual-review/INDEX.md + OBSERVATIONS.md + 120 PNGs',
  key_finding:
    'The 40 diffs are NOT uniformly "added product surface". Projects shows genuinely new UI (correct to refresh). Run also shows a "The event stream stopped — Reconnect" banner caused by an unstubbed harness method, so refreshing now would enshrine an error state as the visual truth. Close the harness stub gap (Phase B per section 9) BEFORE refreshing.',
};
fs.writeFileSync(dir + 'verdict.json', JSON.stringify(v, null, 2) + '\n');

console.log('seq=' + s.seq + ' OD1 visual evidence recorded');
console.log('pack size: ' + fs.readdirSync(dir + 'od1-visual-review').length + ' entries');
