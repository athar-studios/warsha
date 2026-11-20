import { invoke } from '@tauri-apps/api/core';
import { createClient, type WarshaClient } from '@warsha/client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { readDaemonEndpoint } from '../../daemon';

export interface ClientContextValue {
  client: WarshaClient | null;
  reloadClient: () => Promise<WarshaClient | null>;
}

const ClientContext = createContext<ClientContextValue>({
  client: null,
  reloadClient: async () => null,
});

export interface ClientProviderProps {
  client?: WarshaClient | null;
  children: React.ReactNode;
}

export function ClientProvider({ client: clientProp, children }: ClientProviderProps): React.ReactElement {
  const [resolvedClient, setResolvedClient] = useState<WarshaClient | null>(() => clientProp ?? null);

  const reloadClient = useCallback(async (): Promise<WarshaClient | null> => {
    if (clientProp) {
      setResolvedClient(clientProp);
      return clientProp;
    }

    try {
      const endpoint = await readDaemonEndpoint(async (key: string) => {
        try {
          return await invoke<string>('get_config', { key });
        } catch {
          return '';
        }
      });
      if (endpoint.baseUrl) {
        const newClient = createClient(endpoint.baseUrl, endpoint.token);
        setResolvedClient(newClient);
        return newClient;
      }
    } catch {
      // In plain browser / test environment, endpoint may not resolve
    }
    setResolvedClient(null);
    return null;
  }, [clientProp]);

  useEffect(() => {
    if (clientProp) {
      setResolvedClient(clientProp);
      return;
    }
    void reloadClient();
  }, [clientProp, reloadClient]);

  const value = useMemo<ClientContextValue>(
    () => ({
      client: resolvedClient,
      reloadClient,
    }),
    [resolvedClient, reloadClient]
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient(): WarshaClient | null {
  return useContext(ClientContext).client;
}

export function useReloadClient(): () => Promise<WarshaClient | null> {
  return useContext(ClientContext).reloadClient;
}
