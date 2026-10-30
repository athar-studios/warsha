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

export interface ProviderConfig {
  name: string;
  kind: string;
  enabled: boolean;
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
  const source = decoded as Record<string, unknown>;

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

/** Base URL the `/events` endpoint lives under, tolerating a trailing slash. */
function eventEndpoint(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/events') ? trimmed : `${trimmed}/events`;
}

/** Subprotocol carrying the bearer token on the WebSocket handshake. */
const TOKEN_SUBPROTOCOL_PREFIX = 'warsha.token.';

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

  async createProject(name: string): Promise<ProjectSummary> {
    return this.rpc('projects.create', { name });
  }

  async getProject(id: ProjectId): Promise<ProjectSummary> {
    return this.rpc('projects.get', { id });
  }

  async deleteProject(id: ProjectId): Promise<void> {
    return this.rpc('projects.delete', { id });
  }

  // Runs
  async listRuns(projectId: ProjectId): Promise<RunSummary[]> {
    return this.rpc('runs.list', { projectId });
  }

  async startRun(projectId: ProjectId, idea: string): Promise<RunSummary> {
    return this.rpc('runs.start', { projectId, idea });
  }

  async getRun(id: RunId): Promise<RunSummary> {
    return this.rpc('runs.get', { id });
  }

  async getRunStatus(id: RunId): Promise<RunSummary> {
    return this.rpc('runs.status', { id });
  }

  async getRunLogs(id: RunId): Promise<string[]> {
    return this.rpc('runs.logs', { id });
  }

  // Gates
  async getGates(runId: RunId): Promise<GateSummary[]> {
    return this.rpc('gates.list', { runId });
  }

  async approveGate(runId: RunId, stage: Stage): Promise<void> {
    return this.rpc('gates.approve', { runId, stage });
  }

  async rejectGate(runId: RunId, stage: Stage, reason: string): Promise<void> {
    return this.rpc('gates.reject', { runId, stage, reason });
  }

  async requestChanges(runId: RunId, stage: Stage, notes: string): Promise<void> {
    return this.rpc('gates.changes', { runId, stage, notes });
  }

  // Providers
  async listProviders(): Promise<ProviderConfig[]> {
    return this.rpc('providers.list');
  }

  async addProvider(config: { name: string; kind: string; key: string; api_base?: string }): Promise<ProviderConfig> {
    return this.rpc('providers.add', config);
  }

  async testProvider(name: string): Promise<void> {
    return this.rpc('providers.test', { name });
  }

  async removeProvider(name: string): Promise<void> {
    return this.rpc('providers.remove', { name });
  }

  async setProviderBudget(name: string, budgetUsd: number): Promise<void> {
    return this.rpc('providers.budget', { name, budgetUsd });
  }

  async getBudget(): Promise<BudgetStatus> {
    return this.rpc('providers.budget.status');
  }

  // Project Budgets
  async getProjectBudget(projectId: ProjectId): Promise<BudgetStatus> {
    return this.rpc('budget.get', { projectId });
  }

  async setProjectBudget(projectId: ProjectId, cents: number): Promise<void> {
    return this.rpc('budget.set', { projectId, cents });
  }

  // Roles
  async listRoles(): Promise<Role[]> {
    return this.rpc('roles.list');
  }

  async getRoleConfig(role: Role): Promise<RoleRoutingConfig> {
    return this.rpc('roles.get', { role });
  }

  async setRoleConfig(config: RoleRoutingConfig): Promise<void> {
    return this.rpc('roles.set', config);
  }

  async assignRole(deviceId: DeviceId, role: Role): Promise<void> {
    return this.rpc('roles.assign', { deviceId, role });
  }

  // Devices (pairing)
  async listDevices(): Promise<DeviceSummary[]> {
    return this.rpc('devices.list');
  }

  async pairDevice(qrData: string): Promise<DeviceSummary> {
    return this.rpc('devices.pair', { qrData });
  }

  async removeDevice(deviceId: DeviceId): Promise<void> {
    return this.rpc('devices.remove', { deviceId });
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
}export interface SubscribeEventsOptions {
  /** Base WebSocket URL of the daemon, e.g. `ws://127.0.0.1:8766`. */
  url: string;
  /** Daemon auth token, sent on the handshake as `warsha.token.<token>`. */
  token: string;
  onEvent: (event: WarshaEvent) => void;
  onError?: (error: Error) => void;
}

/**
 * Stream `warsha_core::Event` values from the daemon's `/events` WebSocket endpoint.
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
      return new WebSocketCtor(endpoint, `${TOKEN_SUBPROTOCOL_PREFIX}${token}`);
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
