// The projects ledger (docs/design/REDESIGN.md §5's `projects` row, narrowed for the phone).
//
// One ruled row per project: its name, the one-word state, the mono id and the clock reading — and the
// needs-you lamp only when something in that project is waiting on the owner (§1). W4 moved the phone
// from read-and-decide to supervise: when the daemon answers `projects.create` the screen offers a
// create-project form, and when it answers `runs.start` and a project is selected it offers a start-run
// form. Both are capability-gated — a ten-method daemon sees this screen exactly as §5 drew it, with no
// form at all — and neither carries a model key: that boundary is the settings screen's notice, not a
// field here.
//
// The three states the direction insists each list must own: `Skeleton` while the daemon has not
// answered, `Banner` + `common.retry` when it did not answer, and `EmptyState` with one real next step
// when it answered and there is nothing there (§7).
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Banner, Box, Button, EmptyState, Field, Lamp, Ledger, Panel, Skeleton, Text, colorVar, fieldControl, fontSize, fontWeight, space } from '@warsha/ui';
import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';

import { useRemote } from '../bench';
import { Machine, ScreenTitle } from '../chrome';
import { clock, shortId } from '../format';
import { UnpairedScreen } from '../pairing';

export function ProjectsScreen() {
  const dir = useDirection();
  const locale = useLocale();
  const {
    projects,
    projectsState,
    projectId,
    setProjectId,
    pendingGates,
    run,
    reloadAll,
    session,
    createNewProject,
    startNewRun,
    actionError,
    clearActionError,
  } = useRemote();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameMissing, setNameMissing] = useState(false);
  const [idea, setIdea] = useState('');
  const [ideaMissing, setIdeaMissing] = useState(false);

  const nameId = useId();
  const descId = useId();
  const ideaId = useId();

  // The ledger is the session's; without one the phone says so and offers the pairing plate (§7).
  if (session === null) {
    return <UnpairedScreen heading={t('projects.title', {}, locale)} testId="remote-screen-projects" />;
  }

  const submitProject = (event: React.FormEvent) => {
    event.preventDefault();
    if (createNewProject === null) return;
    if (name.trim() === '') {
      setNameMissing(true);
      return;
    }
    setNameMissing(false);
    void createNewProject(name.trim(), description.trim()).then((accepted) => {
      // The field clears only on a write the daemon took; a refusal keeps the owner's typing.
      if (accepted) {
        setName('');
        setDescription('');
      }
    });
  };

  const submitRun = (event: React.FormEvent) => {
    event.preventDefault();
    if (startNewRun === null) return;
    if (idea.trim() === '') {
      setIdeaMissing(true);
      return;
    }
    setIdeaMissing(false);
    void startNewRun(idea.trim()).then((accepted) => {
      if (accepted) setIdea('');
    });
  };

  const nameError = nameMissing ? t('projects.name_needed', {}, locale) : undefined;
  const nameControl = fieldControl(nameId, { hint: nameError === undefined, error: nameError !== undefined, required: true });
  const descControl = fieldControl(descId, { hint: false, error: false, required: false });
  const ideaError = ideaMissing ? t('projects.idea_needed', {}, locale) : undefined;
  const ideaControl = fieldControl(ideaId, { hint: ideaError === undefined, error: ideaError !== undefined, required: true });

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

      {/* A daemon that serves `projects.create` gets a create form; the ten-method one gets nothing. */}
      {createNewProject !== null && (
        <Panel title={t('remote.create_project_title', {}, locale)} label={t('remote.create_project_title', {}, locale)}>
          <form onSubmit={submitProject} dir={dir} className="remote-form" data-testid="remote-create-project-form">
            <Field id={nameId} label={t('projects.name_label', {}, locale)} error={nameError} required>
              <input
                {...nameControl}
                autoComplete="off"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameMissing) setNameMissing(false);
                  if (actionError !== null) clearActionError();
                }}
                data-testid="remote-project-name-input"
              />
            </Field>
            <Field id={descId} label={t('remote.project_desc_label', {}, locale)}>
              <input
                {...descControl}
                autoComplete="off"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (actionError !== null) clearActionError();
                }}
                data-testid="remote-project-desc-input"
              />
            </Field>
            <Button type="submit" variant="primary" dir={dir} data-testid="remote-project-create-submit">
              {t('remote.project_create_submit', {}, locale)}
            </Button>
          </form>
        </Panel>
      )}

      {/* The start-run plate belongs to the selected project: no project selected, no run to start. */}
      {startNewRun !== null && projectId !== null && (
        <Panel title={t('remote.start_run_title', {}, locale)} label={t('remote.start_run_title', {}, locale)}>
          <form onSubmit={submitRun} dir={dir} className="remote-form" data-testid="remote-start-run-form">
            <Field
              id={ideaId}
              label={t('projects.idea_label', {}, locale)}
              hint={t('projects.idea_hint', {}, locale)}
              error={ideaError}
              required
            >
              <input
                {...ideaControl}
                autoComplete="off"
                value={idea}
                onChange={(event) => {
                  setIdea(event.target.value);
                  if (ideaMissing) setIdeaMissing(false);
                  if (actionError !== null) clearActionError();
                }}
                data-testid="remote-run-idea-input"
              />
            </Field>
            <Button type="submit" variant="primary" dir={dir} data-testid="remote-run-start-submit">
              {t('remote.run_start_submit', {}, locale)}
            </Button>
          </form>
        </Panel>
      )}

      {/* A refused run-control write says so beside the forms, in the daemon's redacted words. */}
      {actionError !== null && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={clearActionError} data-testid="remote-action-dismiss">
              {t('common.close', {}, locale)}
            </Button>
          }
        >
          <Box dir={dir} style={{ display: 'grid', gap: space(1), minInlineSize: 0 }}>
            <Text size="sm" dir={dir} style={{ color: colorVar('text') }}>
              {t('remote.action_failed', {}, locale)}
            </Text>
            <Machine title={actionError}>{actionError}</Machine>
          </Box>
        </Banner>
      )}
    </div>
  );
}
