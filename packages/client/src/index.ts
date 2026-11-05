// @warsha/client — Type-safe API client for warshad: JSON-RPC over HTTP + the /events stream.
// Wire types are declared here (not imported from @warsha/core) to avoid a Rust↔TS coupling.
//
// Auth invariant: the daemon token travels only in request headers — never in a URL, a
// thrown error message, or a console call. Every message produced here passes through
// `redactToken` first, so a token echoed back by the daemon cannot escape in an error.

export type ProjectId = string & { readonly __brand: unique symbol };
export type RunId = string & { readonly __brand: unique symbol };
export type DeviceId = string & { readonly __brand: unique symbol };

export type Stage =
  | 'idea'
  | 'gate_a'
  | 'research'
  | 'prd_spec'
  | 'gate_b'
  | 'design'
  | 'plan_tasks'
  | 'code'
  | 'review_qa_security'
  | 'gate_c'
  | 'release'
  | 'gate_d'
  | 'launch_drafts'
  | 'feedback';

export type GateState =
  | { state: 'pending' }
  | { state: 'approved'; by: DeviceId; at: string }
  | { state: 'rejected'; reason: string; by: DeviceId; at: string }
  | { state: 'changes_requested'; notes: string; by: DeviceId; at: string };

export type Role =
  | 'intake'
  | 'researcher'
  | 'pm'
  | 'designer'
  | 'architect'
  | 'coder'
  | 'reviewer'
  | 'qa'
  | 'security'
  | 'release'
  | 'marketer'
  | 'feedback';

export interface RpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface RpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: RpcError;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ProjectSummary {
  id: ProjectId;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunSummary {
  id: RunId;
  projectId: ProjectId;
  stage: Stage;
  status: string;
  startedAt: string;
  updatedAt: string;
}

export interface GateSummary {
  stage: Stage;
  state: GateState;
}

export interface DeviceSummary {
  id: DeviceId;
  name: string;
  pairedAt: string;
  lastSeen: string;
}

/**
 * `warsha_remote::PairingData` exactly as the daemon deserialises it — the struct
 * `devices.pair` binds (`crates/warshad/src/lib.rs:781`, the Rust type at
 * `crates/warsha-remote/src/lib.rs:112-118`).
 *
 * The field names are snake_case and the key material is a JSON array of numbers because
 * the Rust struct carries no serde renames and no byte encoding: `device_id` is the
 * hyphenated UUID string, `static_public` and `pairing_secret` are `[u8; 32]` — arrays of
 * exactly 32 integers 0..=255 — and `expires_at` is an RFC 3339 string. This is also what
 * the pairing QR carries: `PairingData::to_qr_code` encodes `serde_json::to_vec(self)`,
 * so the redeeming side reads the QR text back into this shape (`pairingDataFromQrPayload`)
 * and puts the same object on the wire — nothing is lost between the plate and the daemon.
 *
 * `pairing_secret` is a bearer credential. It is never logged, never rendered, and never
 * appears in an error message this client produces.
 */
export interface PairingData {
  device_id: DeviceId;
  /** The device's X25519 public key: `[u8; 32]` as 32 numbers, each 0..=255. */
  static_public: number[];
  /** Rust `Option<String>`; the QR payload always carries the key, `null` meaning "direct". */
  relay_url: string | null;
  /** The one-time pairing secret: `[u8; 32]` as 32 numbers. A secret — see above. */
  pairing_secret: number[];
  /** RFC 3339, as chrono's serde default writes `DateTime<Utc>`. */
  expires_at: string;
}

/**
 * `warsha_remote::PairingOffer` as returned by `devices.pair-start`.
 *
 * Mints the 32-byte one-time secret and returns it together with the daemon's resolved
 * listening origin as a pairing link and a base64 PNG QR plate.
 */
export interface PairingOffer {
  pairing: PairingData;
  /** Where the daemon is listening, as `http://<host>:<port>`. */
  server_origin: string;
  /** The pairing link for a phone. A bearer credential. */
  pairing_link: string;
  /** Base64-encoded PNG image of the QR code. */
  qr_code_png: string;
  /** True when server_origin is loopback only. */
  loopback_only: boolean;
}

export interface ProviderConfig {
  name: string;
  kind: string;
  enabled: boolean;
  /**
   * The endpoint the provider is reached at, when one is configured.
   *
   * `providers.list` omits it rather than sending `null` for a provider that uses
   * its kind's default, so it is optional here too. The provider's API key is not
   * part of any reply: it stays in the OS keychain, and the daemon only ever reads
   * it to test the connection.
   */
  api_base?: string;
  budgetUsd?: number;
}

export interface RoutingTargetConfig {
  provider_id: string;
  model_id: string;
  weight: number;
}

export interface RoleRoutingConfig {
  role: Role;
  targets: RoutingTargetConfig[];
  fallback_enabled: boolean;
  budget_cents_per_run: number;
}

/**
 * One routing as `roles.list` reports it: the same shape `roles.set` takes, with the
 * ceiling the daemon may answer `null` for. `warshad`'s `budget_cents_per_run` is an
 * `Option`, and "no ceiling" is a fact a caller has to be able to tell from zero cents —
 * so the list keeps the `null` and `getRoleConfig` folds it to `0` for the shape this
 * client's `RoleRoutingConfig` has always declared.
 */
export interface RoleRouting {
  role: Role;
  targets: RoutingTargetConfig[];
  fallback_enabled: boolean;
  budget_cents_per_run: number | null;
}

/** The agent loop's mode, as the daemon serialises `AgentMode`. */
export type AgentModeName = 'plan' | 'agent';

/**
 * One recorded Plan ↔ Agent switch: the approval history.
 *
 * `approvedBy` is never a name a caller typed. It is the device the session
 * authenticated as (audit H-03), and a switch into `agent` with an empty approver did
 * not happen.
 */
export interface AgentModeTransition {
  from: AgentModeName;
  to: AgentModeName;
  approved_by: string;
  approved_at: number;
}

/** Where a todo is in its own flow, as `TodoStatus` serialises it. */
export type AgentTodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

/** One item of the loop's todo list — what a turn said it would do. */
export interface AgentTodo {
  id: string;
  description: string;
  status: AgentTodoStatus;
}

/** A `@kind target` mention the loop resolved out of the owner's words. */
export interface AgentMention {
  kind: string;
  target: string;
}

/** The slash command a turn asked for, when the catalog has it. */
export interface AgentSkill {
  name: string;
  description: string;
}

/**
 * One tool a turn ran. `tool` is `warsha_pipeline`'s `AgentTool` enum, which this client
 * declares as `unknown` on purpose: the fields differ per variant, and a screen that
 * wants one narrows it rather than trusting a shape that may not be there.
 */
export interface AgentToolResult {
  tool: unknown;
  success: boolean;
  output: string;
}

/** One `agent.turn` answer, as `AgentTurnResult` serialises it. */
export interface AgentTurn {
  mode: AgentModeName;
  mentions: AgentMention[];
  command: AgentSkill | null;
  response: string;
  todos: AgentTodo[];
  tools: AgentToolResult[];
}

/**
 * What the agent loop is: the mode the next turn runs in, every switch that got it
 * there and the todos so far — the record a restart is expected to hand back.
 */
export interface AgentState {
  mode: AgentModeName;
  approvals: AgentModeTransition[];
  todos: AgentTodo[];
  model_wired: boolean;
}

export interface BudgetStatus {
  totalBudgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
}

/** Event kinds the daemon emits (`warsha_core::EventKind`, snake_case on the wire). */
export type EventKind = string;

/** One `warsha_core::Event` as streamed by the daemon's `/events` WebSocket endpoint. */
export interface WarshaEvent {
  id: string;
  runId: RunId;
  stage: Stage;
  role: Role | null;
  kind: EventKind;
  payload: unknown;
  costCents: number | null;
  createdAt: string;
  deviceId: DeviceId | null;
}

const STAGE_VALUES: readonly Stage[] = [
  'idea',
  'gate_a',
  'research',
  'prd_spec',
  'gate_b',
  'design',
  'plan_tasks',
  'code',
  'review_qa_security',
  'gate_c',
  'release',
  'gate_d',
  'launch_drafts',
  'feedback',
];

const ROLE_VALUES: readonly Role[] = [
  'intake',
  'researcher',
  'pm',
  'designer',
  'architect',
  'coder',
  'reviewer',
  'qa',
  'security',
  'release',
  'marketer',
  'feedback',
];

const REDACTED = '[redacted]';
const EVENT_FRAME_ERROR = 'Malformed event frame';

/** Replace every occurrence of `token` in `message` with `[redacted]`. */
export function redactToken(message: string, token: string): string {
  if (token.length === 0) return message;
  return message.split(token).join(REDACTED);
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'unknown error';
}

function field(source: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${EVENT_FRAME_ERROR}: missing "${name}"`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`${EVENT_FRAME_ERROR}: invalid "${name}"`);
  }
  return value;
}

function optionalNumber(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${EVENT_FRAME_ERROR}: invalid "${name}"`);
  }
  return value;
}

