import { invoke } from '@tauri-apps/api/core';
import { createClient, type WarshaClient } from '@warsha/client';
import React, { createContext, useContext, useEffect, useState } from 'react';

import { readDaemonEndpoint } from '../../daemon';

const ClientContext = createContext<WarshaClient | null>(null);

export interface ClientProviderProps {
  client?: WarshaClient;
  children: React.ReactNode;
}

export function ClientProvider({ client: clientProp, children }: ClientProviderProps): React.ReactElement {
  const [resolvedClient, setResolvedClient] = useState<WarshaClient | null>(() => clientProp ?? null);

  useEffect(() => {
    if (clientProp) {
      setResolvedClient(clientProp);
      return;
    }

    readDaemonEndpoint(invoke)
      .then((endpoint) => {
        if (endpoint.baseUrl) {
          setResolvedClient(createClient(endpoint.baseUrl, endpoint.token));
        }
      })
      .catch(() => {
        // In plain browser / test environment, endpoint may not resolve
      });
  }, [clientProp]);

  return <ClientContext.Provider value={resolvedClient}>{children}</ClientContext.Provider>;
}

export function useClient(): WarshaClient | null {
  return useContext(ClientContext);
}
