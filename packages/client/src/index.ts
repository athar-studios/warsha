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
  lastSeen?: string;
  revoked?: boolean;
}

const SUMMARY_ERROR = 'Malformed summary';

/** The object half of a summary decode: anything but a JSON object is refused by name. */
function summaryObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${SUMMARY_ERROR}: "${name}" is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** A summary string field: non-strings read as absent so the caller picks the fallback. */
function summaryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The one required identifier of a summary row; the refusal names the field, never the value. */
function summaryId(value: unknown, name: string): string {
  const text = summaryString(value);
  if (text === undefined || text.length === 0) {
    throw new Error(`${SUMMARY_ERROR}: "${name}" is missing "id"`);
  }
  return text;
}

/**
 * One `warsha_core::Project` (snake_case, as `projects.list`/`projects.get`/`projects.create`
 * serialise it) into the camelCase `ProjectSummary` the screens declare.
 *
 * The daemon's `DateTime<Utc>` is an RFC 3339 string, so `created_at`/`updated_at` pass through
 * unchanged in value and only change name. A camelCase wire (the e2e harness, older stubs) decodes
 * too: every read accepts both spellings. A missing timestamp decodes to `''` — the desktop's safe
 * formatters render that as the em-dash fallback rather than throwing `RangeError: Invalid time value`.
 */
export function decodeProjectSummary(source: unknown): ProjectSummary {
  const record = summaryObject(source, 'project');
  const createdAt = summaryString(field(record, 'created_at', 'createdAt')) ?? '';
  return {
    id: summaryId(field(record, 'id'), 'project') as ProjectId,
    name: summaryString(field(record, 'name')) ?? '',
    createdAt,
    updatedAt: summaryString(field(record, 'updated_at', 'updatedAt')) ?? createdAt,
  };
}

/**
 * One `warsha_core::Run` (snake_case, as `runs.list`/`runs.get`/`runs.start`/`runs.advance`/
 * `runs.cancel`/`runs.followup` serialise it) into the camelCase `RunSummary`.
 *
 * `current_stage` becomes `stage`, `project_id` becomes `projectId` and `created_at` (or the
 * harness's `started_at`) becomes `startedAt`. `status` is `RunStatus` as the daemon's snake_case
 * string; a tagged or non-string answer is folded to its `state` word or its `String()` form, so
 * a screen never calls `.startsWith` on an object. A missing stage decodes to `''` — never
 * `undefined`, which is what made `InstrumentStrip` throw and black the desktop.
 */
export function decodeRunSummary(source: unknown): RunSummary {
  const record = summaryObject(source, 'run');
  const stage = summaryString(field(record, 'current_stage', 'currentStage', 'stage')) ?? '';
  const statusValue = field(record, 'status');
  let status = '';
  if (typeof statusValue === 'string') {
    status = statusValue;
  } else if (typeof statusValue === 'object' && statusValue !== null) {
    // A tagged enum (`{ "state": "awaiting_gate", … }`): the tag word is the status.
    const tagged = statusValue as Record<string, unknown>;
    status = summaryString(field(tagged, 'state', 'variant', 'type')) ?? JSON.stringify(tagged);
  } else if (statusValue !== undefined && statusValue !== null) {
    status = String(statusValue);
  }
  const startedAt =
    summaryString(field(record, 'created_at', 'createdAt', 'started_at', 'startedAt')) ?? '';
  return {
    id: summaryId(field(record, 'id'), 'run') as RunId,
    projectId: (summaryString(field(record, 'project_id', 'projectId')) ?? '') as ProjectId,
    stage: stage as Stage,
    status,
    startedAt,
    updatedAt: summaryString(field(record, 'updated_at', 'updatedAt')) ?? startedAt,
  };
}

/**
 * One `warsha_remote::DeviceIdentity` (snake_case, as `devices.list` serialises it) into the
 * camelCase `DeviceSummary`.
 *
 * The daemon's device row carries `device_id` and `created_at`, and `last_seen` only where the
 * daemon tracked a recent connection — so `lastSeen` falls back to `pairedAt`, and to the current
 * time when neither was reported, which reads `offline` on the ledger rather than crashing the
 * `reachability()` age arithmetic on `Invalid Date`.
 */
export function decodeDeviceSummary(source: unknown): DeviceSummary {
  const record = summaryObject(source, 'device');
  const pairedAt = summaryString(field(record, 'created_at', 'createdAt', 'pairedAt', 'paired_at')) ?? '';
  const lastSeen = summaryString(field(record, 'last_seen', 'lastSeen'));
  const rawRevoked = field(record, 'revoked', 'revoked_at');
  return {
    id: summaryId(field(record, 'device_id', 'id'), 'device') as DeviceId,
    name: summaryString(field(record, 'name')) ?? '',
    pairedAt,
    ...(lastSeen !== undefined ? { lastSeen } : {}),
    revoked: Boolean(rawRevoked),
  };
}

/** A `projects.*`/`runs.*`/`devices.*` list result, decoded row by row. */
function summaryList<T>(value: unknown, name: string, decode: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${SUMMARY_ERROR}: "${name}" is not a list`);
  }
  return value.map((row) => decode(row));
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
  /**
   * Daemon-wide sequence number from `warshad::SequencedEventFrame`, present only
   * when the frame carried one. Bare `Event` rows (older daemons, `runs.events`)
   * decode without it.
   */
  seq?: number;
  /** True when this frame announces that `droppedCount` frames went past unseen. */
  gapDetected?: boolean;
  /** Frames lost between the last seen `seq` and this frame (gap frames only). */
  droppedCount?: number;
  /** True when the daemon cannot resume from the client's cursor; rebuild from `runs.events`. */
  resyncRequired?: boolean;
}

/**
 * `warshad::SequencedEventFrame` — one [`WarshaEvent`] plus the daemon-wide
 * sequence metadata. Re-exported here as a named alias so callers can type the
 * sequence fields explicitly; a decoded frame is a `WarshaEvent` whose optional
 * `seq`/`gapDetected`/`droppedCount`/`resyncRequired` fields are populated.
 */
export interface SequencedEventFrame extends WarshaEvent {
  seq: number;
}

/**
 * `warshad::RunStreamSync` — the answer to `runs.subscribe`: where the daemon's
 * stream is (`seq`), whether a gap or a full resync is owed (`gap_detected`,
 * `resync_required`, `dropped_count`), the run the caller named (`run`, raw as
 * the daemon returned it, or null), and the buffered scrubbed frames after the
 * cursor in exact order (`events`).
 */
export interface RunStreamSync {
  seq: number;
  gap_detected: boolean;
  resync_required: boolean;
  dropped_count: number;
  run: unknown | null;
  events: WarshaEvent[];
}

/**
 * `warsha_core::Artifact` as `runs.artifacts` returns it — snake_case on the
 * wire, one versioned document a pipeline stage produced for the run.
 */
export interface RunArtifact {
  name: string;
  content: string;
  stage: Stage;
  role: Role | null;
  created_at: string;
  updated_at: string;
  version: number;
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

/** A sequence flag off a `SequencedEventFrame`: absent/null is false, wrong types throw. */
function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${EVENT_FRAME_ERROR}: invalid "${name}"`);
  }
  return value;
}

