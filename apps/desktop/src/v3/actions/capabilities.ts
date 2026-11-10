import type { WarshaClient } from '@warsha/client';

export interface Capabilities {
  daemon: boolean;
  provider: boolean;
  devices: boolean;
  integrations: boolean;
  plugins: boolean;
  skills: boolean;
  harnesses: boolean;
  routines: boolean;
  preview: boolean;
  backend: boolean;
}

export const DEFAULT_CAPABILITIES: Capabilities = {
  daemon: false,
  provider: false,
  devices: true,
  integrations: true,
  plugins: true,
  skills: true,
  harnesses: true,
  routines: true,
  preview: true,
  backend: true,
};

export async function detectCapabilities(client: WarshaClient): Promise<Capabilities> {
  let daemon = false;
  let provider = false;

  try {
    const health = await client.health();
    if (health && typeof health.status === 'string') {
      daemon = true;
    }
  } catch {
    daemon = false;
  }

  if (daemon) {
    try {
      const providers = await client.listProviders();
      // provider = at least one provider configured / tested OK
      provider = Array.isArray(providers) && providers.length > 0;
    } catch {
      provider = false;
    }
  }

  return {
    daemon,
    provider,
    devices: true,
    integrations: true,
    plugins: true,
    skills: true,
    harnesses: true,
    routines: true,
    preview: true,
    backend: true,
  };
}
