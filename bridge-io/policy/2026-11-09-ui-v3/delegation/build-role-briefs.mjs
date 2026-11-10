// Orchestrator prep: assemble Wave A REVIEWER and VERIFIER briefs (role-separated, gates verbatim).
// Usage: node build-role-briefs.mjs [BASE] [HEAD]  — tokens left when omitted.
import fs from 'node:fs';
import path from 'node:path';
const EV = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3';
const args = process.argv.slice(2);
const BASE = args.find(a => /^[0-9a-f]{40}$/.test(a)) || '{{BASE}}';
const HEAD = '{{HEAD}}';
const idArgs = args.filter(a => /^(U0|U2|H1|R1|V1|U1|E0|U3|U4|U5|U6)$/.test(a));
const ids = idArgs.length ? idArgs : ['U0', 'U2', 'H1', 'R1', 'V1'];
const state = JSON.parse(fs.readFileSync(path.join(EV, 'state.json'), 'utf8'));
const pack = fs.readFileSync(path.join(EV, 'PACKETS.md'), 'utf8');
const rejectStart = pack.indexOf('**The v3 rules that reviewers reject on sight:**');
const rejectEnd = pack.indexOf('\n\n', rejectStart);
const rejectList = pack.slice(rejectStart, rejectEnd).trim();
const neverStart = pack.indexOf('**Never:**');
const neverEnd = pack.indexOf('\n\n', neverStart);
const neverList = pack.slice(neverStart, neverEnd).trim();
fs.mkdirSync(path.join(EV, 'delegation', 'wave-a'), { recursive: true });
for (const id of ids) {
  const p = state.plan.packets.find(x => x.id === id);
  const gates = fs.readFileSync(path.join(EV, 'packets', id, 'gates.md'), 'utf8').trim();
  const review = [
    `# REVIEW brief — packet ${id} (${p.slug}) — run 2026-11-09-ui-v3`,
    `You are the independent REVIEWER. You are neither the implementer nor the verifier of this packet. You do not edit the implementation.`,
    `EV=${EV}`,
    `Requirement (original): ${p.summary}`,
    `Allowed files: ${JSON.stringify(p.allowed)}`,
    `Baseline BASE=${BASE}; reviewed commit HEAD=${HEAD} (one commit range; read the FULL diff: git -C ${p.worktree} diff ${BASE}..${HEAD}).`,
    `Check: scope conformance (no out-of-scope edits); AGENTS.md rules; the reject-on-sight list below; i18n ar+en parity and Arabic purity; RTL logical properties; secret hygiene; correctness; test quality (no skipped/weakened assertions); architecture boundaries via node scripts/check-arch.mjs in the worktree.`,
    rejectList,
    neverList,
    `Deliverables: ${EV}/packets/${id}/review.md (findings + final verdict APPROVE or REQUEST-CHANGES; the final verdict governs) and the exact patch: git -C ${p.worktree} format-patch ${BASE}..${HEAD} -o ${EV}/diff/${id}/.`,
    `Findings return to the implementer as repair items through the orchestrator; max 3 iterations. Never edit gates, never edit the implementation, never run --update-snapshots.`,
    ''
  ].join('\n');
  const verify = [
    `# VERIFY brief — packet ${id} (${p.slug}) — run 2026-11-09-ui-v3`,
    `You are the independent VERIFIER. You are neither the implementer nor the reviewer. You run gates; you never fix anything. Failures become repair items.`,
    `EV=${EV} · BASE=${BASE} · reviewed commit HEAD=${HEAD} · worktree ${p.worktree}`,
    `Run EVERY gate below exactly as written with EV, BASE and GATE set; raw stdout/stderr to ${EV}/gates/<gate id>.log; then record verdict/exit_code/commit/timestamp(UTC)/log path for each gate id into ${EV}/acceptance.json (verdict fields only — never the check/expect text).`,
    `Hosts: windows/any gates run in the packet worktree on Windows. capture gates run on the WSL capture host: MSYS_NO_PATHCONV=1 wsl -d Ubuntu -u root -- bash -lc with PATH=/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin exported first; fetch the commit from the Windows checkout into /root/warsha-visual's object store (never touch its dirty tree), git worktree add --detach a fresh /root/verify-${id.toLowerCase()} tree, pnpm install --frozen-lockfile, port-guard 5173/5174, one Playwright invocation at a time, redirect to logs (never pipe through tail), record snapshot writes and dirty-after.`,
    `.pw gates: run on a SCRATCH merge of the packet branch onto the current integration tip (scratch worktree/branch, never committed, never pushed); no --update-snapshots anywhere.`,
    `A claim without a gate log on disk is not done. Read log bodies, not only exit codes; classify product vs harness/quoting vs environment failures before reporting.`,
    `Deliverables: the logs, the acceptance.json entries, and ${EV}/packets/${id}/verify.md (per-gate table + uncovered scope + blockers).`,
    '',
    gates,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(EV, 'delegation', 'wave-a', `${id}.review.brief.md`), review);
  fs.writeFileSync(path.join(EV, 'delegation', 'wave-a', `${id}.verify.brief.md`), verify);
  console.log(id, 'review', review.length, 'verify', verify.length, verify.includes(gates) ? 'gates-verbatim-ok' : 'GATES-MISSING');
}