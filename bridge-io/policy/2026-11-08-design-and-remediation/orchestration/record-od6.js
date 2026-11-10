const fs = require('fs');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 51) { console.error('unexpected seq ' + s.seq); process.exit(1); }

s.owner_decisions_required.push({
  id: 'OD6',
  at: now,
  topic:
    'Product inconsistency in shipped code: the read-before-write guard exists but is never enabled, while its own policy default says enabled, and the daemon reads neither',
  blocking: [],
  blocking_scope:
    'Nothing in this run - every gate passes. This is a shipped-behaviour question that the W6 review recorded as MINOR M1 and that would otherwise be lost.',
  evidence: {
    executor_default: 'crates/warsha-pipeline/src/agent_tools.rs:228 - FilesystemToolExecutor::new leaves read_guard: None',
    opt_in_only: 'agent_tools.rs:238 - the only way to enable it is with_read_before_write(enforce), called by nobody',
    policy_default: 'crates/warsha-pipeline/src/work_protection.rs:73 - WorkProtectionPolicy::default() sets read_before_write: true',
    daemon: 'crates/warshad/src/lib.rs contains NO reference to with_read_before_write or read_before_write, so the policy field is never read and the guard is inert in the shipped product',
    the_trap: 'wiring it as-is would make writing a brand-new file impossible, because a file that does not exist can never have been read first - the executor would refuse every create',
  },
  question:
    'Should an agent be required to read a file before overwriting it, and should creating a new file be exempt from that requirement?',
  options: [
    'Wire the guard in the daemon from the policy AND exempt creation of a file that does not exist (the guard refuses only a write that would clobber unseen existing content). Most consistent with the policy default and with the safety intent.',
    'Change the policy default to false so the shipped behaviour and the stated policy agree, and track wiring as a separate feature.',
    'Leave both as-is and document that the guard is opt-in and currently unused.',
  ],
  why_owner:
    'This changes shipped agent behaviour (whether an autonomous agent can overwrite a file it has not read), which is a product decision under SECURITY/AGENTS rules, not an engineering preference. It also spans two crates - agent_tools.rs (W6) and warshad (no packet owner) - so it cannot be a repair inside any existing packet.',
  orchestrator_action: 'NOT performed. No code changed. Recorded so it is not lost.',
});

s.orchestration_findings.push({
  at: now,
  topic: 'Surfaced a shipped-code inconsistency that a review had filed as minor: the read-before-write guard is inert',
  fact:
    'W6 review finding M1 said the guard ships unwired while WorkProtectionPolicy::default() sets read_before_write: true. I verified it on the integration tip rather than trusting the review: agent_tools.rs:228 constructs the executor with read_guard: None, agent_tools.rs:238 exposes with_read_before_write as the only way to enable it, work_protection.rs:73 sets the default to true, and crates/warshad/src/lib.rs references neither - so the policy field is dead and the guard never runs in the shipped product. It is not a gate failure (all gates pass) and it is not a regression from this run, but it is a real gap between stated policy and behaviour, and the obvious naive fix is a trap: wiring it as-is would refuse every attempt to create a new file. Recorded as OD6 with three options and left untouched. This is the kind of substantive-but-not-gating issue that gets lost when a review labels it minor and the run closes.',
});

fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/052-od6.json', JSON.stringify(s, null, 2) + '\n');

// Append the OD6 section to the owner-facing document (read + append inside node, no shell quoting).
const p = dir + 'OWNER_DECISIONS.md';
const doc = fs.readFileSync(p, 'utf8');
const section = [
  '',
  '## OD6 — NEW, non-blocking: the read-before-write guard is inert in the shipped product',
  '',
  'Every gate in this run passes, so this does not block acceptance. It is surfaced because a code review',
  'filed it as a minor and this run closes: the guard exists, is documented as opt-in, and is never enabled,',
  'while the policy that describes it defaults to on.',
  '',
  '| Fact | Where |',
  '| --- | --- |',
  '| The executor is built with the guard **off** | `crates/warsha-pipeline/src/agent_tools.rs:228` |',
  '| The only way to enable it, called by nobody | `agent_tools.rs:238` (`with_read_before_write`) |',
  '| The policy default says **on** | `crates/warsha-pipeline/src/work_protection.rs:73` |',
  '| The daemon reads neither | `crates/warshad/src/lib.rs` contains no reference to either |',
  '',
  '**The trap:** wiring it as written would make it impossible to create a new file, because a file that does',
  'not exist can never have been read first. Any fix must exempt creation.',
  '',
  '**Question for you:** should an agent be required to read a file before overwriting it, and should creating',
  'a new file be exempt? Options: (a) wire it from the policy *and* exempt creation; (b) change the policy',
  'default to false so behaviour and policy agree, and track wiring as a feature; (c) leave as-is and document',
  'that it is opt-in and unused.',
  '',
  'It spans two crates — `agent_tools.rs` (W6) and `warshad` (no packet owner) — so it cannot be a repair',
  'inside any existing packet, and it changes shipped agent behaviour, which is your call.',
].join('\n');
fs.writeFileSync(p, doc.replace(/\s*$/, '') + section + '\n');

const v = JSON.parse(fs.readFileSync(dir + 'verdict.json', 'utf8'));
v.non_blocking_product_decisions = [
  {
    id: 'OD6',
    topic: 'read-before-write guard is inert; policy default says on; daemon reads neither (agent_tools.rs:228/:238, work_protection.rs:73, no reference in warshad/src/lib.rs)',
    blocks: 'nothing',
  },
];
fs.writeFileSync(dir + 'verdict.json', JSON.stringify(v, null, 2) + '\n');

console.log('seq=' + s.seq + ' OD6 recorded');
console.log('owner decisions: ' + s.owner_decisions_required.map((d) => d.id).join(', '));
console.log('OWNER_DECISIONS.md now ' + fs.statSync(p).size + ' B');