function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && STAGE_VALUES.some((stage) => stage === value);
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLE_VALUES.some((role) => role === value);
}

/**
 * Decode one `/events` text frame into a `WarshaEvent`.
 * Accepts the daemon's snake_case field names and camelCase aliases.
 * Throws an `Error` whose message never contains the frame body.
 */
export function parseWarshaEvent(frame: string): WarshaEvent {
  let decoded: unknown;
  try {
    decoded = JSON.parse(frame);
  } catch {
    throw new Error(`${EVENT_FRAME_ERROR}: not valid JSON`);
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error(`${EVENT_FRAME_ERROR}: expected a JSON object`);
  }
  return decodeWarshaEvent(decoded as Record<string, unknown>);
}

/**
 * The field-by-field half of the decode, shared by the `/events` frame reader and
 * `runs.events` — the same `warsha_core::Event` arriving over two transports.
 */
function decodeWarshaEvent(source: Record<string, unknown>): WarshaEvent {
  const id = requiredString(field(source, 'id'), 'id');
  const runId = requiredString(field(source, 'run_id', 'runId'), 'run_id');

  const stage = field(source, 'stage');
  if (!isStage(stage)) {
    throw new Error(`${EVENT_FRAME_ERROR}: unknown "stage"`);
  }

  const roleValue = field(source, 'role');
  let role: Role | null = null;
  if (roleValue !== null && roleValue !== undefined) {
    if (!isRole(roleValue)) {
      throw new Error(`${EVENT_FRAME_ERROR}: unknown "role"`);
    }
    role = roleValue;
  }

  const kind = requiredString(field(source, 'kind'), 'kind');
  const costCents = optionalNumber(field(source, 'cost_cents', 'costCents'), 'cost_cents');
  const createdAt = requiredString(field(source, 'created_at', 'createdAt'), 'created_at');
  const deviceId = optionalString(field(source, 'device_id', 'deviceId'), 'device_id');

  return {
    id,
    runId: runId as RunId,
    stage,
    role,
    kind,
    payload: field(source, 'payload') ?? null,
    costCents,
    createdAt,
    deviceId: deviceId === null ? null : (deviceId as DeviceId),
  };
}

/**
 * The daemon's cents as the screens' dollars. `null` is "no ceiling recorded", which the
 * `BudgetStatus` shape has always carried as `0` — and every screen already reads `0` as
 * "no budget row", not as "spent everything".
 */
