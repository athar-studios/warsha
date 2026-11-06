// @warsha/client — real wire contract test (P0 black screen).
//
// Every row here is the *exact* JSON `warshad` answers with today — the serde default
// snake_case names of `warsha_core::Project` (`crates/warsha-core/src/lib.rs:190-199`),
// `warsha_core::Run` (`crates/warsha-core/src/lib.rs:203-214`, `RunStatus` at :216-224)
// and `warsha_remote::DeviceIdentity` (`crates/warsha-remote/src/lib.rs:85-92`) — fed
// through the real `WarshaClient` with only the transport stubbed. The desktop renders
// what these methods resolve to; a raw snake_case row reaching a screen is the bug this
// file pins: `project.createdAt` was `undefined`, `new Date(undefined)` threw
// `RangeError: Invalid time value` during render, and the window went black.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createClient,
  decodeCustomModelRecord,
  decodeDeviceSummary,
  decodeFileContent,
  decodeFileEntry,
  decodeHarnessDefinition,
  decodeIntegrationStatus,
  decodePluginDefinition,
  decodeProjectSummary,
  decodeRunSummary,
  decodeSkillDefinition,
  WarshaClient,
  type DeviceId,
  type IntegrationConfig,
  type ProjectId,
  type RunId,
} from './index';

function okResponse(result: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) };
}

let client: WarshaClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  client = createClient('http://127.0.0.1:8765', 'daemon-token');
});

