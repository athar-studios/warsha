import React, { lazy, Suspense } from 'react';

import { useT } from '@warsha/i18n/v3';

const CodeViewer = lazy(() => import(/* webpackChunkName: "code-viewer" */ '../../components/code/CodeViewer'));

const CodePage: React.FC = () => {
  const t = useT();
  return (
    <Suspense fallback={<div>{t('code.loading')}</div>}>
      <CodeViewer />
    </Suspense>
  );
};

export default CodePage;