/** A sequence number off a `SequencedEventFrame`: absent/null is unset, wrong types throw. */
function optionalSequence(value: unknown, name: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${EVENT_FRAME_ERROR}: invalid "${name}"`);
  }
  return value;
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

  // Sequence metadata is only on `SequencedEventFrame`s (the `/events` wire and
  // `runs.subscribe`); a bare `Event` row decodes with these left unset.
  const seq = optionalSequence(field(source, 'seq'), 'seq');
  const gapDetected = optionalBoolean(
    field(source, 'gap_detected', 'gapDetected'),
    'gap_detected'
  );
  const droppedCount = optionalSequence(
    field(source, 'dropped_count', 'droppedCount'),
    'dropped_count'
  );
  const resyncRequired = optionalBoolean(
    field(source, 'resync_required', 'resyncRequired'),
    'resync_required'
  );

  const event: WarshaEvent = {
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
  if (seq !== undefined) event.seq = seq;
  if (gapDetected !== undefined) event.gapDetected = gapDetected;
  if (droppedCount !== undefined) event.droppedCount = droppedCount;
  if (resyncRequired !== undefined) event.resyncRequired = resyncRequired;
  return event;
}

const SUBSCRIBE_SYNC_ERROR = 'Malformed runs.subscribe response';

/**
 * Decode `warshad::RunStreamSync` from the `runs.subscribe` wire JSON.
 *
 * The `run` field is the daemon's own `Run` shape and is carried through raw (or
 * null): `runs.subscribe` exists to synchronise the *stream*, and a caller that
 * wants the run reads it with `getRun`. Each `events` entry is a flattened
 * `SequencedEventFrame`, so the same `decodeWarshaEvent` reads it — including
 * its sequence metadata.
 */
function decodeRunStreamSync(value: unknown): RunStreamSync {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${SUBSCRIBE_SYNC_ERROR}: expected a JSON object`);
  }
  const source = value as Record<string, unknown>;
  const seq = source['seq'];
  if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0) {
    throw new Error(`${SUBSCRIBE_SYNC_ERROR}: invalid "seq"`);
  }
  const flag = (name: string): boolean => {
    const v = source[name];
    if (typeof v !== 'boolean') throw new Error(`${SUBSCRIBE_SYNC_ERROR}: invalid "${name}"`);
    return v;
  };
  const droppedCount = source['dropped_count'];
  if (
    typeof droppedCount !== 'number' ||
    !Number.isFinite(droppedCount) ||
    droppedCount < 0
  ) {
    throw new Error(`${SUBSCRIBE_SYNC_ERROR}: invalid "dropped_count"`);
  }
  const run = source['run'];
  const eventsValue = source['events'];
  if (!Array.isArray(eventsValue)) {
    throw new Error(`${SUBSCRIBE_SYNC_ERROR}: invalid "events"`);
  }
  const events = eventsValue.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${SUBSCRIBE_SYNC_ERROR}: "events" entry is not an object`);
    }
    return decodeWarshaEvent(item as Record<string, unknown>);
  });
  return {
    seq,
    gap_detected: flag('gap_detected'),
    resync_required: flag('resync_required'),
    dropped_count: droppedCount,
    run: run === null || run === undefined ? null : run,
    events,
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
function eventEndpoint(
  url: string,
  cursor?: { sinceSeq?: number; runId?: RunId }
): string {
  const socketUrl = url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const trimmed = socketUrl.replace(/\/+$/, '');
  const base = trimmed.endsWith('/events') ? trimmed : `${trimmed}/events`;
  const query: string[] = [];
  if (cursor?.sinceSeq !== undefined) {
    query.push(`since_seq=${encodeURIComponent(String(cursor.sinceSeq))}`);
  }
  if (cursor?.runId !== undefined) {
    query.push(`run_id=${encodeURIComponent(String(cursor.runId))}`);
  }
  return query.length === 0 ? base : `${base}?${query.join('&')}`;
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

// ---------------------------------------------------------------------------
// Wave 2: harnesses, skills, plugins, custom models, integrations, files.
//
// These are the camelCase shapes the screens will read, and the decoders that
// put the daemon's snake_case rows (`harness.*`, `skills.*`, `plugins.*`,
// `models.*`, `integrations.*`, `files.*` — serde's default field names on the
// Rust side) into them. Every read accepts both spellings, the same way
// `decodeProjectSummary` does: a live daemon (snake_case) and the e2e harness or
// an older stub (camelCase) decode alike, and a missing field falls back to the
// empty/zero form a screen can render rather than an `undefined` that throws.
//
// The Wave 2 client lane (PLAN.md task #9) landed ahead of its daemon lane (tasks #6–#8);
// those daemon lanes have since registered every wire name these methods dial, so
// `scripts/check-wire-contract.mjs` checks them strictly against an empty
// `KNOWN_UNREGISTERED_METHODS` — no deferral — and W9 holds every name to an e2e harness stub.

const WAVE2_ERROR = 'Malformed Wave 2 payload';

/** The object half of a Wave 2 decode: anything but a JSON object is refused by name. */
function wave2Object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${WAVE2_ERROR}: "${name}" is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** A Wave 2 string field in either spelling; non-strings read as the empty string. */
function wave2String(source: Record<string, unknown>, ...names: string[]): string {
  const value = field(source, ...names);
  return typeof value === 'string' ? value : '';
}

/** A Wave 2 finite number field; anything else reads as the fallback. */
function wave2Number(
  source: Record<string, unknown>,
  fallback: number,
  ...names: string[]
): number {
  const value = field(source, ...names);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A Wave 2 boolean field; anything else reads as the fallback. */
function wave2Boolean(
  source: Record<string, unknown>,
  fallback: boolean,
  ...names: string[]
): boolean {
  const value = field(source, ...names);
  return typeof value === 'boolean' ? value : fallback;
}

/** A Wave 2 list of strings; a missing or malformed list decodes to the empty list. */
function wave2StringList(source: Record<string, unknown>, ...names: string[]): string[] {
  const value = field(source, ...names);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** A Wave 2 list result, decoded row by row. */
function wave2List<T>(value: unknown, name: string, decode: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${WAVE2_ERROR}: "${name}" is not a list`);
  }
  return value.map((row) => decode(row));
}

