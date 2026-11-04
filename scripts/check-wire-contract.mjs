#!/usr/bin/env node
// scripts/check-wire-contract.mjs — enforce the JSON-RPC wire contract (docs/ARCH_RULES.md R7).
//
// Usage:
//   node scripts/check-wire-contract.mjs                  check the repository this file lives in
//   node scripts/check-wire-contract.mjs --root <dir>     check another tree (used by the self-test)
//   node scripts/check-wire-contract.mjs --self-test      plant one violation per check in a temp
//                                                         fixture, assert every check fires, prove
//                                                         each parse mode (the const-indirect name,
//                                                         the rpc<T> generic, every quote style a
//                                                         wire name can arrive in, a nested-angle
//                                                         generic, a multi-line #[method], a quoted
//                                                         params key, a harness stub, a missing
//                                                         policy row, and every params-NAME shape:
//                                                         the snake name, its camelCase alias, the
//                                                         shorthand property, the quoted key, a
//                                                         spread, a computed key, a positional
//                                                         array, a variable), assert a renamed key
//                                                         FIRES W8 where W7 is blind to it and that
//                                                         an aliased CASING does not (a `clean:`
//                                                         mutant, which fails on any false
//                                                         positive), and assert a clean fixture is
//                                                         reported clean in both modes
//   node scripts/check-wire-contract.mjs --report-only-known
//                                                         run the strict checks and additionally
//                                                         print the known #25/#40 drift items
//                                                         (client-side names and the required-field
//                                                         break the TypeScript lane is landing)
//                                                         without letting them change the exit code
//
// Output contract (see docs/ARCH_RULES.md):
//   `<CHECK-ID>: <file>:<line> <offence>` on stdout, one line per violation, exit 1;
//   `wire: 8 checks, 0 violations` on stdout and exit 0 otherwise.
//
// Four sources, compared until they agree:
//   daemon   — every `#[method(name = "…")]` in crates/warshad/src/lib.rs (whitespace-tolerant,
//              so a multi-line attribute cannot be skipped), with its bound argument names;
//   policy   — every `method: "…"` row in METHOD_POLICIES in crates/warshad/src/auth.rs;
//   client   — every JSON-RPC name `packages/client/src/index.ts` can put on the wire: literal
//              `rpc('a.b', …)` calls in EITHER quote style (and a template-literal name, so
//              ``rpc(`a.b`)`` cannot vanish either), `rpc<T>('a.b', …)` / `rpc<T>("a.b", …)`
//              generics, and names passed through a same-file `const X = 'a.b'` / `const X = "a.b"`
//              indirection (five call sites do exactly that — a naive `'…'` regex silently drops
//              them), with each call's params object counted AND its top-level key names read (a
//              quoted key counts as an entry and is still a key);
//   harness  — the `RPC_METHODS` array in apps/desktop/e2e/harness.ts, entries in either quote style;
//
// The param rules, and the measurements that settled them (DECISIONS.md 2026-11-03, #40 WITHDRAWN +
// restated; #54 for the renames): the earlier plan to require client keys to equal the daemon's
// snake_case argument names was RETRACTED after running the real daemon — `runs.list` with camelCase
// `{"projectId": …}` returned `{"result":[]}`, both spellings accepted, both reaching the store. A
// gate that fails working code is worse than no gate, so key CASING is not an offence here and the
// self-test guards that retraction (a `clean:` mutant camelCases every key of one call and must
// leave the tree at zero violations). What the live daemon does fail on is two different things:
//   - fewer entries than the method has required (non-`Option`) bound arguments —
//     `projects.create {"name":"probe"}`, exactly what the client shipped, answered `-32602 "missing
//     field 'description'"`. That is W7 (required-field drift), and it is a COUNT;
//   - a key that is no accepted spelling of any bound argument — `{ id }` against an argument bound
//     as `run_id`, answered `-32602 "missing field 'run_id'"`, twice in shipped code and caught only
//     by hand-running the daemon, because W7 counted 1 sent against 1 required and said nothing.
//     That is W8 (param-name drift), and it is a NAME comparison.
// W8 exists because of where the aliases come from: jsonrpsee 0.26.1's `render_server.rs` generates
// `#[serde(rename = "<arg>")]` plus an `alias` for the snake_case and one for the lowerCamelCase heck
// spelling of every argument, and serde drops what matches none — so exactly two spellings bind, one
// of them derived, and everything else is drift. See the `camelAlias` comment for the citation.
// Type- and shape-level drift (a string where the daemon deserialises an object) is invisible to any
// text parser and is the domain of the boot-the-daemon and drive-it test that DECISIONS.md names as
// the permanent guard.
//
// Known drift (DECISIONS.md 2026-11-03, #25 and #40): CLOSED. The TypeScript client lane landed —
// the eight drifted names are renamed or deleted, `projects.create` sends its three required
// fields, and the harness stub table moved with them — so REQUIRE_NO_KNOWN_DRIFT is now true and
// both known sets are empty. Every name and every params object is checked strictly.
//
// The machinery is kept on purpose: the sets and the flag are the documented one-edit escape hatch
// if a future drift must ship deferred, and the self-test asserts in both modes that nothing is
// deferred while the sets are empty (`enforcedInBothModes`). `--report-only-known` therefore prints
// nothing today; it is inert, not weak.
//
// Quote styles, and why they are all matched: a literal-branch regex that accepts only `'…'` is a
// gate on the file's formatter, not on the wire. Measured on a copied tree: `rpc("made.up", { x: 1 })`
// planted in the client left the check reporting `0 violations, exit 0`, while the identical name in
// single quotes fired W1 and exited 1 (reproduced independently by a second lane). Prettier's
// single-quote config keeps that latent today — and a `.prettierignore`, a `// prettier-ignore` or a
// generated file is exactly how a name gets to hide. So the client literal branch, the same-file const
// table, the harness stub table and the params-key counter all accept `'…'`, `"…"` and (for the two
// name positions that can hold one) a backtick. The Rust sides keep their `"`-only regexes on
// purpose: a Rust string literal has no other spelling.
//
// What this parser still cannot see, so a reviewer does not over-trust it: a call that reaches `rpc`
// any other way than `.rpc(` (a bound alias, a helper that takes the name and calls `rpc` itself) is
// not a call site here — the dot is what tells a call from the declaration; a name held in a
// `let`/`var` instead of a `const` does not resolve and fires W1 as "did not resolve" (loud, not
// silent); a generic nesting two or more levels of angle brackets is one more than the parser
// balances and stops being seen; a template with interpolation is parsed as a literal name, so it
// fires W1 on `runs.${id}` rather than hiding the call. The same discipline now covers the PARAMS:
// a params argument that is a variable, a call, a spread or a computed key is not name-checkable, and
// fires W8 as an unresolved-params finding instead of passing — the gate says it did not look rather
// than implying it looked and found nothing. A positional array is the one shape that is legal and
// still not name-checkable, so its finding text says so. Type- and shape-level drift is out of reach
// of any text parser and stays the domain of the live-daemon test named above.
//
// Dependency-free on purpose: like check-arch.mjs, this may run before `pnpm install`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAEMON_FILE = 'crates/warshad/src/lib.rs';
const POLICY_FILE = 'crates/warshad/src/auth.rs';
const CLIENT_FILE = 'packages/client/src/index.ts';
const HARNESS_FILE = 'apps/desktop/e2e/harness.ts';

const CHECK_IDS = [
  ['W1', 'client-method-unregistered'],
  ['W2', 'harness-method-unregistered'],
  ['W3', 'daemon-method-without-policy'],
  ['W4', 'policy-row-without-daemon-method'],
  ['W5', 'method-without-extensions'],
  ['W6', 'view-integrity'],
  ['W7', 'required-field-drift'],
  ['W8', 'param-name-drift'],
];

