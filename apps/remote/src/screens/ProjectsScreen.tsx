// The projects ledger (docs/design/REDESIGN.md §5's `projects` row, narrowed for the phone).
//
// One ruled row per project: its name, the one-word state, the mono id and the clock reading — and the
// needs-you lamp only when something in that project is waiting on the owner (§1). Creating a project is
// the desktop bench's job (the phone is a reading-and-deciding surface, §2), so this screen offers the
// ledger and the run underneath it, never a form.
//
// The three states the direction insists each list must own: `Skeleton` while the daemon has not
// answered, `Banner` + `common.retry` when it did not answer, and `EmptyState` with one real next step
// when it answered and there is nothing there (§7).
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Banner, Box, Button, EmptyState, Lamp, Ledger, Panel, Skeleton, Text, colorVar, fontSize, fontWeight, space } from '@warsha/ui';
import React from 'react';
import { Link } from 'react-router-dom';

import { useRemote } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { clock, shortId } from '../format';
import { UnpairedScreen } from '../pairing';

export function ProjectsScreen() {
  const dir = useDirection();
  const locale = useLocale();
  const { projects, projectsState, projectId, setProjectId, pendingGates, run, reloadAll, session } = useRemote();

  // The ledger is the session's; without one the phone says so and offers the pairing plate (§7).
  if (session === null) {
    return <UnpairedScreen heading={t('projects.title', {}, locale)} testId="remote-screen-projects" />;
  }

  // The phone only ever sees one project's gates at a time, so the lamp says "this is the one waiting"
  // for the selected project and stays quiet for the others rather than implying a reading it lacks.
  const waitingHere = run !== null && pendingGates.length > 0;

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-projects">
      <Box dir={dir} className="remote-title">
        <ScreenTitle>{t('projects.title', {}, locale)}</ScreenTitle>
        <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
          {t('remote.projects_hint', {}, locale)}
        </Text>
      </Box>

      {session !== null && projectsState === 'failed' && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={reloadAll} data-testid="remote-retry-projects">
              {t('common.retry', {}, locale)}
            </Button>
          }
        >
          {t('projects.failed', {}, locale)}
        </Banner>
      )}

      <Panel title={t('nav.projects', {}, locale)} label={t('projects.title', {}, locale)}>
        {projectsState === 'loading' ? (
          <Skeleton label={t('projects.loading', {}, locale)} variant="row" lines={3} />
        ) : projects.length === 0 ? (
          <EmptyState
            title={t('projects.empty_title', {}, locale)}
            description={t('projects.empty_desc', {}, locale)}
            action={
              // §7: an empty state is a next step. On the phone, the next step is the bench it came from.
              <Link to="/settings" dir={dir} className="warsha-control remote-action">
                {t('nav.settings', {}, locale)}
              </Link>
            }
          />
        ) : (
          <Ledger label={t('projects.title', {}, locale)}>
            {projects.map((candidate) => {
              const selected = candidate.id === projectId;
              return (
                <Ledger.Row
                  key={candidate.id}
                  selected={selected}
                  onSelect={() => setProjectId(candidate.id)}
                  meta={<Machine title={candidate.id}>{shortId(candidate.id, 10)}</Machine>}
                >
                  <Box dir={dir} style={{ display: 'grid', gap: space(1), minInlineSize: 0 }}>
                    <Text size="sm" dir={dir} style={{ color: colorVar('text'), fontWeight: fontWeight('bold') }}>
                      {candidate.name}
                    </Text>
                    <Box dir={dir} style={{ display: 'flex', alignItems: 'center', gap: space(2), minInlineSize: 0 }}>
                      <Lamp state={selected && waitingHere ? 'waiting' : selected ? 'working' : 'idle'} size="xs">
                        {selected && waitingHere
                          ? t('projects.awaiting_gate', {}, locale)
                          : `${t('projects.updated', {}, locale)} ${clock(candidate.updatedAt, locale)}`}
                      </Lamp>
                      {selected && (
                        <Text size="xs" dir={dir} style={{ color: colorVar('text'), fontSize: fontSize('xs') }}>
                          {t('remote.projects_current', {}, locale)}
                        </Text>
                      )}
                    </Box>
                  </Box>
                </Ledger.Row>
              );
            })}
          </Ledger>
        )}

        {projects.length > 0 && (
          <Box dir={dir} style={{ marginBlockStart: space(3) }}>
            <Link to="/run" dir={dir} className="remote-link" data-testid="remote-projects-open-run">
              {t('remote.open_run', {}, locale)}
            </Link>
          </Box>
        )}
      </Panel>
    </div>
  );
}
