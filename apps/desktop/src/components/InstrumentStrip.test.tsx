// Tests for the instrument strip's P0 guard: a run whose stage the daemon never reported.
//
// The black screen came from `stage.startsWith` running against `undefined` — a raw wire row
// whose `current_stage` the old client passed through under a name the strip did not read.
// The strip now says a missing reading in words (`bench.not_reported`), and rendering a run
// with no stage must never throw.
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { RunSummary, Stage } from '@warsha/client';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { InstrumentStrip } from './InstrumentStrip';

const BASE_RUN = {
  id: 'run-9f3a',
  projectId: 'proj-1',
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-28T00:00:00Z',
  updatedAt: '2026-10-28T00:01:00Z',
} as unknown as RunSummary;

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

function strip(run: RunSummary | null) {
  return (
    <InstrumentStrip daemonOnline run={run} gatesWaiting={null} budget={null} />
  );
}

describe('InstrumentStrip stage guard', () => {
  it('prints the stage word when the run has one', () => {
    renderIn('en', strip(BASE_RUN));
    expect(screen.getByText(/Code/i)).toBeInTheDocument();
  });

  for (const missing of [undefined, null, '']) {
    it(`renders words — never throws — when the stage is ${JSON.stringify(missing)}`, () => {
      const broken = { ...BASE_RUN, stage: missing as unknown as Stage };
      expect(() => renderIn('en', strip(broken))).not.toThrow();
      expect(screen.getAllByText(/not reported/i).length).toBeGreaterThan(0);
    });
  }

  it('says the same in Arabic', () => {
    const broken = { ...BASE_RUN, stage: undefined } as unknown as RunSummary;
    renderIn('ar', strip(broken));
    expect(screen.getAllByText(/لم/).length).toBeGreaterThan(0);
  });

  it('treats a missing run as a missing reading, as it always did', () => {
    renderIn('en', strip(null));
    expect(screen.getAllByText(/no run|not reported/i).length).toBeGreaterThan(0);
  });
});
