// @warsha/remote — the pairing plate: the bench's permission state (docs/design/REDESIGN.md §7).
// Rebuilt on @warsha/ui/v3 per DESIGN_SYSTEM_V3.md.
import { t, useDirection, useLocale } from '@warsha/i18n';
// eslint-disable-next-line import/no-unresolved
import { Button, Card, TextField } from '@warsha/ui/v3';
import React, { useCallback, useId, useState } from 'react';

import { useRemote } from './bench';
import { ScreenTitle } from './chrome';
import type { PairingFailure } from './session';

/** The catalog key that names why a link was refused. */
function reasonKey(reason: PairingFailure): string {
  return `remote.pair_reason.${reason}`;
}

/** The plate's own heading, then the form: what a data screen shows while this device holds no session. */
export function UnpairedScreen({ heading, testId }: { heading: string; testId: string }) {
  const dir = useDirection();
  return (
    <div dir={dir} className="remote-screen" data-testid={testId}>
      <div dir={dir} className="remote-title">
        <ScreenTitle>{heading}</ScreenTitle>
      </div>
      <PairingPlate />
    </div>
  );
}

export interface PairingPlateProps {
  /** The plate's own heading; the settings screen names it differently from the bench's first run. */
  title?: string;
  className?: string;
}

/** The pairing form. `useRemote().pair` answers whether the link became a session. */
export function PairingPlate({ title, className = '' }: PairingPlateProps) {
  const dir = useDirection();
  const locale = useLocale();
  const { pair } = useRemote();
  const [link, setLink] = useState('');
  const [refused, setRefused] = useState<PairingFailure | null>(null);
  const fieldId = useId();

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const failure = pair(link);
      setRefused(failure);
      if (failure === null) setLink('');
    },
    [pair, link]
  );

  const error = refused === null ? undefined : t(reasonKey(refused), {}, locale);
  const plateTitle = title ?? t('remote.session_none_title', {}, locale);

  return (
    <section aria-label={plateTitle}>
      <Card className={className} title={plateTitle} variant="default">
        <div dir={dir} className="remote-copy">
          {/* The first screen an unpaired phone meets names the product it is about to control (§5). */}
          <div
            dir={dir}
            style={{
              color: 'var(--w-text)',
              fontSize: 'var(--w-font-size-sm)',
              fontWeight: 'var(--w-font-weight-medium)',
              lineHeight: 'var(--w-line-height-sm)',
            }}
          >
            {`${t('app.name', {}, locale)} — ${t('app.tagline', {}, locale)}`}
          </div>
          <div
            dir={dir}
            style={{
              color: 'var(--w-text)',
              fontSize: 'var(--w-font-size-sm)',
              lineHeight: 'var(--w-line-height-sm)',
              marginBlockStart: 'var(--w-space-2)',
            }}
          >
            {t('remote.session_none_desc', {}, locale)}
          </div>
        </div>

        <form noValidate onSubmit={submit} dir={dir} className="remote-form">
          <TextField
            id={fieldId}
            label={t('remote.pair_link_label', {}, locale)}
            hint={t('remote.pair_link_hint', {}, locale)}
            error={error}
            required
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            translate="no"
            value={link}
            onChange={(event) => {
              setLink(event.target.value);
              if (refused !== null) setRefused(null);
            }}
            style={{ fontFamily: 'var(--w-font-mono)' }}
          />

          <Button type="submit" variant="primary" data-testid="remote-pair-submit">
            {t('remote.pair_submit', {}, locale)}
          </Button>
        </form>

        <div dir={dir} style={{ marginBlockStart: 'var(--w-space-3)' }}>
          <p
            dir={dir}
            style={{
              color: 'var(--w-text)',
              fontSize: 'var(--w-font-size-xs)',
              lineHeight: 'var(--w-line-height-xs)',
              margin: 0,
              maxInlineSize: 'var(--w-content-narrow)',
            }}
          >
            {t('remote.session_token_note', {}, locale)}
          </p>
        </div>
      </Card>
    </section>
  );
}
