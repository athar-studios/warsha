# R2 EXT intake — external facts re-verification (read-only web research)

Retrieved: 2026-11-09. Scope: web research only — no repository/code edits, no commits, no model-API or
registry API calls (all registry facts read from published docs/schema, not live endpoints).
Purpose: get ahead of PROGRAM_PLAN.md §1/§3, which requires re-verifying two unstable external facts at
R2 intake. **Re-confirm every line below at R2 intake** — both surfaces are moving.

Governing plan: `bridge-io/policy/2026-11-09-completion-program/PROGRAM_PLAN.md` §1 (WebMCP status note;
scout audit row), §2.7 (WebMCP), §4 X5/X9, §7 (spec-churn risk).

---

## FACT 1 — WebMCP (packet X9: Warsha's own UI, off by default)

### 1.1 Status and current entry point

- Experimental **W3C Web Machine Learning Community Group Draft Community Group Report**. The rendered
  draft self-dates **9 November 2026** at retrieval. Spec: https://webmachinelearning.github.io/webmcp
  · source repo: https://github.com/webmachinelearning/webmcp
- **Current entry point in the draft = `document.modelContext`** (not `navigator.modelContext`). The IDL
  attaches it to `Document`:
  ```webidl
  partial interface Document {
    [SecureContext, SameObject] readonly attribute ModelContext modelContext;
  };
  ```
  Source: https://github.com/webmachinelearning/webmcp/blob/main/index.bs (line ~710) and the rendered
  spec https://webmachinelearning.github.io/webmcp.
- The README states this explicitly: *"WebMCP introduces an imperative API on the web platform under
  `document.modelContext`"* and *"WebMCP is currently focused on the imperative
  `document.modelContext.registerTool()` API … which is what the specification defines."*
  Source: https://github.com/webmachinelearning/webmcp/blob/main/README.md
- The current spec source contains **no `navigator.modelContext`** (the only `Navigator` reference is the
  unrelated `NavigatorLanguage/language`). Confirmed by reading `index.bs`.

### 1.2 Entry-point churn — draft vs shipping builds (this is the instability the plan flags)

| Surface | Entry point | Evidence |
|---|---|---|
| Current draft + spec source + README (Nov 2026) | `document.modelContext` | https://webmachinelearning.github.io/webmcp · https://github.com/webmachinelearning/webmcp/blob/main/README.md |
| Early Chrome preview (Chrome 146 Canary, launched 2026-02-10) and third-party docs through ~Mar 2026 | `navigator.modelContext` (with `provideContext`/`clearContext` on a `navigator.modelContextTesting` interface) | Technical notes https://w3c-cg.github.io/aikr/webMCP/webmcp-technical-notes.html · cheat sheet (2026-03-09) https://www.webfuse.com/webmcp-cheat-sheet |
| Meta Ray-Ban Display (current implementation-status) | `document.modelContext.registerTool()`, off by default | https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md |
| **Chrome 149 origin trial (live now) — which object it attaches to** | **UNVERIFIED** from primary Chrome sources | Chrome's docs page carries **no JavaScript code example** (fetched twice); it does not state `navigator` vs `document`. https://developer.chrome.com/docs/ai/webmcp |

**Conclusion:** the draft has moved to `document.modelContext`; early preview builds used
`navigator.modelContext`. Whether the current Chrome 149 origin-trial build has caught up to
`document.modelContext` could not be confirmed from Chrome's own docs. **Feature-detect both** exactly as
the plan says (`document.modelContext ?? navigator.modelContext`). This matches PROGRAM_PLAN §1.

### 1.3 `registerTool(...)` — exact descriptor shape (authoritative IDL from spec source)

Method on the `ModelContext` interface:
```webidl
[Exposed=Window, SecureContext]
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject, optional ModelContextExecuteToolOptions options = {});
  attribute EventHandler ontoolchange;
  attribute EventHandler ontoolactivated;
  attribute EventHandler ontoolcancel;
};
```

