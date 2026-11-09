// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import React from 'react';

export default function InboxPage(): React.ReactElement {
  const t = useT();
  return (
    <div>
      <h1>{t('inbox.title')}</h1>
    </div>
  );
}
