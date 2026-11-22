import type { WarshaClient } from '@warsha/client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_CAPABILITIES,
  detectCapabilities,
  type Capabilities,
} from '../actions/capabilities';

import { useClient } from './ClientContext';

interface CapabilitiesContextValue {
  capabilities: Capabilities;
  reload: () => Promise<void>;
}

const CapabilitiesContext = createContext<CapabilitiesContextValue>({
  capabilities: DEFAULT_CAPABILITIES,
  reload: async () => {},
});

export interface CapabilitiesProviderProps {
  initialCapabilities?: Capabilities;
  client?: WarshaClient;
  children: React.ReactNode;
}

export function CapabilitiesProvider({
  initialCapabilities,
  client: propClient,
  children,
}: CapabilitiesProviderProps): React.ReactElement {
  const contextClient = useClient();
  const client = propClient ?? contextClient;

  const [capabilities, setCapabilities] = useState<Capabilities>(
    () => initialCapabilities ?? DEFAULT_CAPABILITIES
  );

  const reload = useCallback(async (): Promise<void> => {
    if (!client) return;
    try {
      const detected = await detectCapabilities(client);
      setCapabilities(detected);
    } catch {
      // Keep existing capabilities on reload failure
    }
  }, [client]);

  useEffect(() => {
    if (client) {
      void reload();
    }
  }, [client, reload]);

  const value = useMemo(() => ({ capabilities, reload }), [capabilities, reload]);

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext).capabilities;
}

export function useReloadCapabilities(): () => Promise<void> {
  return useContext(CapabilitiesContext).reload;
}
