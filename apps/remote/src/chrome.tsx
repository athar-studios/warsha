// @warsha/remote — the bench's chrome: the row that names it, the strip that reports it, the nav that
// moves around it (rebuilt on @warsha/ui/v3 per DESIGN_SYSTEM_V3.md).
import { t, useDirection, useLocale, useLocaleControl, type Locale } from '@warsha/i18n';
import {
  Badge,
  Button,
  ProgressBar,
  StatusPill,
  type StatusPillState,
} from '@warsha/ui/v3';
import React from 'react';
import { NavLink } from 'react-router-dom';

import { useRemote } from './bench';
import { hasCeiling, money } from './format';
import { stageWord } from './labels';
import { endpointHost, type DaemonSession } from './session';

const JOINED_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function slotText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(slotText).join('');
  if (typeof node === 'object') {
    const candidate = node as { [Symbol.iterator]?: unknown; props?: { children?: React.ReactNode } };
    if (typeof candidate[Symbol.iterator] === 'function') {
      return [...(node as Iterable<React.ReactNode>)].map(slotText).join('');
    }
    if (candidate.props && typeof candidate.props === 'object') {
      return slotText(candidate.props.children);
    }
  }
  return '';
}

function carriesJoinedScript(node: React.ReactNode): boolean {
  return JOINED_SCRIPT.test(slotText(node));
}

/**
 * One machine value, isolated from the line's direction (§11).
 *
 * `title` carries the full reading when the row shows a shortened one, so the value stays reachable.
 */
export function Machine({ children, title }: { children: React.ReactNode; title?: string }) {
  const isMachineValue = !carriesJoinedScript(children);

  return (
    <span
      dir={isMachineValue ? 'ltr' : undefined}
      translate={isMachineValue ? 'no' : undefined}
      title={title}
      style={{
        fontFamily: isMachineValue ? 'var(--w-font-mono)' : 'var(--w-font-sans)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: isMachineValue ? undefined : 'normal',
        unicodeBidi: isMachineValue ? 'isolate' : undefined,
        fontSize: 'var(--w-font-size-xs)',
        color: 'var(--w-text)',
      }}
    >
      {children}
    </span>
  );
}

/** The workshop's hex nut — the brand's one logo gesture (§1.5). Decoration: the word beside it names it. */
export function BrandMark() {
  return (
    <svg
      className="app-brand-mark"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', inlineSize: 'var(--w-space-6)', blockSize: 'var(--w-space-6)' }}
    >
      <polygon points="12,1 21.5,6.5 21.5,17.5 12,23 2.5,17.5 2.5,6.5" fill="var(--w-primary)" />
      <circle cx="12" cy="12" r="4.5" fill="var(--w-sunken)" />
    </svg>
  );
}

/**
 * The language switch.
 *
 * Two buttons rather than a select, because there are two locales and each label comes from the catalog
 * in its own language (`onboarding.lang_ar` / `onboarding.lang_en`), so it reads the same whichever
 * locale is live.
 */
export function LanguageSwitch({ testIdPrefix = 'remote-language' }: { testIdPrefix?: string }) {
  const dir = useDirection();
  const locale = useLocale();
  const { setLocale } = useLocaleControl();

  const options: readonly { value: Locale; key: string }[] = [
    { value: 'ar', key: 'onboarding.lang_ar' },
    { value: 'en', key: 'onboarding.lang_en' },
  ];

  return (
    <div dir={dir} role="group" aria-label={t('settings.language', {}, locale)} className="app-language">
      {options.map((option) => {
        const pressed = locale === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            variant={pressed ? 'secondary' : 'ghost'}
            size="sm"
            dir={dir}
            aria-pressed={pressed}
            data-testid={`${testIdPrefix}-${option.value}`}
            onClick={() => setLocale(option.value)}
            className="warsha-control app-language-option"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--w-space-1)',
              border: 'none',
              borderRadius: 'var(--w-radius-sm)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'var(--w-font-size-sm)',
              paddingInline: 'var(--w-space-2)',
              paddingBlock: 'var(--w-space-1)',
              backgroundColor: pressed ? 'var(--w-surface)' : 'transparent',
              boxShadow: pressed ? 'var(--w-shadow-1)' : 'none',
              color: pressed ? 'var(--w-text)' : 'var(--w-text-muted)',
              fontWeight: pressed ? 'var(--w-font-weight-semibold)' : 'var(--w-font-weight-medium)',
            }}
          >
            {t(option.key, {}, locale)}
          </Button>
        );
      })}
    </div>
  );
}

/** The top bar: the brand, the contextual identity, the language. */
export function BenchTopbar() {
  const dir = useDirection();
  const locale = useLocale();
  const { project, run } = useRemote();

  return (
    <header dir={dir} className="app-topbar" data-testid="remote-topbar">
      <span dir={dir} className="app-brand">
        <BrandMark />
        <span>{t('app.name', {}, locale)}</span>
        <span className="app-brand-role">{t('remote.brand_role', {}, locale)}</span>
      </span>

      <span dir={dir} className="app-identity" data-testid="remote-identity">
        {project !== null && (
          <>
            <span>{t('bench.project_label', {}, locale)}</span>
            <Machine title={project.id}>{project.id}</Machine>
          </>
        )}
        {run !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t('bench.run_label', {}, locale)}</span>
            <Machine title={run.id}>{run.id}</Machine>
          </>
        )}
      </span>

      <LanguageSwitch />
    </header>
  );
}

