// One-off: decode `od -c` output back to raw text (verifier evidence helper, not a gate).
import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const out = [];
for (const ln of lines) {
  const m = ln.match(/^[0-7]{7}\s+(.*)$/);
  if (!m) continue;
  const rest = m[1];
  // od -c pads tokens to 4 columns separated by spaces (3 spaces + char, or octal)
  const toks = rest.match(/(?:\S{1,4}|\\\d{3})/g) || [];
  for (let t of toks) {
    if (/^[0-7]{3}$/.test(t)) out.push(parseInt(t, 8));
    else if (t === '\\n') out.push(10);
    else if (t === '\\t') out.push(9);
    else if (t === '\\r') out.push(13);
    else if (t === '\\0') out.push(0);
    else if (t === '\\\\') out.push(92);
    else { for (const ch of t) out.push(ch.charCodeAt(0)); }
  }
}
process.stdout.write(Buffer.from(out).toString('utf8'));
