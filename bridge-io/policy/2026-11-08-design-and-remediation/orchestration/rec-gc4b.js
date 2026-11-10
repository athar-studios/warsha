const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const TIP='a9dad9aa8a0f6c3b74a8a2cb79cfa6f8ef61f7c9';
const ap=JSON.parse(fs.readFileSync(dir+'acceptance.json','utf8'));
const g=ap.gates.find(x=>x.id==='GC.4');
Object.assign(g,{verdict:'partial-pass-provisional',exit_code:0,commit:TIP,log:'orchestration/gc4b-*.out',recorded_at:now,
 measured:'All four stages exit 0 at a9dad9a: pnpm -r typecheck, pnpm -r lint, pnpm -r test (now including mdbook test), pnpm -r build. Per-package vitest: ui 181 (>=170), client 148 (>=140), i18n 52 (>=52), remote 221 (>=221) all met; desktop 446 vs the stated floor >= 451 is BELOW FLOOR.',
 note:'The desktop shortfall is expected and is NOT a defect: the 451 floor presumes W5, which adds 18 tests (446 -> 464) and is held back on owner decision OD4. GC.4 cannot be a full pass until W5 merges. Previous failure (pnpm -r test exit 101 from mdbook test) is FIXED by W2 repair iteration 2.'});
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==34){console.error('seq '+s.seq);process.exit(1);}
s.seq=35;s.updated_at=now;
s.integration_gate_results.fail={};
s.integration_gate_results.pass['GC.4 stages']='typecheck/lint/test/build all exit 0 at a9dad9a (test includes mdbook test, repaired by W2 iteration 2)';
s.integration_gate_results.partial={'GC.4':'commands pass; desktop 446 < stated floor 451 because W5 (+18 tests) is unmerged pending OD4'};
fs.writeFileSync(dir+'acceptance.json',JSON.stringify(ap,null,2)+'\n');
s.orchestration_findings.push({at:now,topic:'GC.4 re-run on the C2b tip: all commands pass, one stated count floor not yet reachable without W5',fact:'On a9dad9a (C2b) the full chain exits 0 at every stage: typecheck 0, lint 0, test 0 (mdbook test now passes, so the earlier 101 is fixed), build 0. The orchestrator then checked the gate\'s second clause - the per-package floors - against the raw vitest output: ui 181 (floor 170), client 148 (140), i18n 52 (52), remote 221 (221) are met, but desktop is 446 against the stated 451. I am deliberately NOT reporting GC.4 as a clean pass, because passing the commands while missing a stated count would be exactly the gate-passes-on-incomplete-truth pattern this run keeps catching in other packets. The cause is structural and benign: the 451 floor presumes W5, which takes desktop from 446 to 464 (+18 tests, 464/464 verified in isolation) and is held back on OD4. So the honest status is partial-pass-provisional, and it flips to a full pass the moment OD4 is resolved and W5 merges.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/035-gc4b.json',JSON.stringify(s,null,2)+'\n');
const c=k=>ap.gates.filter(x=>x.verdict===k).length;
console.log('seq='+s.seq+' | pass='+c('pass')+' pass-provisional='+c('pass-provisional')+' partial='+c('partial-pass-provisional')+' fail='+c('fail')+' blocked='+c('blocked-on-owner-decision')+' not-run='+c('not-run')+' / '+ap.gates.length);