function centsToUsd(value: unknown, name: string): number {
  if (value === null || value === undefined) return 0;
  return wiringNumber(value, 'budget.show', name) / 100;
}

/**
 * The payload keys that carry a line of their own, in the order a log should prefer them: a
 * human-facing text first, then the daemon's own identifiers. `warsha_core::Event.payload` is
 * a free-form `serde_json::Value`, so no single key is guaranteed (`{ idea }`, `{ from, to }`,
 * `{ decision, by }`, `{ artifact, stage }`, `{ cost_cents }` …).
 *
 * `decision` is deliberately NOT one of them (#54). It is a verdict word — `approved`, `rejected`,
 * `changes_requested` — never a sentence an owner reads, and a gate payload almost always carries
 * `by` beside it. Taking it as the line printed `approved` and silently dropped who decided, which
 * is the opposite of §7's rule that a decision records the device that made it (the gates inbox
 * stamps exactly that, `apps/desktop/src/screens/GatesInbox.tsx:84-88`). Left out, the payload
 * falls through to `eventLogLine`'s `key=value` pairs and the line is `decision=approved,
 * by=dev-1`: the verdict with its actor, and no field of the payload lost. A key that is only ever
 * worth reading *beside* its neighbours belongs to the pairs branch, not to the text list.
 */
const EVENT_TEXT_KEYS: readonly string[] = [
  'summary',
  'message',
  'note',
  'idea',
  'reason',
  'output',
  'text',
  'action',
  'artifact',
];

/**
 * One event as one log line — what `getRunLogs` renders.
 *
 * A line is the payload's text when it has one; otherwise its scalar fields as `key=value`
 * pairs (the shape `RunView` already uses for the same rows); otherwise the event's kind, so
 * a log line is never an empty string a screen has to guess the meaning of.
 */
function eventLogLine(value: unknown): string {
  const event = decodeWarshaEvent(wiringObject(value, 'runs.events'));
  const payload = event.payload;
  if (typeof payload === 'string') return payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return event.kind;
  }
  const source = payload as Record<string, unknown>;
  for (const key of EVENT_TEXT_KEYS) {
    const text = source[key];
    if (typeof text === 'string' && text.length > 0) return text;
  }
  const pairs = Object.entries(source)
    .filter(([, item]) => typeof item !== 'object' && typeof item !== 'function')
    .map(([key, item]) => `${key}=${String(item)}`);
  return pairs.length > 0 ? pairs.join(', ') : event.kind;
}

/**
 * The `/events` URL for a daemon base URL, tolerating a trailing slash.
 *
 * This is the one place the WebSocket scheme is decided. `subscribeEvents` opens
 * `new WebSocket(...)`, not an HTTP GET, so the dialled URL must be `ws:` or `wss:`:
 * a socket opened at an `http:` URL is rejected by the platform before it reaches the
 * daemon, which is a permanently offline feed for a reason that has nothing to do with
 * the daemon. An `http:` base therefore becomes `ws:` and an `https:` base becomes
 * `wss:`; a URL already in socket form passes through untouched. Callers pass the
 * endpoint the shell resolved — never a guessed port: `/events` is served by the
 * daemon's HTTP listener, which is not the listener RPC answers on.
 */
function eventEndpoint(url: string): string {
  const socketUrl = url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const trimmed = socketUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/events') ? trimmed : `${trimmed}/events`;
}

/** Subprotocol carrying the bearer token on the WebSocket handshake. */
const TOKEN_SUBPROTOCOL_PREFIX = 'warsha.token.';

/**
 * The `/events` data-plane subprotocol, offered first so the daemon can select it.
 *
 * RFC 6455 §1.9: a server answers a WebSocket handshake by selecting one of the
 * subprotocols the client offered, and a client that offered one and sees no selection
 * is entitled to consider the connection failed. The daemon's `/events` selects this
 * name and never `warsha.token.<token>`, because echoing the credential back onto the
 * response headers is exactly what the subprotocol form exists to avoid. The daemon
 * reads the token entry as its credential and this entry as the protocol
 * (`crates/warshad/src/lib.rs`, `EVENTS_SUBPROTOCOL`).
 */
const EVENTS_SUBPROTOCOL = 'warsha.events.v1';

/** One of `PairingData`'s `[u8; 32]` fields, checked the way serde binds it. Never echoes the bytes. */
function readPairingBytes(value: unknown, name: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`pairing payload: \`${name}\` is not an array of 32 byte values`);
  }
  const bytes: readonly unknown[] = value;
  const out: number[] = [];
  for (const byte of bytes) {
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`pairing payload: \`${name}\` is not an array of 32 byte values`);
    }
    out.push(byte);
  }
  if (out.length !== 32) {
    throw new Error(`pairing payload: \`${name}\` has ${out.length} bytes, expected 32`);
  }
  return out;
}

/** One required string field of a pairing payload; the error names the field, never its value. */
function readPairingString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`pairing payload: \`${name}\` is not a string`);
  }
  return value;
}

/**
 * The pairing QR text, read back into the struct `devices.pair` binds.
 *
 * The plate carries the JSON of the pairing itself — `PairingData::to_qr_code`
 * (`crates/warsha-remote/src/lib.rs:156-169`) encodes `serde_json::to_vec(self)` into the image —
 * so redeeming a pairing is `JSON.parse` plus the shape check serde would run: the four required
 * fields, the two 32-byte arrays, and `relay_url` as a string or null (`Option<String>`). Anything
 * else is refused here, before a byte of it can reach the daemon and be refused there in a message
 * nobody wrote.
 *
 * The QR text is a bearer credential (`pairing_secret`). Every refusal from this function names
 * the field that failed and carries none of the payload.
 */
