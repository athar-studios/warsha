const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const TIP='e172caf';
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==47){console.error('seq '+s.seq);process.exit(1);}
s.seq=48;s.updated_at=now;s.phase='ready-for-acceptance';
s.checkpoints.records_refreshed={at:now,tip:TIP,what:'Corrected PROGRESS.md / DECISIONS.md / PLAN.md, which still described the run as PARTIAL with W5 unmerged. They now state all 8 packets merged, C3 swept, and the OD4 resolution. Committed as e172caf; arch/policy/wire clean, mdbook test exit 0, tree clean, dev still 642ae95.',line_endings:'CRLF preserved in all three files (zero bare LF)'};
s.orchestration_findings.push({at:now,topic:'Run records corrected: the fold had gone stale the moment W5 merged',fact:'The integrator fold at 0066663 described the run as "PARTIAL: 7 of 8 packets merged" and marked W5, C2/INT-2 and C3 as blocked or pending. That became false when W5 merged at C2d, INT-2 landed and C3 was swept, so the records contradicted reality - exactly the all-green-claim-in-reverse failure: a stale partial claim is as misleading as a stale green one. Corrected at e172caf: PLAN.md heading now reads MERGED/awaiting acceptance with W5, C2/INT-2 and C3 ticked and carrying their real results; PROGRESS.md says all 8 packets merged and records the outcome (desktop 793/0 with zero snapshot writes at the final tip, APK rebuilt on the integrated tree, acceptance.json carrying all 108 gate verdicts); DECISIONS.md records that OD4 was resolved without redefining either frozen gate. Line endings preserved. Two remaining grep hits for "7 of 8" were checked and are an unrelated historical pnpm lint output, not stale claims.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/048-records.json',JSON.stringify(s,null,2)+'\n');
const v=JSON.parse(fs.readFileSync(dir+'verdict.json','utf8'));
v.integration_tip=TIP;
v.generated_at=now;
v.verdict='READY FOR ACCEPTANCE, except two owner decisions';
fs.writeFileSync(dir+'verdict.json',JSON.stringify(v,null,2)+'\n');
console.log('seq='+s.seq+' phase='+s.phase+' tip='+TIP);
