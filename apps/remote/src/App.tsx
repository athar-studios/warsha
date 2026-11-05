// @warsha/remote — the remote bench: the phone's supervisor surface (docs/design/REDESIGN.md §2, §4, §10).
//
// The shell is the bench's chrome and nothing more: a skip link, the brand row, the instrument strip, the
// screen, and the navigation that reaches the other screens. §4's regions, redrawn for 390 first: the
// strip keeps the daemon lamp and the budget and marks everything else `hideNarrow`; the navigation is a
// bar under the bench on a phone and the inline-start rail from 768 up; the contextual id the desktop top
// bar carries is dropped below 768 because a phone does not have the width for it (§10).
//
// State is the session's and the daemon's, never the shell's: `RemoteProvider` owns the readings and the
// decision path, and this file only decides *which* screen is showing. The URL is the record of that —
// `screen` by path, `project` and `run` as query — so a link a teammate sends opens the same bench the
// sender was looking at (§4's deep-linkable state), and the browser's back button keeps working.
//
// Every string here is `@warsha/i18n` copy in both locales: this file used to carry
// `t('nav.settings') || 'Settings'` and a `t('nav.dashboard', {}, locale) || 'Dashboard'`, and the
// fallbacks are gone — a missing key is a failing catalog test, not English appearing inside Arabic.
import type { ProjectId, RunId } from '@warsha/client';
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Box, colorVar } from '@warsha/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Route, Routes, useSearchParams } from 'react-router-dom';

import { RemoteProvider, useRemote, type BenchApi, type EventStreamOpener } from './bench';
import { BenchNav, BenchStrip, BenchTopbar } from './chrome';
import { GatesScreen } from './screens/GatesScreen';
import { NeedsYouScreen } from './screens/NeedsYouScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { RunScreen } from './screens/RunScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import {
  clearStoredSession,
  parsePairingLink,
  readSessionFromSearch,
  readStoredSession,
  storeSession,
  stripSessionParams,
  warshaNativeBridge,
  type DaemonSession,
  type PairingFailure,
  type SessionStore,
} from './session';
import { ThemeProvider, type ThemeStore } from './theme';

/** The query names the bench's deep-linkable state travels under (§4). */
const PROJECT_PARAM = 'project';
const RUN_PARAM = 'run';

/** The address a session was read out of, so the shell can take it back out again. */
function currentLocation(): { search: string; pathname: string; hash: string } {
  if (typeof window === 'undefined') return { search: '', pathname: '/', hash: '' };
  return { search: window.location.search, pathname: window.location.pathname, hash: window.location.hash };
}

/**
 * The session this tab holds.
 *
 * The order is the one the pairing flow needs: a link in the address wins (it is the newest hand-off,
 * and it is what a scan produces), then what this tab already holds.
 */
function useSessionController(
  initialSession: DaemonSession | null | undefined,
  store: SessionStore | null | undefined
) {
  const [session, setSession] = useState<DaemonSession | null>(() => {
    // A caller that already holds a session (the test harness, or a future shell) outranks the address.
    if (initialSession !== undefined) return initialSession;
    const fromUrl = readSessionFromSearch(currentLocation().search);
    return fromUrl.ok ? fromUrl.session : readStoredSession(store);
  });

  // The token is taken out of the address as soon as the bench has it: it must not survive in the
  // address bar, the history entry, a screenshot of either, or a link the owner forwards. After paint,
  // not during render — rewriting the URL while React is still building the tree is a side effect in a
  // place that has to stay pure. The same moment is where a URL hand-off becomes this tab's session.
  useEffect(() => {
    const { pathname, search, hash } = currentLocation();
    const fromUrl = readSessionFromSearch(search);
    if (!fromUrl.ok) return;
    storeSession(fromUrl.session, store);
    window.history.replaceState(null, '', `${pathname}${stripSessionParams(search)}${hash}`);
  }, [store]);

  const pair = useCallback(
    (link: string): PairingFailure | null => {
      const parsed = parsePairingLink(link);
      if (!parsed.ok) return parsed.reason;
      setSession(parsed.session);
      storeSession(parsed.session, store);
      return null;
    },
    [store]
  );

  const unpair = useCallback(() => {
    setSession(null);
    clearStoredSession(store);
  }, [store]);

  // The native shell's `warsha:` handler. Inside the Capacitor app the scheme is registered natively,
  // so a pairing link arrives one of two ways: as the URI that *launched* the app (cold start — the
  // WebView was not there to hear it) or as a `warsha:pair-deeplink` event on the window (warm start).
  // Both feed the same `pair` the pairing plate uses, so the deep link and the pasted link cannot drift
  // apart on validation, storage or the token-strip rules.
  useEffect(() => {
    const bridge = warshaNativeBridge();
    if (bridge === null) return;

    const initial = bridge.getInitialPairingUri?.() ?? null;
    if (initial !== null && initial.trim() !== '') pair(initial);

    // The shell may send the link as the event's detail directly or under a `uri` field; either shape
    // pairs, anything else (no payload, an unexpected type) is ignored rather than guessed at.
    const linkFrom = (event: Event): string | null => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail === 'string') return detail;
      if (typeof detail === 'object' && detail !== null) {
        const uri = (detail as Record<string, unknown>)['uri'];
        if (typeof uri === 'string') return uri;
      }
      return null;
    };
    const onDeepLink = (event: Event) => {
      const link = linkFrom(event);
      if (link !== null) pair(link);
    };
    window.addEventListener('warsha:pair-deeplink', onDeepLink);
    return () => window.removeEventListener('warsha:pair-deeplink', onDeepLink);
  }, [pair]);

  return { session, pair, unpair };
}

