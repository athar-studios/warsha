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
  | 'research'
  | 'prd_spec'
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
  'research',
  'prd_spec',
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

export class WarshaClient {
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

  async setProviderBudget(name: string, budgetUsd: number): Promise<void> {
    return this.rpc('providers.budget', { name, budgetUsd });
  }

  async getBudget(): Promise<BudgetStatus> {
    return this.rpc('providers.budget.status');
  }

  // Roles
  async listRoles(): Promise<Role[]> {
    return this.rpc('roles.list');
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
}

/** Handle returned by `subscribeEvents`; `close()` is idempotent. */
export interface EventSubscription {
  close(): void;
}

export interface SubscribeEventsOptions {
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
