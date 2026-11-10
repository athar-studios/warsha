const fs = require('fs');
const path = require('path');
const dir = 'C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const ap = JSON.parse(fs.readFileSync(dir + 'acceptance.json', 'utf8'));

// Normalise multi-part log references so every part carries the gates/ prefix. The files were always
// present; the reference format was ambiguous (first part prefixed, second not), which is the kind of
// detail that makes a record untrustworthy to a reader who tries to follow it.
let normalised = 0;
for (const g of ap.gates) {
  if (!g.log || !g.log.includes(' + ')) continue;
  const parts = g.log.split(' + ').map((p) => p.trim());
  const fixed = parts.map((p) => (p.startsWith('gates/') ? p : 'gates/' + p));
  if (fixed.join(' + ') !== g.log) {
    g.log = fixed.join(' + ');
    normalised++;
  }
}
fs.writeFileSync(dir + 'acceptance.json', JSON.stringify(ap, null, 2) + '\n');

// Precise accounting, so no number is unexplained.
let withLogField = 0;
let allFilesExist = 0;
let missing = [];
let blockedNoLog = [];
for (const g of ap.gates) {
  if (!g.log) {
    if (g.verdict === 'blocked-on-owner-decision') blockedNoLog.push(g.id);
    else missing.push(g.id + ' (verdict ' + g.verdict + ', NO log field at all)');
    continue;
  }
  withLogField++;
  const parts = g.log.split(' + ').map((p) => p.trim());
  let ok = true;
  for (const p of parts) {
    const f = path.join(dir, p);
    if (p.includes('*')) continue;
    if (!fs.existsSync(f) || fs.statSync(f).size === 0) { ok = false; missing.push(g.id + ' -> ' + p); }
  }
  if (ok) allFilesExist++;
}

console.log('normalised multi-part log references: ' + normalised);
console.log('gates total: ' + ap.gates.length);
console.log('  with a log field: ' + withLogField + ' (all files present and non-empty: ' + allFilesExist + ')');
console.log('  deliberately without a log (blocked, never run): ' + blockedNoLog.length + ' -> ' + blockedNoLog.join(', '));
console.log('  problems: ' + missing.length + (missing.length ? ' -> ' + missing.join('; ') : ''));

const s = JSON.parse(fs.readFileSync(dir + 'state.json', 'utf8'));
if (s.seq !== 54) { console.error('seq ' + s.seq); process.exit(1); }
s.seq = 55;
s.updated_at = now;
s.evidence_audit.accounting = {
  at: now,
  gates_total: ap.gates.length,
  with_log_field: withLogField,
  all_referenced_files_present_and_non_empty: allFilesExist,
  deliberately_log_less: blockedNoLog,
  problems: missing,
  note:
    'GC.6, GC.7 and GC.8 referenced two log files each, and the second part was written without the gates/ prefix. The files were always present; the reference format was ambiguous, so all three were normalised. This is why an earlier count read 107 of 108: it was counting log FIELDS rather than files that resolve.',
};
fs.writeFileSync(dir + 'state.json', JSON.stringify(s, null, 2) + '\n');
fs.writeFileSync(dir + 'checkpoints/055-accounting.json', JSON.stringify(s, null, 2) + '\n');
console.log('seq=' + s.seq);