/** Mirror the bench's selection into the address, so what the owner is reading is a link they can send. */
function LocationSync() {
  const { project, run } = useRemote();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    // B4: the session's own parameters are never carried forward. `useSessionController` takes the
    // token out of the address after reading it, but this effect runs on the same tick with a snapshot
    // of the *old* query — and copying it whole re-wrote `server` and `token` back into the address,
    // the history entry and any link the owner forwarded. `stripSessionParams` is the same function the
    // read side uses, so the two halves cannot drift apart.
    const next = new URLSearchParams(stripSessionParams(params.toString()));
    if (project === null) next.delete(PROJECT_PARAM);
    else next.set(PROJECT_PARAM, project.id);
    if (run === null) next.delete(RUN_PARAM);
    else next.set(RUN_PARAM, run.id);

    // A write only when the address and the bench actually disagree: an equal write would re-render the
    // shell on every event the stream delivers.
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [params, project, run, setParams]);

  return null;
}

export interface AppProps {
  /** Start paired, unpaired (`null`), or auto-detect (omit) from the address and this tab's storage. */
  initialSession?: DaemonSession | null;
  /** The tab-scoped store to read and write the session in. */
  store?: SessionStore | null;
  /** The store the owner's theme choice is read from and written to. */
  themeStore?: ThemeStore | null;
  /** The RPC surface (a test hands in a recorder). */
  api?: BenchApi | null;
  /** The event feed opener (a test hands in a recorder). */
  openEvents?: EventStreamOpener;
}

function Bench({ initialSession, store, api, openEvents }: AppProps) {
  const dir = useDirection();
  const locale = useLocale();
  const { session, pair, unpair } = useSessionController(initialSession, store);

  // The URL is the owner's choice, read once: `?project=` and `?run=` are honored by the provider as soon
  // as the lists that contain them have answered. The two values are externally-sourced strings, and the
  // branded id types are what the client answers with — an id from the address is only ever *compared*
  // against the daemon's own list, never sent as a parameter unless it matched one.
  const deepLink = useMemo(() => {
    const params = new URLSearchParams(currentLocation().search);
    const project = params.get(PROJECT_PARAM);
    const run = params.get(RUN_PARAM);
    return {
      project: project === null ? null : (project as ProjectId),
      run: run === null ? null : (run as RunId),
    };
  }, []);

  return (
    <RemoteProvider
      session={session}
      onPair={pair}
      onUnpair={unpair}
      initialProjectId={deepLink.project}
      initialRunId={deepLink.run}
      api={api}
      openEvents={openEvents}
    >
      <Box dir={dir} className="app" style={{ color: colorVar('text') }}>
        {/* §9: the keyboard gets into the bench without walking the chrome first. */}
        <a dir={dir} className="app-skip" href="#app-main">
          {t('app.skip_to_bench', {}, locale)}
        </a>

        <BenchTopbar />
        <BenchStrip />

        <div dir={dir} className="app-body">
          <main id="app-main" dir={dir} tabIndex={-1} className="app-main" aria-label={t('app.bench_label', {}, locale)}>
            <Routes>
              <Route path="/" element={<NeedsYouScreen />} />
              <Route path="/gates" element={<GatesScreen />} />
              <Route path="/run" element={<RunScreen />} />
              <Route path="/projects" element={<ProjectsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              {/* A PWA lands somewhere: an unknown path is the bench's primary screen, not a dead page. */}
              <Route path="*" element={<NeedsYouScreen />} />
            </Routes>
          </main>

          <BenchNav />
        </div>

        <LocationSync />
      </Box>
    </RemoteProvider>
  );
}

export default function App({ themeStore, ...bench }: AppProps) {
  // The theme outranks every screen: the provider writes `data-theme`, and `main.tsx` applied the stored
  // choice before the first paint so a dark phone never flashes light.
  return (
    <ThemeProvider store={themeStore}>
      <Bench {...bench} />
    </ThemeProvider>
  );
}
