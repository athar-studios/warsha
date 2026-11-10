const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==25){console.error('seq '+s.seq);process.exit(1);}
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
s.seq=26;s.updated_at=now;
const w2=s.plan.packets.find(p=>p.id==='W2');
w2.status='repair';w2.repair_iteration=1;w2.review_verdict='REQUEST-CHANGES';
w2.review_findings='B1 blocker: G0/OD1 baseline absent from the canonical docs (the packet defining honesty requirement). M1: report.md missing entirely. M2: SECURITY.md:119-121 wrong code citations. Plus m1 internal.ts contradiction, m3 unverifiable 60/15 split, and 2 nits. All ten frozen gates passed at 97dc93a - so this is a case of gates passing on incomplete truth, exactly the failure mode the packet exists to prevent.';
const w5=s.plan.packets.find(p=>p.id==='W5');
w5.status='implementing';
w5.head_seen=require('child_process').execSync('git -C C:/Users/Dragonfly/Downloads/warsha-wt/w5 rev-parse --short HEAD',{encoding:'utf8'}).trim();
s.orchestration_findings.push({at:now,topic:'W2 review caught a gate-passing-on-incomplete-truth case',fact:'W2 review returned REQUEST-CHANGES. All ten frozen gates passed at 97dc93a, yet the packet missing the ONE thing it exists for: the canonical docs never state the recorded G0 baseline (desktop 793 listed / 785 passed / 8 failed; remote 91 listed / 51 passed / 40 failed) nor that the 40 remote failures are OPEN and blocked on owner decision OD1. It also found packets/W2/report.md did not exist at all - a claim with no artifact, which ENGINEERING_POLICY section 4 treats as not-done - and wrong code-line citations in SECURITY.md:119-121. This is the clearest illustration so far of why the verifier and reviewer roles must judge INTENT and not only the literal grep: ten green greps coexisted with a missing honesty statement.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/026-w2repair.json',JSON.stringify(s,null,2)+'\n');
console.log('seq='+s.seq+' W2 repair dispatched; W5 head='+w5.head_seen);
