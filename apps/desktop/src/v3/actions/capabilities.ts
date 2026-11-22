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
  /**
   * Whether the daemon can honour the run-ending controls (`gates.changes`,
   * `gates.reject`, `runs.cancel`). This is the daemon's own probed answer
   * (`HealthCapabilities.run_controls`), not a guess about this build: `false` until
   * `health` says otherwise, so a control is never offered for a call the daemon cannot
   * serve (R-UI-2 D3).
   */
  runControls: boolean;
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
  // Off by default: run-ending controls appear only when the daemon advertises
  // `run_controls`, which is what makes "hidden" the honest state for an older daemon.
  runControls: false,
};

export async function detectCapabilities(client: WarshaClient): Promise<Capabilities> {
  let daemon = false;
  let provider = false;
  let runControls = false;

  try {
    const health = await client.health();
    if (health && typeof health.status === 'string') {
      daemon = true;
      // The one place the run-ending capability is read: the daemon decodes
      // `capabilities.run_controls` in `health()` (`@warsha/client`), and a daemon that
      // does not state it — or states `false` — leaves the controls hidden.
      runControls = health.capabilities?.runControls === true;
    }
  } catch {
    daemon = false;
    runControls = false;
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
    runControls,
  };
}

/**
 * The one question every run-ending control asks.
 *
 * `gates.changes`, `gates.reject` and `runs.cancel` end a run, so the Bench, Project and
 * Inbox controls that call them render only when the daemon advertises that it can serve
 * them (`Capabilities.runControls`, probed against the store's run-version column). This
 * function reads that one field and nothing else — no `window` flag, no second capability
 * key — so there is exactly one answer to the question (R-UI-2 D3).
 */
export function canEndRuns(capabilities: { runControls?: boolean } | null | undefined): boolean {
  return capabilities?.runControls === true;
}