export function pairingDataFromQrPayload(payload: string): PairingData {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload) as unknown;
  } catch {
    throw new Error('pairing payload is not JSON');
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error('invalid type: expected a PairingData object');
  }
  const source = decoded as Record<string, unknown>;
  const relayUrl = source['relay_url'];
  if (relayUrl !== undefined && relayUrl !== null && typeof relayUrl !== 'string') {
    throw new Error('pairing payload: `relay_url` is not a string or null');
  }
  return {
    device_id: readPairingString(source['device_id'], 'device_id') as DeviceId,
    static_public: readPairingBytes(source['static_public'], 'static_public'),
    relay_url: typeof relayUrl === 'string' ? relayUrl : null,
    pairing_secret: readPairingBytes(source['pairing_secret'], 'pairing_secret'),
    expires_at: readPairingString(source['expires_at'], 'expires_at'),
  };
}

export class WarshaClient implements WarshaWiringApi {
  private baseUrl: string;
  private token: string;
  private requestId = 0;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async rpc<T>(method: string, params?: unknown): Promise<T> {
    const endpoint = `${this.baseUrl}/rpc`;
    const response = await this.postRpc(endpoint, method, params);

    let data: RpcResponse<T>;
    try {
      data = (await response.json()) as RpcResponse<T>;
    } catch (cause) {
      throw new Error(
        this.redact(`Invalid JSON-RPC response from ${endpoint}: ${describeCause(cause)}`)
      );
    }

    if (data.error !== undefined) {
      throw new Error(this.redact(`RPC error ${data.error.code}: ${data.error.message}`));
    }
    return data.result as T;
  }