describe('wire contract — a live-shaped warshad answer decodes into the client types', () => {
  // `warsha_core::Project` with chrono's RFC 3339 datetimes and the extra fields the
  // screens do not carry. The decode must keep what the type declares and drop the rest
  // without inventing `undefined` keys.
  const PROJECT_WIRE = {
    id: '01JPROJECT00000000000000',
    name: 'ورشة',
    description: 'تطبيقي الأول',
    language: 'ar',
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:05:00Z',
    repo_path: null,
    repo_url: null,
  };

  it('projects.list rows arrive as ProjectSummary with camelCase timestamps', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([PROJECT_WIRE]));

    const projects = await client.listProjects();

    expect(projects).toHaveLength(1);
    const project = projects[0];
    expect(project.id).toBe('01JPROJECT00000000000000');
    expect(project.name).toBe('ورشة');
    expect(project.createdAt).toBe('2026-10-28T00:00:00Z');
    expect(project.updatedAt).toBe('2026-10-28T00:05:00Z');
    // The fields `ProjectSummary` does not declare are not carried through with a
    // snake_case name a screen could accidentally read:
    expect(project).not.toHaveProperty('created_at');
    expect(project).not.toHaveProperty('repo_path');
    // And every timestamp is parseable — the render path (`new Date(x)`) can never see
    // `undefined` from this client:
    for (const iso of [project.createdAt, project.updatedAt]) {
      expect(typeof iso).toBe('string');
      expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
    }
  });

  // `warsha_core::Run` as `runs.list`/`runs.get` return it: the whole struct, including
  // `gate_states`/`artifacts`/budget keys the `RunSummary` type does not carry.
  const RUN_WIRE = {
    id: '01JRUN0000000000000000',
    project_id: '01JPROJECT00000000000000',
    current_stage: 'gate_a',
    gate_states: {},
    artifacts: {},
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:07:00Z',
    status: 'awaiting_gate',
    budget_cents: 1200,
    spent_cents: 437,
  };

  const RUN_DECODED = {
    id: '01JRUN0000000000000000',
    projectId: '01JPROJECT00000000000000',
    stage: 'gate_a',
    status: 'awaiting_gate',
    startedAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:07:00Z',
  };

  it('runs.list rows arrive as RunSummary with projectId/stage/startedAt', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([RUN_WIRE]));

    const runs = await client.listRuns('01JPROJECT00000000000000' as ProjectId);
    expect(runs).toEqual([RUN_DECODED]);
    expect(runs[0]).not.toHaveProperty('current_stage');
    expect(runs[0]).not.toHaveProperty('project_id');
  });

  it('every run method that answers a Run decodes it', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.startRun('p' as ProjectId, 'idea')).resolves.toEqual(RUN_DECODED);

    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.getRun('r' as RunId)).resolves.toEqual(RUN_DECODED);

    fetchMock.mockResolvedValueOnce(okResponse(RUN_WIRE));
    await expect(client.getRunStatus('r' as RunId)).resolves.toEqual(RUN_DECODED);

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN_WIRE, current_stage: 'research' }));
    await expect(client.advanceRun('r' as RunId)).resolves.toEqual({
      ...RUN_DECODED,
      stage: 'research',
    });

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN_WIRE, status: 'cancelled' }));
    await expect(client.cancelRun('r' as RunId)).resolves.toEqual({
      ...RUN_DECODED,
      status: 'cancelled',
    });

    fetchMock.mockResolvedValueOnce(okResponse({ ...RUN_WIRE, status: 'completed' }));
    await expect(client.followupRun('r' as RunId, 'نعم')).resolves.toEqual({
      ...RUN_DECODED,
      status: 'completed',
    });
  });

  it('the RunStatus words the daemon serialises are exactly the snake_case enum names', () => {
    // `crates/warsha-core/src/lib.rs:216-224`: `#[serde(rename_all = "snake_case")]` over
    // `Running|Paused|Completed|Failed|Cancelled` — each is a plain JSON string on the wire.
    for (const status of ['running', 'paused', 'completed', 'failed', 'cancelled']) {
      expect(decodeRunSummary({ ...RUN_WIRE, status }).status).toBe(status);
    }
  });

  // `warsha_remote::DeviceIdentity`: `device_id`, a `[u8; 32]` public key as numbers,
  // `created_at`, and the `revoked` pair — with no `last_seen` field at all, which is
  // why the fallback matters: the ledger computes an age from `lastSeen`.
  const DEVICE_WIRE = {
    device_id: '9a12c0de-0000-4000-8000-000000000001',
    static_public: Array.from({ length: 32 }, (_, index) => index),
    name: 'Pixel 8',
    created_at: '2026-10-28T00:00:00Z',
    revoked: false,
    revoked_at: null,
  };

  it('devices.list rows arrive as DeviceSummary with id/pairedAt/lastSeen', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([DEVICE_WIRE]));

    const devices = await client.listDevices();

    expect(devices).toHaveLength(1);
    const device = devices[0];
    expect(device.id).toBe('9a12c0de-0000-4000-8000-000000000001');
    expect(device.name).toBe('Pixel 8');
    expect(device.pairedAt).toBe('2026-10-28T00:00:00Z');
    // `last_seen` is not on the Rust struct: it is undefined (not fabricated from paired_at).
    expect(device.lastSeen).toBeUndefined();
    expect(device.revoked).toBe(false);
    expect(device).not.toHaveProperty('device_id');
    expect(device).not.toHaveProperty('static_public');
  });

  it('a daemon build that does track last_seen reaches it through', () => {
    expect(
      decodeDeviceSummary({ ...DEVICE_WIRE, last_seen: '2026-11-01T09:30:00Z' }).lastSeen
    ).toBe('2026-11-01T09:30:00Z');
  });

  it('no decode ever hands a screen an undefined timestamp or a non-string stage', () => {
    const sparse = decodeProjectSummary({ id: 'p', name: 'n' });
    expect(typeof sparse.createdAt).toBe('string');
    expect(typeof sparse.updatedAt).toBe('string');

    const bareRun = decodeRunSummary({ id: 'r' });
    expect(typeof bareRun.stage).toBe('string');
    expect(typeof bareRun.status).toBe('string');
    expect(typeof bareRun.startedAt).toBe('string');
    expect(typeof bareRun.updatedAt).toBe('string');

    const bareDevice = decodeDeviceSummary({ device_id: 'd' });
    expect(typeof bareDevice.pairedAt).toBe('string');
    expect(bareDevice.lastSeen).toBeUndefined();
    expect(bareDevice.revoked).toBe(false);
  });

  it('a malformed row is a named refusal, and the token never rides in it', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(['not-a-project']));
    await expect(client.listProjects()).rejects.toThrow('Malformed summary');

    fetchMock.mockResolvedValueOnce(okResponse({ id: 'p', name: 'n' }));
    await expect(client.listProjects()).rejects.toThrow('is not a list');

    // `daemon-token` is the bearer credential for this client; a decode refusal names the
    // field shape and must never carry the request body — the redaction rule of this file.
    fetchMock.mockResolvedValueOnce(okResponse({ name: 'no id' }));
    const error = await client.getProject('p' as ProjectId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('daemon-token');
    expect((error as Error).message).toContain('missing "id"');
  });

  it('the three decoders are exported for callers outside the client class', () => {
    expect(typeof decodeProjectSummary).toBe('function');
    expect(typeof decodeRunSummary).toBe('function');
    expect(typeof decodeDeviceSummary).toBe('function');

    expect(decodeProjectSummary(PROJECT_WIRE).createdAt).toBe('2026-10-28T00:00:00Z');
    expect(decodeRunSummary(RUN_WIRE).stage).toBe('gate_a');
    expect(decodeDeviceSummary(DEVICE_WIRE).id).toBe(
      '9a12c0de-0000-4000-8000-000000000001' as DeviceId
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Wave 2 — harnesses, skills, plugins, custom models, integrations, files.
//
// Same discipline as the P0 block above: the fixtures are the *exact* snake_case JSON the
// daemon's Wave 2 registrations will answer (serde's default field names on the Rust side),
// fed through the real `WarshaClient` with only the transport stubbed. Every decoder also
// has to read the camelCase spelling, so the e2e harness and an older stub decode alike —
// "snake_case to camelCase mapping seamless" is the contract these rows pin.

describe('wire contract — Wave 2 rows decode snake_case into the client types', () => {
  // The fixture is one `warsha_core::HarnessDefinition` exactly as serde writes it:
  // `prompt_template`/`gate` are `Option<String>` (null when absent), `budget_cap_cents`
  // is `Option<u64>`, and `Role` serializes snake_case (`crates/warsha-core/src/harness.rs`).
  const HARNESS_WIRE = {
    id: 'autonomous-factory',
    version: '1.0.0',
    name: 'Autonomous Factory',
    description: 'Loki + Hard Mode 9-stage autonomous pipeline',
    stages: [
      {
        id: 'intake',
        role: 'intake',
        name: 'Intake',
        prompt_template: 'Capture the ticket verbatim; do not interpret yet.',
        gate: 'supervisor-approval',
        auto_advance: false,
      },
      {
        id: 'research',
        role: 'researcher',
        name: 'Research',
        prompt_template: null,
        gate: null,
        auto_advance: true,
      },
    ],
    rules: {
      max_repair_iterations: 3,
      budget_cap_cents: 2000,
      allow_parallel_subagents: true,
      require_verification_receipt: true,
    },
    preset: true,
    active: true,
    created_at: '2025-01-01T00:00:00Z',
  };

  it('harness.list rows arrive as HarnessDefinition with camelCase stages/rules', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([HARNESS_WIRE]));

    const harnesses = await client.listHarnesses();

    expect(harnesses).toHaveLength(1);
    const harness = harnesses[0];
    expect(harness.id).toBe('autonomous-factory');
    expect(harness.preset).toBe(true);
    expect(harness.active).toBe(true);
    expect(harness.stages[0].role).toBe('intake');
    expect(harness.stages[0].gate).toBe('supervisor-approval');
    expect(harness.stages[0].promptTemplate).toBe(
      'Capture the ticket verbatim; do not interpret yet.'
    );
    expect(harness.stages[0].autoAdvance).toBe(false);
    // An Option gate stays null — it is not the same fact as a gate named ''.
    expect(harness.stages[1].gate).toBeNull();
    expect(harness.stages[1].promptTemplate).toBeNull();
    expect(harness.stages[1].role).toBe('researcher');
    expect(harness.rules.maxRepairIterations).toBe(3);
    expect(harness.rules.budgetCapCents).toBe(2000);
    expect(harness.rules.allowParallelSubagents).toBe(true);
    expect(harness.rules.requireVerificationReceipt).toBe(true);
    expect(harness.createdAt).toBe('2025-01-01T00:00:00Z');
    // The snake_case names never ride into the decoded shape a screen reads.
    expect(harness).not.toHaveProperty('created_at');
    expect(harness.rules).not.toHaveProperty('max_repair_iterations');
    expect(harness.stages[0]).not.toHaveProperty('auto_advance');
  });

  it('a harness written in camelCase decodes to the very same object', () => {
    const camel = {
      id: 'autonomous-factory',
      version: '1.0.0',
      name: HARNESS_WIRE.name,
      description: HARNESS_WIRE.description,
      stages: [
        {
          id: 'intake',
          role: 'intake',
          name: 'Intake',
          promptTemplate: HARNESS_WIRE.stages[0].prompt_template,
          gate: 'supervisor-approval',
          autoAdvance: false,
        },
        { id: 'research', role: 'researcher', name: 'Research', autoAdvance: true },
      ],
      rules: {
        maxRepairIterations: 3,
        budgetCapCents: 2000,
        allowParallelSubagents: true,
        requireVerificationReceipt: true,
      },
      preset: true,
      active: true,
      createdAt: '2025-01-01T00:00:00Z',
    };
    // `prompt_template`/`gate` absent decode like the wire's explicit nulls.
    expect(decodeHarnessDefinition(camel)).toEqual(decodeHarnessDefinition(HARNESS_WIRE));
  });

  it('a harness row without stages or rules decodes to the empty flow, not a crash', () => {
    const bare = decodeHarnessDefinition({ id: 'bare' });
    expect(bare.stages).toEqual([]);
    expect(bare.rules.maxRepairIterations).toBe(0);
    expect(bare.rules.budgetCapCents).toBeNull();
    expect(bare.rules.allowParallelSubagents).toBe(false);
    expect(bare.rules.requireVerificationReceipt).toBe(false);
    expect(typeof bare.createdAt).toBe('string');
    expect(bare.createdAt).toBe('');
    // An unknown role reads as a renderable one instead of throwing at the screen.
    const oddRole = decodeHarnessDefinition({ id: 'x', stages: [{ id: 's', role: 'wizard' }] });
    expect(oddRole.stages[0].role).toBe('intake');
    // An uncapped budget stays distinguishable from a zero-cent cap.
    const uncapped = decodeHarnessDefinition({
      id: 'x',
      rules: { max_repair_iterations: 1, budget_cap_cents: null },
    });
    expect(uncapped.rules.budgetCapCents).toBeNull();
  });

  it('every harness method reaches the daemon name and decodes the row', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(HARNESS_WIRE));
    await expect(client.getHarness('autonomous-factory')).resolves.toMatchObject({
      id: 'autonomous-factory',
      rules: { maxRepairIterations: 3 },
    });

    fetchMock.mockResolvedValueOnce(okResponse(HARNESS_WIRE));
    await expect(client.importHarness('name: my flow', 'yaml')).resolves.toMatchObject({
      id: 'autonomous-factory',
    });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.selectHarness('h-1', 'p-1')).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.deleteHarness('h-1')).resolves.toBeUndefined();
  });

  const SKILL_WIRE = {
    id: 'test-driven-development',
    name: 'Test-Driven Development',
    description: 'Write the failing test first, watch it fail, then implement the minimum.',
    source: 'github.com/obra/superpowers',
    license: 'MIT',
    content: '# Test-Driven Development\n\nRed, green, refactor.',
    enabled: true,
    tags: ['testing', 'coding', 'quality'],
  };

  it("skills.list answers today's SlashCommand rows and they still decode", async () => {
    // `skills.list` is daemon-registered NOW and returns `{ name, description }`
    // rows: the command name doubles as the id, `enabled` defaults to true, and
    // the Wave 2-only fields decode to their empty forms.
    fetchMock.mockResolvedValueOnce(okResponse([{ name: 'review', description: 'Review code' }]));

    const skills = await client.listSkills();

    expect(skills).toEqual([
      {
        id: 'review',
        name: 'review',
        description: 'Review code',
        source: '',
        license: '',
        content: '',
        enabled: true,
        tags: [],
      },
    ]);
  });

  it('skill rows arrive with ids and content, and writes return rows', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([SKILL_WIRE]));
    const skills = await client.listSkills();
    expect(skills[0].id).toBe('test-driven-development');
    expect(skills[0].tags).toEqual(['testing', 'coding', 'quality']);
    expect(skills[0].content).toContain('Red, green, refactor.');

    fetchMock.mockResolvedValueOnce(okResponse(SKILL_WIRE));
    await expect(
      client.importSkill('https://example.test/skill.md', 'mine')
    ).resolves.toMatchObject({ id: 'test-driven-development' });

    fetchMock.mockResolvedValueOnce(okResponse({ ...SKILL_WIRE, enabled: false }));
    await expect(client.toggleSkill('test-driven-development', false)).resolves.toMatchObject({
      enabled: false,
    });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.deleteSkill('test-driven-development')).resolves.toBeUndefined();
  });

  // One `warsha_core::PluginDefinition` as serde writes it (`crates/warsha-core/src/plugin.rs`):
  // `env` is a HashMap of secret REFERENCES (`${secrets:…}`), never secret material.
  const PLUGIN_WIRE = {
    id: 'github-mcp',
    name: 'GitHub',
    description: 'Repository operations for the ticket-to-PR factory.',
    transport: 'stdio',
    command: 'npx',
    args: ['@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${secrets:github-token}' },
    enabled: true,
    tools: [
      {
        name: 'create_issue',
        description: 'Open an issue with title, body and labels.',
        parameters_json: null,
      },
      {
        name: 'list_issues',
        description: 'List issues filtered by state.',
        parameters_json: '{"type":"object"}',
      },
    ],
    source: 'github.com/modelcontextprotocol/servers',
  };

  it('plugin rows decode transport/command/args/env and tool schemas', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([PLUGIN_WIRE]));

    const plugins = await client.listPlugins();

    expect(plugins).toHaveLength(1);
    const plugin = plugins[0];
    expect(plugin.id).toBe('github-mcp');
    expect(plugin.transport).toBe('stdio');
    expect(plugin.command).toBe('npx');
    expect(plugin.args).toEqual(['@modelcontextprotocol/server-github']);
    expect(plugin.enabled).toBe(true);
    expect(plugin.tools).toEqual([
      {
        name: 'create_issue',
        description: 'Open an issue with title, body and labels.',
        parametersJson: null,
      },
      {
        name: 'list_issues',
        description: 'List issues filtered by state.',
        parametersJson: '{"type":"object"}',
      },
    ]);
    // env carries references, never material; the wire name never rides through.
    expect(plugin.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: '${secrets:github-token}' });
    expect(plugin).not.toHaveProperty('required_env');
    expect(plugin.tools[0]).not.toHaveProperty('parameters_json');

    const camelPlugin = {
      id: 'github-mcp',
      name: 'GitHub',
      description: PLUGIN_WIRE.description,
      transport: 'stdio',
      command: 'npx',
      args: PLUGIN_WIRE.args,
      env: PLUGIN_WIRE.env,
      enabled: true,
      tools: [
        {
          name: 'create_issue',
          description: 'Open an issue with title, body and labels.',
          parametersJson: null,
        },
        {
          name: 'list_issues',
          description: 'List issues filtered by state.',
          parametersJson: '{"type":"object"}',
        },
      ],
      source: PLUGIN_WIRE.source,
    };
    expect(decodePluginDefinition(camelPlugin)).toEqual(decodePluginDefinition(PLUGIN_WIRE));

    // An HTTP pack has no command, and a non-object env reads as empty.
    const httpPlugin = decodePluginDefinition({ id: 'remote-mcp', transport: 'http', env: 7 });
    expect(httpPlugin.command).toBeNull();
    expect(httpPlugin.env).toEqual({});
  });

  it('plugin install/toggle/configure/remove round-trip through the client', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(PLUGIN_WIRE));
    await expect(client.installPlugin('https://example.test/plugin.json')).resolves.toMatchObject({
      id: 'github-mcp',
    });

    fetchMock.mockResolvedValueOnce(okResponse({ ...PLUGIN_WIRE, enabled: false }));
    await expect(client.togglePlugin('github-mcp', false)).resolves.toMatchObject({
      enabled: false,
    });

    fetchMock.mockResolvedValueOnce(okResponse(PLUGIN_WIRE));
    await expect(
      client.configurePlugin('github-mcp', {
        GITHUB_PERSONAL_ACCESS_TOKEN: '${secrets:github-token}',
      })
    ).resolves.toMatchObject({ id: 'github-mcp', transport: 'stdio' });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(client.removePlugin('github-mcp')).resolves.toBeUndefined();
  });

  const MODEL_WIRE = {
    provider: 'open_router',
    model_id: 'qwen/qwen3-coder',
    display_name: 'Qwen Coder',
    context_window: 262144,
    enabled: true,
  };

  it('custom model rows map model_id/context_window/display_name; nulls stay null', () => {
    const decoded = decodeCustomModelRecord(MODEL_WIRE);
    expect(decoded).toEqual({
      provider: 'open_router',
      modelId: 'qwen/qwen3-coder',
      displayName: 'Qwen Coder',
      contextWindow: 262144,
      enabled: true,
    });
    // An Option display name stays null — the screen falls back to modelId itself.
    expect(decodeCustomModelRecord({ ...MODEL_WIRE, display_name: null }).displayName).toBeNull();
    expect(
      decodeCustomModelRecord({ ...MODEL_WIRE, context_window: null }).contextWindow
    ).toBeNull();
    // A bare row still decodes: enabled defaults true, no name, no window.
    expect(decodeCustomModelRecord({ provider: 'x', model_id: 'y' })).toEqual({
      provider: 'x',
      modelId: 'y',
      displayName: null,
      contextWindow: null,
      enabled: true,
    });
    expect(
      decodeCustomModelRecord({ provider: 'x', modelId: 'y', contextWindow: 4096 }).contextWindow
    ).toBe(4096);

    fetchMock.mockResolvedValueOnce(okResponse([MODEL_WIRE]));
    return client.listCustomModels().then((models) => {
      expect(models[0].modelId).toBe('qwen/qwen3-coder');
    });
  });

  it('models.add returns the row it stored and models.remove resolves void', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(MODEL_WIRE));
    await expect(
      client.addCustomModel('open_router', 'qwen/qwen3-coder', 'Qwen Coder', 262144)
    ).resolves.toMatchObject({ displayName: 'Qwen Coder' });

    fetchMock.mockResolvedValueOnce(okResponse(null));
    await expect(
      client.removeCustomModel('open_router', 'qwen/qwen3-coder')
    ).resolves.toBeUndefined();
  });

  // One `warsha_core::IntegrationStatus` (`crates/warsha-core/src/config.rs`):
  // `configured_at` is an Option timestamp, `details` opaque JSON. No field on a
  // read can carry token material — the struct has none.
  const INTEGRATION_WIRE = {
    id: 'github',
    name: 'GitHub',
    connected: true,
    configured_at: '2026-11-04T10:00:00Z',
    details: { org: 'acme' },
  };

  it('integration rows map configured_at/details; the token never rides back', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([INTEGRATION_WIRE]));

    const integrations = await client.listIntegrations();

    expect(integrations[0].configuredAt).toBe('2026-11-04T10:00:00Z');
    expect(integrations[0].details).toEqual({ org: 'acme' });
    expect(integrations[0]).not.toHaveProperty('configured_at');
    // A never-configured row reads null, and no read shape can carry a token.
    const bare = decodeIntegrationStatus({ id: 'slack', name: 'Slack' });
    expect(bare.configuredAt).toBeNull();
    expect(bare.details).toBeNull();
    expect(bare).not.toHaveProperty('token');
    expect(bare).not.toHaveProperty('botToken');

    const config: IntegrationConfig = { token: 'ghp-secret-never-echoed', org: 'acme' };
    fetchMock.mockResolvedValueOnce(okResponse(INTEGRATION_WIRE));
    await expect(client.connectIntegration('github', config)).resolves.toMatchObject({
      connected: true,
    });

    fetchMock.mockResolvedValueOnce(okResponse({ ...INTEGRATION_WIRE, connected: false }));
    await expect(client.disconnectIntegration('github')).resolves.toMatchObject({
      connected: false,
    });

    fetchMock.mockResolvedValueOnce(okResponse({ status: 'ok', message: 'reachable' }));
    await expect(client.testIntegration('github')).resolves.toEqual({
      status: 'ok',
      message: 'reachable',
    });
  });

  // `warsha_core::FileEntry` is a FLAT row: `is_dir` + `size_bytes`, no nesting
  // (`crates/warsha-core/src/config.rs`).
  const TREE_WIRE = [
    { name: 'src', path: 'src', is_dir: true, size_bytes: 0 },
    { name: 'main.rs', path: 'src/main.rs', is_dir: false, size_bytes: 512 },
    { path: 'Cargo.toml', is_dir: false, size_bytes: 640 },
  ];

  it('file tree rows decode is_dir/size_bytes and derive names from bare paths', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(TREE_WIRE));

    const tree = await client.getFilesTree('proj-1', 'src');

    expect(tree[0]).toEqual({ name: 'src', path: 'src', isDir: true, sizeBytes: 0 });
    expect(tree[1].isDir).toBe(false);
    expect(tree[1].sizeBytes).toBe(512);
    // A row that names only its path takes its last segment as the display name.
    expect(tree[2].name).toBe('Cargo.toml');
    expect(tree[0]).not.toHaveProperty('is_dir');
    expect(tree[0]).not.toHaveProperty('size_bytes');

    fetchMock.mockResolvedValueOnce(
      okResponse({ path: 'src/main.rs', content: 'fn main() {}', mime_type: 'text/rust' })
    );
    await expect(client.readFileContent('proj-1', 'src/main.rs')).resolves.toEqual({
      path: 'src/main.rs',
      content: 'fn main() {}',
      mimeType: 'text/rust',
    });
  });

  it('a malformed Wave 2 row is a named refusal, and the token never rides in it', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(['not-a-harness']));
    await expect(client.listHarnesses()).rejects.toThrow('Malformed Wave 2 payload');

    fetchMock.mockResolvedValueOnce(okResponse({ name: 'no id' }));
    const error = await client.getHarness('h').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('"harness" is missing "id"');
    expect((error as Error).message).not.toContain('daemon-token');

    fetchMock.mockResolvedValueOnce(okResponse('not-a-list'));
    await expect(client.listPlugins()).rejects.toThrow('is not a list');

    expect(() => decodeCustomModelRecord({ provider: '', model_id: '' })).toThrow(
      '"custom model" is missing "provider" or "model_id"'
    );
    expect(() => decodeFileContent([])).toThrow('"file content" is not a JSON object');
  });

  it('the seven Wave 2 decoders are exported for callers outside the client class', () => {
    for (const decode of [
      decodeHarnessDefinition,
      decodeSkillDefinition,
      decodePluginDefinition,
      decodeCustomModelRecord,
      decodeIntegrationStatus,
      decodeFileEntry,
      decodeFileContent,
    ]) {
      expect(typeof decode).toBe('function');
    }
    expect(decodeHarnessDefinition(HARNESS_WIRE).version).toBe('1.0.0');
    expect(decodeSkillDefinition(SKILL_WIRE).license).toBe('MIT');
    expect(decodePluginDefinition(PLUGIN_WIRE).tools).toHaveLength(2);
    expect(decodeIntegrationStatus(INTEGRATION_WIRE).connected).toBe(true);
    expect(decodeFileEntry(TREE_WIRE[2]).name).toBe('Cargo.toml');
    expect(decodeFileContent({ path: 'p', content: 'c' }).mimeType).toBe('text/plain');
  });
});
