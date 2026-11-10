const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==35){console.error('seq '+s.seq);process.exit(1);}
s.seq=36;s.updated_at=now;
s.rehearsal={
  at:now,branch:'scratch/od4-rehearsal',head:'ffd19e798992041aa77af069f2632672ee661b5d',
  what:'Throwaway branch from integration a9dad9a: merged W5, applied PROPOSED OD4 option 1 (states.spec.ts:132 regex accepts either the literal or var(--warsha-line-band)), applied INT-2 (APP_LENGTH_BUDGET 145 -> 0). NOT merged anywhere.',
  results:{
    desktop_playwright:'793 passed, 0 failed, exit 0, 0 snapshot writes (gates/REH-both.log)',
    remote_playwright:'51 passed, 40 failed (gates/REH-both.log) - the SAME 51/40 as the G0 baseline, so W5 adds no new remote failures',
    desktop_unit:'464 passed (floor 451)',
    remote_unit:'221 passed (floor 221)',
    ui_constant_zero:'181 passed exit 0 with APP_LENGTH_BUDGET=0',
    ui_env_zero:'181 passed exit 0 with WARSHA_R6_APP_LENGTH_BUDGET=0',
  },
  conclusion:'OD4 option 1 is empirically validated: desktop goes from 781/12 to 793/0 with zero snapshot writes, which also proves W5 145-literal token migration is pixel-neutral on the capture host. The remote 40 are unchanged, i.e. OD1 is the only remote blocker.',
  provenance:'The rehearsal edits are PROPOSALS measured on a scratch branch. No frozen gate in the run was edited, and integration/dev are untouched (integration a9dad9a, dev 642ae95).',
};
s.owner_decisions_required.find(d=>d.id==='OD4').rehearsal_evidence='Measured on scratch/od4-rehearsal ffd19e7: desktop 793/0 with 0 snapshot writes; desktop unit 464 >= 451; ui 181 at budget constant 0; remote identical 51/40 to G0.';
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/036-rehearsal.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'OWNER_DECISIONS.md',fs.readFileSync(dir+'OWNER_DECISIONS.md','utf8')+'\n---\nState: seq '+s.seq+', checkpoint 036-rehearsal. Rehearsal branch scratch/od4-rehearsal @ ffd19e7 (throwaway, unmerged).\n');
console.log('seq='+s.seq+' rehearsal recorded; owner package written');
