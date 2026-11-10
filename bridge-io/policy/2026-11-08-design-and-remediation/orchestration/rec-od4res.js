const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==42){console.error('seq '+s.seq);process.exit(1);}
s.seq=43;s.updated_at=now;
const od4=s.owner_decisions_required.find(d=>d.id==='OD4');
od4.status='RESOLVED - no owner decision required';
od4.resolution={
  at:now,
  how:'R6 own rule text says "the helper import is allowed, the literal is not", and packages/ui/src/tokens/sizes.ts exports `sizeTokens` (raw values, edge: "3px") plus size()/sizeVarName(); packages/ui/src/index.ts does `export * from "./tokens"`, so sizeTokens is reachable from @warsha/ui. The app can therefore emit the literal band TEXT at runtime while containing no px LITERAL in source.',
  edits:['GatesInbox.tsx: import sizeTokens','GatesInbox.tsx: QUIET_BAND -> `${sizeTokens.edge} solid var(--warsha-bench-edge)` (and the second inline site)','GatesInbox.test.tsx: assert the band through the token layer instead of the token spelling'],
  frozen_gates_edited:0,
  states_spec_untouched:true,
  evidence:{'G5.10 desktop (capture host, ORIGINAL states.spec.ts)':'793 passed, 0 failed, exit 0, snapshot_writes 0 (11.6m) - gates/TOKFIX.log','@warsha/ui at budget 0':'exit 0 (ratchet genuinely zero)','warsha-desktop units':'exit 0'},
  branch:'scratch/od4-token-fix 9f1b8e4 (throwaway; W5 to re-apply on its own branch)',
};
s.orchestration_findings.push({at:now,topic:'OD4 DISSOLVED - the G5.7 vs G5.10 conflict was a spelling problem with an in-scope solution',fact:'For many turns I reported OD4 as an owner decision because no honest spelling satisfied both frozen gates. That conclusion was WRONG, and the way out was in the policy text I had been quoting: the R6 comment in tokenDrift.test.ts says "the helper import is allowed, the literal is not", and sizes.ts exports `sizeTokens` (raw value map incl. edge: "3px") which packages/ui/src/index.ts re-exports via `export * from "./tokens"`. So GatesInbox can emit `${sizeTokens.edge} solid var(--warsha-bench-edge)`: at runtime the inline style text is exactly "3px solid var(--warsha-bench-edge)" (matching the frozen e2e regex at states.spec.ts:132) while the app SOURCE contains no px literal (so the R6.9 ratchet at budget 0 counts nothing). I proved it on a throwaway branch (scratch/od4-token-fix 9f1b8e4) with states.spec.ts BYTE-UNTOUCHED: desktop 793 passed / 0 failed / exit 0 / 0 snapshot writes on the authoritative capture host (gates/TOKFIX.log), WARSHA_R6_APP_LENGTH_BUDGET=0 @warsha/ui exit 0, and warsha-desktop units exit 0. No frozen gate was edited. W5 was given the exact three edits and told to re-apply them on its own branch. Consequence: OD4 is withdrawn from the owner decision list; W5 can now be merged without any owner action.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/043-od4-resolved.json',JSON.stringify(s,null,2)+'\n');
const v=JSON.parse(fs.readFileSync(dir+'verdict.json','utf8'));
v.blocked_on=(v.blocked_on||[]).filter(d=>d.id!=='OD4');
v.od4_resolution='RESOLVED without owner action: read the quiet-band width from sizeTokens so the frozen e2e assertion and the R6.9 ratchet both hold; states.spec.ts untouched; desktop 793/0 with 0 snapshot writes (gates/TOKFIX.log).';
fs.writeFileSync(dir+'verdict.json',JSON.stringify(v,null,2)+'\n');
console.log('seq='+s.seq+' OD4 marks RESOLVED');
console.log('remaining owner decisions: '+s.owner_decisions_required.filter(d=>!d.status||!/RESOLVED/.test(d.status)).map(d=>d.id).join(', '));
