// @warsha/remote — the pairing plate: the bench's permission state (docs/design/REDESIGN.md §7).
//
// Nothing on the phone is readable until this device holds a session, so this is the first screen an
// owner meets and it has to do three things §7 asks of a permission state: name what is missing, say how
// to get it, and never imply that work was lost. The long Arabic sentence is the instruction, the field
// is a real labelled field, and the refusal lands beside the field rather than in a toast.
//
// The token rule is stated on the plate itself (`remote.session_token_note`) because it is the one
// promise this app makes about the owner's credentials: it lives in `sessionStorage`, is stripped from
// the address bar, and is redacted out of every message that could have carried it.
import { t, useDirection, useLocale } from '@warsha/i18n';
import {
  Box,
  Button,
  Field,
  Panel,
  Text,
  colorVar,
  fieldControl,
  fontFamily,
  fontSize,
  space,
} from '@warsha/ui';
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
      <Box dir={dir} className="remote-title">
        <ScreenTitle>{heading}</ScreenTitle>
      </Box>
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
  const control = fieldControl(fieldId, {
    hint: refused === null,
    error: error !== undefined,
    required: true,
  });

  return (
    <Panel
      className={className}
      title={title ?? t('remote.session_none_title', {}, locale)}
      label={t('remote.session_none_title', {}, locale)}
    >
      <Box dir={dir} className="remote-copy">
        {/* The first screen an unpaired phone meets names the product it is about to control (§5). */}
        <Text size="sm" weight="medium" dir={dir} style={{ color: colorVar('text') }}>
          {`${t('app.name', {}, locale)} — ${t('app.tagline', {}, locale)}`}
        </Text>
        <Text size="sm" dir={dir} style={{ color: colorVar('text'), marginBlockStart: space(2) }}>
          {t('remote.session_none_desc', {}, locale)}
        </Text>
      </Box>

      <form onSubmit={submit} dir={dir} className="remote-form">
        <Field
          id={fieldId}
          label={t('remote.pair_link_label', {}, locale)}
          hint={t('remote.pair_link_hint', {}, locale)}
          error={error}
          required
        >
          <input
            {...control}
            // A daemon address is LTR machinery inside an Arabic bench; the browser must not guess (§11).
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
            style={{ ...control.style, fontFamily: fontFamily('mono') }}
          />
        </Field>

        <Button type="submit" variant="primary" dir={dir} data-testid="remote-pair-submit">
          {t('remote.pair_submit', {}, locale)}
        </Button>
      </form>

      <Box dir={dir} style={{ marginBlockStart: space(3) }}>
        <Text
          size="xs"
          dir={dir}
          style={{ color: colorVar('text'), fontSize: fontSize('xs'), maxInlineSize: 'var(--warsha-size-measure)' }}
        >
          {t('remote.session_token_note', {}, locale)}
        </Text>
      </Box>
    </Panel>
  );
}
