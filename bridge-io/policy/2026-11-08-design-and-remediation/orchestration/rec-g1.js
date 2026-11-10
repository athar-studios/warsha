const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const HEAD='6d9728f52eb096199c4ace208435c8b8927e5140';
// exit codes observed by the orchestrator's own re-run (w1-gates-rerun.out + corrected G1.4)
const obs={'G1.S':0,'G1.1':1,'G1.2':1,'G1.3':0,'G1.4':0,'G1.5':0,'G1.6':0,'G1.7':1,'G1.8':0,'G1.9':0,'G1.A':0,'G1.P':0,'G1.W':0};
const ap=JSON.parse(fs.readFileSync(dir+'acceptance.json','utf8'));
for(const g of ap.gates){
  if(!(g.id in obs)) continue;
  g.exit_code=obs[g.id];
  g.log='gates/'+g.id+'.log';
  g.log_source='RE-RUN by the orchestrator at 6d9728f in throwaway worktree verify-w1b/verify-w1c. The originally recorded verdict had NO log file on disk - see the audit finding.';
  g.verifier='orchestrator re-run (the named verifier session listed logs that were never written)';
  g.recorded_at=now;
  g.commit=HEAD;
}
fs.writeFileSync(dir+'acceptance.json',JSON.stringify(ap,null,2)+'\n');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==37){console.error('seq '+s.seq);process.exit(1);}
s.seq=38;s.updated_at=now;
const w1=s.plan.packets.find(p=>p.id==='W1');
w1.verification_verdict='PASS (re-derived by the orchestrator)';
w1.evidence_note='The verifier session asserted 13/13 pass and listed log filenames, but NO G1.*.log existed on disk. The orchestrator re-ran all 13 gates at 6d9728f in throwaway worktrees and wrote real logs; all 13 reproduce their frozen expectation. G1.4 initially logged exit 1 due to an orchestrator quoting bug (backticks command-substituted by the outer shell), corrected and re-run to exit 0 with all 26 module names found.';
s.orchestration_findings.push({at:now,topic:'EVIDENCE AUDIT caught 13 verdicts with no backing log - mine included - and I re-derived them',fact:'An integrity audit of the evidence dir found 17 gates whose acceptance.json verdict referenced a log that did not exist. Three were checker artifacts (GC.6/GC.7/GC.8 legitimately use a/b log pairs) and one was correct (G3.9 is blocked-on-owner, so it has no log). But THIRTEEN were real: every G1.* gate. The W1 verifier session had reported 13/13 pass and its verification.md listed one log per gate, yet no G1.*.log file was ever written. That is precisely the "a claim with no artifact is not done" failure the policy names, and it applied to a verdict the orchestrator itself had recorded. Remedy: the orchestrator re-ran all 13 frozen G1 gates itself at 6d9728f in a throwaway detached worktree and wrote genuine logs. Result: all 13 reproduce their frozen expectation (G1.S 0, G1.1/1.2/1.7 exit 1 as required, the rest exit 0). One instructive failure on the way: G1.4 first logged exit 1 and the log showed "process_spawn: command not found" - the backticks in the grep pattern had been command-substituted by the outer shell, i.e. MY harness bug, not a W1 defect; a direct check showed all 26 modules present, and a corrected re-run exited 0. Lesson recorded: a harness that silently mangles the gate command can manufacture a false failure just as easily as a false pass, so the log body must be read, not just the exit code.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/038-evidence-audit.json',JSON.stringify(s,null,2)+'\n');
const missing=ap.gates.filter(g=>g.log&&!g.log.startsWith('orchestration/')&&!/a\.log \+/.test(g.log)&&g.verdict!=='not-run'&&g.verdict!=='blocked-on-owner-decision'&&!fs.existsSync(dir+g.log));
console.log('seq='+s.seq+' | gates with a verdict but still-missing log: '+missing.length+(missing.length?' -> '+missing.map(g=>g.id).join(', '):''));