/** The one identifier a Wave 2 row must carry; the refusal names the field, never the value. */
function wave2Id(source: Record<string, unknown>, name: string): string {
  const value = field(source, 'id');
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${WAVE2_ERROR}: "${name}" is missing "id"`);
  }
  return value;
}

/**
 * A Rust `Option<String>`: absent and `null` both read as `null` — "not
 * declared" stays distinguishable from `''`, the way `RoleRouting` keeps its
 * `budget_cents_per_run: number | null`.
 */
function wave2NullableString(source: Record<string, unknown>, ...names: string[]): string | null {
  const value = field(source, ...names);
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : null;
}

/** A Rust `Option` number: absent and `null` both read as `null` ("no ceiling"). */
function wave2NullableNumber(source: Record<string, unknown>, ...names: string[]): number | null {
  const value = field(source, ...names);
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A `HashMap<String, String>` field; anything but an object of strings reads as empty. */
function wave2StringRecord(
  source: Record<string, unknown>,
  ...names: string[]
): Record<string, string> {
  const value = field(source, ...names);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

/**
 * One stage inside a harness (`warsha_core::HarnessStage`): the role that runs it,
 * an optional prompt template, and the optional gate that must be approved to
 * leave it. `gate` is a gate identifier string or null — not a boolean.
 */
export interface HarnessStage {
  id: string;
  role: Role;
  name: string;
  promptTemplate: string | null;
  gate: string | null;
  autoAdvance: boolean;
}

/** Run-wide rules a harness enforces (`warsha_core::HarnessRules`). */
export interface HarnessRules {
  maxRepairIterations: number;
  /** Hard spending limit in cents; `null` means uncapped. */
  budgetCapCents: number | null;
  allowParallelSubagents: boolean;
  requireVerificationReceipt: boolean;
}

/**
 * One declarative pipeline harness (`warsha_core::HarnessDefinition`, snake_case
 * on the wire). `preset` is true for the pre-bundled software-factory flows and
 * false for user-authored harnesses; there is no `updated_at` on the Rust struct.
 */
export interface HarnessDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  stages: HarnessStage[];
  rules: HarnessRules;
  preset: boolean;
  active: boolean;
  createdAt: string;
}

/**
 * One installable markdown skill pack (`warsha_core::SkillDefinition`).
 * `skills.list` answers the installed `SkillDefinition` catalog today; the decoder
 * still tolerates the daemon's older `SlashCommand` row — `{ name, description }`
 * with no `id` — so the id falls back to the command name rather than refusing a
 * shape an older daemon really sent.
 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  source: string;
  license: string;
  /** The full markdown prompt body. */
  content: string;
  enabled: boolean;
  tags: string[];
}

/** One tool an MCP plugin exposes (`warsha_core::PluginToolDefinition`). */
export interface PluginToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the parameters, as a string, when published. */
  parametersJson: string | null;
}

/**
 * One MCP plugin pack (`warsha_core::PluginDefinition`). `env` values are
 * *references* to secrets (`${env:GITHUB_TOKEN}` style), never secret material
 * itself — the Rust struct says so, and the keychain rule holds.
 */
export interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  /** `stdio` or `http`. */
  transport: string;
  /** Executable for stdio transports; null for HTTP packs. */
  command: string | null;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  tools: PluginToolDefinition[];
  source: string;
}

/** A user-registered model on a known provider (`warsha_core::CustomModelRecord`). */
export interface CustomModelRecord {
  provider: string;
  modelId: string;
  /** Display label; null when the owner declared none (screens fall back to `modelId`). */
  displayName: string | null;
  /** Context window in tokens; null when undeclared. */
  contextWindow: number | null;
  enabled: boolean;
}

/** The status of one external integration (`warsha_core::IntegrationStatus`). */
export interface IntegrationStatus {
  id: string;
  name: string;
  connected: boolean;
  /** When it was last configured; null when never. */
  configuredAt: string | null;
  /**
   * Whatever the integration wants to show — org name, bot identity, last sync
   * — as opaque JSON (the Rust `details: Option<serde_json::Value>`); the UI
   * renders it and nothing in between interprets it.
   */
  details: unknown;
}

/**
 * What `connectIntegration` sends (`warsha_core::IntegrationConfig`). The token
 * material rides the write once, the way `providers.add` sends its `key`, and a
 * read that returns it has already redacted it to null — the Rust doc says so
 * and the decoders here never carry a `token`/`bot_token` field at all.
 */
export interface IntegrationConfig {
  token?: string;
  webhookUrl?: string;
  botToken?: string;
  channel?: string;
  org?: string;
}

/** The outcome of a live integration test (`warsha_core::IntegrationTestResult`). */
export interface IntegrationTestResult {
  /** Coarse status: `ok`, `error`, `unconfigured`. */
  status: string;
  message: string;
}

/** One entry in a directory listing for the file browser (`warsha_core::FileEntry`). */
export interface FileEntry {
  /** Base name of the entry. */
  name: string;
  /** Full path relative to the browsing root. */
  path: string;
  isDir: boolean;
  /** Size in bytes for files; 0 for directories. */
  sizeBytes: number;
}

/** The text content of one file, for the viewer pane (`warsha_core::FileContent`). */
export interface FileContent {
  path: string;
  /** The file's text; the daemon rejects binary files before this is built. */
  content: string;
  /** Best-guess MIME type, e.g. `text/markdown`. */
  mimeType: string;
}

/** A Wave 2 `Role`; a missing or unknown role reads as the pipeline's first role. */
function wave2Role(source: Record<string, unknown>, ...names: string[]): Role {
  const value = field(source, ...names);
  return isRole(value) ? value : 'intake';
}

function decodeHarnessStage(source: unknown): HarnessStage {
  const record = wave2Object(source, 'harness stage');
  return {
    id: wave2String(record, 'id'),
    role: wave2Role(record, 'role'),
    name: wave2String(record, 'name'),
    promptTemplate: wave2NullableString(record, 'prompt_template', 'promptTemplate'),
    gate: wave2NullableString(record, 'gate'),
    autoAdvance: wave2Boolean(record, false, 'auto_advance', 'autoAdvance'),
  };
}

const EMPTY_HARNESS_RULES: HarnessRules = {
  maxRepairIterations: 0,
  budgetCapCents: null,
  allowParallelSubagents: false,
  requireVerificationReceipt: false,
};

function decodeHarnessRules(source: unknown): HarnessRules {
  const record = wave2Object(source, 'harness rules');
  return {
    maxRepairIterations: wave2Number(record, 0, 'max_repair_iterations', 'maxRepairIterations'),
    budgetCapCents: wave2NullableNumber(record, 'budget_cap_cents', 'budgetCapCents'),
    allowParallelSubagents: wave2Boolean(
      record,
      false,
      'allow_parallel_subagents',
      'allowParallelSubagents'
    ),
    requireVerificationReceipt: wave2Boolean(
      record,
      false,
      'require_verification_receipt',
      'requireVerificationReceipt'
    ),
  };
}

export function decodeHarnessDefinition(source: unknown): HarnessDefinition {
  const record = wave2Object(source, 'harness');
  const stagesValue = field(record, 'stages');
  const rulesValue = field(record, 'rules');
  return {
    id: wave2Id(record, 'harness'),
    version: wave2String(record, 'version'),
    name: wave2String(record, 'name'),
    description: wave2String(record, 'description'),
    stages: Array.isArray(stagesValue) ? stagesValue.map(decodeHarnessStage) : [],
    rules:
      rulesValue === undefined || rulesValue === null
        ? { ...EMPTY_HARNESS_RULES }
        : decodeHarnessRules(rulesValue),
    preset: wave2Boolean(record, false, 'preset'),
    active: wave2Boolean(record, false, 'active'),
    createdAt: wave2String(record, 'created_at', 'createdAt'),
  };
}

export function decodeSkillDefinition(source: unknown): SkillDefinition {
  const record = wave2Object(source, 'skill');
  const name = wave2String(record, 'name');
  const idValue = field(record, 'id');
  // A `SlashCommand` row carries no `id`; its command name IS its identity.
  const id = typeof idValue === 'string' && idValue.length > 0 ? idValue : name;
  if (id.length === 0) {
    throw new Error(`${WAVE2_ERROR}: "skill" is missing "id"`);
  }
  return {
    id,
    name,
    description: wave2String(record, 'description'),
    source: wave2String(record, 'source'),
    license: wave2String(record, 'license'),
    content: wave2String(record, 'content'),
    enabled: wave2Boolean(record, true, 'enabled'),
    tags: wave2StringList(record, 'tags'),
  };
}

function decodePluginTool(source: unknown): PluginToolDefinition {
  const record = wave2Object(source, 'plugin tool');
  return {
    name: wave2String(record, 'name'),
    description: wave2String(record, 'description'),
    parametersJson: wave2NullableString(record, 'parameters_json', 'parametersJson'),
  };
}

export function decodePluginDefinition(source: unknown): PluginDefinition {
  const record = wave2Object(source, 'plugin');
  const toolsValue = field(record, 'tools');
  return {
    id: wave2Id(record, 'plugin'),
    name: wave2String(record, 'name'),
    description: wave2String(record, 'description'),
    transport: wave2String(record, 'transport'),
    command: wave2NullableString(record, 'command'),
    args: wave2StringList(record, 'args'),
    // `env` values are secret *references* (`${secrets:…}`), never material —
    // carrying them as plain strings keeps the keychain rule intact on a read.
    env: wave2StringRecord(record, 'env'),
    enabled: wave2Boolean(record, false, 'enabled'),
    tools: Array.isArray(toolsValue) ? toolsValue.map(decodePluginTool) : [],
    source: wave2String(record, 'source'),
  };
}

export function decodeCustomModelRecord(source: unknown): CustomModelRecord {
  const record = wave2Object(source, 'custom model');
  const provider = wave2String(record, 'provider');
  const modelId = wave2String(record, 'model_id', 'modelId');
  if (provider.length === 0 || modelId.length === 0) {
    throw new Error(`${WAVE2_ERROR}: "custom model" is missing "provider" or "model_id"`);
  }
  return {
    provider,
    modelId,
    // Undeclared display names stay null; the screen falls back to `modelId`.
    displayName: wave2NullableString(record, 'display_name', 'displayName'),
    contextWindow: wave2NullableNumber(record, 'context_window', 'contextWindow'),
    enabled: wave2Boolean(record, true, 'enabled'),
  };
}

export function decodeIntegrationStatus(source: unknown): IntegrationStatus {
  const record = wave2Object(source, 'integration');
  return {
    id: wave2Id(record, 'integration'),
    name: wave2String(record, 'name'),
    connected: wave2Boolean(record, false, 'connected'),
    configuredAt: wave2NullableString(record, 'configured_at', 'configuredAt'),
    // `details` is opaque JSON the UI renders as-is; nothing here interprets it,
    // and a Wave 2 row carries no token field to leak.
    details: field(record, 'details') ?? null,
  };
}

export function decodeIntegrationTestResult(source: unknown): IntegrationTestResult {
  const record = wave2Object(source, 'integration test result');
  return {
    status: wave2String(record, 'status'),
    message: wave2String(record, 'message'),
  };
}

export function decodeFileEntry(source: unknown): FileEntry {
  const record = wave2Object(source, 'file entry');
  const entryPath = wave2String(record, 'path');
  return {
    // A tree row may name only its path: the last segment is then its display name.
    name: wave2String(record, 'name') || (entryPath.split('/').filter(Boolean).pop() ?? ''),
    path: entryPath,
    isDir: wave2Boolean(record, false, 'is_dir', 'isDir'),
    sizeBytes: wave2Number(record, 0, 'size_bytes', 'sizeBytes'),
  };
}

export function decodeFileContent(source: unknown): FileContent {
  const record = wave2Object(source, 'file content');
  return {
    path: wave2String(record, 'path'),
    content: wave2String(record, 'content'),
    mimeType: wave2String(record, 'mime_type', 'mimeType') || 'text/plain',
  };
}

/**
 * The Wave 2 surface: harnesses, skills, plugins, custom models, integrations and
 * the project file browser. `WarshaClient` implements this interface so a screen
 * written against these names calls the daemon's RPC without knowing the wire
 * shape, exactly as `WarshaWiringApi` does for the M20 batch.
 */
export interface WarshaWave2Api {
  listHarnesses(): Promise<HarnessDefinition[]>;
  getHarness(id: string): Promise<HarnessDefinition>;
  importHarness(content: string, format?: string): Promise<HarnessDefinition>;
  selectHarness(harnessId: string, projectId?: string): Promise<void>;
  deleteHarness(id: string): Promise<void>;

  listSkills(): Promise<SkillDefinition[]>;
  importSkill(urlOrContent: string, name?: string): Promise<SkillDefinition>;
  toggleSkill(id: string, enabled: boolean): Promise<SkillDefinition>;
  deleteSkill(id: string): Promise<void>;

  listPlugins(): Promise<PluginDefinition[]>;
  installPlugin(manifestJsonOrUrl: string): Promise<PluginDefinition>;
  togglePlugin(id: string, enabled: boolean): Promise<PluginDefinition>;
  configurePlugin(id: string, env: Record<string, string>): Promise<PluginDefinition>;
  removePlugin(id: string): Promise<void>;

  listCustomModels(provider?: string): Promise<CustomModelRecord[]>;
  addCustomModel(
    provider: string,
    modelId: string,
    displayName?: string,
    contextWindow?: number
  ): Promise<CustomModelRecord>;
  removeCustomModel(provider: string, modelId: string): Promise<void>;

  listIntegrations(): Promise<IntegrationStatus[]>;
  connectIntegration(id: string, config: IntegrationConfig): Promise<IntegrationStatus>;
  disconnectIntegration(id: string): Promise<IntegrationStatus>;
  testIntegration(id: string): Promise<IntegrationTestResult>;

  getFilesTree(projectId: string, path?: string): Promise<FileEntry[]>;
  readFileContent(projectId: string, path: string): Promise<FileContent>;
}

export class WarshaClient implements WarshaWiringApi, WarshaWave2Api {
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
  //
  // Every `projects.*`/`runs.*`/`devices.*` result is decoded here, at the client edge: the daemon
  // speaks snake_case (`crates/warsha-core/src/lib.rs` serialises `Project`/`Run` with serde's
  // default field names) and the screens speak the camelCase types this file declares. A screen
  // that read `run.currentStage`/`project.created_at` off the raw wire got `undefined`, and the
  // desktop's `new Date(undefined)` threw `RangeError: Invalid time value` into the render —
  // the black screen. Decoding is the only place the two shapes meet.
  async listProjects(): Promise<ProjectSummary[]> {
    const rows = await this.rpc<unknown>('projects.list');
    return summaryList(rows, 'projects.list', decodeProjectSummary);
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
    const row = await this.rpc<unknown>('projects.create', { name, description, language });
    return decodeProjectSummary(row);
  }

  async getProject(id: ProjectId): Promise<ProjectSummary> {
    const row = await this.rpc<unknown>('projects.get', { id });
    return decodeProjectSummary(row);
  }

  // Runs
  async listRuns(projectId: ProjectId): Promise<RunSummary[]> {
    const rows = await this.rpc<unknown>('runs.list', { projectId });
    return summaryList(rows, 'runs.list', decodeRunSummary);
  }

  async startRun(projectId: ProjectId, idea: string): Promise<RunSummary> {
    const row = await this.rpc<unknown>('runs.start', { projectId, idea });
    return decodeRunSummary(row);
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
    const row = await this.rpc<unknown>('runs.get', { run_id: id });
    return decodeRunSummary(row);
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

  // Run stream synchronisation and run control (WS3).
  //
  // The parameter names are the daemon's own snake_case spellings
  // (`crates/warshad/src/lib.rs`, the `runs.subscribe` … `runs.artifacts` rpc
  // trait methods): jsonrpsee binds arguments by those names, so anything else
  // is a `-32602` on the wire. `null` is the honest spelling of "not named" —
  // the daemon's `Option` parameters bind `null` and an omitted key alike, and
  // sending the key keeps the request self-describing in a log.

  /**
   * `runs.subscribe` — the RPC mirror of the `/events` reconnect: where the
   * daemon-wide stream is, whether this client's cursor owes a gap or a full
   * resync, and the buffered scrubbed frames after `sinceSeq` in exact order.
   * No run means every run; no cursor means "from the current end" (nothing
   * replayed).
   */
  async subscribeRun(runId?: RunId, sinceSeq?: number): Promise<RunStreamSync> {
    const value = await this.rpc<unknown>('runs.subscribe', {
      run_id: runId ?? null,
      since_seq: sinceSeq ?? null,
    });
    return decodeRunStreamSync(value);
  }

  /**
   * `runs.advance` — walk the run to the next gate that still needs a decision
   * (or to the terminal `Feedback` stage, which completes it). Unrouted stage
   * roles are answered by the daemon's deterministic fake provider, so this
   * works on a fresh daemon with no key and no network.
   */
  async advanceRun(runId: RunId): Promise<RunSummary> {
    const row = await this.rpc<unknown>('runs.advance', { run_id: runId });
    return decodeRunSummary(row);
  }

  /** `runs.cancel` — cancel the run and record why in its event stream. */
  async cancelRun(runId: RunId, reason?: string): Promise<RunSummary> {
    const row = await this.rpc<unknown>('runs.cancel', {
      run_id: runId,
      reason: reason ?? null,
    });
    return decodeRunSummary(row);
  }

  /** `runs.followup` — answer a follow-up prompt on the run's current stage. */
  async followupRun(runId: RunId, prompt: string): Promise<RunSummary> {
    const row = await this.rpc<unknown>('runs.followup', { run_id: runId, prompt });
    return decodeRunSummary(row);
  }

  /** `runs.artifacts` — the run's artifacts, sorted by name. */
  async getRunArtifacts(runId: RunId): Promise<RunArtifact[]> {
    return this.rpc('runs.artifacts', { run_id: runId });
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
  async testProvider(name: string, model?: string): Promise<void> {
    await this.rpc<unknown>('providers.test', { name, model: model ?? null });
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
    const rows = await this.rpc<unknown>('devices.list');
    return summaryList(rows, 'devices.list', decodeDeviceSummary);
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

  // Wave 2 — harnesses.
  //
  // The parameter names are the daemon's own snake_case spellings, per the rule the
  // M20 batch follows: jsonrpsee binds arguments by name (and its generated camelCase
  // alias), so anything else is a `-32602` on the wire. `null` is the honest spelling
  // of "not named" for the daemon's `Option` parameters.
  async listHarnesses(): Promise<HarnessDefinition[]> {
    const rows = await this.rpc<unknown>('harness.list');
    return wave2List(rows, 'harness.list', decodeHarnessDefinition);
  }

  async getHarness(id: string): Promise<HarnessDefinition> {
    const row = await this.rpc<unknown>('harness.get', { id });
    return decodeHarnessDefinition(row);
  }

  async importHarness(content: string, format?: string): Promise<HarnessDefinition> {
    const row = await this.rpc<unknown>('harness.import', { content, format: format ?? null });
    return decodeHarnessDefinition(row);
  }

  async selectHarness(harnessId: string, projectId?: string): Promise<void> {
    await this.rpc<unknown>('harness.select', {
      harness_id: harnessId,
      project_id: projectId ?? null,
    });
  }

  async deleteHarness(id: string): Promise<void> {
    await this.rpc<unknown>('harness.delete', { id });
  }

  // Wave 2 — skills. `skills.list` is daemon-registered and answers the installed
  // `SkillDefinition` catalog (`crates/warshad/src/lib.rs:1399-1400`, `list_skills`
  // returns `Vec<SkillDefinition>`); `decodeSkillDefinition` reads that row and still
  // tolerates the older `SlashCommand` shape (its `name` doubles as the id). The three
  // writes (`skills.import|toggle|delete`) are registered too — nothing is deferred.
  async listSkills(): Promise<SkillDefinition[]> {
    const rows = await this.rpc<unknown>('skills.list');
    return wave2List(rows, 'skills.list', decodeSkillDefinition);
  }

  async importSkill(urlOrContent: string, name?: string): Promise<SkillDefinition> {
    const row = await this.rpc<unknown>('skills.import', {
      url_or_content: urlOrContent,
      name: name ?? null,
    });
    return decodeSkillDefinition(row);
  }

  async toggleSkill(id: string, enabled: boolean): Promise<SkillDefinition> {
    const row = await this.rpc<unknown>('skills.toggle', { id, enabled });
    return decodeSkillDefinition(row);
  }

  async deleteSkill(id: string): Promise<void> {
    await this.rpc<unknown>('skills.delete', { id });
  }

  // Wave 2 — plugins (MCP extensions).
  async listPlugins(): Promise<PluginDefinition[]> {
    const rows = await this.rpc<unknown>('plugins.list');
    return wave2List(rows, 'plugins.list', decodePluginDefinition);
  }

  async installPlugin(manifestJsonOrUrl: string): Promise<PluginDefinition> {
    const row = await this.rpc<unknown>('plugins.install', {
      manifest_json_or_url: manifestJsonOrUrl,
    });
    return decodePluginDefinition(row);
  }

  async togglePlugin(id: string, enabled: boolean): Promise<PluginDefinition> {
    const row = await this.rpc<unknown>('plugins.toggle', { id, enabled });
    return decodePluginDefinition(row);
  }

  async configurePlugin(id: string, env: Record<string, string>): Promise<PluginDefinition> {
    const row = await this.rpc<unknown>('plugins.configure', { id, env });
    return decodePluginDefinition(row);
  }

  async removePlugin(id: string): Promise<void> {
    await this.rpc<unknown>('plugins.remove', { id });
  }

  // Wave 2 — custom models (the rows the owner registers by hand under a provider).
  async listCustomModels(provider?: string): Promise<CustomModelRecord[]> {
    const rows = await this.rpc<unknown>('models.list', { provider: provider ?? null });
    return wave2List(rows, 'models.list', decodeCustomModelRecord);
  }

  async addCustomModel(
    provider: string,
    modelId: string,
    displayName?: string,
    contextWindow?: number
  ): Promise<CustomModelRecord> {
    const row = await this.rpc<unknown>('models.add', {
      provider,
      model_id: modelId,
      display_name: displayName ?? null,
      context_window: contextWindow ?? null,
    });
    return decodeCustomModelRecord(row);
  }

  async removeCustomModel(provider: string, modelId: string): Promise<void> {
    await this.rpc<unknown>('models.remove', { provider, model_id: modelId });
  }

  // Wave 2 — integrations. The token material rides the write once, like
  // `providers.add`'s `key`, and no reply carries it back: the daemon keeps it in
  // the OS keychain, `IntegrationStatus` has no token field, and `redactToken`
  // already guards every message this client produces.
  async listIntegrations(): Promise<IntegrationStatus[]> {
    const rows = await this.rpc<unknown>('integrations.list');
    return wave2List(rows, 'integrations.list', decodeIntegrationStatus);
  }

  async connectIntegration(id: string, config: IntegrationConfig): Promise<IntegrationStatus> {
    const row = await this.rpc<unknown>('integrations.connect', {
      id,
      config: {
        token: config.token ?? null,
        webhook_url: config.webhookUrl ?? null,
        bot_token: config.botToken ?? null,
        channel: config.channel ?? null,
        org: config.org ?? null,
      },
    });
    return decodeIntegrationStatus(row);
  }

  async disconnectIntegration(id: string): Promise<IntegrationStatus> {
    const row = await this.rpc<unknown>('integrations.disconnect', { id });
    return decodeIntegrationStatus(row);
  }

  async testIntegration(id: string): Promise<IntegrationTestResult> {
    const row = await this.rpc<unknown>('integrations.test', { id });
    return decodeIntegrationTestResult(row);
  }

  // Wave 2 — the project file browser.
  async getFilesTree(projectId: string, path?: string): Promise<FileEntry[]> {
    const rows = await this.rpc<unknown>('files.tree', {
      project_id: projectId,
      path: path ?? null,
    });
    return wave2List(rows, 'files.tree', decodeFileEntry);
  }

  async readFileContent(projectId: string, path: string): Promise<FileContent> {
    const row = await this.rpc<unknown>('files.read', { project_id: projectId, path });
    return decodeFileContent(row);
  }

  // Wiring — the live records (PLAN.md M16/M19/M20): routines, the backend kit, the
  // dev-server preview, run modes and taste preferences. Parameter names are the
  // daemon's own snake_case argument names; every result is decoded strictly before it
  // reaches a caller, and the three struct writes encode back to the daemon's shape.
  async listRoutines(): Promise<Routine[]> {
    const rows = await this.rpc<unknown>('routines.list');
    return wiringList(rows, 'routines.list', decodeRoutine);
  }

  async getRoutine(id: string): Promise<Routine | null> {
    const row = await this.rpc<unknown>('routines.get', { id });
    return row === null ? null : decodeRoutine(row, 'routines.get');
  }

  async runRoutineNow(id: string): Promise<Routine> {
    const row = await this.rpc<unknown>('routines.run_now', { id });
    return decodeRoutine(row, 'routines.run_now');
  }

  async pauseRoutine(id: string): Promise<Routine> {
    const row = await this.rpc<unknown>('routines.pause', { id });
    return decodeRoutine(row, 'routines.pause');
  }

  async resumeRoutine(id: string): Promise<Routine> {
    const row = await this.rpc<unknown>('routines.resume', { id });
    return decodeRoutine(row, 'routines.resume');
  }

  async getBackendKit(runId: RunId): Promise<BackendKit | null> {
    const row = await this.rpc<unknown>('backend.get', { run_id: runId });
    return row === null ? null : decodeBackendKit(row, 'backend.get');
  }

  async setBackendKit(runId: RunId, kit: BackendKit): Promise<void> {
    await this.rpc<unknown>('backend.set', { run_id: runId, kit: encodeBackendKit(kit) });
  }

  async startPreview(projectId: string, command: string): Promise<LivePreview> {
    const row = await this.rpc<unknown>('preview.start', { project_id: projectId, command });
    return decodeLivePreview(row, 'preview.start');
  }

  async stopPreview(projectId: string): Promise<void> {
    await this.rpc<unknown>('preview.stop', { project_id: projectId });
  }

  async previewStatus(projectId: string): Promise<LivePreview> {
    const row = await this.rpc<unknown>('preview.status', { project_id: projectId });
    return decodeLivePreview(row, 'preview.status');
  }

  async listRunModes(): Promise<RunModeConfig[]> {
    const rows = await this.rpc<unknown>('runmode.list');
    return wiringList(rows, 'runmode.list', decodeRunModeConfig);
  }

  async setRunMode(config: RunModeConfig): Promise<RunModeConfig> {
    const row = await this.rpc<unknown>('runmode.set', { config: encodeRunModeConfig(config) });
    return decodeRunModeConfig(row, 'runmode.set');
  }

  async listPreferences(projectId: string): Promise<Preference[]> {
    const rows = await this.rpc<unknown>('preferences.list', { project_id: projectId });
    return wiringList(rows, 'preferences.list', decodePreference);
  }

  async recordPreference(signal: PreferenceSignal): Promise<Preference[]> {
    const rows = await this.rpc<unknown>('preferences.record', {
      signal: encodePreferenceSignal(signal),
    });
    return wiringList(rows, 'preferences.record', decodePreference);
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

/** When a routine comes due (`warsha_pipeline::RoutineSchedule`, externally tagged). */
export type RoutineSchedule = { cron: string } | { intervalSeconds: number } | 'manual';

/** Where a routine is in its lifecycle (`warsha_pipeline::RoutineState`). */
export type RoutineState = 'idle' | 'running' | 'paused' | { failed: string };

/**
 * One scheduled task (`warsha_pipeline::Routine`, snake_case on the wire). The
 * screen reads camelCase; `decodeRoutine` maps the daemon's `last_run_unix` and the
 * externally-tagged `schedule`/`state` enums into these shapes.
 */
export interface Routine {
  id: string;
  name: string;
  description: string;
  schedule: RoutineSchedule;
  state: RoutineState;
  lastRunUnix: number | null;
}

/** The open-source backend a project points at (`warsha_pipeline::BackendKind`). */
export type BackendKind = 'pocket_base' | 'supabase';

/** A backend service the owner turned on (`warsha_pipeline::BackendFeature`). */
export type BackendFeature = 'auth' | 'postgres_rls' | 'storage' | 'push' | 'functions';

/** The operation an RLS policy covers (`warsha_pipeline::RlsOperation`). */
export type RlsOperation = 'select' | 'insert' | 'update' | 'delete' | 'all';

/** The picked backend (`warsha_pipeline::BackendConfig`); `enabled_features` defaults to `[]`. */
export interface BackendConfig {
  kind: BackendKind;
  url: string;
  projectName: string;
  enabledFeatures: BackendFeature[];
}

/** One column of a generated table (`warsha_pipeline::ColumnDef`). */
export interface ColumnDef {
  name: string;
  colType: string;
  nullable: boolean;
}

/** One table the agent created (`warsha_pipeline::TableDef`). */
export interface TableDef {
  name: string;
  columns: ColumnDef[];
}

/** One row-level security policy (`warsha_pipeline::RlsPolicy`). */
export interface RlsPolicy {
  table: string;
  policyName: string;
  expression: string;
  operation: RlsOperation;
}

/**
 * The backend kit (`warsha_pipeline::BackendKit`, snake_case on the wire). The four
 * list fields and `config.enabledFeatures` carry serde defaults, so they decode to
 * `[]` when absent; `encodeBackendKit` writes the whole kit back to snake_case for
 * `backend.set`.
 */
export interface BackendKit {
  config: BackendConfig;
  tables: TableDef[];
  rlsPolicies: RlsPolicy[];
  storageBuckets: string[];
  functions: string[];
}

/** A managed process status (`warsha_pipeline::ProcessStatus`). */
export type ProcessStatus = 'starting' | 'running' | 'stopped' | 'failed' | 'crashed';

/** One project's dev server (`warsha_pipeline::LivePreview`, snake_case on the wire). */
export interface LivePreview {
  projectId: string;
  processId: string;
  command: string;
  args: string[];
  status: ProcessStatus;
  url: string | null;
}

/** Where a Warsha daemon runs (`warsha_pipeline::RunMode`). */
export type RunMode = 'local' | 'self_hosted' | 'hosted';

/** Where the API binds and who may reach it (`warsha_pipeline::RunModeConfig`). */
export interface RunModeConfig {
  mode: RunMode;
  bindHost: string;
  allowedHosts: string[];
  relayUrl: string | null;
}

/** What the owner did to a target (`warsha_pipeline::SignalKind`). */
export type SignalKind = 'approve' | 'reject' | 'change_request' | 'edit';

/** A decayed, weighted preference (`warsha_pipeline::Preference`, snake_case on the wire). */
export interface Preference {
  key: string;
  score: number;
  evidenceCount: number;
  lastUpdated: number;
}

/**
 * One recorded taste signal (`warsha_pipeline::PreferenceSignal`). Every field is
 * required by the daemon; `encodePreferenceSignal` writes it back to snake_case for
 * `preferences.record`.
 */
export interface PreferenceSignal {
  id: string;
  projectId: string;
  ownerId: string;
  kind: SignalKind;
  target: string;
  weight: number;
  recordedAt: number;
}

/**
 * Signatures for the daemon wiring batch (PLAN.md M16/M19/M20): backend kit export,
 * continue-on-server handoff, the read half of post-launch care, and the live
 * records — routines, the backend kit, the dev-server preview, run modes and taste
 * preferences.
 *
 * `WarshaClient` implements this interface, so a screen written against these
 * methods calls the daemon's own RPC names (`backend.export`, `handoff.create`,
 * `handoff.apply`, `postlaunch.crashes`, `postlaunch.reviews`, `routines.*`,
 * `backend.get`/`backend.set`, `preview.*`, `runmode.*`, `preferences.*`) without
 * knowing the wire shape. Every result is decoded strictly before it reaches a caller.
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

  /** `routines.list` — every registered routine. */
  listRoutines(): Promise<Routine[]>;

  /** `routines.get` — one routine, or `null` when no routine carries that id. */
  getRoutine(id: string): Promise<Routine | null>;

  /** `routines.run_now` — run the routine once now; resolves to its updated row. */
  runRoutineNow(id: string): Promise<Routine>;

  /** `routines.pause` — stop scheduling the routine; resolves to its updated row. */
  pauseRoutine(id: string): Promise<Routine>;

  /** `routines.resume` — let a paused or failed routine schedule again; resolves to its row. */
  resumeRoutine(id: string): Promise<Routine>;

  /** `backend.get` — the run's backend kit, or `null` when none is recorded. */
  getBackendKit(runId: RunId): Promise<BackendKit | null>;

  /** `backend.set` — record the run's backend kit, encoded to the daemon's snake_case. */
  setBackendKit(runId: RunId, kit: BackendKit): Promise<void>;

  /** `preview.start` — start the project's dev server; resolves to its live preview. */
  startPreview(projectId: string, command: string): Promise<LivePreview>;

  /** `preview.stop` — stop the project's dev server. */
  stopPreview(projectId: string): Promise<void>;

  /** `preview.status` — the project's live preview, observed now. */
  previewStatus(projectId: string): Promise<LivePreview>;

  /** `runmode.list` — the stored config for every run mode. */
  listRunModes(): Promise<RunModeConfig[]>;

  /** `runmode.set` — store one mode's config and resolve to the stored row. */
  setRunMode(config: RunModeConfig): Promise<RunModeConfig>;

  /** `preferences.list` — the project's derived preferences. */
  listPreferences(projectId: string): Promise<Preference[]>;

  /** `preferences.record` — record one taste signal; resolves to the updated preferences. */
  recordPreference(signal: PreferenceSignal): Promise<Preference[]>;
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

/** A wiring list result, decoded row by row; a non-list is a named error. */
function wiringList<T>(
  value: unknown,
  method: string,
  decode: (row: unknown, method: string) => T
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${WIRING_RESULT_ERROR} from ${method}: expected a list`);
  }
  return value.map((row) => decode(row, method));
}

