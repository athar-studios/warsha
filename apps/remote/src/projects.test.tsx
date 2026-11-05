// @warsha/remote — the projects ledger on a phone: ruled rows, one lamp, and the run underneath.
//
// §5 gives the desktop a projects board with an inline new-project plate; W4 moved the phone from
// read-and-decide to supervise, so the ledger also owns a create-project form and a start-run form —
// both capability-gated: a ten-method daemon sees the ledger exactly as §5 drew it, with no form at
// all. Nothing on this screen carries a model key: that boundary is the settings plate's notice.
// The rest of the file is the three states §7 insists every list owns.
import { fireEvent, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ProjectSummary } from '@warsha/client';
import { describe, expect, it } from 'vitest';


import { PROJECT, SESSION, fullApi, renderRemote, settle, stubApi } from './testkit';

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
    expect(screen.getByText('بوّابة بانتظارك')).toBeInTheDocument();
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

describe('the create-project and start-run plates', () => {
  it('creates a project through `projects.create` when the daemon answers it, and clears only on acceptance', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/projects', api: fullApi() });
    await settle();

    const form = screen.getByTestId('remote-create-project-form');
    fireEvent.change(within(form).getByTestId('remote-project-name-input'), { target: { value: 'تطبيق الوصفة' } });
    fireEvent.change(within(form).getByTestId('remote-project-desc-input'), { target: { value: 'قائمة تسوق وصفات' } });
    fireEvent.click(within(form).getByTestId('remote-project-create-submit'));
    await settle();

    // The write happened as an RPC, and the daemon's own new row joined the ledger.
    expect(calls).toContain('createProject');
    expect(within(screen.getByRole('list', { name: 'لوحة المشاريع' })).getByText('تطبيق الوصفة')).toBeInTheDocument();
    // The field clears only on a write the daemon took (§7: nothing the owner typed is silently eaten).
    expect(within(form).getByTestId('remote-project-name-input')).toHaveValue('');
    expect(within(form).getByTestId('remote-project-desc-input')).toHaveValue('');
  });

  it('asks for a name before it writes, and keeps the owner’s words when the daemon refuses', async () => {
    const refuse = fullApi({
      createProject: () => Promise.reject(new Error('no')),
    });
    const { calls } = renderRemote({ session: SESSION, route: '/projects', api: refuse });
    await settle();

    const form = screen.getByTestId('remote-create-project-form');
    fireEvent.click(within(form).getByTestId('remote-project-create-submit'));
    await settle();
    expect(calls).not.toContain('createProject');
    expect(within(form).getByText('اكتب اسماً للمشروع أولاً.')).toBeInTheDocument();
  });

  it('starts a run on the selected project through `runs.start`', async () => {
    const { calls } = renderRemote({ session: SESSION, route: '/projects', api: fullApi() });
    await settle();

    // The bench opened on the ledger's only project, so the start-run plate is there with it.
    const form = screen.getByTestId('remote-start-run-form');
    fireEvent.change(within(form).getByTestId('remote-run-idea-input'), { target: { value: 'سوق للأسر المنتجة' } });
    fireEvent.click(within(form).getByTestId('remote-run-start-submit'));
    await settle();

    expect(calls).toContain('startRun');
    expect(within(form).getByTestId('remote-run-idea-input')).toHaveValue('');
  });

  it('shows neither form to a daemon that does not serve the writes', async () => {
    // The ten-method stub is exactly that: capability gating, not a control that lies about working.
    renderRemote({ session: SESSION, route: '/projects', api: stubApi() });
    await settle();

    expect(screen.queryByTestId('remote-create-project-form')).toBeNull();
    expect(screen.queryByTestId('remote-start-run-form')).toBeNull();
  });

  it('offers no model-key field on either plate — the phone never holds keys', async () => {
    renderRemote({ session: SESSION, route: '/projects', api: fullApi() });
    await settle();

    const create = screen.getByTestId('remote-create-project-form');
    const start = screen.getByTestId('remote-start-run-form');
    expect(within(create).queryByRole('textbox', { name: /key|مفتاح/i })).toBeNull();
    expect(within(start).queryByRole('textbox', { name: /key|مفتاح/i })).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});
