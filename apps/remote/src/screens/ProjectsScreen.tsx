// The projects ledger — rebuilt on @warsha/ui/v3 per DESIGN_SYSTEM_V3.md.
import { t, useDirection, useLocale } from '@warsha/i18n';
/* eslint-disable import/no-unresolved */
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ListRow,
  Skeleton,
  StatusPill,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useCallback, useId, useState } from 'react';
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
    parkedGate,
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

  const nameInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node !== null) node.setAttribute('data-testid', 'remote-project-name-input');
  }, []);
  const descInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node !== null) node.setAttribute('data-testid', 'remote-project-desc-input');
  }, []);
  const ideaInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node !== null) node.setAttribute('data-testid', 'remote-run-idea-input');
  }, []);

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
  const ideaError = ideaMissing ? t('projects.idea_needed', {}, locale) : undefined;
  const waitingHere = run !== null && parkedGate !== null;
  const hasStartRun = startNewRun !== null && projectId !== null;

  return (
    <div dir={dir} className="remote-screen" data-testid="remote-screen-projects">
      <div dir={dir} className="remote-title">
        <ScreenTitle>{t('projects.title', {}, locale)}</ScreenTitle>
        <p
          dir={dir}
          style={{
            margin: 0,
            color: 'var(--w-text-muted)',
            fontSize: 'var(--w-font-size-xs)',
            lineHeight: 'var(--w-line-height-xs)',
          }}
        >
          {t('remote.projects_hint', {}, locale)}
        </p>
      </div>

      {session !== null && projectsState === 'failed' && (
        <Banner
          variant="danger"
          action={
            <Button variant="secondary" size="sm" onClick={reloadAll} data-testid="remote-retry-projects">
              {t('common.retry', {}, locale)}
            </Button>
          }
        >
          {t('projects.failed', {}, locale)}
        </Banner>
      )}

      <section aria-label={t('projects.title', {}, locale)}>
        <Card title={t('nav.projects', {}, locale)} variant="default">
          {projectsState === 'loading' ? (
            <div
              role="status"
              aria-label={t('projects.loading', {}, locale)}
              style={{ display: 'grid', gap: 'var(--w-space-2)' }}
            >
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="text" />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState
              title={t('projects.empty_title', {}, locale)}
              description={t('projects.empty_desc', {}, locale)}
              action={
                <Link to="/settings" dir={dir} className="warsha-control remote-action">
                  {t('nav.settings', {}, locale)}
                </Link>
              }
            />
          ) : (
            <ul
              role="list"
              aria-label={t('projects.title', {}, locale)}
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
              }}
            >
              {projects.map((candidate) => {
                const selected = candidate.id === projectId;
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      dir={dir}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => setProjectId(candidate.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: 0,
                        border: 'none',
                        background: selected ? 'var(--w-primary-soft)' : 'transparent',
                        color: 'var(--w-text)',
                        textAlign: 'start',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      <ListRow
                        selected={selected}
                        title={candidate.name}
                        subtitle={
                          <span
                            dir={dir}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 'var(--w-space-2)',
                              flexWrap: 'wrap',
                              minInlineSize: 0,
                            }}
                          >
                            <StatusPill
                              status={selected && waitingHere ? 'waiting' : selected ? 'running' : 'idle'}
                              label={
                                selected && waitingHere
                                  ? t('projects.awaiting_gate', {}, locale)
                                  : `${t('projects.updated', {}, locale)} ${clock(candidate.updatedAt, locale)}`
                              }
                            />
                            {selected && (
                              <span
                                style={{
                                  color: 'var(--w-primary-text)',
                                  fontSize: 'var(--w-font-size-xs)',
                                  fontWeight: 'var(--w-font-weight-semibold)',
                                }}
                              >
                                {t('remote.projects_current', {}, locale)}
                              </span>
                            )}
                          </span>
                        }
                        meta={<Machine title={candidate.id}>{shortId(candidate.id, 10)}</Machine>}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {projects.length > 0 && (
            <div dir={dir} style={{ marginBlockStart: 'var(--w-space-3)' }}>
              <Link to="/run" dir={dir} className="remote-link" data-testid="remote-projects-open-run">
                {t('remote.open_run', {}, locale)}
              </Link>
            </div>
          )}
        </Card>
      </section>

      {/* A daemon that serves `projects.create` gets a create form; the ten-method one gets nothing. */}
      {createNewProject !== null && (
        <section aria-label={t('remote.create_project_title', {}, locale)}>
          <Card title={t('remote.create_project_title', {}, locale)} variant="default">
            <form noValidate onSubmit={submitProject} dir={dir} className="remote-form" data-testid="remote-create-project-form">
              <TextField
                id={nameId}
                ref={nameInputRef}
                label={t('projects.name_label', {}, locale)}
                error={nameError}
                required
                autoComplete="off"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameMissing) setNameMissing(false);
                  if (actionError !== null) clearActionError();
                }}
              />
              <TextField
                id={descId}
                ref={descInputRef}
                label={t('remote.project_desc_label', {}, locale)}
                autoComplete="off"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (actionError !== null) clearActionError();
                }}
              />
              <Button
                type="submit"
                variant={hasStartRun ? 'secondary' : 'primary'}
                data-testid="remote-project-create-submit"
              >
                {t('remote.project_create_submit', {}, locale)}
              </Button>
            </form>
          </Card>
        </section>
      )}

      {/* The start-run plate belongs to the selected project: no project selected, no run to start. */}
      {hasStartRun && (
        <section aria-label={t('remote.start_run_title', {}, locale)}>
          <Card title={t('remote.start_run_title', {}, locale)} variant="default">
            <form noValidate onSubmit={submitRun} dir={dir} className="remote-form" data-testid="remote-start-run-form">
              <TextField
                id={ideaId}
                ref={ideaInputRef}
                label={t('projects.idea_label', {}, locale)}
                hint={t('projects.idea_hint', {}, locale)}
                error={ideaError}
                required
                autoComplete="off"
                value={idea}
                onChange={(event) => {
                  setIdea(event.target.value);
                  if (ideaMissing) setIdeaMissing(false);
                  if (actionError !== null) clearActionError();
                }}
              />
              <Button type="submit" variant="primary" data-testid="remote-run-start-submit">
                {t('remote.run_start_submit', {}, locale)}
              </Button>
            </form>
          </Card>
        </section>
      )}

      {/* A refused run-control write says so beside the forms, in the daemon's redacted words. */}
      {actionError !== null && (
        <Banner
          variant="danger"
          action={
            <Button variant="secondary" size="sm" onClick={clearActionError} data-testid="remote-action-dismiss">
              {t('common.close', {}, locale)}
            </Button>
          }
        >
          <div dir={dir} style={{ display: 'grid', gap: 'var(--w-space-1)', minInlineSize: 0 }}>
            <span style={{ color: 'var(--w-text)', fontSize: 'var(--w-font-size-sm)' }}>
              {t('remote.action_failed', {}, locale)}
            </span>
            <Machine title={actionError}>{actionError}</Machine>
          </div>
        </Banner>
      )}
    </div>
  );
}
