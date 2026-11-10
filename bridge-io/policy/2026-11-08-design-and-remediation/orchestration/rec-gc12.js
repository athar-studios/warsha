const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==36){console.error('seq '+s.seq);process.exit(1);}
s.seq=37;s.updated_at=now;
s.owner_decisions_required.push({
  id:'OD5',at:now,topic:'GC.12: the recorded APK facts go STALE on the integrated tree - the APK must be rebuilt and re-recorded on the FINAL tip',
  blocking:['GC.12','W7 G7.3/G7.4/G7.5 on the integration tree'],
  blocking_scope:'the W7 half of C3 only. Does not affect any other gate.',
  evidence:{
    measured:'On the integration tree a9dad9a the remote bundle is DIFFERENT from the one W7 hashed: index.html 5ce10767... -> 16a7bf9c..., sw.js b100e927... -> 1a9fb2ca... (rebuild exit 0, orchestration /tmp/reh-bundle.out). The cause is legitimate: W3 tokens (and later W5 apps/remote/src) change apps/remote, whose dist is synced into the Android assets.',
    consequence:'apps/mobile/README.md records the APK SHA-256 from W7 base. An APK built on the integrated tree will have a different hash, so `grep -qF "$(sha256sum "$APK")" apps/mobile/README.md` (G7.5) FAILS until the hash is re-recorded. G7.3/G7.4 also need the APK to exist: it does NOT exist on the integration tree (gitignored build output, and that is correct per G7.7 which reads 0).',
    sequencing_trap:'Re-recording the hash NOW would be wrong: W5 is still unmerged and W5 changes apps/remote/src, so the bundle (and therefore the APK bytes) will change AGAIN. The APK must be rebuilt and its hash re-recorded only AFTER W5 is merged, i.e. on the final C3 tip.',
    note_on_G7S:'My first reading printed "57 out-of-scope files" for G7.S - that was MY misapplication, not a gate failure. G7.S is a per-PACKET scope gate comparing the packet own delta against BASE; on the integrated tree every packet changes are present by definition, so the gate is not meaningful there. W7 own delta was already verified confined to apps/mobile at C1.',
  },
  options_for_owner:[
    'Accept that GC.12 requires one rebuild-and-re-record step on the final tip as part of C3 (recommended - this is a normal artifact-refresh, docs-only, no gate change).',
    'Alternatively plan a W7b micro-packet that owns that rebuild plus the README hash update, with its own frozen gates.',
  ],
  why_owner:'It is a plan-shaped decision (who owns the post-merge artifact re-record, and whether that counts as a W7 repair or a C3 integrator step). No gate needs editing either way; the recommended path changes no frozen text.',
  orchestrator_action:'NOT performed - I did not rebuild the APK on the integrated tree and did not touch apps/mobile/README.md, because doing it before W5 merges would immediately go stale again.',
});
s.orchestration_findings.push({at:now,topic:'GC.12 measured: W7 recorded APK facts are stale on the integrated tree - sequencing matters',fact:'I ran the cheap half of GC.12 on the integration tree a9dad9a. G7.7 holds (0 tracked assets). The APK does not exist there, which is correct because it is gitignored build output. But I found a genuine integration-only defect that no per-packet gate could see: the remote bundle the APK embeds has CHANGED - apps/remote/dist/index.html 5ce10767 -> 16a7bf9c and sw.js b100e927 -> 1a9fb2ca after rebuilding on the integrated tree (exit 0). That is legitimate (W3 tokens now feed apps/remote) but it means the SHA-256 recorded in apps/mobile/README.md at W7 base can no longer match an APK built on the integrated tree, so G7.5 and therefore GC.12 will fail until the artifact is rebuilt and the hash re-recorded on the final tip. Critically, doing that now would be premature: W5 is still unmerged and changes apps/remote/src, so the bundle would change again. Recorded as OD5 with that sequencing trap spelled out. Also corrected my own misreading: the "57 out-of-scope files" I first printed for G7.S was my misapplication of a per-packet gate to the integrated tree, not a failure.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/037-gc12.json',JSON.stringify(s,null,2)+'\n');
console.log('seq='+s.seq+' OD5 recorded; decisions: '+s.owner_decisions_required.map(d=>d.id).join(', '));