  private async postRpc(endpoint: string, method: string, params?: unknown): Promise<Response> {
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method,
          params,
        }),
      });
    } catch (cause) {
      throw new Error(this.redact(`Request to ${endpoint} failed: ${describeCause(cause)}`));
    }
  }

  private redact(message: string): string {
    return redactToken(message, this.token);
  }

  // Projects
  async listProjects(): Promise<ProjectSummary[]> {
    return this.rpc('projects.list');
  }

  /**
   * `projects.create` — all three fields are required by the daemon.
   *
   * Measured against a running `warshad` (DECISIONS.md 2026-11-03, #40 restated): `{ name }`
   * alone answered `-32602 "missing field 'description'"`, and adding `description` then
   * answered `-32602 "missing field 'language'"`. `crates/warshad/src/lib.rs:668-674` binds
   * `name`, `description` and `language`, none of them an `Option`.
   *
   * `language` is a parameter rather than something this client guesses: the product is
   * Arabic-first, and the locale belongs to the app that owns it (`@warsha/i18n`'s
   * `useLocale()`), not to a wire client. Callers pass the active locale — the desktop's
   * `ProjectsBoard.tsx` and `Onboarding.tsx` both already hold it.
   */
  async createProject(
    name: string,
    description: string,
    language: string
  ): Promise<ProjectSummary> {
    return this.rpc('projects.create', { name, description, language });
  }

  async getProject(id: ProjectId): Promise<ProjectSummary> {
    return this.rpc('projects.get', { id });
  }

  // Runs
  async listRuns(projectId: ProjectId): Promise<RunSummary[]> {
    return this.rpc('runs.list', { projectId });
  }

  async startRun(projectId: ProjectId, idea: string): Promise<RunSummary> {
    return this.rpc('runs.start', { projectId, idea });
  }

  /**
   * `runs.get` — the daemon's own argument name, not a shorter one for the same thing.
   *
   * Measured against a running `warshad` (#54): `{ id }` answered `-32602 "missing field
   * 'run_id'"`, because `crates/warshad/src/lib.rs:683` binds `run_id` and jsonrpsee's generated
   * decoder accepts only that name and its camelCase spelling `runId`. `id` is a *rename*, which
   * matches neither, so serde skipped it and the required field was simply absent. The live caller
   * is the remote bench's run read (`apps/remote/src/bench.tsx:529` → `getRunStatus` → here); the
   * desktop's own run screen reads `runs.list` and `runs.events` and so never reached this name.
   *
   * Casing is not the problem and was not swept for it: `{"runId": …}` parses today.
   */
  async getRun(id: RunId): Promise<RunSummary> {
    return this.rpc('runs.get', { run_id: id });
  }

  /**
   * The run as the daemon holds it right now.
   *
   * `runs.status` was a second name for the one reading `runs.get` already answers
   * (DECISIONS.md 2026-11-03: one wire name per meaning), so this delegates instead of
   * putting an unregistered name on the wire. The method name stays, because the callers
   * that ask for "the status" should not have to change what they say.
   */
  async getRunStatus(id: RunId): Promise<RunSummary> {
    return this.getRun(id);
  }

  /**
   * The run's log, as display lines.
   *
   * `runs.logs` was never a method `warshad` serves; the rows behind it are the run's events
   * (`runs.events`, `crates/warshad/src/lib.rs:688`), so this reads those and formats them
   * here rather than giving the same rows a second name. `eventLogLine` is the whole
   * presentation: one line per event, taken from the payload's own text when it has any.
   */
  async getRunLogs(id: RunId): Promise<string[]> {
    const events = await this.rpc<unknown[]>('runs.events', { run_id: id });
    if (!Array.isArray(events)) {
      throw new Error(`${WIRING_RESULT_ERROR} from runs.events: expected a list`);
    }
    return events.map(eventLogLine);
  }

  // Gates
  // Gates (audit H-03: the deciding device is the session, never a param).
  //
  // `approveGate`, `rejectGate` and `requestChanges` are the three writes: the daemon's
  // signature is `gates.approve(run_id, stage, device_id)`, where `device_id` is an
  // `Option` that exists only so a client written against the old shape can still send
  // something. Its value is checked against the authenticated session and a mismatch is
  // refused with `-32003`, so this client sends `null`: the verified-session contract
  // stated out loud — the approver recorded is the device the bearer token belongs to,
  // and nothing a screen types can change it. Their results are the daemon's `Run` in
  // snake_case, which these methods do not claim to read, so they are typed `void`.
  //
  // `getGates` is the read of that same record: `gates.list` is registered by the daemon and
  // served from the run's gate states (DECISIONS.md 2026-11-03, #25), in the flat
  // `{ stage, state }` shape `GateSummary` declares. It is a `Session`-tier read — deliberately
  // not the `Auth` tier the three writes above use, because a paired phone has to be able to
  // read the queue it is being asked to decide.
  async getGates(runId: RunId): Promise<GateSummary[]> {
    return this.rpc('gates.list', { runId });
  }

  async approveGate(runId: RunId, stage: Stage): Promise<void> {
    await this.rpc<unknown>('gates.approve', { run_id: runId, stage, device_id: null });
  }

  async rejectGate(runId: RunId, stage: Stage, reason: string): Promise<void> {
    await this.rpc<unknown>(
      'gates.reject',
      { run_id: runId, stage, reason, device_id: null }
    );
  }

  async requestChanges(runId: RunId, stage: Stage, notes: string): Promise<void> {
    await this.rpc<unknown>(
      'gates.changes',
      { run_id: runId, stage, notes, device_id: null }
    );
  }

  // Providers.
  //
  // `providers.add(name, kind, key, api_base)` and its `api_base` are snake_case
  // because that is what jsonrpsee deserialises the daemon's arguments from, and the
  // key is sent once, in the write: no `providers.*` reply carries it, because the
  // daemon keeps it in the OS keychain.
  async listProviders(): Promise<ProviderConfig[]> {
    return this.rpc('providers.list');
  }

  async addProvider(config: {
    name: string;
    kind: string;
    key: string;
    api_base?: string;
  }): Promise<ProviderConfig> {
    return this.rpc('providers.add', {
      name: config.name,
      kind: config.kind,
      key: config.key,
      api_base: config.api_base ?? null,
    });
  }

  ///
  async testProvider(name: string): Promise<void> {
    await this.rpc<unknown>('providers.test', { name });
  }

  async removeProvider(name: string): Promise<void> {
    await this.rpc<unknown>('providers.remove', { name });
  }

  // There is no `providers.budget` and no `providers.budget.status`: the daemon's ceiling is
  // per project (`budget.set`) and per routing (`roles.set` carries `budget_cents_per_run`),
  // and no per-provider budget exists (DECISIONS.md 2026-11-03). Both client methods were
  // deleted rather than aliased, so no screen can present a number the daemon never kept.

  // Project Budgets
  /**
   * `budget.show`, converted from the daemon's cents to the USD the screens present.
   *
   * `warshad` owns money in cents (`crates/warshad/src/lib.rs:1045-1050`: `budget_cents` and
   * `remaining_cents` are `Option`s) and `BudgetStatus` has always declared dollars, so the
   * unit change happens here, at the client edge, and nowhere else — a second daemon read in
   * USD would fork one fact into two units.
   *
   * A `null` ceiling reads as `0`, which is what every screen already treats as "no budget
   * row" (`ProjectsBoard.tsx` hides its bar at `totalBudgetUsd > 0`); it is not a claim that
   * the run spent nothing. `spent_cents` is never `null` on the wire, so a non-number there is
   * a malformed answer and named as one.
   */
  async getProjectBudget(projectId: ProjectId): Promise<BudgetStatus> {
    const wire = await this.rpc<unknown>('budget.show', { projectId });
    if (typeof wire !== 'object' || wire === null || Array.isArray(wire)) {
      throw new Error(`${WIRING_RESULT_ERROR} from budget.show: expected an object`);
    }
    const source = wire as Record<string, unknown>;
    return {
      totalBudgetUsd: centsToUsd(source['budget_cents'], 'budget_cents'),
      spentUsd: centsToUsd(source['spent_cents'], 'spent_cents'),
      remainingUsd: centsToUsd(source['remaining_cents'], 'remaining_cents'),
    };
  }

  async setProjectBudget(projectId: ProjectId, cents: number): Promise<void> {
    return this.rpc('budget.set', { projectId, cents });
  }

  // Roles.
  //
  // `roles.list` answers the daemon's routing table — one `RoleRoutingConfig` per role the
  // owner routed — and `roles.set(config)` takes the whole config as its one argument, so
  // the params are named `config` and not spread. A routing is the owner's decision about
  // which configured provider answers a role, and `roles.set` refuses a role the pipeline
  // does not know, a target with no provider or no model, and a provider that was never
  // configured; what it accepts is what the next call reaches, and what the daemon after a
  // restart reads back.
  async listRoleRoutings(): Promise<RoleRouting[]> {
    return this.rpc<RoleRouting[]>('roles.list');
  }

  /**
   * The roles that have a routing, as this client's `Role` names.
   *
   * Derived from the routing table rather than asked for on its own, because that is what
   * the daemon reports: a role with no routing is a role nothing answers.
   */
  async listRoles(): Promise<Role[]> {
    const routings = await this.listRoleRoutings();
    return routings.map((routing) => routing.role);
  }

  /** One role's routing, or a refusal naming the role when nothing routes it. */
  async getRoleConfig(role: Role): Promise<RoleRoutingConfig> {
    const routings = await this.listRoleRoutings();
    const routing = routings.find((candidate) => candidate.role === role);
    if (routing === undefined) {
      throw new Error(`no routing is set for role ${role}`);
    }
    const { budget_cents_per_run: budgetCentsPerRun, ...rest } = routing;
    return { ...rest, budget_cents_per_run: budgetCentsPerRun ?? 0 };
  }

  async setRoleConfig(config: RoleRoutingConfig): Promise<void> {
    await this.rpc<unknown>('roles.set', {
      config: {
        role: config.role,
        targets: config.targets,
        fallback_enabled: config.fallback_enabled,
        budget_cents_per_run: config.budget_cents_per_run,
      },
    });
  }

  // There is no `roles.assign`: a role is a pipeline concern and a device's role is decided by
  // the credential it presents (audit H-04), not by an assignment call. `roles.set` above is
  // routing config — which provider answers a role — and aliasing the two would re-open an
  // authority bug, so the method was deleted rather than renamed (DECISIONS.md 2026-11-03).

  // Agent (PLAN.md M18, C2).
  //
  // Three methods, and they are the whole of what an owner can do to the daemon's agent
  // from a screen: ask a turn, approve the mode that edits, and go back to the mode that
  // does not. There is no approver parameter on any of them, by the same rule the gates
  // follow: the daemon records the device its session authenticated as.
  async agentTurn(input: string): Promise<AgentTurn> {
    return this.rpc<AgentTurn>('agent.turn', { input });
  }

  async approveAgentMode(): Promise<AgentModeTransition> {
    return this.rpc<AgentModeTransition>('agent.approve_mode');
  }

  async returnAgentToPlanMode(): Promise<AgentModeTransition> {
    return this.rpc<AgentModeTransition>('agent.plan_mode');
  }

  /** The mode, the approval history and the todos — including after a restart. */
  async agentState(): Promise<AgentState> {
    return this.rpc<AgentState>('agent.state');
  }

  // Devices (pairing)
  async listDevices(): Promise<DeviceSummary[]> {
    return this.rpc('devices.list');
  }

  /**
   * `devices.pair-start` — mints a one-time pairing credential and returns the pairing
   * offer containing the QR plate, link, and origin. Requires Owner token.
   */
  async startPairing(): Promise<PairingOffer> {
    return this.rpc('devices.pair-start');
  }

  /**
   * `devices.pair` — the parameter is the daemon's whole `PairingData` struct, not text about it.
   *
   * Measured against a running `warshad` (#54, then #58): `{ qrData }` answered `-32602 "missing
   * field 'pairing_data'"`; after the key was fixed, the string value answered `-32602 "invalid
   * type: string …, expected struct PairingData"`, because `crates/warshad/src/lib.rs:781` binds
   * `warsha_remote::PairingData` (`crates/warsha-remote/src/lib.rs:112-118`) as a struct. The struct
   * carries everything the QR string did and nothing is left behind: `to_qr_code`
   * (`crates/warsha-remote/src/lib.rs:156`) encodes exactly `serde_json::to_vec(self)` into the
   * plate, so `pairingDataFromQrPayload` reads the QR text back into this shape and the wire sends
   * the object the daemon binds. Pinned against a live daemon by
   * `crates/warshad/tests/devices_pair.rs`; the e2e stub in `apps/desktop/e2e/harness.ts` answers
   * the struct and still refuses the string in serde's shape.
   *
   * The daemon returns `()` — hence `void`. The old `DeviceSummary` result was a shape no live
   * daemon ever answered (`pair_device` maps to `Ok(())`, `crates/warshad/src/lib.rs:1760-1779`);
   * the paired device shows up on the next `devices.list` read instead.
   */
  async pairDevice(pairingData: PairingData): Promise<void> {
    await this.rpc<unknown>('devices.pair', { pairing_data: pairingData });
  }

  /**
   * `devices.revoke` — the daemon's name for un-pairing a device; the params are the same one
   * `device_id` it always took. The TS method stays `removeDevice` so `Devices.tsx` and its
   * tests read the same call they always did (DECISIONS.md 2026-11-03).
   */
  async removeDevice(deviceId: DeviceId): Promise<void> {
    await this.rpc<unknown>('devices.revoke', { deviceId });
  }

  // Health
  async health(): Promise<{ status: string; version: string }> {
    return this.rpc('health');
  }

  // Wiring (PLAN.md M20): backend kit export, continue-on-server handoff, and the
  // read half of post-launch care. Parameter names are snake_case because that is
  // what `warshad`'s jsonrpsee params deserialize; every result is checked before
  // it reaches a caller, so a wrong shape is a named error and not `undefined`
  // rendered by a screen.
  async exportBackend(runId: RunId, outputDir: string): Promise<string> {
    const result = await this.rpc<unknown>(BACKEND_EXPORT_METHOD, {
      run_id: runId,
      output_dir: outputDir,
    });
    return wiringPath(result, BACKEND_EXPORT_METHOD);
  }

  async createHandoff(
    runId: RunId,
    files: ReadonlyArray<readonly [string, string]>
  ): Promise<string> {
    const result = await this.rpc<unknown>(HANDOFF_CREATE_METHOD, { run_id: runId, files });
    return wiringPath(result, HANDOFF_CREATE_METHOD);
  }

  async applyHandoff(path: string, ownerWins: boolean): Promise<HandoffApplySummary> {
    const result = await this.rpc<unknown>(HANDOFF_APPLY_METHOD, {
      path,
      owner_wins: ownerWins,
    });
    return parseHandoffApplySummary(wiringString(result, HANDOFF_APPLY_METHOD, 'summary'));
  }

  async listCrashReports(runId?: RunId): Promise<CrashReport[]> {
    // A blank run id is the daemon's "every report" (the crash screen's unselected state).
    const result = await this.rpc<unknown>(POSTLAUNCH_CRASHES_METHOD, { run_id: runId ?? '' });
    return wiringArray(result, POSTLAUNCH_CRASHES_METHOD, 'crashes').map(parseCrashReport);
  }

  async listStoreReviews(store?: string): Promise<StoreReview[]> {
    // A blank store is the daemon's "every store".
    const result = await this.rpc<unknown>(POSTLAUNCH_REVIEWS_METHOD, { store: store ?? '' });
    return wiringArray(result, POSTLAUNCH_REVIEWS_METHOD, 'reviews').map(parseStoreReview);
  }
}