/** A number serde may omit or null: absent and `null` both read as `null`. */
function wiringNullableNumber(value: unknown, method: string, name: string): number | null {
  if (value === null || value === undefined) return null;
  return wiringNumber(value, method, name);
}

/** A list field carrying a serde default: absent and `null` both read as `[]`. */
function wiringDefaultArray(value: unknown, method: string, name: string): unknown[] {
  if (value === null || value === undefined) return [];
  return wiringArray(value, method, name);
}

/** A defaulted list of strings (`storage_buckets`, `functions`, `enabled_features`). */
function wiringDefaultStringList(value: unknown, method: string, name: string): string[] {
  return wiringDefaultArray(value, method, name).map((entry) => wiringString(entry, method, name));
}

function decodeRoutineSchedule(value: unknown, method: string): RoutineSchedule {
  if (value === 'manual') return 'manual';
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    const cron = source['cron'];
    if (typeof cron === 'string') return { cron };
    const interval = source['interval_seconds'];
    if (typeof interval === 'number' && Number.isFinite(interval)) {
      return { intervalSeconds: interval };
    }
  }
  throw new Error(
    `${WIRING_RESULT_ERROR} from ${method}: "schedule" is not "manual", {cron} or {interval_seconds}`
  );
}

function decodeRoutineState(value: unknown, method: string): RoutineState {
  if (value === 'idle' || value === 'running' || value === 'paused') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const failed = (value as Record<string, unknown>)['failed'];
    if (typeof failed === 'string') return { failed };
  }
  throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "state" is not a known routine state`);
}

/** Decode one `warsha_pipeline::Routine` (snake_case) into the screen's camelCase row. */
export function decodeRoutine(value: unknown, method: string): Routine {
  const source = wiringObject(value, method);
  return {
    id: wiringString(source['id'], method, 'id'),
    name: wiringString(source['name'], method, 'name'),
    description: wiringString(source['description'], method, 'description'),
    schedule: decodeRoutineSchedule(source['schedule'], method),
    state: decodeRoutineState(source['state'], method),
    lastRunUnix: wiringNullableNumber(source['last_run_unix'], method, 'last_run_unix'),
  };
}

function decodeBackendKind(value: unknown, method: string): BackendKind {
  if (value === 'pocket_base' || value === 'supabase') return value;
  throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "kind" is not a known backend kind`);
}

