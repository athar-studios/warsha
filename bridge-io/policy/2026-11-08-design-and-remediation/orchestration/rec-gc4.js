const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==30){console.error('seq '+s.seq);process.exit(1);}
s.seq=31;s.updated_at=now;
const w2=s.plan.packets.find(p=>p.id==='W2');
w2.status='repair';w2.repair_iteration=2;
w2.integration_regression='GC.4 pnpm -r test exits 101 at c2709169: @warsha/docs test script is `mdbook test`, which compiles unannotated code fences as Rust. 4 fences in files W2 CREATED fail: docs/src/design-system-v2.md (ASCII diagram at line 85) and docs/src/deploy.md lines 54, 167, 329. CONTROL: `mdbook test` exits 0 at 406240a (pre-W2), so W2 introduced it.';
s.integration_gate_results={
  tip:'c27091696796805bbdf72848fbc93ff611866dcc',note:'Early C3-style sweep on the C2a tip. Not final: W5 is unmerged and W2 needs a repair, so the sweep must be re-run at the final tip.',
  pass:{'GC.1':'cargo fmt --all --check exit 0','GC.5':'tsc -p tsconfig.e2e.json exit 0','GC.6a/6b':'arch self-test + arch exit 0','GC.7a/7b':'policy self-test + policy exit 0','GC.8a/8b':'wire self-test + "wire: 9 checks, 0 violations" exit 0','GC.9':'mdbook build docs exit 0','GC.11':'gitleaks no leaks (120 commits)','GC.4 stages':'pnpm -r typecheck exit 0, pnpm -r lint exit 0, pnpm -r build exit 0'},
  fail:{'GC.4 test stage':'pnpm -r test exit 101 - mdbook test failure in W2 files (see W2 integration_regression)'},
  pending:{'GC.2/GC.3':'clippy and cargo test --workspace running in a background agent','GC.10':'blocked on OD1 + OD4','GC.12':'W7 gates re-run on the integrated tree - not yet run'},
};
s.orchestration_findings.push({at:now,topic:'GC.4 found an INTEGRATION-ONLY regression that W2 own gates could not see',fact:'On the C2a tip c2709169, pnpm -r typecheck, lint and build pass but pnpm -r test exits 101. The @warsha/docs package test script is `mdbook test`, which compiles every unannotated code fence as Rust. Four fences in files W2 itself created fail: an ASCII layout diagram in docs/src/design-system-v2.md (rustc: "unknown start of token: U+00B7 / U+250C") and three fences in docs/src/deploy.md (Backup/restore line 329, First start/bootstrap admin token line 167, Network/port architecture line 54). A CONTROL run proves causation: `mdbook test` exits 0 at 406240a, the integration tip immediately before W2 merged, with 0 FAILED lines. W2 own gate G2.1 is `mdbook build docs`, which does not compile fences, so ten green gates coexisted with a broken workspace test - a real gap in the frozen gate set, not a mistake by W2. W2 was sent a repair brief: annotate fences honestly (text/sh/toml), never delete content or hide lines, prove with `mdbook test docs` exit 0 and re-run its ten gates (G2.4 N=35 and G2.5 "9 checks" must not move), and add the fix as NEW commits without rebasing the merged ones.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/031-gc4.json',JSON.stringify(s,null,2)+'\n');
console.log('seq='+s.seq+' GC.4 finding recorded');
