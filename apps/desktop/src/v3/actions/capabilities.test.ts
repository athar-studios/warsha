import { describe, expect, it } from 'vitest';

import {
  canEndRuns,
  DEFAULT_CAPABILITIES,
  detectCapabilities,
  type Capabilities,
} from './capabilities';

describe('capabilities detection', () => {
  it('detects daemon online and provider present when client calls succeed', async () => {
    const mockClient = {
      health: async () => ({ status: 'ok', version: '0.2.1' }),
      listProviders: async () => [
        { name: 'deepseek', kind: 'openai_compatible', endpoint: 'https://api.deepseek.com' },
      ],
    } as unknown;

    const caps: Capabilities = await detectCapabilities(mockClient as never);
    expect(caps.daemon).toBe(true);
    expect(caps.provider).toBe(true);
    expect(caps.devices).toBe(true);
  });

  it('detects daemon online but no provider when providers list is empty', async () => {
    const mockClient = {
      health: async () => ({ status: 'ok', version: '0.2.1' }),
      listProviders: async () => [],
    } as unknown;

    const caps: Capabilities = await detectCapabilities(mockClient as never);
    expect(caps.daemon).toBe(true);
    expect(caps.provider).toBe(false);
  });

  it("reports the daemon's run-controls answer from health", async () => {
    const mockClient = {
      health: async () => ({
        status: 'ok',
        version: '0.3.0',
        capabilities: { runControls: true },
      }),
      listProviders: async () => [],
    } as unknown;

    const caps: Capabilities = await detectCapabilities(mockClient as never);
    expect(caps.daemon).toBe(true);
    expect(caps.runControls).toBe(true);
  });

  it('keeps run controls off when health does not state the capability', async () => {
    const noCapabilities = {
      health: async () => ({ status: 'ok', version: '0.2.0' }),
      listProviders: async () => [],
    } as unknown;
    const capsOff = {
      health: async () => ({
        status: 'ok',
        version: '0.2.0',
        capabilities: { runControls: false },
      }),
      listProviders: async () => [],
    } as unknown;

    expect((await detectCapabilities(noCapabilities as never)).runControls).toBe(false);
    expect((await detectCapabilities(capsOff as never)).runControls).toBe(false);
  });

  it('detects daemon offline when health fails', async () => {
    const mockClient = {
      health: async () => {
        throw new Error('Connection refused');
      },
      listProviders: async () => [],
    } as unknown;

    const caps: Capabilities = await detectCapabilities(mockClient as never);
    expect(caps.daemon).toBe(false);
    expect(caps.provider).toBe(false);
  });
});

describe('canEndRuns — the one run-ending capability question', () => {
  it('is true only when the daemon advertises runControls', () => {
    expect(canEndRuns(null)).toBe(false);
    expect(canEndRuns(undefined)).toBe(false);
    expect(canEndRuns({})).toBe(false);
    expect(canEndRuns({ runControls: false })).toBe(false);
    expect(canEndRuns(DEFAULT_CAPABILITIES)).toBe(false);
    expect(canEndRuns({ ...DEFAULT_CAPABILITIES, runControls: true })).toBe(true);
  });

  it('reads that one field and nothing else', () => {
    // Every other capability can be on — the run-ending answer is `runControls` alone.
    const everythingElseOn = {
      ...DEFAULT_CAPABILITIES,
      daemon: true,
      provider: true,
      runControls: false,
    };
    expect(canEndRuns(everythingElseOn)).toBe(false);
  });
});