function decodeBackendFeature(value: unknown, method: string): BackendFeature {
  if (
    value === 'auth' ||
    value === 'postgres_rls' ||
    value === 'storage' ||
    value === 'push' ||
    value === 'functions'
  ) {
    return value;
  }
  throw new Error(
    `${WIRING_RESULT_ERROR} from ${method}: "enabled_features" carries an unknown backend feature`
  );
}

function decodeColumnDef(value: unknown, method: string): ColumnDef {
  const source = wiringObject(value, method);
  return {
    name: wiringString(source['name'], method, 'name'),
    colType: wiringString(source['col_type'], method, 'col_type'),
    nullable: wiringBoolean(source['nullable'], method, 'nullable'),
  };
}

function decodeTableDef(value: unknown, method: string): TableDef {
  const source = wiringObject(value, method);
  return {
    name: wiringString(source['name'], method, 'name'),
    columns: wiringArray(source['columns'], method, 'columns').map((column) =>
      decodeColumnDef(column, method)
    ),
  };
}

function decodeRlsOperation(value: unknown, method: string): RlsOperation {
  if (
    value === 'select' ||
    value === 'insert' ||
    value === 'update' ||
    value === 'delete' ||
    value === 'all'
  ) {
    return value;
  }
  throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "operation" is not a known RLS operation`);
}

function decodeRlsPolicy(value: unknown, method: string): RlsPolicy {
  const source = wiringObject(value, method);
  return {
    table: wiringString(source['table'], method, 'table'),
    policyName: wiringString(source['policy_name'], method, 'policy_name'),
    expression: wiringString(source['expression'], method, 'expression'),
    operation: decodeRlsOperation(source['operation'], method),
  };
}

/**
 * Decode one `warsha_pipeline::BackendKit` (snake_case) into the screen's camelCase
 * kit. The four list fields and `config.enabled_features` carry serde defaults and
 * read as `[]` when absent; `config`, its `kind`/`url`/`project_name` and each table's
 * `columns` are required and a wrong shape is a named error.
 */
export function decodeBackendKit(value: unknown, method: string): BackendKit {
  const source = wiringObject(value, method);
  const config = wiringObject(source['config'], method);
  return {
    config: {
      kind: decodeBackendKind(config['kind'], method),
      url: wiringString(config['url'], method, 'url'),
      projectName: wiringString(config['project_name'], method, 'project_name'),
      enabledFeatures: wiringDefaultArray(config['enabled_features'], method, 'enabled_features').map(
        (feature) => decodeBackendFeature(feature, method)
      ),
    },
    tables: wiringDefaultArray(source['tables'], method, 'tables').map((table) =>
      decodeTableDef(table, method)
    ),
    rlsPolicies: wiringDefaultArray(source['rls_policies'], method, 'rls_policies').map((policy) =>
      decodeRlsPolicy(policy, method)
    ),
    storageBuckets: wiringDefaultStringList(source['storage_buckets'], method, 'storage_buckets'),
    functions: wiringDefaultStringList(source['functions'], method, 'functions'),
  };
}

/** Encode a `BackendKit` back to the daemon's snake_case shape for `backend.set`. */
export function encodeBackendKit(kit: BackendKit): Record<string, unknown> {
  return {
    config: {
      kind: kit.config.kind,
      url: kit.config.url,
      project_name: kit.config.projectName,
      enabled_features: kit.config.enabledFeatures,
    },
    tables: kit.tables.map((table) => ({
      name: table.name,
      columns: table.columns.map((column) => ({
        name: column.name,
        col_type: column.colType,
        nullable: column.nullable,
      })),
    })),
    rls_policies: kit.rlsPolicies.map((policy) => ({
      table: policy.table,
      policy_name: policy.policyName,
      expression: policy.expression,
      operation: policy.operation,
    })),
    storage_buckets: kit.storageBuckets,
    functions: kit.functions,
  };
}

function decodeProcessStatus(value: unknown, method: string): ProcessStatus {
  if (
    value === 'starting' ||
    value === 'running' ||
    value === 'stopped' ||
    value === 'failed' ||
    value === 'crashed'
  ) {
    return value;
  }
  throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "status" is not a known process status`);
}

