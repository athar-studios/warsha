const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==28){console.error('seq '+s.seq);process.exit(1);}
s.seq=29;s.updated_at=now;
s.owner_decisions_required=(s.owner_decisions_required||[]);
s.owner_decisions_required.push({
  id:'OD4',at:now,topic:'W5: two frozen gates demand mutually exclusive spellings of ONE inline style',
  blocking:['G5.10 (desktop 793/0 - currently 12 failed) OR G5.7 (ratchet at budget 0) - one of the two cannot hold'],
  blocking_scope:'W5 acceptance, and therefore C2 / INT-2 / GC.10. W1/W2/W3/W4/W6/W7/W8 are unaffected.',
  question:'How should the conflict between G5.7 and the e2e assertion states.spec.ts:132 be resolved?',
  evidence:{
    assertion:'apps/desktop/e2e/states.spec.ts:132 expectDecidedCardIsQuiet does getAttribute("style") on .warsha-gate-card and requires it to match /border-inline-start:\s*3px solid var\(--warsha-bench-edge\)/ - i.e. it matches the LITERAL inline-style text including the length 3px.',
    ratchet:'packages/ui/src/tokens/tokenDrift.test.ts R6.9 (APP_LENGTH = /\b\d*\.?\d+(?:px|rem|em)\b/g, scanAppLengths) counts every px/rem/em literal in app sources; G5.7 runs it at WARSHA_R6_APP_LENGTH_BUDGET=0 so a single "3px" in apps/desktop/src is an offence. The only exemptions are comments, @media preludes at breakpoint values, and a length that is part of a literal var() fallback (counted as R6.10 instead).',
    reproduced_by_orchestrator:'literal spelling "3px solid var(--warsha-bench-edge)": ratchet offences = 1 ("3px"), e2e regex = MATCH. token spelling "var(--warsha-line-band)": ratchet offences = 0, e2e regex = NO MATCH (the style text no longer contains 3px). There is no honest spelling that is both (a) free of a px length and (b) contains the text "3px solid".',
    pixel_impact:'NONE. tokens.css:99 defines --warsha-line-band as var(--warsha-size-edge) solid var(--warsha-bench-edge) and tokens.css:117 sets --warsha-size-edge to 3px, so the computed border is byte-identical either way. 0 toHaveScreenshot failures and 0 pixel-ratio lines in the failed log; 308 visual cases passed; snapshot_writes 0.',
    failing_cases:'12 of 793 - all states.spec.ts:289 "gates success" (3 widths x ar/en x light/dark)',
  },
  options_for_owner:[
    'Keep the token spelling and amend the e2e assertion at states.spec.ts:132 to accept the token reference (e.g. match either "3px solid var(--warsha-bench-edge)" or "var(--warsha-line-band)"). This is the semantically correct fix: the assertion intends "the decided card still carries the quiet band", not a particular source spelling. It requires editing a spec that no packet owns and that sits under a frozen gate.',
    'Keep the literal at that ONE call site and add a narrow, reviewed exemption for it to the R6.9 scanner (or leave APP_LENGTH_BUDGET at 1 instead of 0 at INT-2). Weakens the "zero" ratchet by one site.',
    'Accept W5 as not-fully-green on G5.10 until a planner re-words one of the two gates.',
  ],
  orchestrator_recommendation:'Option 1: the assertion is coupled to source text rather than to behaviour, the computed style is identical, and it keeps the ratchet at a true zero. I did NOT do it because ENGINEERING_POLICY forbids editing a frozen gate and the spec sits outside every packet allowed_files.',
  why_owner:'Re-passing a gate by redefinition is not a repair (section 5/6), no agent may edit, narrow or re-word a frozen gate, and both candidate fixes change what a frozen gate enforces.',
  orchestrator_action:'NOT performed - no spec edited, no scanner edited, no exemption added, no budget changed, no evasion spelling attempted.',
});
const w5=s.plan.packets.find(p=>p.id==='W5');
w5.status='blocked-on-OD4';
w5.blocker={kind:'out-of-scope',reason:'G5.7 and the e2e assertion at states.spec.ts:132 are mutually exclusive for one inline style (see OD4). Reproduced independently by the orchestrator.',needs:'Owner decision OD4: amend the assertion to accept the token reference, grant a reviewed exemption, or accept G5.10 as not fully green.'};
s.orchestration_findings.push({at:now,topic:'W5 stopped, correctly, at a genuine conflict between two frozen gates (OD4) - reproduced by the orchestrator',fact:'W5 followed the corrected instruction exactly: it tried the in-scope revert, recognised it would break G5.7, declined to game the scanner, and wrote a precise out-of-scope blocker (packets/W5/blocker.json and a repair section in report.md). The orchestrator independently reproduced the conflict with the two regexes: the literal spelling yields ratchet offences=1 and the e2e regex matches; the token spelling yields offences=0 and the e2e regex does NOT match. The computed border is identical either way (tokens.css:99/:117), so this is a gate-text coupling, not a rendering defect. Recorded as OD4 with a recommendation (amend the assertion) that the orchestrator did not act on because it would edit a frozen spec outside every packet scope. Net effect on the run: W5 is implemented, reviewed APPROVE and worktree-verified 14/14, but its G5.10 cannot be both honestly green and ratchet-zero until the owner picks.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/029-od4.json',JSON.stringify(s,null,2)+'\n');
console.log('seq='+s.seq+' OD4 recorded; owner decisions: '+s.owner_decisions_required.map(d=>d.id).join(', '));
