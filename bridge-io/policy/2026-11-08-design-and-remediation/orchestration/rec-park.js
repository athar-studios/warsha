const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==38){console.error('seq '+s.seq);process.exit(1);}
s.seq=39;s.updated_at=now;s.phase='parked';
s.parked={
  at:now,state:'Parked cleanly at the end of the working session. The run is NOT complete and NOT accepted.',
  refs:{dev:'642ae95 (untouched, checkout clean)',integration:'a9dad9a (6 packets merged)',rehearsal:'scratch/od4-rehearsal ffd19e7 (throwaway, unmerged)'},
  unmerged_candidates:[
    {what:'W2 follow-up commit 5a2834d "docs(book): close the design-system wrapper on the source fence so drift fails loudly"',scope:'docs/src/design-system-v2.md only, 1 file +1/-2',verified:'scope 0 out-of-scope; mdbook test exit 0; mdbook build exit 0 (orchestrator probe)',status:'NOT MERGED on purpose - it is unreviewed, and merging unreviewed work is not safe parking. It directly addresses the hard-coded include-range drift risk noted at C2b. Next session: have the W2 reviewer cover it, then merge.'},
    {what:'W5 (all 5 commits, HEAD 10a1819)',status:'blocked on OD4; rehearsed and proven green when OD4 option 1 is applied (desktop 793/0)'},
  ],
  still_running_sessions:'Two implementer conversations (W2 5a2834d, W5 10a1819) may still be open. They work only inside their own worktrees, so integration and dev cannot be corrupted. W2 latest work is captured above; W5 is blocked on OD4 and cannot proceed without it.',
  no_work_in_flight_that_can_corrupt:'integration tree clean (0), dev checkout clean (0), 0 snapshot files touched anywhere in the run.',
};
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/039-parked.json',JSON.stringify(s,null,2)+'\n');
const ap=JSON.parse(fs.readFileSync(dir+'acceptance.json','utf8'));
const c=k=>ap.gates.filter(g=>g.verdict===k).length;
console.log('seq='+s.seq+' phase='+s.phase);
console.log('gates: pass='+c('pass')+' pass-provisional='+c('pass-provisional')+' partial='+c('partial-pass-provisional')+' fail='+c('fail')+' blocked='+c('blocked-on-owner-decision')+' not-run='+c('not-run')+' / '+ap.gates.length);
console.log('owner decisions open: '+s.owner_decisions_required.map(d=>d.id).join(', '));
