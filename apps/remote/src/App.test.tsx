// @warsha/remote — the shell: the bench's chrome, its routes, and the two states every phone starts in
// (unpaired, and paired with something waiting).
//
// These cases hold the anchors the visual suite reaches by — `.app`, `remote-language-en`, the product
// line in both languages, `<html lang>`/`<html dir>` — because the phone's redesign must not break the way
// B4's harness finds it (docs/design/REDESIGN.md §10: the *pixels* are regenerated, the anchors are not
// rewritten).
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { SESSION, renderRemote, settle, stubApi } from './testkit';

describe('the bench shell', () => {
  it('is the region the visual harness waits for, with its chrome around the screen', async () => {
    renderRemote();
    await settle();

    expect(document.querySelector('.app')).not.toBeNull();
    // The skip link is the first thing in the DOM, and it points at the screen itself (§9).
    expect(screen.getByRole('link', { name: 'انتقل إلى طاولة العمل' })).toHaveAttribute('href', '#app-main');
    expect(screen.getByTestId('remote-topbar')).toBeInTheDocument();
    expect(screen.getByTestId('remote-strip')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('reports the daemon on the instrument strip in words, and a count the queue agrees with', async () => {
    renderRemote({ session: SESSION });
    await settle();

    // `role="status"` is the strip's own claim: it reports, it does not interrupt (§4).
    const strip = screen.getByRole('status', { name: 'شريط الحالة' });
    expect(strip).toHaveTextContent('الخادم متصل');
    expect(strip).toHaveTextContent('بوّابات بانتظارك');
    // The budget reading the daemon answered is a meter with its number beside it, never a bar alone (§9).
    expect(within(strip).getByRole('meter', { name: 'الميزانية المستعملة' })).toHaveAttribute(
      'aria-valuenow',
      '4.2'
    );
    expect(strip).toHaveTextContent('$4.20 / $20.00');
  });

  it('keeps the five destinations, each on the touch floor, and marks the current one', async () => {
    renderRemote({ session: SESSION });
    await settle();

    const nav = screen.getByRole('navigation', { name: 'تنقّل الطاولة' });
    const items = within(nav).getAllByRole('link');
    expect(items.map((item) => item.textContent?.replace(/\d+$/, '').trim())).toEqual([
      'بانتظارك',
      'البوابات',
      'التشغيل',
      'المشاريع',
      'الإعدادات',
    ]);
    // `.warsha-control` is the touch contract: 32px on a fine pointer, 44px under `pointer: coarse` (§9).
    for (const item of items) expect(item).toHaveClass('warsha-control');
    expect(within(nav).getByText('بانتظارك').closest('a')).toHaveAttribute('aria-current', 'page');
  });

  it('lights the gates destination only while a gate waits, with the number beside the fill', async () => {
    renderRemote({ session: SESSION });
    await settle();

    // The default daemon refuses `gates.list`; a run parked at `gate_b` is still a gate waiting (§7).
    const nav = screen.getByRole('navigation', { name: 'تنقّل الطاولة' });
    const badge = within(nav).getByText('1');
    expect(badge).toHaveClass('app-nav-badge');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    // …and the same count is said in words, so the state is never colour alone (§9).
    expect(screen.getByText('بوابة واحدة بانتظارك')).toBeInTheDocument();
  });

  it('moves between screens by their own routes', async () => {
    renderRemote({ session: SESSION });
    await settle();

    fireEvent.click(screen.getByRole('link', { name: 'المشاريع' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'لوحة المشاريع' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'الإعدادات' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'الإعدادات' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'التشغيل' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'التشغيل الحالي' })).toBeInTheDocument();
  });

  it('lands an unknown address on the bench rather than on a dead page', async () => {
    renderRemote({ session: SESSION, route: '/nowhere' });
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'بانتظارك' })).toBeInTheDocument();
    expect(screen.getByText('ما ينتظر قرارك')).toBeInTheDocument();
  });

  it('switches the whole catalog and the document direction with it', async () => {
    const { localeStore } = renderRemote();
    await settle();

    // The product line is the proof the shared catalog reaches this app, in either language.
    expect(screen.getByText('ورشة — مصنع برمجيات بالذكاء الاصطناعي، عربي أولاً')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('remote-language-en'));
    await settle();

    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByText('Warsha — Arabic-first AI software factory')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Needs you' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeInTheDocument();
    // The choice is stored where the choice was made, so the next launch reads it back.
    expect(localeStore.values['warsha.locale']).toBe('en');
  });
});

