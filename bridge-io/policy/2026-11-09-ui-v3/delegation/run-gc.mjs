// C-final mechanical GC runner (GC.1-GC.12 only; GC.13-GC.17 need orchestrator judgement on artifacts).
// Usage (Windows Git Bash at the integration worktree, or WSL at the final capture worktree with PATH exported):
//   node .../delegation/run-gc.mjs <windows|any|capture> <RELEASE> <RUN_BASE>
// Runs each matching frozen gate command verbatim with EV/GATE/RELEASE/RUN_BASE set; raw output to
// EV/gates/<id>.log; prints id + exit. Verdict folding stays with the orchestrator (expect strings are judged
// against the log bodies, never by exit code alone).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const [hostFilter, RELEASE, RUN_BASE] = process.argv.slice(2);
if (!hostFilter || !RELEASE || !RUN_BASE) { console.error('usage: run-gc.mjs <windows|any|capture> <RELEASE> <RUN_BASE>'); process.exit(2); }
const state = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
const gates = state.plan.acceptance_gates.filter(g => /^GC\.(1|2|3|4|5|6|7|8|9|10|11|12)$/.test(g.id) && (g.host === hostFilter || (hostFilter === 'windows' && g.host === 'any')));
for (const g of gates) {
  const env = { ...process.env, EV, GATE: g.id, RELEASE, RUN_BASE };
  const r = spawnSync('bash', ['-c', g.check], { env, encoding: 'utf8', timeout: 3600000 });
  const log = path.join(EV, 'gates', `${g.id}.log`);
  fs.writeFileSync(log, (r.stdout || '') + (r.stderr || '') + `\nGC_RUN_EXIT=${r.status}\n`);
  console.log(g.id, 'host', g.host, 'exit', r.status);
}
console.log('GC_RUN_DONE filter=' + hostFilter);