// The one-edit flip: when true, the KNOWN_* sets below are ignored and every parsed name and
// params object is checked strictly. It is TRUE since the TypeScript #25/#40 client lane landed
// (the renames, the deletions, `projects.create`'s three required fields and the harness stub
// table), which is the state the check is meant to stay in. The self-test's
// `enforcedInBothModes` mutants assert that a drift shape fires in the shipped mode as well and
// that nothing is deferred while the sets are empty — so re-populating a whitelist is a visible
// decision, not a silent one.
const REQUIRE_NO_KNOWN_DRIFT = true;

// Names `packages/client` puts on the wire that `warshad` does not register. EMPTY since the #25
// client lane landed: budget.get→budget.show, devices.remove→devices.revoke, runs.status→runs.get
// and runs.logs→runs.events, with projects.delete, providers.budget, providers.budget.status and
// roles.assign deleted outright (DECISIONS.md 2026-11-03; each answered `-32601 Method not found`
// against a live daemon before the rename).
const KNOWN_UNREGISTERED_METHODS = new Set([]);

// Registered methods whose params object supplies fewer entries than the daemon has required
// bound arguments. EMPTY since the client lane landed: `projects.create` sent `{ name }` where the
// daemon requires name + description + language (measured live: `-32602 "missing field
// 'description'"`, then `'language'`), which is why the first-run flow could not create its first
// project (#11); the client now sends all three and its callers pass the locale.
const KNOWN_PARAM_DRIFT_METHODS = new Set([]);

const toPosix = (p) => p.split(path.sep).join('/');

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < text.length && i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

const violation = (id, file, line, offence) => ({ id, file: toPosix(file), line, offence });

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------------------- parsers

/**
 * Skip a string literal starting at `i` (which is the quote) and return the index after its
 * closing quote. Template interpolations are not parsed — no call site in the checked files
 * uses one inside a params object, and the self-test fixtures do not either.
 */
function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src[j] === quote) return j + 1;
    j += 1;
  }
  return j;
}

/** Split on commas outside `<>()[]{}` nesting (so `Vec<(String, String)>` stays one part). */
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const c of s) {
    if (c === '<' || c === '(' || c === '[' || c === '{') depth += 1;
    if (c === '>' || c === ')' || c === ']' || c === '}') depth -= 1;
    if (c === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim() !== '') out.push(current);
  return out;
}

/**
 * The bound argument names of one `#[method]` signature, in declaration order, each marked
 * `optional` when its type is `Option<…>` (an `Option` argument may be omitted on the wire).
 * `sig` is the text between the `fn` parens.
 */
function parseBindings(sig) {
  const binds = [];
  for (const part of splitTopLevel(sig)) {
    const trimmed = part.trim();
    if (trimmed === '' || trimmed === 'self' || trimmed === '&self') continue;
    const m = /^([a-z_][a-z0-9_]*)\s*:\s*([\s\S]+)$/.exec(trimmed);
    if (!m) continue;
    binds.push({ name: m[1], optional: /^\s*Option\s*</.test(m[2]) });
  }
  return binds;
}

/**
 * Scan an object literal starting at its `{`: its top-level entries as `keys` (`{ name, index }`,
 * `index` pointing at the key token so a finding can name its own line), how many of them there
 * are, and the `blockers` that stop the key set from being known at all — a top-level spread and a
 * computed `[expr]:` key both mean a name this parser cannot see. `ok` is false when the literal is
 * never closed. W7 reads `size`, W8 reads `keys` and `blockers`.
 */
function scanObjectLiteral(src, open) {
  const keys = [];
  const blockers = [];
  let i = open + 1;
  let depth = 1;
  let state = 'key'; // 'key' before a property name, 'value' after its colon
  let pending = null;
  let pendingAt = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      // A quoted property name IS a key: `{ "run_id": x }` must count as an entry the way
      // `{ run_id: x }` does, or W7 reads a fully-specified params object as empty and fails
      // working code. Only at depth 1, only where a key is expected; every other string is a
      // value and is skipped whole.
      if (depth === 1 && state === 'key' && pending === null) {
        const after = skipString(src, i);
        pending = src.slice(i + 1, after - 1);
        pendingAt = i;
        i = after;
        continue;
      }
      i = skipString(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (depth === 1 && state === 'key' && pending === null) {
      // `{ ...base, run_id }` sends more keys than the parser can name, and `{ [k]: v }` sends a
      // key the parser cannot read. Either one is an UNRESOLVABLE params object: say so rather
      // than check the names that happen to be visible.
      if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') {
        blockers.push('a spread (`...`), so keys it contributes are not visible here');
        state = 'value'; // skip the spread's own expression: it holds no key token
        i += 3;
        continue;
      }
      if (c === '[') {
        blockers.push('a computed key (`[expr]:`), whose name is not a literal here');
      }
    }
    if (c === '{' || c === '[' || c === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        if (state === 'key' && pending !== null) keys.push({ name: pending, index: pendingAt });
        return { size: keys.length, keys, blockers, ok: true };
      }
      continue;
    }
    if (depth !== 1) {
      i += 1;
      continue;
    }
    if (c === ':') {
      if (pending !== null) keys.push({ name: pending, index: pendingAt });
      pending = null;
      state = 'value';
      i += 1;
      continue;
    }
    if (c === ',') {
      if (state === 'key' && pending !== null) keys.push({ name: pending, index: pendingAt });
      pending = null;
      state = 'key';
      i += 1;
      continue;
    }
    const id = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
    if (id && state === 'key' && pending === null) {
      pending = id[0];
      pendingAt = i;
      i += id[0].length;
      continue;
    }
    i += 1;
  }
  return { size: keys.length, keys, blockers, ok: false };
}

/**
 * Every `#[method(name = "…")]` in the `WarshaApi` trait: name, declared line, whether it is
 * `with_extensions`, and its bound argument names. A method whose `fn` cannot be located is
 * reported as malformed so the caller fails rather than silently under-counting.
 */
function parseDaemon(text) {
  const methods = [];
  const malformed = [];
  const marker = 'pub trait WarshaApi {';
  const markerStart = text.indexOf(marker);
  if (markerStart < 0) return { found: false, methods, malformed };
  const regionStart = markerStart + marker.length;
  const regionEndRel = text.indexOf('\n}', regionStart);
  const region = text.slice(regionStart, regionEndRel < 0 ? text.length : regionEndRel);

  const attrRe = /#\[\s*method\s*\(([\s\S]*?)\)\s*\]/g;
  let attr;
  while ((attr = attrRe.exec(region)) !== null) {
    const nameMatch = /name\s*=\s*"([^"]+)"/.exec(attr[1]);
    if (!nameMatch) {
      malformed.push({
        line: lineOf(text, regionStart + attr.index),
        offence: 'a #[method(…)] attribute carries no `name = "…"` literal',
      });
      continue;
    }
    const name = nameMatch[1];
    const line = lineOf(text, regionStart + attr.index);
    const withExtensions = /(^|[^\w])with_extensions([^\w]|$)/.test(attr[1]);

    const rest = region.slice(attr.index + attr[0].length);
    const fnMatch = /(?:^|\n)[ \t]*(?:async[ \t]+)?fn[ \t]+([A-Za-z0-9_]+)[ \t]*\(/.exec(rest);
    let binds = null;
    if (fnMatch) {
      const openAbs = attr.index + attr[0].length + fnMatch.index + fnMatch[0].length;
      let depth = 1;
      let j = openAbs;
      while (j < region.length && depth > 0) {
        if (region[j] === '(') depth += 1;
        if (region[j] === ')') depth -= 1;
        j += 1;
      }
      binds = parseBindings(region.slice(openAbs, j - 1));
    }
    if (binds === null) {
      malformed.push({ line, offence: `method "${name}" has no locatable \`fn\` signature after its attribute` });
    }
    methods.push({ name, line, withExtensions, binds: binds ?? [] });
  }
  return { found: true, methods, malformed };
}

/** Every `method: "…"` row inside `METHOD_POLICIES`. */
function parsePolicy(text) {
  const rows = [];
  const marker = 'pub const METHOD_POLICIES';
  const start = text.indexOf(marker);
  if (start < 0) return { found: false, rows };
  const end = text.indexOf('\n];', start);
  const region = text.slice(start, end < 0 ? text.length : end);
  const rowRe = /method:\s*"([^"]+)"/g;
  let row;
  while ((row = rowRe.exec(region)) !== null) {
    rows.push({ name: row[1], line: lineOf(text, start + row.index) });
  }
  return { found: true, rows };
}