describe('the unpaired bench', () => {
  it('names the product and says how to get a session', async () => {
    renderRemote();
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'بانتظارك' })).toBeInTheDocument();
    expect(screen.getByText('ورشة — مصنع برمجيات بالذكاء الاصطناعي، عربي أولاً')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'رابط الإقران' })).toBeInTheDocument();
    // The token promise is copy the owner reads *before* pasting anything, not a line in a privacy page.
    expect(screen.getByText(/لا يُكتب في التخزين الدائم/)).toBeInTheDocument();
  });

  it('refuses an empty field beside the field, with `aria-invalid` and an alert', async () => {
    renderRemote();
    await settle();

    fireEvent.click(screen.getByTestId('remote-pair-submit'));

    expect(screen.getByRole('alert')).toHaveTextContent('الصق رابط الإقران أولاً.');
    expect(screen.getByRole('textbox', { name: 'رابط الإقران' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a link that is not an http(s) address, or one that carries a provider key', async () => {
    renderRemote();
    await settle();
    const field = screen.getByRole('textbox', { name: 'رابط الإقران' });

    fireEvent.change(field, { target: { value: 'not-a-link' } });
    fireEvent.click(screen.getByTestId('remote-pair-submit'));
    expect(screen.getByRole('alert')).toHaveTextContent(/يجب أن يبدأ عنوان الخادم/);

    fireEvent.change(field, { target: { value: 'https://host.example/?token=abc&api_key=sk-1' } });
    fireEvent.click(screen.getByTestId('remote-pair-submit'));
    expect(screen.getByRole('alert')).toHaveTextContent(/لا تُكتب الاعتمادات في العنوان/);
    // A refusal writes nothing anywhere.
    expect(sessionStorage.getItem('warsha.remote.session')).toBeNull();
  });

  it('accepts a pairing link, stores it in this tab only, and shows the queue', async () => {
    const { sessionStore } = renderRemote({ session: null });
    await settle();

    fireEvent.change(screen.getByRole('textbox', { name: 'رابط الإقران' }), {
      target: { value: 'https://remote.example/?server=https%3A%2F%2F10.0.0.5%3A8766&token=t-1' },
    });
    fireEvent.click(screen.getByTestId('remote-pair-submit'));
    await settle();

    expect(screen.getByText('ما ينتظر قرارك')).toBeInTheDocument();
    // Session-scoped: the token lands in the tab store the app was handed, and in nothing that outlives
    // the tab. `session.ts` has no persistent store to write to, which is what this asserts.
    expect(sessionStore.values['warsha.remote.session']).toContain('t-1');
    expect(window.localStorage?.getItem('warsha.remote.session') ?? null).toBeNull();
  });
});

describe('a daemon that does not answer', () => {
  it('says the table is running without live data, and the retry reads it again', async () => {
    let healthReads = 0;
    const api = stubApi({
      health: () => {
        healthReads += 1;
        return Promise.reject(new Error('Request failed'));
      },
    });
    renderRemote({ session: SESSION, api });
    await settle();

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('لا يجيب أحد على عنوان الخادم؛ الطاولة تعمل بلا بيانات حيّة.');
    expect(healthReads).toBe(1);

    fireEvent.click(screen.getByTestId('remote-retry-daemon'));
    await settle();
    expect(healthReads).toBe(2);
  });

  it('keeps the strip honest about an offline daemon in words, not a colour', async () => {
    renderRemote({ session: SESSION, api: stubApi({ health: () => Promise.reject(new Error('nope')) }) });
    await settle();

    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toHaveTextContent('الخادم غير متصل');
    expect(screen.getByRole('button', { name: 'أعد المحاولة' })).toBeInTheDocument();
  });

  it('says what it cannot read instead of showing a zero it was never given', async () => {
    renderRemote({
      session: SESSION,
      api: stubApi({ getProjectBudget: () => Promise.reject(new Error('nope')) }),
    });
    await settle();

    const strip = screen.getByRole('status', { name: 'شريط الحالة' });
    expect(strip).toHaveTextContent('الميزانية المستعملة: لم يُبلَّغ بعد');
    expect(within(strip).queryByRole('meter')).toBeNull();
    expect(screen.getByText('الميزانية')).toBeInTheDocument();
  });
});

describe('the address bar after a pairing hand-off', () => {
  // B4 found this in a real browser: the shell takes the token out of the address once it has read it,
  // and then `LocationSync` — running on the same tick with the *old* query in hand — wrote the whole
  // query back, `server` and `token` included. The owner's address bar, their history and any link they
  // forward would then carry the bearer token. It is a unit case now because the fix is one line.
  it('never writes the session parameters back into the address', async () => {
    window.history.replaceState(
      null,
      '',
      '/?server=http%3A%2F%2F127.0.0.1%3A8766&token=sekrit-token-abcdef&project=proj-1&run=run-1'
    );

    renderRemote({ router: 'browser' });
    await settle();

    expect(window.location.search).not.toContain('sekrit-token-abcdef');
    expect(window.location.search).not.toContain('token=');
    expect(window.location.search).not.toContain('server=');
    // What the bench is looking at still travels: the address keeps naming the project and the run,
    // and it names the ones the daemon actually reported rather than the placeholders in the link.
    expect(window.location.search).toMatch(/[?&]project=/);
    expect(window.location.search).toMatch(/[?&]run=/);
    // And nowhere else on the page repeats it.
    expect(document.body.textContent).not.toContain('sekrit-token-abcdef');
  });
});
