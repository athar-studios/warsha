// Orchestrator landing helper: inspect the five Wave A worktrees and write delegation/wave-a-heads.json
// for the packets whose implementer has committed (ahead > 0) and left a clean tree.
// Usage: node collect-heads.mjs   (read-only on the repos; prints head, commits ahead, dirty count, changed files)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const BASE = '4c65ead4f46cf97eecffd73149a57056e505568c';
const git = (wt, ...args) => execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8' }).trim();
const heads = {};
for (const id of ['R1', 'V1', 'U0', 'U2', 'H1']) {
  const wt = `C:/Users/Dragonfly/Downloads/warsha-wt/v3/${id.toLowerCase()}`;
  if (!fs.existsSync(wt)) { console.log(id, '(no worktree yet)'); continue; }
  const ahead = parseInt(git(wt, 'rev-list', '--count', `${BASE}..HEAD`), 10);
  const dirty = git(wt, 'status', '--porcelain').split('\n').filter(Boolean).length;
  const head = git(wt, 'rev-parse', 'HEAD');
  const files = ahead > 0 ? git(wt, 'diff', '--name-only', `${BASE}..HEAD`).split('\n').filter(Boolean) : [];
  const report = fs.existsSync(path.join(EV, 'packets', id, 'report.md')) ? 'report.md present' : 'NO report.md';
  console.log(`${id} head=${head.slice(0, 7)} ahead=${ahead} dirty=${dirty} files=${files.length} ${report}`);
  files.slice(0, 12).forEach(f => console.log('   ', f));
  if (files.length > 12) console.log(`    ... +${files.length - 12} more`);
  if (ahead > 0 && dirty === 0) heads[id] = head;
}
fs.writeFileSync(path.join(EV, 'delegation', 'wave-a-heads.json'), JSON.stringify(heads, null, 2));
console.log('wave-a-heads.json ->', Object.keys(heads).join(',') || '(none landed)');