/** Decode one `warsha_pipeline::LivePreview` (snake_case) into the screen's row. */
export function decodeLivePreview(value: unknown, method: string): LivePreview {
  const source = wiringObject(value, method);
  return {
    projectId: wiringString(source['project_id'], method, 'project_id'),
    processId: wiringString(source['process_id'], method, 'process_id'),
    command: wiringString(source['command'], method, 'command'),
    args: wiringStringList(source['args'], method, 'args'),
    status: decodeProcessStatus(source['status'], method),
    url: wiringNullableString(source['url'], method, 'url'),
  };
}

function decodeRunMode(value: unknown, method: string): RunMode {
  if (value === 'local' || value === 'self_hosted' || value === 'hosted') return value;
  throw new Error(`${WIRING_RESULT_ERROR} from ${method}: "mode" is not a known run mode`);
}

/** Decode one `warsha_pipeline::RunModeConfig` (snake_case) into the screen's row. */
export function decodeRunModeConfig(value: unknown, method: string): RunModeConfig {
  const source = wiringObject(value, method);
  return {
    mode: decodeRunMode(source['mode'], method),
    bindHost: wiringString(source['bind_host'], method, 'bind_host'),
    allowedHosts: wiringStringList(source['allowed_hosts'], method, 'allowed_hosts'),
    relayUrl: wiringNullableString(source['relay_url'], method, 'relay_url'),
  };
}

