// @warsha/remote — the landmark shape of every screen.
//
// A phone screen is read by a keyboard and by a screen reader before it is read by an eye, so the
// landmarks are the navigation: one banner (the bench's own top bar), one main, one named navigation, and
// exactly one `h1` per screen. The check is written against the DOM the app produces rather than against a
// role calculator's opinion of a nested `<header>`: `@warsha/ui`'s `Panel` puts a `<header>` inside a
// `<section>`, which the HTML-AAM scopes and some tooling does not, and that is a design-system question
// for B4's axe run — not a defect this shell may grow into a second page banner.
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';

import { SESSION, renderRemote, settle } from './testkit';

const ROUTES: readonly { route: string; session: typeof SESSION | null; heading: string }[] = [
  { route: '/', session: null, heading: 'بانتظارك' },
  { route: '/', session: SESSION, heading: 'بانتظارك' },
  { route: '/gates', session: SESSION, heading: 'صندوق الوارد للبوابات' },
  { route: '/run', session: SESSION, heading: 'التشغيل الحالي' },
  { route: '/projects', session: SESSION, heading: 'لوحة المشاريع' },
  { route: '/settings', session: SESSION, heading: 'الإعدادات' },
];

describe('the landmark shape', () => {
  it.each(ROUTES)('$route keeps one page banner, one main and one h1', async ({ route, session, heading }) => {
    renderRemote({ route, session });
    await settle();

    // The page's banner is the top bar, and it is the only `<header>` that is a direct child of the shell.
    const pageBanners = document.querySelectorAll('.app > header');
    expect(pageBanners).toHaveLength(1);
    expect(pageBanners[0]).toHaveAttribute('data-testid', 'remote-topbar');

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'تنقّل الطاولة' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toBeInTheDocument();

    // One title per screen — the announcement that answers "which screen am I on" before anything else.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
  });

  it('gives the skip link a target that is actually the screen', async () => {
    renderRemote({ session: SESSION });
    await settle();

    const skip = screen.getByRole('link', { name: 'انتقل إلى طاولة العمل' });
    expect(skip).toHaveAttribute('href', '#app-main');
    expect(document.getElementById('app-main')).toBe(screen.getByRole('main'));
  });

  it('names the instrument strip as a report, not as an alert', async () => {
    renderRemote({ session: SESSION });
    await settle();

    // §4: the strip reports state; only a failure interrupts, and that is a Banner's `role="alert"`.
    expect(screen.getByRole('status', { name: 'شريط الحالة' })).toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