/** One `warsha_pipeline::CrashReport` as the daemon serialises it (snake_case). */
export interface CrashReport {
  id: string;
  run_id: string;
  message: string;
  stack_trace?: string | null;
  occurred_at: number;
  sent: boolean;
}

/** One `warsha_pipeline::StoreReview` as the daemon serialises it (snake_case). */
export interface StoreReview {
  id: string;
  store: string;
  rating: number;
  body: string;
  author: string;
  received_at: number;
}

/** One entry of `warsha_pipeline::Conflict`, in the `handoff.apply` summary. */
export interface HandoffConflict {
  path: string;
  local_checksum: string;
  remote_checksum: string;
}

/**
 * What `handoff.apply` decides, as `warsha_pipeline::ApplyResult` serialises it.
 * `applied` is what would be written, `backups` what must survive the write, and
 * `resolved` the conflicts owner-wins settled; anything left in `conflicts`
 * without a `resolved` entry needs a gate. `backup_dir` names where the copies
 * went and is absent when nothing was backed up (and on a dry run).
 */
export interface HandoffApplySummary {
  applied: string[];
  conflicts: HandoffConflict[];
  backups: string[];
  resolved: string[];
  backup_dir?: string;
}

/**
 * Signatures for the daemon wiring batch (PLAN.md M20): backend kit export,
 * continue-on-server handoff and the read half of post-launch care.
 *
 * `WarshaClient` implements this interface, so a screen written against these
 * five methods calls the daemon's own RPC names (`backend.export`,
 * `handoff.create`, `handoff.apply`, `postlaunch.crashes`,
 * `postlaunch.reviews`) without knowing the wire shape.
 */
