// @warsha/remote — the projects ledger on a phone: ruled rows, one lamp, and the run underneath.
//
// §5 gives the desktop a projects board with an inline new-project plate. The phone gets the ledger only:
// creating a project is the desktop bench's job (§2's mobile checker reads and decides), so this screen's
// whole promise is "pick one and its run appears" — plus the three states §7 insists every list owns.
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ProjectSummary } from '@warsha/client';
import { describe, expect, it } from 'vitest';


import { PROJECT, SESSION, renderRemote, settle, stubApi } from './testkit';

const SECOND: ProjectSummary = {
  ...PROJECT,
  id: 'prj_22cc44dd' as ProjectSummary['id'],
  name: 'مكتبة الأصول',
  updatedAt: '2026-11-03T08:00:00.000Z',
};

describe('the projects ledger', () => {
  it('is a ledger of ruled rows, one per project, with the newest one the bench opened on', async () => {
    renderRemote({ session: SESSION, route: '/projects', api: stubApi({ listProjects: () => Promise.resolve([SECOND, PROJECT]) }) });
    await settle();

    const ledger = screen.getByRole('list', { name: 'لوحة المشاريع' });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(2);
    expect(within(ledger).getByText('متجر ورشة')).toBeInTheDocument();
    expect(within(ledger).getByText('مكتبة الأصول')).toBeInTheDocument();

    // The row the bench is showing is stated by `aria-current`, which is also what draws its edge (§6).
    const current = within(ledger).getByRole('button', { name: /مكتبة الأصول/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(within(ledger).getByText('المشروع الحالي')).toBeInTheDocument();
  });

  it('moves the bench when the owner presses another project', async () => {
    renderRemote({ session: SESSION, route: '/projects', api: stubApi({ listProjects: () => Promise.resolve([SECOND, PROJECT]) }) });
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /متجر ورشة/ }));
    await settle();

    expect(screen.getByRole('button', { name: /متجر ورشة/ })).toHaveAttribute('aria-current', 'true');
    // The other project is no longer the current one, so its row no longer claims to be.
    expect(within(screen.getByRole('list', { name: 'لوحة المشاريع' })).getAllByText('المشروع الحالي')).toHaveLength(1);
  });

  it('lights the row that is waiting on the owner, in a word as well as a lamp', async () => {
    renderRemote({ session: SESSION, route: '/projects' });
    await settle();

    // A run parked at a gate is the reason this row is lit (§1).
    expect(screen.getByText('بوابة بانتظارك')).toBeInTheDocument();
  });

  it('says there is nothing yet, and gives one real next step', async () => {
    renderRemote({ session: SESSION, route: '/projects', api: stubApi({ listProjects: () => Promise.resolve([]) }) });
    await settle();

    expect(screen.getByText('لا يوجد مشاريع بعد')).toBeInTheDocument();
    expect(screen.getByText('أنشئ أول مشروع واكتب فكرتك، وسيبدأ فريق ورشة العمل.')).toBeInTheDocument();
    // Scoped: the nav always carries a settings link too, and this assertion is about the empty state's step.
    const plate = screen.getByRole('region', { name: 'لوحة المشاريع' });
    expect(within(plate).getByRole('link', { name: 'الإعدادات' })).toHaveAttribute('href', '/settings');
  });

  it('says the list did not come back, and reads it again', async () => {
    let reads = 0;
    const api = stubApi({
      listProjects: () => {
        reads += 1;
        return Promise.reject(new Error('no answer'));
      },
    });
    renderRemote({ session: SESSION, route: '/projects', api });
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('لم يستجب الخادم لقائمة المشاريع.');
    fireEvent.click(screen.getByTestId('remote-retry-projects'));
    await settle();
    expect(reads).toBe(2);
  });

  it('offers the pairing plate rather than an empty ledger it cannot have read', async () => {
    renderRemote({ session: null, route: '/projects' });
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'لوحة المشاريع' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'رابط الإقران' })).toBeInTheDocument();
    expect(screen.queryByText('لا يوجد مشاريع بعد')).toBeNull();
  });

  it('reaches the run the ledger is about', async () => {
    renderRemote({ session: SESSION, route: '/projects' });
    await settle();

    fireEvent.click(screen.getByTestId('remote-projects-open-run'));
    expect(await screen.findByRole('heading', { level: 1, name: 'التشغيل الحالي' })).toBeInTheDocument();
  });
});
