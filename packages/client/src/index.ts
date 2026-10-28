// @warsha/client — Type-safe API client for warshad JSON-RPC
// Types are defined here (not imported from @warsha/core) to avoid cross-lang dependency

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

export class WarshaClient {
  private baseUrl: string;
  private token: string;
  private requestId = 0;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async rpc<T>(method: string, params?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/rpc`, {
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

    const data: RpcResponse<T> = await res.json();
    if (data.error) {
      throw new Error(`RPC error ${data.error.code}: ${data.error.message}`);
    }
    return data.result as T;
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

export function createClient(baseUrl: string, token: string): WarshaClient {
  return new WarshaClient(baseUrl, token);
}