import { describe, expect, it } from 'vitest';

import { detectCapabilities, type Capabilities } from './capabilities';

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