/**
 * Every name the client can put on the wire, with the size of its params object (the number of
 * top-level entries it sends), the shape its params argument has (`paramKind`: `none`, `object`,
 * `positional` or `unresolved`) and, for an object, its top-level key names. Resolves `rpc('a.b', …)`,
 * `rpc("a.b", …)`, ``rpc(`a.b`, …)``, `rpc<T>('a.b', …)` / `rpc<T>("a.b", …)` (including one level of
 * nested angle brackets, so `rpc<Record<string, string>>(…)` is still a call site) and
 * `rpc(CONST_NAME, …)` where the const is a same-file `const NAME = 'a.b';` or `const NAME = "a.b";`,
 * at any indent and optionally `export`ed.
 * A params argument that is not a fully visible object literal yields `paramSize: null` (nothing
 * provable about its entries) and a `paramKind` that says why, so W7 skips it and W8 reports it.
 */
function parseClient(text) {
  const consts = new Map();
  const constRe =
    /(?:^|\n)[ \t]*(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:'([^']+)'|"([^"]+)")\s*;/g;
  let c;
  while ((c = constRe.exec(text)) !== null) consts.set(c[1], c[2] ?? c[3]);

  const calls = [];
  // Every alternation of the literal branch is a wire name the client can put on the wire: `'…'`,
  // `"…"` and `` `…` `` (an interpolated template parses as a literal name and therefore FAILS W1 —
  // the gate refuses to guess, it does not look away). The generic branch balances one nested
  // `<…>` so a `Record<string, string>` return type does not make the whole call invisible.
  const callRe =
    /\.rpc\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`|([A-Za-z_$][A-Za-z0-9_$]*))/g;
  let call;
  while ((call = callRe.exec(text)) !== null) {
    let name = call[1] ?? call[2] ?? call[3];
    let unresolved = null;
    if (name === undefined) {
      const resolved = consts.get(call[4]);
      if (resolved === undefined) {
        unresolved = call[4];
        name = call[4];
      } else {
        name = resolved;
      }
    }
    let i = call.index + call[0].length;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    let paramSize = null;
    let paramKind = 'none';
    let paramKeys = [];
    let paramNote = 'no params argument is written at this call site';
    if (text[i] === ')') {
      paramSize = 0;
    } else if (text[i] === ',') {
      i += 1;
      while (i < text.length && /\s/.test(text[i])) i += 1;
      if (text[i] === '{') {
        const scanned = scanObjectLiteral(text, i);
        if (scanned.blockers.length > 0) {
          paramKind = 'unresolved';
          paramNote = `an object literal carrying ${scanned.blockers.join(' and ')}`;
        } else if (!scanned.ok) {
          paramKind = 'unresolved';
          paramNote = 'an object literal that is never closed (the parser cannot count its keys)';
        } else {
          paramKind = 'object';
          paramSize = scanned.size;
          // A key list is handed out ONLY for an object the scan fully resolved: a partially-read
          // list would let a later check certify the names it happened to see.
          paramKeys = scanned.keys;
          paramNote = null;
        }
      } else if (text[i] === '[') {
        // A positional array is legal — the measured daemon answers it — but its values are matched
        // by POSITION, not by name, so there is no key here to check and none is invented.
        paramKind = 'positional';
        paramNote = 'a positional array (jsonrpsee matches it by position, not by param name)';
      } else {
        // A variable, a call, a ternary — anything that is not an object literal. W8 reports this
        // rather than checking the names it happens to be able to see, because "no finding" here
        // would mean the gate passed a call it never looked at.
        const tok = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/.exec(text.slice(i));
        paramKind = 'unresolved';
        paramNote = tok
          ? `the value of \`${tok[0]}\` — a variable, an expression or a call, not an object literal`
          : 'an argument that is not an object literal';
      }
    }
    calls.push({ name, line: lineOf(text, call.index), paramSize, paramKind, paramKeys, paramNote, unresolved });
  }
  return calls;
}

/** The `RPC_METHODS` stub table of the desktop e2e harness, in either quote style. */
function parseHarness(text) {
  const names = [];
  const marker = 'export const RPC_METHODS';
  const start = text.indexOf(marker);
  if (start < 0) return { found: false, names };
  const end = text.indexOf('\n]', start);
  const region = text.slice(start, end < 0 ? text.length : end);
  // A `'…'`-only entry regex read a double-quoted table as ZERO names, and unlike the daemon and
  // policy views the harness count has no W6 cross-check to fail on, so the whole W2 view would go
  // vacuously clean. Every quoted entry in the region is a stub the harness answers.
  const entryRe = /'([^']+)'|"([^"]+)"|`([^`]+)`/g;
  let entry;
  while ((entry = entryRe.exec(region)) !== null) {
    names.push({ name: entry[1] ?? entry[2] ?? entry[3], line: lineOf(text, start + entry.index) });
  }
  return { found: true, names };
}

// ------------------------------------------------------------------------------------------- checks

/**
 * The two spellings one Rust bound argument accepts on the wire, measured against a running
 * `warshad` and read off the macro that generates the decoder:
 * `jsonrpsee-proc-macros-0.26.1/src/render_server.rs:398-421` (the vendored copy under
 * `~/.cargo/registry/src/index.crates.io-…`) builds the params map decoder from
 * `#[serde(rename = "<arg>")]` plus an `alias` for `heck::ToSnakeCase` and an `alias` for
 * `heck::ToLowerCamelCase` of every argument name — and serde ignores unknown fields. So `run_id`
 * and `runId` both bind, and a key that is neither spelling of ANY bound argument binds nothing:
 * the daemon never sees the value, and if the argument it was meant for is required the call dies
 * with `-32602 "missing field 'run_id'"`. That is the offence W8 reports. Casing is NOT an offence,
 * which is the #40 retraction W8 must not undo (see the clean fixture's `approveCamel` call, and the
 * `clean:` mutant that camelCases every key of one call).
 */
const camelAlias = (name) =>
  name
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');

/**
 * Compare the four parsed views and return { violations, knowns }. `knowns` are the drift items
 * excluded until the #25/#40 client lane lands (or none of them, when `opts.requireNoKnownDrift`
 * is true — then they are violations like any other). Required-field drift means: the params
 * object supplies fewer entries than the method has non-`Option` bound arguments — the failure
 * the live daemon answered with `-32602 "missing field …"`. Key CASING is deliberately not an
 * offence (the retraction, DECISIONS.md 2026-11-03, measured both spellings accepted); a key that
 * is no accepted spelling of any bound argument is, and that is W8, not W7.
 */
