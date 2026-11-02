// @warsha/remote — the bench's chrome: the row that names it, the strip that reports it, the nav that
// moves around it (docs/design/REDESIGN.md §4, redrawn for the phone by §10's 390 row).
//
// Three rules decide everything in this file:
//
//   * **the phone reads top-down**: brand, then the instrument strip, then the queue. The strip keeps the
//     daemon lamp and the budget at 390 and lets the rest go — `StatusStrip.Item`'s `hideNarrow` plus the
//     `@media` rule in `tokens.css`, because a viewport is not a prop (§10);
//   * **yellow is a lamp, never paint** (§1): the only lit things here are the pending-gate count and the
//     selected nav item's edge, and both say their meaning in a word as well as a colour (§9);
//   * **machine data is mono and isolated** (§11): an id inside an Arabic sentence gets `dir="ltr"`,
//     `translate="no"` and `unicode-bidi: isolate`, or the bidi algorithm scrambles it.
//
// The *layout* of the chrome lives in `index.css`, which is where a viewport, an attribute and a
// pseudo-class belong; what is inline here is what a state decides — the pressed language chip, the
// selected row — never a colour, a length or a font.
import { t, useDirection, useLocale, useLocaleControl, type Locale } from '@warsha/i18n';
import {
  Lamp,
  Meter,
  StatusStrip,
  Text,
  colorVar,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  shadow,
  size,
  space,
} from '@warsha/ui';
import React from 'react';
import { NavLink } from 'react-router-dom';

import { useRemote } from './bench';
import { stageWord } from './labels';
import { endpointHost, type DaemonSession } from './session';

/**
 * One machine value, isolated from the line's direction (§11).
 *
 * `title` carries the full reading when the row shows a shortened one, so the value stays reachable.
 */