export interface WarshaWiringApi {
  /** `backend.export` — write `schema.sql` into `outputDir`; resolves to its path. */
  exportBackend(runId: RunId, outputDir: string): Promise<string>;

  /** `handoff.create` — write the bundle under the daemon's data dir; resolves to its JSON path. */
  createHandoff(runId: RunId, files: ReadonlyArray<readonly [string, string]>): Promise<string>;

  /** `handoff.apply` — read the bundle at `path` and apply it, returning the decoded summary. */
  applyHandoff(path: string, ownerWins: boolean): Promise<HandoffApplySummary>;

  /** `postlaunch.crashes` — crash reports for `runId`, or every report when it is omitted. */
  listCrashReports(runId?: RunId): Promise<CrashReport[]>;

  /** `postlaunch.reviews` — store reviews, optionally of one `store`. */
  listStoreReviews(store?: string): Promise<StoreReview[]>;
}

const BACKEND_EXPORT_METHOD = 'backend.export';
const HANDOFF_CREATE_METHOD = 'handoff.create';
const HANDOFF_APPLY_METHOD = 'handoff.apply';
const POSTLAUNCH_CRASHES_METHOD = 'postlaunch.crashes';
const POSTLAUNCH_REVIEWS_METHOD = 'postlaunch.reviews';

const WIRING_RESULT_ERROR = 'Malformed RPC result';

function wiringObject(value: unknown, method: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${WIRING_RESULT_ERROR} from ${method}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function wiringArray(value: unknown, method: string, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "${name}" is not a list`);
  }
  return value as unknown[];
}

function wiringString(value: unknown, method: string, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "${name}" is not a string`);
  }
  return value;
}

function wiringNumber(value: unknown, method: string, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "${name}" is not a number`);
  }
  return value;
}

function wiringBoolean(value: unknown, method: string, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "${name}" is not a boolean`);
  }
  return value;
}

/** A string field that serde may omit or null: absent and `null` both read as `null`. */
function wiringNullableString(value: unknown, method: string, name: string): string | null {
  if (value === null || value === undefined) return null;
  return wiringString(value, method, name);
}

