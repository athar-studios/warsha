const fs = require('fs');
const R = 'C:/Users/Dragonfly/Downloads/warsha-wt/tokfix/';

function patch(file, edits) {
  const p = R + file;
  let raw = fs.readFileSync(p, 'utf8');
  const crlf = raw.includes('\r\n');
  // Normalise to LF for matching, restore the file's own EOL on write, so we never flip line endings.
  let t = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  for (const [from, to, expect] of edits) {
    const n = t.split(from).length - 1;
    if (n !== expect) throw new Error(`${file}: expected ${expect} occurrence(s) of ${JSON.stringify(from.slice(0, 60))}, found ${n}`);
    t = t.split(from).join(to);
  }
  fs.writeFileSync(p, crlf ? t.replace(/\n/g, '\r\n') : t);
  console.log('patched ' + file + ' (' + (crlf ? 'CRLF' : 'LF') + ')');
}

// 1) GatesInbox: emit the band with the token's WIDTH read from the token layer, so the inline style
//    text is "3px solid var(--warsha-bench-edge)" (what states.spec.ts:132 asserts) while the app
//    source contains no px literal (what the R6.9 ratchet counts).
patch('apps/desktop/src/screens/GatesInbox.tsx', [
  [
    "  Skeleton,\n  Text,",
    "  Skeleton,\n  Text,\n  sizeTokens,",
    1,
  ],
  [
    "const QUIET_BAND: React.CSSProperties = { borderInlineStart: 'var(--warsha-line-band)' };",
    "const QUIET_BAND: React.CSSProperties = {\n  borderInlineStart: `${sizeTokens.edge} solid var(--warsha-bench-edge)`,\n};",
    1,
  ],
  [
    "                      borderInlineStart: 'var(--warsha-line-band)',",
    "                      borderInlineStart: `${sizeTokens.edge} solid var(--warsha-bench-edge)`,",
    1,
  ],
]);

// 2) W5's own unit test asserted the token SPELLING. Re-point it at the same band expressed through
//    the token layer: it still proves the decided card carries the plate's edge, and it no longer
//    contradicts the frozen e2e assertion.
patch('apps/desktop/src/screens/GatesInbox.test.tsx', [
  [
    "expect(card().style.borderInlineStart).toContain('--warsha-line-band');",
    "expect(card().style.borderInlineStart).toContain('var(--warsha-bench-edge)');\n    expect(card().style.borderInlineStart).toMatch(/^3px solid /);",
    1,
  ],
]);

// 3) INT-2: the planner-specified one-line tightening.
patch('packages/ui/src/tokens/tokenDrift.test.ts', [
  ['const APP_LENGTH_BUDGET = 145;', 'const APP_LENGTH_BUDGET = 0;', 1],
]);

console.log('--- all patches applied ---');