function run(root, opts = {}) {
  const strictKnown = opts.requireNoKnownDrift ?? REQUIRE_NO_KNOWN_DRIFT;
  const violations = [];
  const knowns = [];
  const raise = (id, file, line, offence) => violations.push(violation(id, file, line, offence));
  const defer = (id, file, line, offence) => knowns.push(violation(id, file, line, offence));

  const daemonText = readIfExists(path.join(root, DAEMON_FILE));
  const policyText = readIfExists(path.join(root, POLICY_FILE));
  const clientText = readIfExists(path.join(root, CLIENT_FILE));
  const harnessText = readIfExists(path.join(root, HARNESS_FILE));

  // W6, the integrity half: a missing source or a parser that matches nothing would let the
  // other checks pass vacuously. The two daemon-side views are also counted against each other.
  let structural = 0;
  const broken = (file, offence) => {
    structural += 1;
    raise('W6', file, 1, offence);
  };
  if (daemonText === null) broken(DAEMON_FILE, 'source file missing (the wire contract cannot be checked)');
  if (policyText === null) broken(POLICY_FILE, 'source file missing (the wire contract cannot be checked)');
  if (clientText === null) broken(CLIENT_FILE, 'source file missing (the wire contract cannot be checked)');
  if (harnessText === null) broken(HARNESS_FILE, 'source file missing (the wire contract cannot be checked)');

  const daemon = daemonText === null ? { found: false, methods: [], malformed: [] } : parseDaemon(daemonText);
  const policy = policyText === null ? { found: false, rows: [] } : parsePolicy(policyText);
  const client = clientText === null ? [] : parseClient(clientText);
  const harness = harnessText === null ? { found: false, names: [] } : parseHarness(harnessText);

  if (daemonText !== null && !daemon.found) {
    broken(DAEMON_FILE, 'the `pub trait WarshaApi` declaration was not found (source moved or parser broken)');
  }
  if (policyText !== null && !policy.found) {
    broken(POLICY_FILE, '`pub const METHOD_POLICIES` was not found (source moved or parser broken)');
  }
  if (harnessText !== null && !harness.found) {
    broken(HARNESS_FILE, '`export const RPC_METHODS` was not found (source moved or parser broken)');
  }
  for (const m of daemon.malformed) {
    broken(DAEMON_FILE, `malformed method declaration at line ${m.line}: ${m.offence}`);
  }
  if (daemon.found && daemon.methods.length === 0) {
    broken(DAEMON_FILE, 'parsed zero #[method] declarations (a parser that silently matches nothing must not report clean)');
  }
  if (policy.found && policy.rows.length === 0) {
    broken(POLICY_FILE, 'parsed zero METHOD_POLICIES rows (a parser that silently matches nothing must not report clean)');
  }
  if (structural > 0) return { violations, knowns };

  const daemonSet = new Map(daemon.methods.map((m) => [m.name, m]));
  const policySet = new Set(policy.rows.map((r) => r.name));

  // W1: every name the client can put on the wire is registered by the daemon.
  for (const call of client) {
    if (call.unresolved !== null) {
      raise(
        'W1',
        CLIENT_FILE,
        call.line,
        `rpc argument ${call.unresolved} did not resolve to a same-file string const (the parser refuses to guess a wire name)`
      );
      continue;
    }
    if (daemonSet.has(call.name)) continue;
    const offence = `method "${call.name}" (the client can put it on the wire and the daemon registers no such name — a live call answers -32601)`;
    if (!strictKnown && KNOWN_UNREGISTERED_METHODS.has(call.name)) defer('W1', CLIENT_FILE, call.line, offence);
    else raise('W1', CLIENT_FILE, call.line, offence);
  }

  // W2: every harness stub is registered by the daemon too — a stub the daemon does not serve
  // is a screen measured against an RPC that no real daemon answers (#25's fiction).
  for (const entry of harness.names) {
    if (daemonSet.has(entry.name)) continue;
    const offence = `stub "${entry.name}" (the harness answers a name the daemon does not register)`;
    if (!strictKnown && KNOWN_UNREGISTERED_METHODS.has(entry.name)) defer('W2', HARNESS_FILE, entry.line, offence);
    else raise('W2', HARNESS_FILE, entry.line, offence);
  }

  // W3 and W5: every daemon method has a policy row and is declared `with_extensions`.
  for (const m of daemon.methods) {
    if (!policySet.has(m.name)) {
      raise('W3', DAEMON_FILE, m.line, `method "${m.name}" has no row in METHOD_POLICIES (it would be served unpoliced)`);
    }
    if (!m.withExtensions) {
      raise('W5', DAEMON_FILE, m.line, `method "${m.name}" is declared without with_extensions (its handler cannot reach authorize())`);
    }
  }

  // W4: every policy row names a method the daemon registers (the other half of set equality —
  // a stale row plus a missing row would otherwise cancel out in the count below).
  for (const row of policy.rows) {
    if (!daemonSet.has(row.name)) {
      raise('W4', POLICY_FILE, row.line, `policy row for "${row.name}" names no daemon method (the table and the registry drifted)`);
    }
  }

  // W6: two independent views of one set — a parser that silently misses a method fails here
  // even if the surviving rows happen to pair up.
  if (daemon.methods.length !== policy.rows.length) {
    raise(
      'W6',
      DAEMON_FILE,
      1,
      `the daemon view parsed ${daemon.methods.length} methods and the policy view parsed ${policy.rows.length} rows (two parsers must see one set)`
    );
  }

  // W7: each client call's params object supplies at least as many entries as the daemon method
  // has required (non-`Option`) bound arguments. Measured: one entry short is exactly the
  // `-32602 "missing field …"` the live daemon answered for `projects.create { name }`.
  for (const call of client) {
    const m = daemonSet.get(call.name);
    if (!m || call.paramSize === null) continue;
    const required = m.binds.filter((b) => !b.optional);
    if (call.paramSize >= required.length) continue;
    const entryWord = call.paramSize === 1 ? 'entry' : 'entries';
    const argWord = required.length === 1 ? 'argument' : 'arguments';
    const offence = `method "${call.name}" sends ${call.paramSize} param ${entryWord} but it requires ${required.length} bound ${argWord} {${required.map((b) => b.name).join(', ')}} — the live daemon answered -32602 "missing field" for exactly this shape`;
    if (!strictKnown && KNOWN_PARAM_DRIFT_METHODS.has(call.name)) defer('W7', CLIENT_FILE, call.line, offence);
    else raise('W7', CLIENT_FILE, call.line, offence);
  }

  // W8: param-NAME drift — the check W7 could not be. W7 counts entries, so `{ id }` against an
  // argument bound as `run_id` read as "1 sent, 1 required" and stayed silent while the live daemon
  // answered -32602 "missing field `run_id`". Here every key of a resolvable params object is
  // matched against the daemon method's bound argument names, accepting exactly the spellings the
  // generated decoder accepts (the argument's own snake_case name, its lowerCamelCase alias, and the
  // shorthand `{ run_id }` / `{ runId }` form, whose key token is that same name). A params argument
  // this parser cannot resolve to an object literal is REPORTED, not skipped — the same refusal to
  // guess that makes an unresolvable method name a W1 finding. Nothing is deferrable: W8 has no
  // known-drift set, because a key no argument binds is a name both sides can be fixed on.
  for (const call of client) {
    if (call.unresolved !== null) continue; // W1 already refuses this call site
    const m = daemonSet.get(call.name);
    if (!m) continue; // W1 fires on the name; matching keys to a method that is not there is noise
    if (call.paramKind === 'unresolved' || call.paramKind === 'positional') {
      const positionalNote =
        call.paramKind === 'positional'
          ? ' — legal on the wire (the measured daemon answers a positional array by matching arguments to positions, not to names), so this is a not-name-checkable notice and not a claim the call fails'
          : '';
      raise(
        'W8',
        CLIENT_FILE,
        call.line,
        `method "${call.name}" sends params as ${call.paramNote}, so its param NAMES cannot be checked against the daemon's bound arguments here and the parser refuses to guess them${positionalNote}`
      );
      continue;
    }
    if (call.paramKind !== 'object') continue;
    const required = m.binds.filter((b) => !b.optional);
    for (const key of call.paramKeys) {
      // The shorthand `{ run_id }` and the quoted `{ "run_id": … }` forms arrive here as the same
      // key token; only the name is compared, never the value.
      const matched = m.binds.find((b) => key.name === b.name || key.name === camelAlias(b.name));
      if (matched) continue;
      // The argument the daemon would name in its -32602 — deduced from the keys the call DOES send,
      // never guessed at from what the key looks like.
      const missing = required.filter(
        (b) => !call.paramKeys.some((k) => k.name === b.name || k.name === camelAlias(b.name))
      );
      const outcome =
        missing.length === 0
          ? 'serde ignores a key no argument binds, so the call succeeds with this value silently dropped'
          : `the live daemon skips it and answers -32602 "missing field ${missing
              .map((b) => `'${b.name}'`)
              .join(', ')}"`;
      raise(
        'W8',
        CLIENT_FILE,
        lineOf(clientText, key.index),
        `method "${call.name}" sends param key "${key.name}", which is no accepted spelling of any bound argument of the daemon method (it binds {${m.binds.map((b) => b.name).join(', ')}} — accepted: ${
          m.binds.map((b) => `${b.name} / ${camelAlias(b.name)}`).join(', ') || 'no arguments, so no keys at all'
        }); ${outcome}`
      );
    }
    // What this loop deliberately does NOT re-check is an argument no key supplies while every key
    // matches: that is W7's count for the honest shapes, and the only way to hide it behind a passing
    // count is a duplicate key in one object literal (`{ a, a }` against `{a, b}`), which TypeScript
    // rejects as an error long before it is a wire fact.
  }

  violations.sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file) || a.line - b.line);
  knowns.sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file) || a.line - b.line);
  return { violations, knowns };
}

