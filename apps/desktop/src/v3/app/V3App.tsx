import { invoke } from '@tauri-apps/api/core';
import type { WarshaClient } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { I18nProvider } from '@warsha/i18n/v3';
import React, { useEffect, useState } from 'react';

import { Frame } from '../pages/frame/Frame';
import { RouteOutlet, RouterProvider } from '../router';

import { CapabilitiesProvider } from './CapabilitiesContext';
import { ClientProvider, useClient } from './ClientContext';
import { DataReadyProvider } from './DataReadyContext';
import { DensityProvider } from './DensityContext';
import { ThemeProvider } from './ThemeContext';
import { decideStartupRoute } from './startup';

export interface V3AppProps {
  client?: WarshaClient;
  initialRoute?: string;
}

function V3AppInner({ initialRoute }: { initialRoute?: string }): React.ReactElement {
  const client = useClient();
  const [startupRoute, setStartupRoute] = useState<string | null>(initialRoute ?? null);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    if (initialRoute) {
      setStartupRoute(initialRoute);
      return;
    }

    const readConfig = async (key: string): Promise<string> => {
      try {
        return await invoke<string>('get_config', { key });
      } catch {
        return '';
      }
    };

    decideStartupRoute({ readConfig, client: client ?? undefined })
      .then((decision) => {
        setStartupRoute(decision.route);
        if (decision.error) {
          setStartupError(decision.error);
        }
      })
      .catch((err) => {
        setStartupRoute('/');
        setStartupError(err instanceof Error ? err.message : 'Startup failure');
      });
  }, [initialRoute, client]);

  return (
    <RouterProvider initialPath={startupRoute ?? '/'}>
      <Frame>
        {startupError && (
          <div className="v3-danger-banner" role="alert">
            {startupError}
          </div>
        )}
        <RouteOutlet />
      </Frame>
    </RouterProvider>
  );
}

export function V3App({ client, initialRoute }: V3AppProps): React.ReactElement {
  return (
    <ClientProvider client={client}>
      <CapabilitiesProvider client={client}>
        <I18nProvider>
          <ThemeProvider>
            <DensityProvider>
              <DataReadyProvider>
                <V3AppInner initialRoute={initialRoute} />
              </DataReadyProvider>
            </DensityProvider>
          </ThemeProvider>
        </I18nProvider>
      </CapabilitiesProvider>
    </ClientProvider>
  );
}

export default V3App;
