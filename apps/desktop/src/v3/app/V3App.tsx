import { invoke } from '@tauri-apps/api/core';
import type { WarshaClient } from '@warsha/client';
import { I18nProvider, useT } from '@warsha/i18n/v3';
import '@warsha/ui/v3/fonts.css';
import React, { useEffect, useState } from 'react';

import { Frame } from '../pages/frame/Frame';
import { RouteOutlet, RouterProvider } from '../router';
import { WebMcpBridge } from '../webmcp/WebMcpBridge';

import { CapabilitiesProvider } from './CapabilitiesContext';
import { ClientProvider, useClient } from './ClientContext';
import { DataReadyProvider } from './DataReadyContext';
import { DensityProvider } from './DensityContext';
import { ThemeProvider } from './ThemeContext';
import { decideStartupRoute, type StartupErrorKey } from './startup';

export interface V3AppProps {
  client?: WarshaClient;
  initialRoute?: string;
}

interface StartupFailure {
  key: StartupErrorKey;
  detail: string | null;
}

function V3AppInner({ initialRoute }: { initialRoute?: string }): React.ReactElement {
  const client = useClient();
  const t = useT();
  const [startupRoute, setStartupRoute] = useState<string | null>(initialRoute ?? null);
  const [startupError, setStartupError] = useState<StartupFailure | null>(null);

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
        setStartupError(
          decision.error === undefined
            ? null
            : { key: decision.error, detail: decision.errorDetail ?? null }
        );
      })
      .catch((err) => {
        setStartupRoute('/');
        setStartupError({
          key: 'startup.errors.unexpected',
          detail: err instanceof Error ? err.message : String(err),
        });
      });
  }, [initialRoute, client]);

  return (
    <RouterProvider initialPath={startupRoute ?? '/'}>
      <WebMcpBridge />
      <Frame>
        {startupError !== null && (
          <div className="v3-danger-banner" role="alert">
            {t(startupError.key)}
            {startupError.detail !== null && (
              <span className="v3-danger-detail" dir="auto">
                {' '}
                {startupError.detail}
              </span>
            )}
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