// ----------------------------------------------------------------------------------------- self-test

function writeTree(base, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(base, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

// A tree whose four sources agree. It exercises every parse mode in one clean sweep: two
// single-line attributes, one multi-line attribute (the mode a naive line regex drops), a name
// reached through a same-file const, an `rpc<T>` generic call, a double-quoted `rpc("a.b")` literal,
// a double-quoted generic call whose params keys are quoted (the modes a `'…'`-only parser drops),
// a call that omits an `Option` argument, params keys in all three spellings W8 accepts (the Rust
// argument's own snake_case name, its lowerCamelCase alias — clean by the #40 retraction, and the
// shorthand `{ runId }` form), and the real names `gates.approve` and `projects.create` (so the known
// sets and the strict enforcement are both exercised against names the shipped lists actually carry).
function cleanFixture() {
  return {
    [DAEMON_FILE]: [
      'pub struct DaemonState;',
      'pub trait WarshaApi {',
      '    #[method(name = "alpha.read", with_extensions)]',
      '    async fn read(&self) -> RpcResult<String>;',
      '',
      '    #[method(name = "alpha.write", with_extensions)]',
      '    async fn write(&self, input: String) -> RpcResult<String>;',
      '',
      '    #[method(name = "gates.approve", with_extensions)]',
      '    async fn approve_gate(',
      '        &self,',
      '        run_id: String,',
      '        stage: String,',
      '        device_id: Option<String>,',
      '    ) -> RpcResult<String>;',
      '',
      '    #[method(',
      '        name = "gates.list",',
      '        with_extensions',
      '    )]',
      '    async fn list_gates(&self, run_id: String, device_id: Option<String>) -> RpcResult<String>;',
      '',
      '    #[method(name = "projects.create", with_extensions)]',
      '    async fn create_project(&self, name: String, description: String, language: String) -> RpcResult<String>;',
      '}',
      '',
    ].join('\n'),
    [POLICY_FILE]: [
      'pub const METHOD_POLICIES: &[MethodPolicy] = &[',
      '    M {',
      '        method: "alpha.read",',
      '        policy: Session,',
      '        tier: Standard,',
      '    },',
      '    M {',
      '        method: "alpha.write",',
      '        policy: Session,',
      '        tier: Standard,',
      '    },',
      '    M {',
      '        method: "gates.approve",',
      '        policy: Session,',
      '        tier: Auth,',
      '    },',
      '    M {',
      '        method: "gates.list",',
      '        policy: Session,',
      '        tier: Standard,',
      '    },',
      '    M {',
      '        method: "projects.create",',
      '        policy: Owner,',
      '        tier: Standard,',
      '    },',
      '];',
      '',
    ].join('\n'),
    [CLIENT_FILE]: [
      "const GATES_LIST_METHOD = 'gates.list';",
      'class Client {',
      '  private async rpc<T>(method: string, params?: unknown): Promise<T> {',
      '    return undefined as T;',
      '  }',
      "  read() { return this.rpc('alpha.read'); }",
      // The quote-style guard in the OTHER direction: these two calls are legal and fully specified,
      // so they must keep the fixture clean. `readDq` is the `rpc<T>("a.b")` spelling; `writeDq`
      // spells its params key in quotes, which the object scanner used to skip without counting — a
      // parser that reads `{ "input": input }` as zero entries fails working code (W7: `alpha.write`
      // requires one bound argument). If either spelling regresses, this fixture goes red here.
      '  readDq() { return this.rpc<string>("alpha.read"); }',
      '  writeDq(input: string) { return this.rpc(\'alpha.write\', { "input": input }); }',
      "  write(input: string) { return this.rpc<string>('alpha.write', { input }); }",
      '  approveCamel(runId: string) {',
      '    // The retraction guard, in the one shape the retraction actually covers: every key here is',
      '    // the lowerCamelCase ALIAS of a real bound argument (`run_id` → `runId`, `device_id` →',
      "    // `deviceId`) — what the generated decoder's `#[serde(alias = …)]` accepts, and what the",
      '    // live daemon measured as accepted — in the shorthand spelling too, which is W8',
      '    // third accepted form. It must keep the clean fixture clean. The guard used to send',
      '    // `{ inputValue }` where the argument is `input`: that is a RENAME, not a casing variant,',
      '    // and a live daemon answers -32602 "missing field \'input\'" for it, so W8 firing there was',
      '    // the parser being right and the fixture being wrong.',
      "    return this.rpc<unknown>('gates.approve', { runId, stage: 'gate_a', deviceId: null });",
      '  }',
      '  approve(runId: string) {',
      "    return this.rpc<unknown>('gates.approve', { run_id: runId, stage: 'gate_a', device_id: null });",
      '  }',
      '  queue(runId: string) {',
      "    return this.rpc<unknown[]>(GATES_LIST_METHOD, { runId });",
      '  }',
      '  create(name: string, description: string, language: string) {',
      "    return this.rpc('projects.create', { name, description, language });",
      '  }',
      '}',
      '',
    ].join('\n'),
    [HARNESS_FILE]: [
      'export const RPC_METHODS = [',
      "  'alpha.read',",
      "  'alpha.write',",
      "  'gates.approve',",
      "  'gates.list',",
      "  'projects.create',",
      '] as const;',
      '',
    ].join('\n'),
  };
}

// One surgical mutation per check, each asserted to fire, plus two mutants for the drift shapes the
// known sets used to defer: with the flip on and the sets empty they must fire in the shipped mode
// as well, and nothing may be deferred (that is the guard against the whitelist coming back). Then
// the quote-style mutants: one per spelling a wire name can arrive in (`"a.b"`, `rpc<T>("a.b")`, a
// `"a.b"` const, a `"a.b"` harness stub, a nested-angle generic, quoted params keys), each planted so
// that a parser narrowing back to `'…'`-only stops firing it — the formatter's quote preference is
// not a safety property, and a name the parser cannot see is a name the gate cannot check.
const MUTATIONS = [
  {
    name: 'const-indirect-ghost',
    ids: ['W1'],
    expect: /method "alpha.ghost"/,
    mutate: (f) => {
      f[CLIENT_FILE] = `const ALPHA_GHOST_METHOD = 'alpha.ghost';\n${f[CLIENT_FILE]}`;
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        "  ghost() { return this.rpc(ALPHA_GHOST_METHOD, { run_id: 'x' }); }\n  read() {"
      );
    },
  },
  {
    name: 'generic-ghost',
    ids: ['W1'],
    expect: /method "alpha.nosuch"/,
    mutate: (f) => {
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        "  ghost2() { return this.rpc<RoleRouting[]>('alpha.nosuch'); }\n  read() {"
      );
    },
  },
  {
    name: 'harness-stub',
    ids: ['W2'],
    expect: /stub "alpha.stubble"/,
    mutate: (f) => {
      f[HARNESS_FILE] = f[HARNESS_FILE].replace("  'alpha.read',", "  'alpha.read',\n  'alpha.stubble',");
    },
  },
  {
    name: 'missing-policy-row',
    ids: ['W3'],
    expect: /method "alpha.write" has no row in METHOD_POLICIES/,
    mutate: (f) => {
      f[POLICY_FILE] = f[POLICY_FILE].replace(
        '    M {\n        method: "alpha.write",\n        policy: Session,\n        tier: Standard,\n    },\n',
        ''
      );
    },
  },
  {
    name: 'stale-policy-row',
    ids: ['W4', 'W6'],
    expect: {
      W4: /policy row for "alpha.nosuchmethod"/,
      W6: /the daemon view parsed 5 methods and the policy view parsed 6 rows/,
    },
    mutate: (f) => {
      f[POLICY_FILE] = f[POLICY_FILE].replace(
        '];',
        '    M {\n        method: "alpha.nosuchmethod",\n        policy: Session,\n        tier: Standard,\n    },\n];'
      );
    },
  },
  {
    name: 'no-with-extensions',
    ids: ['W5'],
    expect: /method "alpha.read" is declared without with_extensions/,
    mutate: (f) => {
      f[DAEMON_FILE] = f[DAEMON_FILE].replace(
        '#[method(name = "alpha.read", with_extensions)]',
        '#[method(name = "alpha.read")]'
      );
    },
  },
  {
    name: 'trait-region-moved',
    ids: ['W6'],
    expect: /`pub trait WarshaApi` declaration was not found/,
    mutate: (f) => {
      f[DAEMON_FILE] = f[DAEMON_FILE].replace('pub trait WarshaApi {', 'pub trait WarshaApiMoved {');
    },
  },
  {
    name: 'camel-key-not-an-offence',
    ids: ['W1'],
    expect: /method "alpha.nosuch"/,
    mutate: (f) => {
      // Prove the retraction survives a parser edit: turning the legal camelCase-alias call into a
      // call at an unregistered name must fire W1 on the NAME while a pure key-casing change (the
      // clean fixture's `approveCamel`, and the `aliased-casing-is-not-an-offence` mutant) fires
      // nothing. This mutant adds a camelCase-key call to a name the daemon does not serve — the
      // offence text must quote the resolved name, never the key.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        "  camelGhost(v: string) { return this.rpc<string>('alpha.nosuch', { projectId: v }); }\n  read() {"
      );
    },
  },
  {
    name: 'omitted-required-params',
    ids: ['W7'],
    expect: /method "alpha.write" sends 0 param entries but it requires 1 bound argument \{input\}/,
    mutate: (f) => {
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        "this.rpc<string>('alpha.write', { input })",
        "this.rpc<string>('alpha.write')"
      );
    },
  },
  {
    name: 'one-short-required-field',
    ids: ['W7'],
    expect: /method "gates.approve" sends 1 param entry but it requires 2 bound arguments \{run_id, stage\}/,
    mutate: (f) => {
      // A name outside the known sets must fire in the SHIPPED mode: the client lane has no
      // excuse for a params object one entry short of the daemon's required arguments.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        "{ run_id: runId, stage: 'gate_a', device_id: null }",
        '{ runId }'
      );
    },
  },
  {
    name: 'required-field-drift-enforced-in-both-modes',
    ids: ['W7'],
    enforcedInBothModes: true,
    expect: /method "projects.create" sends 1 param entry but it requires 3 bound arguments/,
    mutate: (f) => {
      // Exactly the live-measured client shape — `{ name }` against three required arguments.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        "return this.rpc('projects.create', { name, description, language });",
        "return this.rpc('projects.create', { name });"
      );
    },
  },
  {
    name: 'unregistered-name-enforced-in-both-modes',
    ids: ['W1'],
    enforcedInBothModes: true,
    expect: /method "projects.delete"/,
    mutate: (f) => {
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        "  del(id: string) { return this.rpc('projects.delete', { id }); }\n  read() {"
      );
    },
  },
  {
    name: 'dq-literal-ghost',
    ids: ['W1'],
    expect: /method "alpha.dqghost"/,
    mutate: (f) => {
      // The quote-style blind spot this file's parser used to have: `callRe`'s literal branch
      // matched `'…'` only, so THIS call — a name no daemon serves, on the wire verbatim — left the
      // whole tree reporting `0 violations, exit 0`. Measured on a copied tree before the widening;
      // the same name in single quotes fired. If the literal branch narrows back to `'…'`, this
      // mutant stops firing and the self-test fails.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        '  dqGhost() { return this.rpc("alpha.dqghost"); }\n  read() {'
      );
    },
  },
  {
    name: 'dq-generic-ghost',
    ids: ['W1'],
    expect: /method "alpha.dqgeneric"/,
    mutate: (f) => {
      // The other half of the widening: `rpc<T>("a.b")` — generic AND double-quoted. Proves the
      // generic branch and the literal branch widen together, not one at a time.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        '  dqGhost2() { return this.rpc<RoleRouting[]>("alpha.dqgeneric"); }\n  read() {'
      );
    },
  },
  {
    name: 'dq-const-indirect-ghost',
    ids: ['W1'],
    expect: /method "alpha.dqconst"/,
    mutate: (f) => {
      // The const table read `const NAME = 'a.b';` only, so a double-quoted const left the call
      // UNRESOLVED and W1 quoted the identifier with "did not resolve to a same-file string const"
      // instead of the wire name. Loud, but the wrong claim; this mutant asserts the resolved NAME
      // is what fires.
      f[CLIENT_FILE] = `const ALPHA_DQ_METHOD = "alpha.dqconst";\n${f[CLIENT_FILE]}`;
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        "  dqGhost3() { return this.rpc(ALPHA_DQ_METHOD, { run_id: 'x' }); }\n  read() {"
      );
    },
  },
  {
    name: 'dq-harness-stub',
    ids: ['W2'],
    expect: /stub "alpha.dqstubble"/,
    mutate: (f) => {
      // Same class, other file: the stub table's entry regex matched `'…'` only, and the harness
      // view has no W6 count cross-check behind it, so a double-quoted table parsed as zero names
      // and W2 went vacuously clean.
      f[HARNESS_FILE] = f[HARNESS_FILE].replace('] as const;', '"alpha.dqstubble",\n] as const;');
    },
  },
  {
    name: 'nested-generic-ghost',
    ids: ['W1'],
    expect: /method "alpha.nestedghost"/,
    mutate: (f) => {
      // `<[^>]*>` ended the generic at the FIRST `>`, so `rpc<Record<string, string>>('a.b')`
      // matched nothing at all — not the name, not the const, nothing — and the call site simply
      // did not exist. The widened branch balances one nested `<…>`.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        "  dqGhost4() { return this.rpc<Record<string, string>>('alpha.nestedghost'); }\n  read() {"
      );
    },
  },
  {
    name: 'quoted-params-key-still-counts',
    ids: ['W7'],
    expect: /method "projects.create" sends 2 param entries but it requires 3 bound arguments/,
    mutate: (f) => {
      // The params-key half of the same assumption, isolated by keeping the METHOD name in the
      // spelling the old parser could already see: the object scanner skipped a quoted key without
      // recording it, so `{ "name": …, "description": … }` counted as ZERO entries and W7 failed
      // code that sends what the daemon requires. Quoted keys must count, so the honest count here
      // is 2 — genuinely one short of three — not 0 and not a clean pass.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        "return this.rpc('projects.create', { name, description, language });",
        'return this.rpc(\'projects.create\', { "name": name, "description": description });'
      );
    },
  },
  {
    name: 'renamed-param-key',
    ids: ['W8'],
    expect: /method "alpha.write" sends param key "inputValue"/,
    mutate: (f) => {
      // THE blind spot that let two broken calls ship and only a hand-run daemon caught them:
      // `alpha.write` binds `input`, this call sends exactly one entry, so W7 counts 1 against 1
      // required and stays silent — while the generated decoder renames the field to `input` with
      // aliases `input` and `input` (the argument is one word, so snake and camel coincide), meaning
      // `inputValue` binds nothing and the live answer is -32602 "missing field 'input'". Only a
      // NAME comparison sees it; if W8 is ever narrowed back to a count, this mutant stops firing.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        "  renamed(input: string) { return this.rpc<string>('alpha.write', { inputValue: input }); }\n  read() {"
      );
    },
  },
  {
    name: 'aliased-casing-is-not-an-offence',
    ids: ['W8'],
    clean: true,
    mutate: (f) => {
      // The mutant in the other direction, and the one that decides whether W8 is mergeable: every
      // key here is the lowerCamelCase ALIAS of a real bound argument (`run_id` → `runId`,
      // `device_id` → `deviceId`) in the shorthand spelling too, which is what the macro's
      // `#[serde(alias = …)]` line accepts and what the live daemon measured as accepted. A W8 that
      // fired on casing would fail working code and undo the #40 retraction, so this mutation must
      // leave the tree at ZERO violations and zero deferred items in both modes.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        "{ run_id: runId, stage: 'gate_a', device_id: null }",
        "{ runId, stage: 'gate_a', deviceId: null }"
      );
    },
  },
  {
    name: 'params-from-a-variable',
    ids: ['W8'],
    expect: /method "gates.approve" sends params as the value of `payload`/,
    mutate: (f) => {
      // Refusing to guess, the way W1 already refuses an unresolvable name: a params object built
      // elsewhere is a call site whose keys this parser cannot see, so it must be REPORTED. The
      // alternative — treating it as "no keys to check" — is the silent pass that let the renames
      // through. `paramSize` goes null here too, so W7 must not read a variable as an empty object.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        '  read() {',
        "  indirect(payload: unknown) { return this.rpc<unknown>('gates.approve', payload); }\n  read() {"
      );
    },
  },
  {
    name: 'params-with-a-spread',
    ids: ['W8'],
    expect: /sends params as an object literal carrying a spread/,
    mutate: (f) => {
      // `{ ...base, run_id }` sends more names than the parser can enumerate; W8 reports the call
      // site instead of certifying the two keys it happens to see.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        "{ run_id: runId, stage: 'gate_a', device_id: null }",
        '{ ...base, run_id: runId }'
      );
    },
  },
  {
    name: 'params-with-a-computed-key',
    ids: ['W8'],
    expect: /sends params as an object literal carrying a computed key/,
    mutate: (f) => {
      // `{ [key]: runId }` — the name is a template or a variable at runtime. Same discipline: a key
      // the parser cannot read is a finding, not a pass.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        "{ run_id: runId, stage: 'gate_a', device_id: null }",
        "{ [key]: runId, stage: 'gate_a' }"
      );
    },
  },
  {
    name: 'positional-array-params',
    ids: ['W8'],
    expect: /method "gates.approve" sends params as a positional array[\s\S]*legal on the wire/,
    mutate: (f) => {
      // A positional array IS legal — the measured daemon answers it — but its values bind arguments
      // by POSITION, so there is no name here to check and none is invented. Reporting it is what
      // "do not silently treat it as passing" means: the offence text says the call is not
      // name-checkable rather than accusing it of casing drift.
      f[CLIENT_FILE] = f[CLIENT_FILE].replace(
        "{ run_id: runId, stage: 'gate_a', device_id: null }",
        "[runId, 'gate_a', null]"
      );
    },
  },
];

