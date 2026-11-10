#!/usr/bin/env bash
# Summarise U5.6b / U5.pwb gate evidence (read-only). Usage: u5-judge.sh
EV=/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
for G in U5.6b U5.pwb; do
  echo "===== $G ====="
  if [ -f "$EV/gates/$G.meta" ]; then cat "$EV/gates/$G.meta"; else echo "meta MISSING"; fi
  echo "--- pw-gate vs EMPTY:"
  cat "$EV/gates/$G.pw-gate.log" 2>/dev/null | head -80
  if [ -f "$EV/gates/$G.pw-gate-u5.log" ]; then
    echo "--- pw-gate vs named/U5.txt:"
    head -40 "$EV/gates/$G.pw-gate-u5.log"
  fi
  echo "--- counts:"
  cat "$EV/gates/$G.counts.log" 2>/dev/null
  echo "--- json bytes: $(wc -c < "$EV/gates/$G.json" 2>/dev/null)"
  # breakdown: visual vs non-visual failures, per project
  node -e '
const fs=require("fs");
const p=process.argv[1];
let r; try{r=JSON.parse(fs.readFileSync(p,"utf8"));}catch(e){console.log("JSON_UNREADABLE:",e.message);process.exit(0);}
const st=r.stats||{};
console.log("stats:",JSON.stringify(st));
const cases=[];
const walk=(s)=>{for(const sp of s.specs||[]){for(const t of sp.tests||[]){cases.push({key:`${t.projectName} › ${String(sp.file||s.file||"").split(/[\\/]/).pop()} › ${sp.title}`,status:t.status});}}for(const s2 of s.suites||[])walk(s2);};
(r.suites||[]).forEach(walk);
const bad=cases.filter(c=>c.status==="unexpected"||c.status==="flaky");
const vis=bad.filter(c=>/@visual/.test(c.key));
const nonvis=bad.filter(c=>!/@visual/.test(c.key));
console.log(`total_cases=${cases.length} bad=${bad.length} visual_bad=${vis.length} nonvisual_bad=${nonvis.length}`);
const byProj={};bad.forEach(c=>{const p2=c.key.split(" › ")[0];byProj[p2]=(byProj[p2]||0)+1;});
console.log("bad_by_project:",JSON.stringify(byProj));
console.log("--- nonvisual failures:");
nonvis.forEach(c=>console.log("FAIL",c.key));
const specs=[...new Set(cases.map(c=>c.key.split(" › ")[1]))];
console.log("spec_files:",specs.join(", "));
' "$EV/gates/$G.json"
done
