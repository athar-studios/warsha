const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==44){console.error('seq '+s.seq);process.exit(1);}
s.seq=45;s.updated_at=now;
s.checkpoints.GC10 = {at:now,commit:'e914ad35d6ffc8098716b27593482159032e8cd3',
 desktop:'793 passed / 0 failed / exit 0 / 0 snapshot writes (log gates/GC.10desk.log)',
 remote:'NOT RUN - blocked on OD1 (40 stale remote visual baselines). The desktop half of GC.10 is complete and green; the remote half cannot be green until the owner names the baseline set.',
 verdict:'partial - desktop pass, remote blocked on owner'};
s.checkpoints.GC12 = {at:now,commit:'a643a536323b845fe7dec486a5d747f16653660d',
 note:'APK rebuilt on the integrated tree and the recorded facts refreshed in apps/mobile/README.md (one file, 2 lines).',
 apk:{size:842981,sha256:'6a4681852c53f01294159b1d6a905ddb8b32ab968d68fbefcd50a93eae2700ef',apksigner:'Verifies, exit 0; APK Signature Scheme v2 true; signer CN=Warsha Remote, RSA 4096',map_entries:0},
 gates:{'G7.1':'remote build exit 0, dist present','G7.3':'apksigner.bat verify exit 0 (Windows launcher; gate text names the Unix script)','G7.4':'2','G7.5':'frozen grep exit 0 - the README hash now matches the artefact built here','G7.6':'CANNOT PASS - self-referential gate, OD2','G7.7':'0 tracked assets'},
 leftover_nit:'apps/mobile/README.md still carries the previous "Build date" line; flagged for a follow-up doc correction.'};
s.orchestration_findings.push({at:now,topic:'C3 near-complete: desktop pixel gate green at the final tip; GC.12 resolved by rebuilding on the integrated tree',fact:'GC.10 desktop at e914ad3: 793 passed / 0 failed / exit 0 / 0 snapshot writes - so after every merge (W8, W1, W6, W7, W4, W3, W2, W5) plus INT-2 the integrated tree is still pixel-identical to the G0 baseline on desktop. GC.12: the APK was rebuilt ON the integration tree (HEAD a643a53), producing 842,981 bytes with SHA-256 6a468185..., apksigner Verifies with v2 true and RSA-4096, 2 web-asset entries (G7.4), ZERO .map entries, and the frozen G7.5 grep now exits 0 because apps/mobile/README.md records the artefact actually built there. G7.7 reads 0 and no snapshot was touched. The only W7 gate that cannot pass is G7.6, which greps a directory containing its own prompt (OD2). GC.10 remote remains blocked on OD1.'});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/045-gc10-gc12.json',JSON.stringify(s,null,2)+'\n');
const ap=JSON.parse(fs.readFileSync(dir+'acceptance.json','utf8'));
const set=(id,o)=>{const g=ap.gates.find(x=>x.id===id);if(g)Object.assign(g,o);};
set('GC.10',{verdict:'partial-pass-provisional',commit:'e914ad35d6ffc8098716b27593482159032e8cd3',log:'gates/GC.10desk.log',measured:'desktop 793 passed / 0 failed / exit 0 / 0 snapshot writes at the final tip; remote NOT RUN - blocked on OD1',recorded_at:now,note:'desktop half green; remote half owner-blocked'});
set('GC.12',{verdict:'partial-pass-provisional',commit:'a643a536323b845fe7dec486a5d747f16653660d',log:'gates/G7.*.log',measured:'G7.1, G7.3, G7.4 (2), G7.5 (grep exit 0) and G7.7 (0) pass on the integrated tree after rebuilding the APK there; G7.6 cannot pass (self-referential, OD2)',recorded_at:now,note:'APK 842,981 B, apksigner Verifies v2 RSA-4096, 0 .map entries'});
const c=k=>ap.gates.filter(x=>x.verdict===k).length;
fs.writeFileSync(dir+'acceptance.json',JSON.stringify(ap,null,2)+'\n');
console.log('seq='+s.seq+' | pass='+c('pass')+' provisional='+c('pass-provisional')+' partial='+c('partial-pass-provisional')+' fail='+c('fail')+' blocked='+c('blocked-on-owner-decision')+' not-run='+c('not-run'));