/** A path the daemon reports it wrote, which is never blank. */
function wiringPath(value: unknown, method: string): string {
  const path = wiringString(value, method, 'path');
  if (path.length === 0) {
    throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "path" is blank`);
  }
  return path;
}

function wiringStringList(value: unknown, method: string, name: string): string[] {
  return wiringArray(value, method, name).map((entry) => wiringString(entry, method, name));
}

function parseHandoffConflict(value: unknown): HandoffConflict {
  const source = wiringObject(value, HANDOFF_APPLY_METHOD);
  return {
    path: wiringString(source['path'], HANDOFF_APPLY_METHOD, 'path'),
    local_checksum: wiringString(source['local_checksum'], HANDOFF_APPLY_METHOD, 'local_checksum'),
    remote_checksum: wiringString(
      source['remote_checksum'],
      HANDOFF_APPLY_METHOD,
      'remote_checksum'
    ),
  };
}

function parseCrashReport(value: unknown): CrashReport {
  const source = wiringObject(value, POSTLAUNCH_CRASHES_METHOD);
  return {
    id: wiringString(source['id'], POSTLAUNCH_CRASHES_METHOD, 'id'),
    run_id: wiringString(source['run_id'], POSTLAUNCH_CRASHES_METHOD, 'run_id'),
    message: wiringString(source['message'], POSTLAUNCH_CRASHES_METHOD, 'message'),
    stack_trace: wiringNullableString(
      source['stack_trace'],
      POSTLAUNCH_CRASHES_METHOD,
      'stack_trace'
    ),
    occurred_at: wiringNumber(source['occurred_at'], POSTLAUNCH_CRASHES_METHOD, 'occurred_at'),
    sent: wiringBoolean(source['sent'], POSTLAUNCH_CRASHES_METHOD, 'sent'),
  };
}

function parseStoreReview(value: unknown): StoreReview {
  const source = wiringObject(value, POSTLAUNCH_REVIEWS_METHOD);
  return {
    id: wiringString(source['id'], POSTLAUNCH_REVIEWS_METHOD, 'id'),
    store: wiringString(source['store'], POSTLAUNCH_REVIEWS_METHOD, 'store'),
    rating: wiringNumber(source['rating'], POSTLAUNCH_REVIEWS_METHOD, 'rating'),
    body: wiringString(source['body'], POSTLAUNCH_REVIEWS_METHOD, 'body'),
    author: wiringString(source['author'], POSTLAUNCH_REVIEWS_METHOD, 'author'),
    received_at: wiringNumber(source['received_at'], POSTLAUNCH_REVIEWS_METHOD, 'received_at'),
  };
}

/**
 * Decode the JSON string `handoff.apply` returns into a `HandoffApplySummary`.
 * `backup_dir` is optional (a dry run, or an apply that overwrote nothing).
 * Throws an `Error` naming the method and field that did not match.
 */
export function parseHandoffApplySummary(json: string): HandoffApplySummary {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new Error(`${WIRING_RESULT_ERROR} from ${HANDOFF_APPLY_METHOD}: not valid JSON`);
  }
  const source = wiringObject(decoded, HANDOFF_APPLY_METHOD);
  const summary: HandoffApplySummary = {
    applied: wiringStringList(source['applied'], HANDOFF_APPLY_METHOD, 'applied'),
    conflicts: wiringArray(source['conflicts'], HANDOFF_APPLY_METHOD, 'conflicts').map(
      parseHandoffConflict
    ),
    backups: wiringStringList(source['backups'], HANDOFF_APPLY_METHOD, 'backups'),
    resolved: wiringStringList(source['resolved'], HANDOFF_APPLY_METHOD, 'resolved'),
  };
  const backupDir = wiringNullableString(source['backup_dir'], HANDOFF_APPLY_METHOD, 'backup_dir');
  if (backupDir !== null) summary.backup_dir = backupDir;
  return summary;
}

/** Handle returned by `subscribeEvents`; `close()` is idempotent. */
export interface EventSubscription {
  close(): void;
}

export interface SubscribeEventsOptions {
  /**
   * Base URL of the daemon, e.g. `ws://127.0.0.1:8765` — the endpoint `/events` is
   * really served on, not the RPC base. An `http(s)` URL is rewritten to `ws(s)` here
   * (see `eventEndpoint`); the `/events` path is appended if it is not already there.
   */
  url: string;
  /**
   * Daemon auth token. It is sent on the handshake as the `warsha.token.<token>`
   * subprotocol — never in the URL, which a proxy, a browser history entry and a
   * `Referer` would all log — and the daemon answers the handshake by selecting
   * `warsha.events.v1`, not this entry.
   */
  token: string;
  onEvent: (event: WarshaEvent) => void;
  onError?: (error: Error) => void;
}

/**
 * Stream `warsha_core::Event` values from the daemon's `/events` WebSocket endpoint.
 *
 * The handshake offers two subprotocols, in this order: `warsha.events.v1` — the name the
 * daemon selects back, which is what stops a spec-checking client from treating an
 * accepted socket as failed — and `warsha.token.<token>`, the credential the daemon
 * authenticates with. The token never goes in the URL, and never comes back.
 * Connection and frame errors go to `onError`; nothing is thrown asynchronously.
 * No automatic reconnect in M1 — a dropped stream stays closed.
 */
export function subscribeEvents(options: SubscribeEventsOptions): EventSubscription {
  const { url, token, onEvent, onError } = options;

  const reportError = (error: Error): void => {
    try {
      onError?.(new Error(redactToken(error.message, token)));
    } catch {
      // A throwing onError callback must not escape the socket handler.
    }
  };

  const inert: EventSubscription = {
    close: () => {
      // Nothing was opened, so there is nothing to close.
    },
  };

  if (token.length === 0) {
    reportError(new Error('Missing daemon auth token for the event stream'));
    return inert;
  }

  const endpoint = eventEndpoint(url);

  const socket = ((): WebSocket | null => {
    const WebSocketCtor = globalThis.WebSocket;
    if (typeof WebSocketCtor !== 'function') {
      reportError(new Error('WebSocket is not available in this environment'));
      return null;
    }
    try {
      return new WebSocketCtor(endpoint, [
        EVENTS_SUBPROTOCOL,
        `${TOKEN_SUBPROTOCOL_PREFIX}${token}`,
      ]);
    } catch (cause) {
      reportError(
        new Error(redactToken(`Could not open event stream: ${describeCause(cause)}`, token))
      );
      return null;
    }
  })();

  if (socket === null) return inert;

  let closed = false;

  socket.onmessage = (event: MessageEvent<unknown>): void => {
    if (closed) return;
    const data = event.data;
    if (typeof data !== 'string') {
      reportError(new Error(`${EVENT_FRAME_ERROR}: expected a JSON text frame`));
      return;
    }
    let parsed: WarshaEvent;
    try {
      parsed = parseWarshaEvent(data);
    } catch (cause) {
      reportError(new Error(redactToken(describeCause(cause), token)));
      return;
    }
    try {
      onEvent(parsed);
    } catch (cause) {
      reportError(new Error(redactToken(`Event handler failed: ${describeCause(cause)}`, token)));
    }
  };

  socket.onerror = (): void => {
    if (closed) return;
    reportError(new Error('Event stream connection error'));
  };

  socket.onclose = (event: CloseEvent): void => {
    if (closed) return;
    if (!event.wasClean) {
      reportError(new Error(`Event stream closed unexpectedly (code ${event.code})`));
    }
  };

  return {
    close: (): void => {
      if (closed) return;
      closed = true;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Closing an already-detached socket is harmless.
      }
    },
  };
}

export function createClient(baseUrl: string, token: string): WarshaClient {
  return new WarshaClient(baseUrl, token);
}
