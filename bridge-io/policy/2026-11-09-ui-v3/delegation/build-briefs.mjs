// Orchestrator prep: assemble Wave A implementer briefs verbatim (COMMON + section + gates.md).
// Usage: node build-briefs.mjs [BASE]   — without BASE, leaves the {{BASE}} token for dispatch time.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const args = process.argv.slice(2);
const base = args.find(a => /^[0-9a-f]{40}$/.test(a)) || '{{BASE}}';
const idArgs = args.filter(a => /^(U0|U2|H1|R1|V1|U1|E0|U3|U4|U5|U6)$/.test(a));
const ids = idArgs.length ? idArgs : ['U0', 'U2', 'H1', 'R1', 'V1'];
const packets = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8')).plan.packets;
const pack = fs.readFileSync(path.join(EV, 'PACKETS.md'), 'utf8');
const commonStart = pack.indexOf('## COMMON (every packet)');
const commonEnd = pack.indexOf('\n---\n', commonStart);
const common = pack.slice(commonStart, commonEnd).trim();
const counts = 'ui 181, client 149, crypto 22, i18n 52, remote 221, desktop 468, desktop_v3 0, rust 746, rust_ignored 10 (G0 at ba90e71)';
fs.mkdirSync(path.join(EV, 'delegation', 'wave-a'), { recursive: true });
for (const id of ids) {
  const p = packets.find(x => x.id === id);
  const secStart = pack.indexOf(`## ${id} —`);
  if (secStart < 0) throw new Error(`section missing: ${id}`);
  const secEnd = pack.indexOf('\n## ', secStart + 1);
  const section = pack.slice(secStart, secEnd < 0 ? pack.length : secEnd).trim();
  const gates = fs.readFileSync(path.join(EV, 'packets', id, 'gates.md'), 'utf8').trim();
  const header = [
    `# Dispatch brief — packet ${id} (${p.slug}), Wave A — run 2026-11-09-ui-v3`,
    `EV=${EV}`,
    `branch: ${p.branch}`,
    `worktree: ${p.worktree}`,
    `base: ${base}  (at dispatch this must equal the worktree HEAD; record it as BASE)`,
    `base_counts (G0): ${counts}`,
    'Roles: you are the IMPLEMENTER. A separate reviewer and a separate verifier judge this packet; neither is you.',
    'Deliverable: commits in your worktree + $EV/packets/' + id + '/report.md per COMMON. Repairs max 3, back through review.',
    ''
  ].join('\n');
  const brief = header + '\n' + common + '\n\n---\n\n' + section + '\n\n---\n\n' + gates + '\n';
  const out = path.join(EV, 'delegation', 'wave-a', `${id}.brief.md`);
  fs.writeFileSync(out, brief);
  const ok = brief.includes('You are the IMPLEMENTER') && brief.includes('Frozen by the planner') && brief.includes(p.branch);
  console.log(id, brief.length, 'chars', ok ? 'verbatim-markers-ok' : 'MARKERS-MISSING');
}