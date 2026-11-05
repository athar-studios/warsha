// @warsha/remote — the settings entry point on the phone: three plates, a tab strip and a session.
//
// §4 gives the settings screens one horizontally scrollable `role="tablist"`, and §9 gives a tablist a
// roving tabindex — one tab in the Tab order, the arrows moving between the rest, Enter or Space
// selecting. These cases test that keyboard path, the two owner choices (language, theme), and the
// session's own permission and success states (§7).
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { DEVICES, SESSION, fullApi, renderRemote, settle, stubApi } from './testkit';

async function openSettings(options: Parameters<typeof renderRemote>[0] = {}) {
  renderRemote({ session: SESSION, route: '/settings', ...options });
  await settle();
}

describe('the settings tab strip', () => {
  it('is one tablist with three tabs and a roving tabindex', async () => {
    await openSettings();

    const tablist = screen.getByRole('tablist', { name: 'شاشات الإعدادات' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['التفضيلات', 'جلسة هذا الجهاز', 'عن التطبيق']);

    // Exactly one tab is in the Tab order; the arrows own the rest (§9).
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-controls', 'settings-panel-preferences');
  });

  it('moves focus with the arrows and selects with the keyboard', async () => {
    await openSettings();
    const tablist = screen.getByRole('tablist', { name: 'شاشات الإعدادات' });
    const tabs = within(tablist).getAllByRole('tab');

    // The bench is mirrored in Arabic, so `ArrowLeft` advances (§11: the mirror lives in one helper).
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(tabs[1]).toHaveFocus();
    // Focus moved; selection did not. Manual activation is the pattern a panel that would fetch something
    // needs, and Enter/Space are the button's own keys (jsdom does not synthesize them, so the press that
    // selects is asserted as a click on the focused tab).
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'جلسة هذا الجهاز' })).toBeInTheDocument();
  });

  it('wraps at the ends, so the last tab is never a dead end', async () => {
    await openSettings();
    const tablist = screen.getByRole('tablist', { name: 'شاشات الإعدادات' });
    const tabs = within(tablist).getAllByRole('tab');

    // In RTL, "previous" from the first tab is the last one.
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[2]).toHaveFocus();

    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(tabs[0]).toHaveFocus();
  });

  it('is a region of its own, so the panel it shows names itself to the tree', async () => {
    await openSettings();

    const panel = screen.getByRole('tabpanel', { name: 'التفضيلات' });
    expect(panel).toHaveAttribute('tabindex', '0');
  });
});

describe('the preferences plate', () => {
  it('switches the language from the plate, with the hint that explains what pressing it does', async () => {
    const { localeStore } = renderRemote({ session: SESSION, route: '/settings' });
    await settle();

    // Scoped to the plate: the top bar carries its own language group, and both are named "language".
    const plate = screen.getByRole('tabpanel', { name: 'التفضيلات' });
    const group = within(plate).getByRole('group', { name: 'اللغة' });
    expect(within(group).getByRole('button', { name: 'العربية' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(plate).getByText('تبديل اللغة يقلب الاتجاه فوراً ويحفظ اختيارك.')).toBeInTheDocument();

    fireEvent.click(within(group).getByRole('button', { name: 'English' }));
    await settle();

    expect(localeStore.values['warsha.locale']).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('tablist', { name: 'Settings screens' })).toBeInTheDocument();
  });

  it('writes the theme choice into the same key the desktop uses', async () => {
    const { themeStore } = renderRemote({ session: SESSION, route: '/settings' });
    await settle();

    const group = within(screen.getByRole('tabpanel', { name: 'التفضيلات' })).getByRole('group', {
      name: 'المظهر',
    });
    fireEvent.click(within(group).getByRole('button', { name: 'داكن' }));
    await settle();

    expect(themeStore.values['warsha.theme']).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    // The hint is the chosen one's own sentence, so the plate explains the state it shows (§7).
    expect(screen.getByText('الواجهة الداكنة دائمًا.')).toBeInTheDocument();
  });

  it('keeps the machine readings of this device in mono', async () => {
    await openSettings();

    const plate = screen.getByRole('tabpanel', { name: 'التفضيلات' });
    expect(within(plate).getByText('ar', { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(within(plate).getByText('system', { selector: '[translate="no"]' })).toBeInTheDocument();
  });
});

describe('the session plate', () => {
  it('reports the daemon, the endpoint and the version — the success state, stated quietly', async () => {
    await openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));
    const plate = screen.getByRole('tabpanel', { name: 'جلسة هذا الجهاز' });

    // Scoped: the instrument strip reports the same daemon reading at the top of the bench.
    expect(within(plate).getByText('الخادم متصل')).toBeInTheDocument();
    expect(within(plate).getByText('هذا الجهاز مقترن')).toBeInTheDocument();
    expect(within(plate).getByText('عنوان الخادم')).toBeInTheDocument();
    expect(within(plate).getByText(SESSION.baseUrl, { selector: '[translate="no"]' })).toBeInTheDocument();
    expect(within(plate).getByText('إصدار الخادم')).toBeInTheDocument();
    expect(within(plate).getByText('0.2.0', { selector: '[translate="no"]' })).toBeInTheDocument();
    // The token promise is on the plate, not buried in a privacy page.
    expect(within(plate).getByText(/لا يظهر في أي رسالة خطأ/)).toBeInTheDocument();
  });

  it('asks twice before it ends the session, and Escape is the first answer', async () => {
    const { sessionStore } = renderRemote({ session: SESSION, route: '/settings' });
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));

    const end = screen.getByRole('button', { name: 'أنهِ جلسة هذا الجهاز' });
    fireEvent.click(end);

    // The same control, now asking to confirm, and describing why (§9: no `window.confirm`).
    const confirm = screen.getByRole('button', { name: 'نعم، أنهِ الجلسة' });
    expect(confirm).toHaveAttribute('aria-describedby', 'remote-session-end-hint');
    expect(screen.getByText(/يُسقط الرمز من هذا المتصفح/)).toBeInTheDocument();

    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'أنهِ جلسة هذا الجهاز' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'أنهِ جلسة هذا الجهاز' }));
    fireEvent.click(screen.getByRole('button', { name: 'نعم، أنهِ الجلسة' }));
    await settle();

    // The bench is back to the pairing plate, and the tab store no longer holds a token.
    expect(screen.getByTestId('remote-session-ended')).toHaveTextContent('أُنهيت الجلسة على هذا الجهاز');
    expect(screen.getByRole('textbox', { name: 'رابط الإقران' })).toBeInTheDocument();
    expect(sessionStore.values['warsha.remote.session']).toBeUndefined();
  });

  it('reconnects by reading the bench again', async () => {
    let reads = 0;
    const api = stubApi({
      health: () => {
        reads += 1;
        return Promise.resolve({ status: 'ok', version: '0.2.0' });
      },
    });
    await openSettings({ api });
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));

    fireEvent.click(screen.getByTestId('remote-session-reconnect'));
    await settle();
    expect(reads).toBe(2);
  });

  it('shows the pairing plate when this device holds nothing', async () => {
    renderRemote({ session: null, route: '/settings' });
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));

    expect(screen.getByRole('textbox', { name: 'رابط الإقران' })).toBeInTheDocument();
  });
});

