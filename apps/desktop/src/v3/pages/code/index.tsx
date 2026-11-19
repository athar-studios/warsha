import { useT } from '@warsha/i18n/v3';
import React, { lazy, Suspense, useEffect } from 'react';

import { useDataReady } from '../../app/DataReadyContext';

const CodeViewer = lazy(() => import(/* webpackChunkName: "code-viewer" */ '../../components/code/CodeViewer'));

const CodePage: React.FC = () => {
  const t = useT();
  const { setReady } = useDataReady();

  // The page has no primary data of its own; the viewer reports empty/error states itself.
  useEffect(() => {
    setReady(true);
  }, [setReady]);

  return (
    <div data-testid="code-page">
      <Suspense fallback={<div>{t('code.loading')}</div>}>
        <CodeViewer />
      </Suspense>
    </div>
  );
};

export default CodePage;
