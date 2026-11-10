const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==33){console.error('seq '+s.seq);process.exit(1);}
s.seq=34;s.updated_at=now;
s.checkpoints.C2b={at:now,branch:'run/2026-11-08/integration',tip:'a9dad9a',full:'a9dad9aa8a0f6c3b74a8a2cb79cfa6f8ef61f7c9',merged:['W2 repair iteration 2 (498405e, 2fbd620)'],merge_style:'git merge --no-ff',
  post_merge_checks:{'check-arch':'arch: 5 rules, 0 violations','check-engineering-policy':'policy: 8 checks, 0 failures','check-wire-contract':'wire: 9 checks, 0 violations','mdbook test':'exit 0 (was 101-causing at c2709169)'},tree_clean:true,
  held_back:['W5 - blocked on OD4'],note:'dev not touched; planner-owned docs/designs/DESIGN_SYSTEM_V2.md untouched.'};
const w2=s.plan.packets.find(p=>p.id==='W2');
w2.status='merged-at-C2b';w2.repair_iteration=2;w2.integration_regression_fixed='mdbook test exit 0 at 2fbd620 / a9dad9a; control exit 0 at 406240a';
w2.repair_head='2fbd620486ee9e08cc484e603aac19c6d2d2f1a7';
s.orchestration_findings.push({at:now,topic:'W2 repair iteration 2 fixed the integration-only mdbook-test regression WITHOUT touching the planner-owned file',fact:'W2 added two commits on top of its merged work: 498405e annotated three bare fences in docs/DEPLOY.md (network diagram, first-start banner, directory tree) and one in docs/DEVELOPERS.md as text; 2fbd620 solved the fourth, which lives in the planner-owned docs/designs/DESIGN_SYSTEM_V2.md (line 76), by splitting its shim include into three ranges - {{#include ../designs/DESIGN_SYSTEM_V2.md:1:75}}, a ```text fence wrapping :77:102, and {{#include ...:104:}} - so the planner file is byte-untouched and the diagram is still rendered (the built page still contains the diagram text). This was option 1 of the three the orchestrator offered. The orchestrator independently confirmed: G2.S 0 out-of-scope files, planner file touched 0, G2.4 N=35 ok, G2.5 "9 checks" ok, arch/policy/wire clean, mdbook build exit 0 and mdbook TEST exit 0 at 2fbd620 (log orchestration/w2fix-mdbook-test.out has 0 FAILED and 0 ERROR lines). Merged --no-ff as C2b; tip a9dad9a. One residual: the splice boundary lines 76 and 103 (the fence markers) are deliberately omitted, so if the planner ever shifts the diagram the hard-coded ranges 1:75 / 77:102 / 104: will silently drift - a maintenance coupling worth a future gate.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/034-c2b.json',JSON.stringify(s,null,2)+'\n');
console.log('seq='+s.seq+' C2b tip=a9dad9a');
