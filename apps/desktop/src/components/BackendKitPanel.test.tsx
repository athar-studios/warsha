// Tests for the backend kit panel (PLAN.md M19): the kind selector, the service
// toggles, the generated-table list, the export button and the payments gate.
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  BackendKitPanel,
  allBackendFeatures,
  backendKinds,
  canExport,
  paymentsGateEnabled,
  paymentsGateText,
  type BackendTable,
  type BackendKitPanelProps,
  type PaymentsGateStatus,
} from './BackendKitPanel';

function renderIn(locale: 'ar' | 'en', node: ReactElement) {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>);
}

const tables: BackendTable[] = [
  {
    name: 'posts',
    columns: [
      { name: 'id', colType: 'TEXT', nullable: false },
      { name: 'body', colType: 'TEXT', nullable: true },
    ],
  },
  { name: 'comments', columns: [{ name: 'id', colType: 'TEXT', nullable: false }] },
];

const shutGate: PaymentsGateStatus = { enabled: false, approvedBy: null, approvedAt: null };

function props(overrides: Partial<BackendKitPanelProps> = {}): BackendKitPanelProps {
  return {
    kind: 'pocket_base',
    url: 'http://127.0.0.1:8090',
    features: ['auth', 'storage'],
    tables,
    payments: shutGate,
    onKindChange: () => {},
    onToggleFeature: () => {},
    onExport: () => {},
    ...overrides,
  };
}

describe('BackendKitPanel', () => {
  it('offers the two backends in order and marks the current one', () => {
    renderIn('en', <BackendKitPanel {...props()} />);

    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('PocketBase');
    expect(options[1]).toHaveTextContent('Supabase');
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(options[1]).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radiogroup', { name: 'Backend' })).toBeInTheDocument();
    // The URL is shown, isolated LTR.
    expect(screen.getByText('http://127.0.0.1:8090')).toHaveAttribute('dir', 'ltr');
  });

  it('calls back with the picked backend', () => {
    const onKindChange = vi.fn();
    renderIn('en', <BackendKitPanel {...props({ onKindChange })} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Supabase' }));

    expect(onKindChange).toHaveBeenCalledWith('supabase');
  });

  it('lists all five services and toggles one', () => {
    const onToggleFeature = vi.fn();
    renderIn(
      'en',
      <BackendKitPanel {...props({ features: ['auth', 'storage'], onToggleFeature })} />
    );

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(5);
    expect(screen.getByRole('checkbox', { name: 'Auth' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Storage' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Push' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Push' }));
    expect(onToggleFeature).toHaveBeenCalledWith('push', true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Auth' }));
    expect(onToggleFeature).toHaveBeenCalledWith('auth', false);
  });

  it('lists the generated tables with their columns, and says when there are none', () => {
    const { unmount } = renderIn('en', <BackendKitPanel {...props()} />);

    expect(screen.getByText('posts')).toBeInTheDocument();
    expect(screen.getByText('id TEXT, body TEXT (nullable)')).toBeInTheDocument();
    expect(screen.getByText('comments')).toBeInTheDocument();
    unmount();

    renderIn('en', <BackendKitPanel {...props({ tables: [] })} />);
    expect(screen.getByText('No tables yet')).toBeInTheDocument();
    expect(screen.queryByText('posts')).not.toBeInTheDocument();
  });

  it('exports only when there is a schema to export', () => {
    const onExport = vi.fn();
    const { unmount } = renderIn('en', <BackendKitPanel {...props({ onExport })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    unmount();

    renderIn('en', <BackendKitPanel {...props({ onExport, tables: [] })} />);
    const blocked = screen.getByRole('button', { name: 'Export' });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute('title', 'Nothing to export yet');
    fireEvent.click(blocked);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('shows the payments gate shut and open', () => {
    const { unmount } = renderIn('en', <BackendKitPanel {...props()} />);

    const shut = screen.getByTestId('payments-gate');
    expect(shut).toHaveAttribute('data-enabled', 'false');
    expect(shut).toHaveTextContent('Off — owner approval required');
    unmount();

    renderIn(
      'en',
      <BackendKitPanel
        {...props({ payments: { enabled: true, approvedBy: 'owner', approvedAt: 1700000000 } })}
      />
    );

    const open = screen.getByTestId('payments-gate');
    expect(open).toHaveAttribute('data-enabled', 'true');
    expect(open).toHaveTextContent('Enabled — approved by owner @ 1700000000');
  });

  it('follows the locale and mirrors for RTL', () => {
    renderIn('ar', <BackendKitPanel {...props()} />);

    const panel = screen.getByTestId('backend-kit-panel');
    expect(panel).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('region', { name: 'حزمة الواجهة الخلفية' })).toBe(panel);
    expect(screen.getByRole('radio', { name: 'بوكيت بيز' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('checkbox', { name: 'أمان الصفوف (RLS)' })).not.toBeChecked();
    expect(screen.getByText('الجداول')).toBeInTheDocument();
    // Identifiers and the URL stay LTR inside the mirrored panel.
    expect(screen.getByText('http://127.0.0.1:8090')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('payments-gate')).toHaveTextContent('متوقفة — تحتاج موافقة المالك');
  });
});

describe('backend kit helpers', () => {
  it('counts the gate as open only with a named owner and a timestamp', () => {
    expect(paymentsGateEnabled(shutGate)).toBe(false);
    expect(paymentsGateEnabled({ enabled: true })).toBe(false);
    expect(paymentsGateEnabled({ enabled: true, approvedBy: '   ', approvedAt: 1700000000 })).toBe(
      false
    );
    expect(paymentsGateEnabled({ enabled: true, approvedBy: 'owner', approvedAt: 0 })).toBe(false);
    // The flag alone is not an approval.
    expect(paymentsGateEnabled({ enabled: true, approvedBy: null, approvedAt: null })).toBe(false);
    expect(
      paymentsGateEnabled({ enabled: true, approvedBy: 'owner', approvedAt: 1700000000 })
    ).toBe(true);
  });

  it('needs one table before an export makes sense', () => {
    expect(canExport([])).toBe(false);
    expect(canExport(tables)).toBe(true);
    expect(backendKinds).toEqual(['pocket_base', 'supabase']);
    expect(allBackendFeatures).toHaveLength(5);
  });

  it('renders the gate line from one table in both locales', () => {
    const open: PaymentsGateStatus = {
      enabled: true,
      approvedBy: 'owner',
      approvedAt: 1700000000,
    };
    expect(paymentsGateText(shutGate, 'en')).toBe('Off — owner approval required');
    expect(paymentsGateText(open, 'en')).toBe('Enabled — approved by owner @ 1700000000');
    expect(paymentsGateText(shutGate, 'ar')).toBe('متوقفة — تحتاج موافقة المالك');
  });
});