export function Machine({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      dir="ltr"
      translate="no"
      title={title}
      style={{
        fontFamily: fontFamily('mono'),
        fontVariantNumeric: 'tabular-nums',
        unicodeBidi: 'isolate',
        fontSize: fontSize('xs'),
        color: colorVar('text'),
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
      style={{ display: 'block', inlineSize: size('nut'), blockSize: size('nut') }}
    >
      <polygon points="12,1 21.5,6.5 21.5,17.5 12,23 2.5,17.5 2.5,6.5" fill="var(--warsha-signal)" />
      <circle cx="12" cy="12" r="4.5" fill="var(--warsha-bench-plate)" />
    </svg>
  );
}

/**
 * The language switch.
 *
 * Two buttons rather than a select, because there are two locales and each label comes from the catalog
 * in its own language (`onboarding.lang_ar` / `onboarding.lang_en`), so it reads the same whichever
 * locale is live. The pressed state is `aria-pressed` plus a lifted plate — a shape and a weight, not a
 * colour (§9) — and `pointer: coarse` raises both to the 44px floor through `.warsha-control`.
 *
 * It lives in the top bar because the phone's owner may be handed a device set to the other language,
 * and a control that costs three screens to reach is a control that costs them the ten seconds (§2).
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
          <button
            key={option.value}
            type="button"
            dir={dir}
            aria-pressed={pressed}
            data-testid={`${testIdPrefix}-${option.value}`}
            onClick={() => setLocale(option.value)}
            className="warsha-control app-language-option"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: space(1),
              border: 'none',
              borderRadius: radius('sm'),
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: fontSize('sm'),
              paddingInline: space(2),
              paddingBlock: space(1),
              backgroundColor: pressed ? colorVar('surface') : 'transparent',
              boxShadow: pressed ? shadow('sm') : 'none',
              color: pressed ? colorVar('text') : colorVar('textMuted'),
              fontWeight: pressed ? fontWeight('semibold') : fontWeight('medium'),
            }}
          >
            {t(option.key, {}, locale)}
          </button>
        );
      })}
    </div>
  );
}

/** The top bar: the brand, the contextual identity, the language. 56px, sticky, wraps below 768 (§4). */
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
 * The phone keeps two readings at 390 — the daemon lamp and the budget — and marks the rest `hideNarrow`.
 * A reading the daemon has not made is said in words, never as a zero (§7).
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

  const daemonLamp =
    connection === 'online'
      ? 'ok'
      : connection === 'offline'
        ? 'fail'
        : connection === 'checking'
          ? 'working'
          : 'idle';

  return (
    <div dir={dir} className="app-strip" data-testid="remote-strip">
      <StatusStrip label={t('bench.status_label', {}, locale)}>
        <StatusStrip.Item>
          <Lamp state={daemonLamp} size="xs">
            {daemonWord}
          </Lamp>
        </StatusStrip.Item>

        <StatusStrip.Item hideNarrow>
          {run === null
            ? t('bench.no_run', {}, locale)
            : `${t('bench.stage_label', {}, locale)} ${stageWord(run.stage, locale)}`}
        </StatusStrip.Item>

        <StatusStrip.Item hideNarrow machine>
          {`${pendingGates.length} ${t('bench.gates_waiting', {}, locale)}`}
        </StatusStrip.Item>

        <StatusStrip.Item>
          {budget === null ? (
            <Lamp state="idle" size="xs" bare>
              {`${t('bench.budget_used', {}, locale)}: ${t('bench.not_reported', {}, locale)}`}
            </Lamp>
          ) : (
            <Meter
              value={Number(budget.spentUsd.toFixed(2))}
              max={Number(budget.totalBudgetUsd.toFixed(2))}
              label={t('bench.budget_used', {}, locale)}
            >
              {`$${budget.spentUsd.toFixed(2)} / $${budget.totalBudgetUsd.toFixed(2)}`}
            </Meter>
          )}
        </StatusStrip.Item>

        {session !== null && (
          <StatusStrip.Item hideNarrow>
            <Machine title={session.baseUrl}>{endpointHost(session)}</Machine>
          </StatusStrip.Item>
        )}
      </StatusStrip>
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
 * A `nav` landmark of links, each carrying `aria-current="page"` — which is also what draws the signal
 * edge on the selected item, so "where am I" is one attribute rather than two claims (§6). Links rather
 * than buttons: these change the URL, and the back button has to keep working (§4).
 *
 * The pending count rides the gates item and is the one lit thing on the bench: a lit lamp means the
 * owner's hand is what is missing (§1), and the number beside it is the colour-free channel (§9). Below
 * 768 the nav is the bar under the bench; at 768 and above it becomes the inline-start rail (§10).
 */
export function BenchNav() {
  const dir = useDirection();
  const locale = useLocale();
  const { pendingGates } = useRemote();
  const waiting = pendingGates.length;

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
                gap: space(1),
                minBlockSize: size('touch'),
                paddingInline: space(2),
                paddingBlock: space(2),
                textDecoration: 'none',
                fontFamily: 'inherit',
                fontSize: fontSize('sm'),
                textAlign: 'center',
              }}
            >
              <span>{t(item.key, {}, locale)}</span>
              {item.badge === true && waiting > 0 && (
                <span className="app-nav-badge" aria-hidden="true">
                  {waiting}
                </span>
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
 *
 * A real `<h1>`, not a styled `Text`: the phone's owner lands on a screen and the first thing a screen
 * reader announces should be *which* screen it is (§9's semantic controls), and `main` + `h1` is what
 * makes that claim instead of a span that happens to be bold.
 */
export function ScreenTitle({ children }: { children: React.ReactNode }) {
  const dir = useDirection();
  return (
    <h1
      dir={dir}
      style={{
        margin: 0,
        color: colorVar('text'),
        fontSize: fontSize('lg'),
        fontWeight: fontWeight('bold'),
        lineHeight: lineHeight('snug'),
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
    <Text size="xs" dir={dir} style={{ color: colorVar('text') }}>
      {`${t('remote.session_endpoint', {}, locale)} `}
      <Machine title={session.baseUrl}>{endpointHost(session)}</Machine>
    </Text>
  );
}