/** Encode a `RunModeConfig` back to the daemon's snake_case shape for `runmode.set`. */
function encodeRunModeConfig(config: RunModeConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    bind_host: config.bindHost,
    allowed_hosts: config.allowedHosts,
    relay_url: config.relayUrl,
  };
}

/** Decode one `warsha_pipeline::Preference` (snake_case) into the screen's row. */
export function decodePreference(value: unknown, method: string): Preference {
  const source = wiringObject(value, method);
  return {
    key: wiringString(source['key'], method, 'key'),
    score: wiringNumber(source['score'], method, 'score'),
    evidenceCount: wiringNumber(source['evidence_count'], method, 'evidence_count'),
    lastUpdated: wiringNumber(source['last_updated'], method, 'last_updated'),
  };
}

/** Encode a `PreferenceSignal` back to the daemon's snake_case shape for `preferences.record`. */
function encodePreferenceSignal(signal: PreferenceSignal): Record<string, unknown> {
  return {
    id: signal.id,
    project_id: signal.projectId,
    owner_id: signal.ownerId,
    kind: signal.kind,
    target: signal.target,
    weight: signal.weight,
    recorded_at: signal.recordedAt,
  };
}

/** Handle returned by `subscribeEvents`; `close()` is idempotent. */
export interface EventSubscription {
  close(): void;
  /**
   * Send `runs.subscribe` down the open `/events` socket: the daemon turns the
   * stream on, narrows it to `runId`, and — when `sinceSeq` is named — replays
   * the buffered frames after that cursor (or answers one gap frame). Optional
   * because a subscription whose socket never opened has no down-channel; on one
   * that closed, calling this reports an error rather than throwing.
   */
  subscribeRun?: (runId: RunId, sinceSeq?: number) => void;
  /**
   * Send `runs.unsubscribe` down the socket: the daemon stops the stream and
   * answers one acknowledgement frame. Same optionality rules as `subscribeRun`.
   */
  unsubscribeRun?: (runId: RunId) => void;
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
  /**
   * Replay cursor: ask the daemon for every frame after this `seq` at connect
   * time (appended to the socket URL as `since_seq`, and honoured the same way
   * via the `Last-Event-ID` header on transports that can set one).
   */
  sinceSeq?: number;
  /** Narrow the stream to one run at connect time (`run_id` on the socket URL). */
  runId?: RunId;
  onEvent: (event: WarshaEvent) => void;
  onError?: (error: Error) => void;
  /**
   * Called when the stream announces lost frames: a frame with `gap_detected`,
   * or a live frame whose `seq` jumped past the last one seen. Carries the
   * daemon's own `droppedCount` when it named one.
   */
  onGap?: (info: { droppedCount: number; seq: number }) => void;
  /**
   * Called when the daemon says it cannot resume from this client's cursor
   * (`resync_required`): the client should rebuild from `runs.events` and
   * re-subscribe from the current `seq`.
   */
  onResyncRequired?: (info: { seq: number }) => void;
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
 *
 * Sequence handling: every frame that carries a `seq` advances the subscription's
 * cursor; a frame announcing `gap_detected`/`resync_required`, or one whose `seq`
 * skips past the cursor, reaches `onGap`/`onResyncRequired` beside `onEvent`, so a
 * viewer never has to infer loss from a silent gap.
 */
export function subscribeEvents(options: SubscribeEventsOptions): EventSubscription {
  const { url, token, onEvent, onError, onGap, onResyncRequired } = options;

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

  const endpoint = eventEndpoint(url, { sinceSeq: options.sinceSeq, runId: options.runId });

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
  // The highest frame `seq` this subscription has seen; `undefined` until the
  // first sequenced frame, so a bare-`Event` daemon never trips the gap check.
  let lastSeq: number | undefined =
    options.sinceSeq !== undefined && Number.isFinite(options.sinceSeq) && options.sinceSeq >= 0
      ? options.sinceSeq
      : undefined;

  const reportGap = (info: { droppedCount: number; seq: number }): void => {
    try {
      onGap?.(info);
    } catch {
      // A throwing onGap callback must not escape the socket handler.
    }
  };

  const reportResync = (seq: number): void => {
    try {
      onResyncRequired?.({ seq });
    } catch {
      // A throwing onResyncRequired callback must not escape the socket handler.
    }
  };

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

    // Stream-level announcements come through their flags, not the event body.
    if (parsed.gapDetected === true) {
      reportGap({ droppedCount: parsed.droppedCount ?? 0, seq: parsed.seq ?? 0 });
    }
    if (parsed.resyncRequired === true) {
      reportResync(parsed.seq ?? 0);
    }

    if (parsed.seq !== undefined) {
      // A sequenced frame whose `seq` skips past the cursor is a gap the daemon
      // did not announce; count the skipped frames and move the cursor anyway.
      if (lastSeq !== undefined && parsed.seq > lastSeq + 1) {
        reportGap({ droppedCount: parsed.seq - lastSeq - 1, seq: parsed.seq });
      }
      if (lastSeq === undefined || parsed.seq > lastSeq) {
        lastSeq = parsed.seq;
      }
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

  const sendCommand = (method: string, params: Record<string, unknown>): void => {
    if (closed) {
      reportError(new Error(`Cannot send ${method} on a closed event stream`));
      return;
    }
    try {
      socket.send(JSON.stringify({ method, params }));
    } catch (cause) {
      reportError(new Error(redactToken(`Could not send ${method}: ${describeCause(cause)}`, token)));
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
    subscribeRun: (runId: RunId, sinceSeq?: number): void => {
      const params: Record<string, unknown> = { run_id: String(runId) };
      if (sinceSeq !== undefined) params.since_seq = sinceSeq;
      sendCommand('runs.subscribe', params);
    },
    unsubscribeRun: (runId: RunId): void => {
      sendCommand('runs.unsubscribe', { run_id: String(runId) });
    },
  };
}

export function createClient(baseUrl: string, token: string): WarshaClient {
  return new WarshaClient(baseUrl, token);
}
