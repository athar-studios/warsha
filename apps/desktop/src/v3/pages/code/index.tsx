import { useT } from '@warsha/i18n/v3';
import React, { lazy, Suspense, useEffect } from 'react';

import { useDataReady } from '../../app/DataReadyContext';
import { CodeSkeleton } from '../../components/code/CodeSkeleton';
import './code.css';

const CodeViewer = lazy(() => import(/* webpackChunkName: "code-viewer" */ '../../components/code/CodeViewer'));

const CodePage: React.FC = () => {
  const t = useT();
  const { setReady } = useDataReady();

  // The page has no primary data of its own; the viewer reports empty/error states itself.
  useEffect(() => {
    setReady(true);
  }, [setReady]);

  return (
    <div className="v3-code-page" data-testid="code-page">
      <Suspense fallback={<CodeSkeleton label={t('code.loading')} />}>
        <CodeViewer />
      </Suspense>
    </div>
  );
};

export default CodePage;
