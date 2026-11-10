const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==29){console.error('seq '+s.seq);process.exit(1);}
s.seq=30;s.updated_at=now;
s.checkpoints.C2a={at:now,branch:'run/2026-11-08/integration',tip:'c2709169',merged:['W2'],merge_style:'git merge --no-ff',
  post_merge_checks:{'check-arch':'arch: 5 rules, 0 violations','check-engineering-policy':'policy: 8 checks, 0 failures','check-wire-contract':'wire: 9 checks, 0 violations','mdbook build docs':'HTML book written, tree stays clean (docs/book is gitignored)'},
  tree_clean:true,
  held_back:['W5 - blocked on owner decision OD4 (G5.7 vs the e2e assertion at states.spec.ts:132)'],
  authorization:'owner pre-authorised checkpoint merges into run/2026-11-08/integration ("all approved by me"). dev not touched.'};
const w2=s.plan.packets.find(p=>p.id==='W2');w2.status='merged-at-C2a';w2.merge_commit='c2709169';
const od4=s.owner_decisions_required.find(d=>d.id==='OD4');
od4.exhaustive_spelling_check={at:now,method:'Evaluated the e2e regex /border-inline-start:\s*3px solid var\(--warsha-bench-edge\)/ and the ratchet length regex /\b\d*\.?\d+(?:px|rem|em)\b/g against every plausible spelling of the inline style.',results:{'literal 3px solid var(--warsha-bench-edge)':'e2e MATCH, ratchet offences 1','longhand width/style/color via tokens':'e2e no match, ratchet 0','shorthand with var(--warsha-size-edge) width':'e2e no match, ratchet 0','whole token var(--warsha-line-band) (W5 current)':'e2e no match, ratchet 0'},conclusion:'The e2e regex requires the literal text "3px solid", and "3px" is exactly what the R6.9 ratchet counts. No spelling satisfies both, so there is no in-scope escape and no evasion is being attempted. TS helper path also checked: packages/ui/src/tokens/sizes.ts exports edge as a raw "3px" string but the app consumes var references via lineVar(), which would produce var(--warsha-line-band), i.e. still no match.'};
s.orchestration_findings.push({at:now,topic:'C2a - W2 merged; integration c2709169',fact:'W2 (docs only, review APPROVE after a REQUEST-CHANGES repair, 10/10 gates verified) was merged --no-ff into run/2026-11-08/integration, taking it from 406240a to c2709169. Post-merge on the tip: check-arch 5 rules 0 violations, check-engineering-policy 8 checks 0 failures, check-wire-contract 9 checks 0 violations, mdbook build docs succeeds and leaves the tree clean. W5 is deliberately held back pending OD4. OD4 was additionally exhausted: four plausible spellings of the decided-card band were evaluated against both frozen regexes and none satisfies both.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/030-c2a.json',JSON.stringify(s,null,2)+'\n');
console.log('seq='+s.seq+' C2a tip=c2709169');
for(const p of s.plan.packets)console.log(p.id+' '+p.status);
