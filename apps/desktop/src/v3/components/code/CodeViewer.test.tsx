// apps/desktop/src/v3/components/code/CodeViewer.test.tsx
// Design pass: the read-only viewer shows the kit's empty state, one skeleton while a file loads, and a danger
// banner (never a silent blank) when the read fails.
import { render, screen, waitFor } from '@testing-library/react';
import type { WarshaClient } from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../app/ClientContext';
import { RouterProvider } from '../../router';

import CodeViewer from './CodeViewer';

function renderViewer(client: WarshaClient | null): void {
  render(
    <I18nProvider initialLocale="en">
      <ClientProvider client={client}>
        <RouterProvider initialPath="/p/p1/code">
          <CodeViewer />
        </RouterProvider>
      </ClientProvider>
    </I18nProvider>
  );
}

describe('CodeViewer states', () => {
  afterEach(() => {
    window.location.hash = '';
    vi.restoreAllMocks();
  });

  it('shows the empty state with native copy when no file is chosen', () => {
    window.location.hash = '#/p/p1/code';
    renderViewer({} as WarshaClient);
    expect(screen.getByTestId('code-viewer-empty')).toBeDefined();
    expect(screen.getByText('No file selected')).toBeDefined();
  });

  it('shows a loading skeleton, then a danger banner when the file cannot be read', async () => {
    window.location.hash = '#/p/p1/code?file=src/a.ts';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let reject: (reason: Error) => void = () => undefined;
    const client = {
      readFileContent: vi.fn(
        () =>
          new Promise((_resolve, rejectRead) => {
            reject = rejectRead;
          })
      ),
    } as unknown as WarshaClient;
    renderViewer(client);

    await waitFor(() => expect(screen.getByTestId('code-viewer-loading')).toBeDefined());
    expect(screen.getByText('src/a.ts')).toBeDefined();

    reject(new Error('gone'));
    await waitFor(() => expect(screen.getByTestId('code-viewer-error')).toBeDefined());
    expect(screen.getByText(/Couldn't open this file/)).toBeDefined();
    expect(screen.queryByTestId('code-viewer-loading')).toBeNull();
  });
});