describe('the about plate', () => {
  it('says what this surface is, in both languages', async () => {
    await openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'عن التطبيق' }));

    expect(screen.getByText('عن الطاولة البعيدة')).toBeInTheDocument();
    expect(
      screen.getByText('ورشة مصنع برمجيات يقودُه مالكه: يعمل الفريق بالذكاء الاصطناعي، ولا تعبر البوّابات إلا بقرارك. هذه الطاولة البعيدة للقراءة والقرار فقط.')
    ).toBeInTheDocument();
    expect(screen.getByText('ورشة — مصنع برمجيات بالذكاء الاصطناعي، عربي أولاً')).toBeInTheDocument();
  });
});

describe('the no-keys notice', () => {
  const AR_NOTICE =
    'مفاتيح نماذج الذكاء الاصطناعي تبقى على خادم ورشة؛ أدرها من طاولة الحاسوب أو عبر متغيّرات بيئة الخادم.';

  it('stands on the session plate, and no key field is there to mistype into', async () => {
    await openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));

    const plate = screen.getByRole('tabpanel', { name: 'جلسة هذا الجهاز' });
    expect(within(plate).getByTestId('remote-no-llm-keys-notice')).toHaveTextContent(AR_NOTICE);
    // The companion boundary is structural: a paired session plate has no text field at all,
    // and no secret field anywhere on the screen — keys live on the server, and the phone says so.
    expect(within(plate).queryByRole('textbox')).toBeNull();
    expect(plate.querySelector('input[type="password"]')).toBeNull();
  });

  it('stands on the about plate too, in Arabic', async () => {
    await openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'عن التطبيق' }));

    expect(screen.getByTestId('remote-no-llm-keys-notice')).toHaveTextContent(AR_NOTICE);
  });

  it('says the same sentence in English when the owner reads in English', async () => {
    await openSettings({ locale: 'en' });
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByTestId('remote-no-llm-keys-notice')).toHaveTextContent(
      'Model keys live on your Warsha server — manage them on Desktop or via server environment variables.'
    );
  });
});

describe('the paired-devices plate on the session tab', () => {
  it('lists the devices the daemon reports, with each id in the mono face', async () => {
    renderRemote({ session: SESSION, route: '/settings', api: fullApi() });
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));

    const list = screen.getByTestId('remote-devices-list');
    expect(within(list).getByText('Surface')).toBeInTheDocument();
    expect(within(list).getByText('Pixel')).toBeInTheDocument();
    // A 390px row shortens the id but keeps it reachable in the title (§11).
    expect(within(list).getByText('device-des…', { selector: '[translate="no"]' })).toBeInTheDocument();
  });

  it('revokes another device through `devices.revoke` and drops its row', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/settings', api: fullApi() });
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));

    fireEvent.click(screen.getByTestId('remote-device-revoke-device-phone-b'));
    await settle();

    expect(calls).toContain('revokeDevice');
    const list = screen.getByTestId('remote-devices-list');
    expect(within(list).queryByText('Pixel')).toBeNull();
    expect(within(list).getByText('Surface')).toBeInTheDocument();
  });

  it('never offers a revoke for the device this session belongs to', async () => {
    const api = fullApi({
      listDevices: () => Promise.resolve([{ ...DEVICES[0], isCurrent: true }, DEVICES[1]]),
    });
    renderRemote({ session: SESSION, route: '/settings', api });
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));

    // Ending your own session is the two-press button on the session plate, not a row action.
    expect(screen.queryByTestId('remote-device-revoke-device-desktop')).toBeNull();
    expect(screen.getByTestId('remote-device-revoke-device-phone-b')).toBeInTheDocument();
  });

  it('stays unrendered against a daemon that does not answer `devices.list`', async () => {
    // Capability gating: no plate claiming "no paired devices" when nothing was ever read (§7).
    await openSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'جلسة هذا الجهاز' }));

    expect(screen.queryByTestId('remote-devices-list')).toBeNull();
  });
});
