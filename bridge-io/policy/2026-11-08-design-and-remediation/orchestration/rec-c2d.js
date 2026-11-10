const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const TIP='e914ad35d6ffc8098716b27593482159032e8cd3';
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==43){console.error('seq '+s.seq);process.exit(1);}
s.seq=44;s.updated_at=now;
s.checkpoints.C2d={at:now,branch:'run/2026-11-08/integration',tip:TIP,merged:['W5 (77a02c1, review APPROVE after repair 2)'],merge_style:'git merge --no-ff',post_merge_checks:{},tree_clean:true,
 note:'OD4 resolved in-scope: the quiet band reads its width from sizeTokens so the emitted inline style is exactly "3px solid var(--warsha-bench-edge)" while the app source holds no px literal; states.spec.ts byte-identical; no frozen gate edited. G5.10 on the capture host at 77a02c1 = 793 passed / 0 failed / exit 0 / 0 snapshot writes (gates/G5.10b.log).'};
s.checkpoints.INT_2={at:now,commit:'e914ad3',change:'packages/ui/src/tokens/tokenDrift.test.ts: const APP_LENGTH_BUDGET = 145 -> 0 (planner-specified one-line tightening)',verified:{'@warsha/ui test':'181 passed at the constant 0, exit 0','warsha-desktop':'464 passed','arch/policy/wire':'clean','mdbook test':'exit 0','snapshots':'0'}};
const w5=s.plan.packets.find(p=>p.id==='W5');
w5.status='merged-at-C2d';w5.merge_commit=TIP;
w5.review_verdict='APPROVE (re-review after repair 2)';w5.verification_verdict='14/14 worktree gates + G5.10 793/0';
w5.implementer_succession='Original implementer session died in error state at 10a1819. A successor Coder applied the OD4 fix (77a02c1). Re-review by a different debugger session APPROVED. Verifier role: orchestrator capture-host runs plus the worktree-gate verifier.';
s.orchestration_findings.push({at:now,topic:'W5 MERGED at C2d; INT-2 applied; GC.4 now fully passes',fact:'W5 merged --no-ff taking integration from 0066663 to 391ef7a, then INT-2 set APP_LENGTH_BUDGET 145 -> 0 (e914ad3). On that final tip, GC.4 fully passes for the first time: pnpm -r typecheck 0, lint 0, test 0, build 0, with every stated floor met - ui 181 (>=170), client 148 (>=140), i18n 52 (>=52), desktop 464 (>=451), remote 221 (>=221). Before W5 the desktop floor was unreachable at 446. The OD4 conflict is withdrawn: it was resolved by reading the quiet-band width from sizeTokens, which the re-reviewer independently confirmed is honest (Math.min(145, env), the scan walks both app roots and fires on a planted 16px) and which the capture host confirmed at 793/0 with zero snapshot writes.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/044-c2d-int2.json',JSON.stringify(s,null,2)+'\n');
const ap=JSON.parse(fs.readFileSync(dir+'acceptance.json','utf8'));
for(const [id,meas] of [['GC.4','all four stages exit 0 at e914ad3; ui 181>=170, client 148>=140, i18n 52>=52, desktop 464>=451, remote 221>=221 - every floor met'],['INT-2','APP_LENGTH_BUDGET = 0; @warsha/ui 181 passed exit 0']]){
  const g=ap.gates.find(x=>x.id===id);
  if(g){g.verdict='pass';g.exit_code=0;g.commit=TIP;g.log='orchestration/gc4c-*.out / orchestration/int2-ui.out';g.measured=meas;g.recorded_at=now;g.note='final-tip run';}
}
ap.gates.find(x=>x.id==='G5.10').verdict='pass';
Object.assign(ap.gates.find(x=>x.id==='G5.10'),{exit_code:0,commit:'77a02c1c08e2b2c97c828738ac95b64073d42d3b',log:'gates/G5.10b.log',measured:'793 passed, 0 failed (9.8m), exit 0, 0 snapshot writes on W5 repair head',recorded_at:now});
ap.gates.find(x=>x.id==='G5.11').measured='not run - blocked on OD1 (40 stale remote baselines)';
ap.gates.find(x=>x.id==='G5.11').verdict='blocked-on-owner-decision';
ap.gates.find(x=>x.id==='G5.11').commit=TIP;
fs.writeFileSync(dir+'acceptance.json',JSON.stringify(ap,null,2)+'\n');
const c=k=>ap.gates.filter(x=>x.verdict===k).length;
console.log('seq='+s.seq+' C2d tip=e914ad3 | pass='+c('pass')+' provisional='+c('pass-provisional')+' fail='+c('fail')+' blocked='+c('blocked-on-owner-decision')+' not-run='+c('not-run'));