/**
 * The instrument strip: what an owner glances at (§4).
 *
 * Keeps the daemon status and budget visible on narrow viewports, hides secondary items below tablet,
 * and counts only the current-stage gate (`parkedGate`).
 */
export function BenchStrip() {
  const dir = useDirection();
  const locale = useLocale();
  const { connection, run, budget, pendingGates, session } = useRemote();

  const daemonWord =
    connection === 'online'
      ? t('bench.daemon_online', {}, locale)
      : connection === 'offline'
        ? t('bench.daemon_offline', {}, locale)
        : connection === 'checking'
          ? t('remote.daemon_checking', {}, locale)
          : t('remote.session_none_title', {}, locale);

  const daemonStatus: StatusPillState =
    connection === 'online'
      ? 'done'
      : connection === 'offline'
        ? 'failed'
        : connection === 'checking'
          ? 'running'
          : 'idle';

  return (
    <div dir={dir} className="app-strip" data-testid="remote-strip">
      <div
        role="status"
        aria-label={t('bench.status_label', {}, locale)}
        tabIndex={0}
        className="app-strip-bar"
      >
        <span className="app-strip-item">
          <StatusPill status={daemonStatus} label={daemonWord} />
        </span>

        <span className="app-strip-item" data-hide-narrow="true">
          {run === null
            ? t('bench.no_run', {}, locale)
            : `${t('bench.stage_label', {}, locale)} ${stageWord(run.stage, locale)}`}
        </span>

        <span className="app-strip-item" data-hide-narrow="true">
          <Machine>{pendingGates.length}</Machine>
          {` ${t('bench.gates_waiting', {}, locale)}`}
        </span>

        <span className="app-strip-item">
          {budget === null ? (
            <StatusPill
              status="idle"
              label={`${t('bench.budget_used', {}, locale)}: ${t('bench.not_reported', {}, locale)}`}
            />
          ) : !hasCeiling(budget.totalBudgetUsd) ? (
            <StatusPill
              status="idle"
              label={`${t('bench.budget_used', {}, locale)}: ${money(budget.spentUsd)} · ${t('bench.no_ceiling', {}, locale)}`}
            />
          ) : (
            <span className="app-strip-meter">
              <ProgressBar
                role="meter"
                value={Number(budget.spentUsd.toFixed(2))}
                max={Number(budget.totalBudgetUsd.toFixed(2))}
                label={t('bench.budget_used', {}, locale)}
                aria-valuenow={Number(budget.spentUsd.toFixed(2))}
                aria-valuemin={0}
                aria-valuemax={Number(budget.totalBudgetUsd.toFixed(2))}
                style={{ width: 'var(--w-space-10)', flexShrink: 0 }}
              />
              <Machine>{`${money(budget.spentUsd)} / ${money(budget.totalBudgetUsd)}`}</Machine>
            </span>
          )}
        </span>

        {session !== null && (
          <span className="app-strip-item" data-hide-narrow="true">
            <Machine title={session.baseUrl}>{endpointHost(session)}</Machine>
          </span>
        )}
      </div>
    </div>
  );
}

/** The places the phone's owner moves between, in the order the glance reads them. */
const NAV_ITEMS: readonly { to: string; key: string; end?: boolean; badge?: boolean }[] = [
  { to: '/', key: 'remote.nav.needs_you', end: true },
  { to: '/gates', key: 'nav.gates', badge: true },
  { to: '/run', key: 'remote.nav.run' },
  { to: '/projects', key: 'nav.projects' },
  { to: '/settings', key: 'nav.settings' },
];

/**
 * The bench navigation.
 *
 * Counts only the current-stage gate (`parkedGate`) for the gates badge.
 */
export function BenchNav() {
  const dir = useDirection();
  const locale = useLocale();
  const { parkedGate } = useRemote();
  const waiting = parkedGate !== null ? 1 : 0;

  return (
    <nav dir={dir} className="app-nav" aria-label={t('remote.nav_label', {}, locale)} data-testid="remote-nav">
      <ul className="app-nav-list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              dir={dir}
              className="warsha-control app-nav-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--w-space-1)',
                minBlockSize: 'var(--w-control-height)',
                paddingInline: 'var(--w-space-2)',
                paddingBlock: 'var(--w-space-2)',
                textDecoration: 'none',
                fontFamily: 'inherit',
                fontSize: 'var(--w-font-size-sm)',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{t(item.key, {}, locale)}</span>
              {item.badge === true && waiting > 0 && (
                <Badge count={waiting} variant="attention" className="app-nav-badge" aria-hidden="true" />
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A screen's own heading.
 */
export function ScreenTitle({ children }: { children: React.ReactNode }) {
  const dir = useDirection();
  return (
    <h1
      dir={dir}
      style={{
        margin: 0,
        color: 'var(--w-text)',
        fontSize: 'var(--w-font-size-lg)',
        fontWeight: 'var(--w-font-weight-bold)',
        lineHeight: 'var(--w-line-height-lg)',
      }}
    >
      {children}
    </h1>
  );
}

/** The session line the pairing plate and the settings plate both state (§7's permission state). */
export function SessionLine({ session }: { session: DaemonSession }) {
  const dir = useDirection();
  const locale = useLocale();
  return (
    <p
      dir={dir}
      style={{
        margin: 0,
        color: 'var(--w-text)',
        fontSize: 'var(--w-font-size-xs)',
        lineHeight: 'var(--w-line-height-xs)',
      }}
    >
      {`${t('remote.session_endpoint', {}, locale)} `}
      <Machine title={session.baseUrl}>{endpointHost(session)}</Machine>
    </p>
  );
}