Tool descriptor dictionary:
```webidl
dictionary ModelContextTool {
  required DOMString name;
  USVString title;                 // optional display label (USVString for native UIs)
  required DOMString description;
  object inputSchema;              // JSON Schema object
  object outputSchema;             // optional JSON Schema object
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;     // optional
};

dictionary ToolAnnotations {
  boolean readOnlyHint = false;
  boolean untrustedContentHint = false;
  // (further hint members exist; only these two confirmed verbatim)
};

callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);

dictionary ModelContextRegisterToolOptions {
  sequence<USVString> exposedTo;   // origins this tool is exposed to (cross-origin iframe control)
  AbortSignal signal;              // unregisters the tool when aborted
};
```
Source (verbatim): https://github.com/webmachinelearning/webmcp/blob/main/index.bs (lines ~727–737,
~1227–1250, ~1332–1344).

Descriptor fields, plain terms: **`name`** (required, unique id), **`title`** (optional display label),
**`description`** (required, natural-language), **`inputSchema`** (JSON Schema object), **`outputSchema`**
(optional), **`execute`** (the handler/callback), **`annotations`** (optional hints incl. `readOnlyHint`,
`untrustedContentHint`).

> Minor churn note: the auto-built rendered page (https://webmachinelearning.github.io/webmcp) showed
> `execute` without `required` and the callback arg as `any inputArguments`, whereas the current spec
> **source** (`index.bs`) shows `required ToolExecuteCallback execute` and `object inputObject`. Treat the
> source as authoritative; the built page lags slightly. Either way `execute` is the handler.

Canonical example (README, verbatim shape):
```js
await document.modelContext.registerTool({
  name: "add-todo",
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "The text content of the todo item" } },
    required: ["text"]
  },
  async execute({ text }) {
    await addTodoItemToCollection(text);
    return { content: [ { type: "text", text: `Added todo item: "${text}" successfully.` } ] };
  }
}, { signal: controller.signal });
```
Source: https://github.com/webmachinelearning/webmcp/blob/main/README.md (lines ~277–300). `execute`
returns an MCP-style `{ content: [...] }` result.

### 1.4 Return value and unregistration

- `registerTool(...)` returns **`Promise<undefined>`** — it does **not** return an unregister handle.
  Rejects (per spec domintro) if a tool with the same `name` is already registered, if `name`/`description`
  are empty, or if `inputSchema`/`outputSchema` is invalid; also `NotAllowedError` when the `tools`
  permission is disabled (`Permissions-Policy: tools=()` / iframe `allow`).
- **Unregistration is via the `AbortSignal`** passed as `options.signal` ("An AbortSignal that unregisters
  the tool when aborted"). This is exactly the plan's §2.7 / X9 "unregister (AbortSignal) on route change
  or sign-out" pattern: keep an `AbortController`, pass `controller.signal`, call `controller.abort()`.
- Sources: https://github.com/webmachinelearning/webmcp/blob/main/index.bs (domintro ~744–750, ~1342–1343)
  · https://github.com/webmachinelearning/webmcp/blob/main/README.md (Permissions-Policy / `exposedTo`).

### 1.5 `provideContext()` / `clearContext()` — CONFIRMED dropped in 2026

- **Absent** from the current draft and spec source (no occurrences of either string in `index.bs` or the
  rendered spec).
- Removal confirmed as a group decision: **PR #132 "Remove `provideContext()` and `clearContext()`"**
  (domfarolino). W3C WebML CG teleconference **5 March 2026** records: *"Brandon proposed to drop
  provideContext/clearContext from the spec entirely … the group agrees"* and **RESOLUTION: "Drop
  provideContext/clearContext from the spec as in PR #132."**
  Source: https://www.w3.org/2026/03/05-webmachinelearning-minutes.html
- Corroborating secondary sources state removal in **March 2026**:
  https://webmcp-checker.com/blog/complete-webmcp-implementation-guide-2026 ·
  https://www.openhermit.com/blog/webmcp-implementation-2026. Earlier drafts exposed them on
  `navigator.modelContextTesting` (https://www.webfuse.com/webmcp-cheat-sheet).
- **Matches PROGRAM_PLAN §1** ("dropped from the draft in 2026"). X9 must not call them.

### 1.6 Chrome / browser enablement (how it is turned on today)

- **Local development flag:** `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch.
  Sources: https://developer.chrome.com/docs/ai/webmcp ·
  https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md (writes it as
  `about:flags#enable-webmcp-testing`).
- **Origin trial:** live in **Chrome 149** (sign-up/token-based, time-limited).
  Sources: https://developer.chrome.com/blog/ai-webmcp-origin-trial (2026-06-09) ·
  https://developer.chrome.com/docs/ai/webmcp (2026-05-18) ·
  https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md.
- **Early preview** began **Chrome 146 Canary, 2026-02-10** (behind the testing flag).
  Source: https://developer.chrome.com/blog/webmcp-epp.
- **Edge:** origin trial live in **Edge 150**.
  Source: https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md ·
  https://developer.microsoft.com/microsoft-edge/origin-trials/trials/0b76fe60-b266-458e-a285-04e375c0c31a
- Also supported/experimental in ChatGPT Desktop, Brave Leo, Meta Ray-Ban Display (off by default);
  Firefox/Safari have standards-positions entries only. Source: implementation-status.md (above).
- TypeScript types: `webmcp-types` npm package — https://www.npmjs.com/package/webmcp-types (referenced by
  the README; useful for X9 typings, verify licence before bundling).

### 1.7 WebMCP — UNVERIFIED items

- **UNVERIFIED:** the exact object (`document` vs `navigator`) the **current Chrome 149 origin-trial build**
  exposes — Chrome's docs page has no code example. Mitigation: feature-detect both (plan already does).
- **UNVERIFIED:** full member list of `ToolAnnotations` beyond `readOnlyHint` / `untrustedContentHint`.
- **UNVERIFIED:** origin-trial start/end dates and the precise trial token (blog did not list dates).
- Churn-prone: `execute` required-ness and callback arg type differ slightly between built page and source.

---

## FACT 2 — MCP Registry API (packet X5: the scout's real registry client)

### 2.1 Base URLs and published schema/docs

- **Production base URL: `https://registry.modelcontextprotocol.io`** (matches PROGRAM_PLAN §1).
  **Staging:** `https://staging.registry.modelcontextprotocol.io`.
- **Live API docs (Stoplight, try-it-now):** https://registry.modelcontextprotocol.io/docs
- **Published OpenAPI spec (machine-readable):** https://registry.modelcontextprotocol.io/openapi.yaml
  · mirror in repo:
  https://raw.githubusercontent.com/modelcontextprotocol/registry/refs/heads/main/docs/reference/api/openapi.yaml
  · repo: https://github.com/modelcontextprotocol/registry
- API spec `info.version` = **`2025-12-01`**; paths are versioned **`/v0.1/`**.
- Docs: official API doc
  https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md ·
  generic API doc
  https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/generic-registry-api.md ·
  about https://modelcontextprotocol.io/registry/about ·
  aggregators https://modelcontextprotocol.io/registry/registry-aggregators

### 2.2 Read endpoints (list / search / detail / versions)

All read endpoints require **no authentication** (see 2.3). Content type `application/json`.

| Method + path | Purpose | Key query params |
|---|---|---|
| `GET /v0.1/servers` | List servers (one record per server **version**); also the **search** endpoint | `search`, `version`, `updated_since`, `include_deleted`, `limit`, `cursor` |
| `GET /v0.1/servers/{serverName}/versions` | List all versions of a server | `include_deleted` |
| `GET /v0.1/servers/{serverName}/versions/{version}` | Get a specific version; special version **`latest`** = most recent | `include_deleted` |

- **Search is a query parameter on the list endpoint, not a separate route.** `search` =
  **case-insensitive substring match on server NAMES only** (not description/metadata). A non-empty
  `search` must be **≥ 3 Unicode chars** after trimming, else **HTTP 422**; empty/omitted = normal listing.
  Free-text search across metadata is only a *proposed extension* (issue #389), not core.
- `version` filter: `latest` (only latest versions, `_meta…isLatest=true`) or an exact version (e.g. `1.2.3`).
- `updated_since`: RFC3339 timestamp for incremental sync (auto-set `include_deleted=true`).
- `{serverName}` must be **URL-encoded** (reverse-DNS with one `/`, e.g. `io.github.example%2Fweather`).
- Example: `GET /v0.1/servers?search=filesystem&version=latest`.
- Write/admin endpoints (not needed by X5 read client): `POST /v0.1/publish`,
  `PUT/DELETE/PATCH …/versions/{version}[/status]`, `PATCH …/status`, `POST /v0.1/auth/*`.
- Sources: official-registry-api.md and generic-registry-api.md (above) · openapi.yaml paths
  (`/v0.1/servers` line ~21, `search` param ~47, versions ~83/~120).

### 2.3 Authentication

- **Read/list/search/detail: NO auth required by default.** ("No authentication required by default.
  Subregistries may optionally require authentication.")
- **Publishing** requires namespace-based auth: GitHub OAuth (`io.github.*`), GitHub OIDC (Actions),
  DNS or HTTP verification (domain namespaces). X5's read-only scout client needs none of this.
- Sources: generic-registry-api.md (Authentication) · official-registry-api.md (Authentication) ·
  https://modelcontextprotocol.io/registry/about

### 2.4 Response schema (exact fields)

**List envelope (`ServerList`):**
```jsonc
{
  "servers": [ /* array of ServerResponse */ ],
  "metadata": { "nextCursor": "opaque-string-or-null", "count": 30 }
}
```

**`ServerResponse`** (required: `server`):
```jsonc
{
  "server": { /* ServerDetail, see below */ },
  "_meta": {
    "io.modelcontextprotocol.registry/official": {
      "status": "active|deprecated|deleted",
      "statusMessage": "…",          // optional, ≤500 chars
      "statusChangedAt": "RFC3339",
      "publishedAt": "RFC3339",
      "updatedAt": "RFC3339",
      "isLatest": true               // present per official-registry-api.md when version=latest
    }
  }
}
```

**`ServerDetail`** (the server entry; required: `name`, `description`, `version`):
| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | reverse-DNS, exactly one `/`, 3–200 chars |
| `description` | string | yes | 1–100 chars |
| `version` | string | yes | **exact version**, e.g. `1.0.2`; semver recommended; **ranges rejected** (`^1.2.3`, `1.x`, …); ≤255 chars |
| `title` | string | no | display name, ≤100 chars |
| `repository` | object (`Repository`) | no | see below |
| `websiteUrl` | string (uri) | no | homepage/docs |
| `icons` | array (`Icon`) | no | sized icons |
| `$schema` | string (uri) | no | server.json schema URI |
| `packages` | array (`Package`) | no | installable packages (npm/pypi/cargo/oci/nuget/mcpb), with `version`, `registryType`, transport, env/args, sha256 |
| `remotes` | array (`RemoteTransport`) | no | remote transports (streamable-http/sse), url |
| `_meta` | object | no | vendor extension metadata (`…/publisher-provided`) |

**`Repository`** object fields: `url` (browse + git clone), `source` (hosting-service id, e.g. github),
`id` (stable host repo id), `path` (optional monorepo subpath).

**`licence`/`license`: ABSENT.** There is **no licence field** in `ServerDetail`, in the published
`server.schema.json`, in `official-registry-requirements.md`, or in the latest validator schema
(`2025-12-11.json`). The only `license` token in `openapi.yaml` is the spec's own `info.license`
(line 10), **not** a server-entry field. No SPDX field either.

Sources (verbatim schema): openapi.yaml `ServerDetail` (~950–1023), `ServerResponse` (~1024–1071),
`ServerList` (~636–657), `Repository` (~611–635) —
https://raw.githubusercontent.com/modelcontextprotocol/registry/refs/heads/main/docs/reference/api/openapi.yaml
· server.schema.json
https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/draft/server.schema.json
· official-registry-api.md (Server List Filtering / Server Detail).

### 2.5 Pagination and ordering gotchas (important for X5)

- **Cursor-based pagination:** first request omits `cursor`; pass `metadata.nextCursor` as `cursor` next;
  stop when `nextCursor` is null/empty. **Treat cursors as opaque.** Keep the same filters across pages.
- **One record per server VERSION.** Without `version=latest`, results include **superseded** versions
  (also when `search` is set).
- **Ordering is by name, then version-as-TEXT ascending** — e.g. `1.10.0` sorts before `1.2.0`. **Do not
  treat the first result for a server as its latest.** Use `version=latest` (sets `isLatest=true`) or fetch
  `…/versions/latest` when the full name is known.
- Source: official-registry-api.md (Server List Filtering) · generic-registry-api.md (Pagination).

### 2.6 Registry — UNVERIFIED items

- **UNVERIFIED (live behaviour):** endpoint responses were read from published docs/OpenAPI only — **no
  live API call was made** (per task constraint). Re-confirm a real `GET /v0.1/servers?version=latest`
  response at R2 intake / via recorded fixtures.
- **UNVERIFIED:** whether any subregistry/extension adds a licence field (core + official do not).
- `isLatest` placement is documented in official-registry-api.md; confirm it appears in the live `_meta`
  block when `version=latest`.

---

## Implications for X9 / X5

### X9 — WebMCP in Warsha's own UI (flagged, off by default)

1. **Feature-detect both entry points** exactly as planned: `document.modelContext ?? navigator.modelContext`.
   The draft is `document.modelContext`; early builds were `navigator.modelContext`; Chrome 149's object is
   UNVERIFIED, so detecting both is mandatory, not optional.
2. **Descriptor to generate from the actions registry:** `{ name, description, inputSchema, execute }`
   (+ optional `title`, `outputSchema`, `annotations`). Set `annotations.readOnlyHint = true` for read-only
   safe-list tools (read status, navigate); keep write/confirm actions explicit. `execute` returns an
   MCP-style `{ content: [...] }` result and must route through `useAction` (same capability check +
   confirm dialog) per §2.7.
3. **Unregistration = AbortSignal**, not a returned handle. Hold one `AbortController` per registration
   scope; pass `{ signal }`; `abort()` on route change / sign-out / setting-off. `registerTool` returns
   `Promise<undefined>` and rejects on duplicate `name` — guard against double-registration.
4. **Do NOT call `provideContext()` / `clearContext()`** — removed March 2026 (PR #132). Any template/skill
   (X10) or shim must omit them.
5. **Never register gate/delete/secret actions** (plan §2.7 / X9). Respect `Permissions-Policy: tools=()`
   and handle `NotAllowedError` rejection gracefully (treat as "WebMCP unavailable").
6. Tests use a **fake `modelContext`** (vitest) and an injected shim (Playwright) — no real browser
   WebMCP dependency. Typings: consider `webmcp-types` (verify licence/lock first).

### X5 — Scout truth (registry seam + fixtures)

1. **Base URL `https://registry.modelcontextprotocol.io`, read endpoints need no auth.** Client behind a
   trait; production reaches the registry or reports "catalog unavailable"; tests use recorded fixtures
   (no live registry in tests, per §2.9).
2. **Real exact version: AVAILABLE.** Replace the mock `version: "latest"` with the entry's exact
   `version` string; query `?version=latest` (or `…/versions/latest`) to get the latest exact version and
   `isLatest=true`. Mind the text-ordering gotcha (don't assume first result = latest).
3. **Real licence: NOT AVAILABLE from the registry API.** There is **no licence field**. Therefore the
   mock `license: "MIT"` cannot be replaced with a registry-sourced licence. Per X5's own rule
   (**unknown licence → link-only**), **every registry-sourced proposal maps to unknown → link-only**.
   If a real licence is required, X5 must resolve it **out-of-band** (e.g. the `repository.url` host's
   licence API or the package registry's metadata) — that is a separate seam, not the MCP Registry API.
   Flag this to the run planner: the X5 acceptance phrase "proposals carry real version **and licence**"
   is only half-achievable from the registry alone.
4. **Search = `GET /v0.1/servers?search=<name-substring>`**, case-insensitive, **names only**, **≥3 chars**
   (else 422). The scout's search box must enforce the 3-char minimum and not promise description search.
5. **Useful fields to surface:** `name`, `description`, `version`, `repository.url` (for link-only +
   out-of-band licence resolution), `websiteUrl`, `packages`/`remotes` (for pinned install manifests, X2/X7).
   `_meta…official.status` (active/deprecated/deleted) and `publishedAt`/`updatedAt` for filtering.
6. **Pagination:** follow opaque `metadata.nextCursor`, keep filters constant; offline → "catalog
   unavailable". Remove all "In real implementation"/"mock proposals" stubs (X5 grep gate).

---

## Contradictions / refinements to PROGRAM_PLAN §1

- **WebMCP §1 note: CONFIRMED, well-calibrated.** `document.modelContext` is current; earlier/some builds
  used `navigator.modelContext`; `provideContext`/`clearContext` dropped in 2026 (March, PR #132); Chrome
  exposes it via origin trial (Chrome 149) + testing flag. No contradiction. The only gap: Chrome 149's
  exact entry-point object is UNVERIFIED — the plan's "feature-detect both" already covers it.
- **Registry §1 / X5: REFINEMENT (material).** The plan assumes the scout can carry a "real … licence"
  from `registry.modelcontextprotocol.io`. **The registry API exposes no licence field at all.** Version
  and description and repository are present; licence is not. Net effect: X5's "unknown licence →
  link-only" applies to **all** registry entries unless a secondary licence source is added. This does not
  block X5 (link-only is a valid outcome) but the acceptance wording should be corrected at intake.

## Confidence

- **High:** WebMCP draft entry point (`document.modelContext`), `registerTool` IDL/descriptor,
  `Promise<undefined>` + AbortSignal unregistration, provideContext/clearContext removal (primary spec
  source + README + W3C resolution). Registry base URL, read endpoints, no-auth read, response schema,
  exact `version` present, **licence absent**, cursor pagination (primary OpenAPI + official/generic docs).
- **Medium:** Chrome enablement specifics (flag name + Chrome 149 origin trial confirmed across Chrome
  docs/blog + implementation-status; trial dates/token not listed).
- **UNVERIFIED:** Chrome 149 origin-trial entry-point object; full `ToolAnnotations` members; live registry
  response behaviour (no live call made); any subregistry licence extension.

## Blockers

- **None blocking R2 intake.** Both facts are sufficiently verified to proceed. Two carry-forward actions:
  (a) X9 must feature-detect both entry points and use AbortSignal (already in plan); (b) X5 acceptance
  wording "real … licence" must be corrected — registry has no licence field, so link-only is the default
  for all registry-sourced proposals unless a secondary licence seam is added. Re-confirm both at R2 intake.

---

## Sources (URLs)

WebMCP:
- https://webmachinelearning.github.io/webmcp (rendered draft, 9 Nov 2026)
- https://github.com/webmachinelearning/webmcp (repo)
- https://github.com/webmachinelearning/webmcp/blob/main/index.bs (spec source / IDL)
- https://github.com/webmachinelearning/webmcp/blob/main/README.md (entry point + example)
- https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md (browser support)
- https://developer.chrome.com/docs/ai/webmcp (flag + Chrome 149 origin trial)
- https://developer.chrome.com/blog/ai-webmcp-origin-trial (origin trial, 2026-06-09)
- https://developer.chrome.com/blog/webmcp-epp (early preview, 2026-02-10)
- https://www.w3.org/2026/03/05-webmachinelearning-minutes.html (PR #132 removal resolution)
- https://w3c-cg.github.io/aikr/webMCP/webmcp-technical-notes.html (navigator early entry point)
- https://www.webfuse.com/webmcp-cheat-sheet (navigator.modelContext / modelContextTesting, 2026-03-09)
- https://webmcp-checker.com/blog/complete-webmcp-implementation-guide-2026 (removal March 2026)
- https://www.openhermit.com/blog/webmcp-implementation-2026 (removal March 2026)
- https://developer.microsoft.com/microsoft-edge/origin-trials/trials/0b76fe60-b266-458e-a285-04e375c0c31a (Edge trial)
- https://www.npmjs.com/package/webmcp-types (TS typings)

MCP Registry:
- https://registry.modelcontextprotocol.io/ (official registry)
- https://registry.modelcontextprotocol.io/docs (live API docs)
- https://registry.modelcontextprotocol.io/openapi.yaml (live OpenAPI)
- https://raw.githubusercontent.com/modelcontextprotocol/registry/refs/heads/main/docs/reference/api/openapi.yaml (OpenAPI mirror)
- https://github.com/modelcontextprotocol/registry (repo)
- https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md
- https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/generic-registry-api.md
- https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/draft/server.schema.json
- https://modelcontextprotocol.io/registry/about
- https://modelcontextprotocol.io/registry/registry-aggregators