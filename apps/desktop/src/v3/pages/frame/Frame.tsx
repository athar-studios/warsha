// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import React from 'react';

import { useDataReady } from '../../app/DataReadyContext';

export interface FrameProps {
  children?: React.ReactNode;
}

export function Frame({ children }: FrameProps): React.ReactElement {
  const { isReady } = useDataReady();
  const t = useT();
  return (
    <div className="v3-frame-root">
      <header className="v3-frame-topbar">
        <h1>{t('common.app_name')}</h1>
      </header>
      <main data-ready={isReady ? 'true' : 'false'}>
        {children}
      </main>
    </div>
  );
}

export default Frame;