function selfTest() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'warsha-wire-selftest-'));
  const names = Object.fromEntries(CHECK_IDS);
  let failed = false;
  try {
    // Parser-mode proofs, read straight off the clean fixture (the checks below would also
    // catch a miss — but a check that passes only because a name pair coincidentally matches
    // is not proof the parse mode itself works).
    const daemon = parseDaemon(cleanFixture()[DAEMON_FILE]);
    const namesParsed = new Set(daemon.methods.map((m) => m.name));
    if (namesParsed.has('gates.list') && daemon.methods.length === 5) {
      console.log('self-test parser multi-line-#[method]: detected gates.list (5/5 methods parsed)');
    } else {
      failed = true;
      console.log(`self-test parser multi-line-#[method]: FAILED — parsed [${[...namesParsed].join(', ')}]`);
    }
    const listBinds = daemon.methods.find((m) => m.name === 'gates.list')?.binds ?? [];
    if (
      listBinds.length === 2 &&
      listBinds[0].name === 'run_id' &&
      !listBinds[0].optional &&
      listBinds[1].name === 'device_id' &&
      listBinds[1].optional
    ) {
      console.log('self-test parser bound-args: detected run_id (required) + device_id (Option)');
    } else {
      failed = true;
      console.log(`self-test parser bound-args: FAILED — ${JSON.stringify(listBinds)}`);
    }
    const clientCalls = parseClient(cleanFixture()[CLIENT_FILE]);
    const viaConst = clientCalls.find((k) => k.name === 'gates.list');
    const viaGeneric = clientCalls.find((k) => k.name === 'alpha.write' && k.paramSize === 1);
    if (viaConst && viaGeneric) {
      console.log('self-test parser const-indirect + rpc<T>: detected gates.list and alpha.write');
    } else {
      failed = true;
      console.log(
        `self-test parser const-indirect + rpc<T>: FAILED — calls ${JSON.stringify(clientCalls.map((k) => [k.name, k.paramSize]))}`
      );
    }

    // The quote-style parse modes, read off a snippet that plants one call per spelling. Every line
    // of it was mis-read by the pre-widening parser — a wire name it never saw at all, or a params
    // object it counted wrong — so this proves the PARSE (name resolved and params counted), not just
    // that some pair coincidentally matches: the double-quoted literal, the double-quoted generic,
    // the backtick literal, a name through a double-quoted const, a generic nesting one angle pair,
    // and quoted params keys that must count as entries — the last planted on a single-quoted name,
    // so it isolates the key count from the quote widening and can fail on its own.
    const quoteModes = parseClient(
      [
        'const DQ_METHOD = "alpha.dqconst";',
        'class Q {',
        '  private async rpc<T>(method: string, params?: unknown): Promise<T> {',
        '    return undefined as T;',
        '  }',
        '  a() { return this.rpc("alpha.dqliteral", { run_id: "x" }); }',
        '  b() { return this.rpc<RoleRouting[]>("alpha.dqgeneric"); }',
        '  c() { return this.rpc(`alpha.template`); }',
        '  d() { return this.rpc(DQ_METHOD, { "run_id": "x", input: 1 }); }',
        '  e() { return this.rpc<Record<string, string>>("alpha.nested", { x: 1 }); }',
        '  f() { return this.rpc(\'alpha.sqquotedkey\', { "run_id": "x" }); }',
        '}',
        '',
      ].join('\n')
    );
    const quoteModeExpected = [
      ['alpha.dqliteral', 1],
      ['alpha.dqgeneric', 0],
      ['alpha.template', 0],
      ['alpha.dqconst', 2],
      ['alpha.nested', 1],
      ['alpha.sqquotedkey', 1],
    ];
    const quoteModeMisses = quoteModeExpected.filter(
      ([name, size]) =>
        !quoteModes.some((k) => k.name === name && k.paramSize === size && k.unresolved === null)
    );
    if (quoteModeMisses.length === 0) {
      console.log(
        'self-test parser quote-styles: dq-literal + dq-generic + template + dq-const + nested-angle parsed, quoted params keys counted'
      );
    } else {
      failed = true;
      console.log(
        `self-test parser quote-styles: FAILED — missed ${JSON.stringify(quoteModeMisses)} of calls ${JSON.stringify(
          quoteModes.map((k) => [k.name, k.paramSize, k.unresolved])
        )}`
      );
    }
    // The param-NAME parse modes W8 stands on, read off one snippet per shape. The four shapes whose
    // keys ARE knowable (the Rust name, its camelCase alias, the shorthand property, the quoted key)
    // must come back as exactly those key tokens, and the four whose keys are NOT (a spread, a
    // computed key, a positional array, a variable) must come back kind-tagged and with no key list —
    // a parser that quietly returned `[]` for a spread would let W8 report a call it never read.
    const nameModes = parseClient(
      [
        'class N {',
        '  private async rpc<T>(method: string, params?: unknown): Promise<T> {',
        '    return undefined as T;',
        '  }',
        "  a() { return this.rpc('alpha.snake', { run_id: 'x' }); }",
        "  b() { return this.rpc('alpha.camel', { runId: 'x' }); }",
        "  c() { return this.rpc('alpha.shorthand', { run_id, stage }); }",
        '  d() { return this.rpc(\'alpha.quoted\', { "run_id": x, device_id: y }); }',
        '  e() { return this.rpc(\'alpha.spread\', { ...base, run_id: x }); }',
        '  f() { return this.rpc(\'alpha.computed\', { [k]: v }); }',
        '  g() { return this.rpc(\'alpha.array\', [runId]); }',
        '  h() { return this.rpc(\'alpha.variable\', payload); }',
        '}',
        '',
      ].join('\n')
    );
    const nameModeExpected = [
      ['alpha.snake', 'object', 'run_id'],
      ['alpha.camel', 'object', 'runId'],
      ['alpha.shorthand', 'object', 'run_id,stage'],
      ['alpha.quoted', 'object', 'run_id,device_id'],
      ['alpha.spread', 'unresolved', ''],
      ['alpha.computed', 'unresolved', ''],
      ['alpha.array', 'positional', ''],
      ['alpha.variable', 'unresolved', ''],
    ];
    const nameModeMisses = nameModeExpected.filter(
      ([name, kind, keyList]) =>
        !nameModes.some(
          (k) =>
            k.name === name &&
            k.paramKind === kind &&
            (k.paramKeys ?? []).map((entry) => entry.name).join(',') === keyList
        )
    );
    if (nameModeMisses.length === 0) {
      console.log(
        'self-test parser param-names: snake + alias + shorthand + quoted keys read; spread + computed + positional + variable reported, not guessed'
      );
    } else {
      failed = true;
      console.log(
        `self-test parser param-names: FAILED — missed ${JSON.stringify(nameModeMisses)} of calls ${JSON.stringify(
          nameModes.map((k) => [k.name, k.paramKind, k.paramKeys.map((entry) => entry.name), k.paramSize])
        )}`
      );
    }
    const harnessModes = parseHarness(
      [
        'export const RPC_METHODS = [',
        "  'alpha.sq',",
        '  "alpha.dq",',
        '  `alpha.tpl`,',
        '] as const;',
        '',
      ].join('\n')
    );
    if (harnessModes.found && harnessModes.names.map((n) => n.name).join(',') === 'alpha.sq,alpha.dq,alpha.tpl') {
      console.log('self-test parser harness-stub-quotes: detected the sq, dq and template-literal entries');
    } else {
      failed = true;
      console.log(`self-test parser harness-stub-quotes: FAILED — ${JSON.stringify(harnessModes)}`);
    }

    for (const mutant of MUTATIONS) {
      const dir = path.join(base, `mutant-${mutant.name}`);
      const files = cleanFixture();
      mutant.mutate(files);
      writeTree(dir, files);

      const found = run(dir);
      const strictFound = run(dir, { requireNoKnownDrift: true });
      // A `clean: true` mutant asserts the OPPOSITE of the rest of the table: this mutation is legal
      // on the wire, so a check that fires on it is a false positive and the whole run fails. It is
      // how "an aliased casing must NOT fire" is proved — the shipped tree would otherwise only be
      // proving the happy path of its own fixture.
      if (mutant.clean) {
        const firedAnyway = [...found.violations, ...strictFound.violations, ...found.knowns];
        if (firedAnyway.length === 0) {
          console.log(`self-test ${mutant.ids.join('+')} ${names[mutant.ids[0]]}/${mutant.name}: accepted (legal spelling, 0 violations)`);
        } else {
          failed = true;
          console.log(
            `self-test ${mutant.ids.join('+')} ${mutant.name}: FAILED — a legal shape was reported: ${firedAnyway
              .map((v) => `${v.id}: ${v.offence}`)
              .join(' | ')}`
          );
        }
        continue;
      }
      // `enforcedInBothModes` mutants must fire in the shipped mode AND under the strict flip,
      // with nothing deferred; every other mutant fires in the shipped mode.
      const source = mutant.enforcedInBothModes ? strictFound.violations : found.violations;
      const fired = mutant.ids.every((id) => {
        const re = mutant.expect instanceof RegExp ? mutant.expect : mutant.expect[id];
        return re && source.some((v) => v.id === id && re.test(v.offence));
      });
      const enforcedAsExpected = mutant.enforcedInBothModes
        ? found.violations.length > 0 &&
          strictFound.violations.length > 0 &&
          found.knowns.length === 0
        : true;
      if (fired && enforcedAsExpected) {
        console.log(`self-test ${mutant.ids.join('+')} ${names[mutant.ids[0]]}/${mutant.name}: detected`);
      } else {
        failed = true;
        console.log(
          `self-test ${mutant.ids.join('+')} ${mutant.name}: FAILED — expected ${mutant.ids.join('+')}${
            mutant.enforcedInBothModes ? ' enforced in both modes with nothing deferred' : ''
          }, violations [${source.map((v) => v.id).join(', ') || 'nothing'}], shipped-mode violations ${found.violations.length}, deferred ${found.knowns.length}`
        );
      }
    }

    // Message format: every line must be `<ID>: <file>:<line> <offence>` with a relative path.
    const dir = path.join(base, 'format');
    writeTree(dir, MUTATIONS.reduce((files, m) => ((m.mutate(files), files)), cleanFixture()));
    for (const v of run(dir, { requireNoKnownDrift: true }).violations) {
      const rendered = `${v.id}: ${v.file}:${v.line} ${v.offence}`;
      if (!/^W[1-8]: [^:\n]+:\d+ \S/.test(rendered) || path.isAbsolute(v.file)) {
        failed = true;
        console.log(`self-test message format: FAILED — ${rendered}`);
      }
    }

    // The clean fixture reports clean — in the shipped mode and in the strict mode the flip
    // turns on — and it reports nothing even as known items, so the retraction guard (the
    // `approveCamel` call whose keys are the camelCase ALIASES of real arguments) is proven inert in
    // both modes, and the same guard as a mutation is the `aliased-casing-is-not-an-offence` mutant.
    const cleanDir = path.join(base, 'clean');
    writeTree(cleanDir, cleanFixture());
    for (const [mode, opts] of [
      ['shipped', {}],
      ['strict', { requireNoKnownDrift: true }],
    ]) {
      const { violations, knowns } = run(cleanDir, opts);
      if (violations.length === 0 && knowns.length === 0) {
        console.log(`self-test clean fixture (${mode}): 0 violations`);
      } else {
        failed = true;
        for (const v of violations) {
          console.log(`self-test clean fixture (${mode}): FAILED — false positive ${v.id}: ${v.file}:${v.line} ${v.offence}`);
        }
        for (const k of knowns) {
          console.log(`self-test clean fixture (${mode}): FAILED — unexpected deferred item ${k.id}: ${k.offence}`);
        }
      }
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  if (failed) {
    console.log('wire self-test: FAILED');
    return 1;
  }
  console.log(`wire self-test: ${CHECK_IDS.length} checks fire, clean fixture is clean in both modes`);
  return 0;
}

// --------------------------------------------------------------------------------------------- main

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  const reportKnown = argv.includes('--report-only-known');

  const rootFlag = argv.indexOf('--root');
  const root =
    rootFlag >= 0 && argv[rootFlag + 1]
      ? path.resolve(argv[rootFlag + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const { violations, knowns } = run(root);
  for (const v of violations) {
    process.stdout.write(`${v.id}: ${v.file}:${v.line} ${v.offence}\n`);
  }
  if (reportKnown) {
    for (const k of knowns) {
      process.stdout.write(
        `${k.id}: ${k.file}:${k.line} ${k.offence} (known #25/#40 drift — DECISIONS.md 2026-11-03)\n`
      );
    }
  }
  if (violations.length > 0) {
    process.stdout.write(`wire: ${CHECK_IDS.length} checks, ${violations.length} violation(s)\n`);
    return 1;
  }
  process.stdout.write(`wire: ${CHECK_IDS.length} checks, 0 violations\n`);
  if (reportKnown && knowns.length > 0) {
    process.stdout.write(
      `wire: ${knowns.length} known drift item(s) listed above; flip REQUIRE_NO_KNOWN_DRIFT when the client lane lands\n`
    );
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
