const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==26){console.error('seq '+s.seq);process.exit(1);}
s.seq=27;s.updated_at=now;
const w2=s.plan.packets.find(p=>p.id==='W2');
w2.status='verified';w2.review_verdict='APPROVE (re-review after repair)';w2.verification_verdict='PASS (10/10 gates)';
w2.g2_4_n=35;w2.g2_5_string='9 checks';
const w5=s.plan.packets.find(p=>p.id==='W5');
w5.status='repair';w5.repair_iteration=1;w5.review_verdict='APPROVE';w5.verification_verdict='14/14 worktree gates PASS';
w5.linux_gate='G5.10 FAILED at 10a1819: 12 failed / 781 passed / exit 1 / 0 snapshot writes. ALL 12 are states.spec.ts:289 "gates success" across 320x568, 390x844 and 1440x900 x ar/en x light/dark. No other spec failed. Real pixel regression from the token migration.';
s.orchestration_findings.push({at:now,topic:'G5.10 CAUGHT A REAL PIXEL REGRESSION that both the implementer and the reviewer missed',fact:'W5 passed all 14 of its own worktree gates and was APPROVED by an independent reviewer that spot-checked 10 risky substitutions. Then G5.10 on the authoritative capture host failed: 12 of 793 desktop cases, ALL of them states.spec.ts:289 "gates success" across three widths by two locales by two themes, with 781 passed and ZERO snapshot writes. So a specific substitution in the approved-gate rendering resolves to a different computed value than the literal it replaced, and neither the vitest suites nor a 10-substitution code-reading spot-check could see it - only the real browser render could. This is the strongest evidence in the whole run for why the frozen linux-capture-host gates exist and why a green worktree gate set plus a code-reading review is NOT a substitute for running the pixels. W5 was sent back with the exact case list; the repair must make the computed style byte-identical and must not touch any snapshot.'});
s.orchestration_findings.push({at:now,topic:'W2 fully green through the loop',fact:'W2 completed the full loop: implement -> review REQUEST-CHANGES (blocker: the G0/OD1 honesty statement was absent despite all 10 gates passing; plus a missing report.md and wrong SECURITY.md citations) -> repair -> re-review APPROVE (docs/VERIFY.md:71-103 now carries 793/785/8 and 91/51/40, G0 verdict fail, W8 re-measurements, and the 40 marked OPEN under OD1 with the sentence "no document may imply the remote suite is green") -> independent verification PASS with all 10 gates, G2.4 deriving N=35 and G2.5 grepping "9 checks".'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/027-w5repair.json',JSON.stringify(s,null,2)+'\n');
console.log('seq='+s.seq+' recorded');
