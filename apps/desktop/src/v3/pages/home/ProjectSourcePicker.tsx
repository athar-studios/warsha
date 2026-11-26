import type { GithubStatus, WarshaClient } from '@warsha/client';
import {
  Banner,
  Button,
  IconFolder,
  IconGitBranch,
  IconLink,
  IconPlus,
  Segmented,
  TextField,
} from '@warsha/ui/v3';
import React, { useEffect, useState } from 'react';

import { isTauriRuntime, pickProjectFolder } from './folderPicker';

export type ProjectSourceMode = 'new_folder' | 'existing' | 'github_link' | 'github_create';

export interface ProjectSourceValue {
  mode: ProjectSourceMode;
  existingPath: string;
  parentDir: string;
  folderName: string;
  repoUrl: string;
  githubRepoName: string;
}

export const INITIAL_PROJECT_SOURCE: ProjectSourceValue = {
  mode: 'new_folder',
  existingPath: '',
  parentDir: '',
  folderName: '',
  repoUrl: '',
  githubRepoName: '',
};

export interface ResolvedProjectSource {
  repoPath?: string;
  repoUrl?: string;
}

const VALID_MODES = new Set<ProjectSourceMode>([
  'new_folder',
  'existing',
  'github_link',
  'github_create',
]);

function isProjectSourceMode(value: string): value is ProjectSourceMode {
  return VALID_MODES.has(value as ProjectSourceMode);
}

export function validateProjectSource(
  value: ProjectSourceValue,
  githubStatus: GithubStatus | null,
  t: (key: string) => string
): string | null {
  switch (value.mode) {
    case 'new_folder': {
      const parent = value.parentDir.trim();
      const folder = value.folderName.trim();
      if (parent.length > 0 && folder.length === 0) {
        return t('home.source.err_missing_folder_name');
      }
      if (folder.length > 0 && parent.length === 0) {
        return t('home.source.err_missing_parent_dir');
      }
      return null;
    }
    case 'existing':
      return value.existingPath.trim().length > 0 ? null : t('home.source.err_missing_folder');
    case 'github_link':
      return value.repoUrl.trim().length > 0 ? null : t('home.source.err_missing_repo_url');
    case 'github_create':
      if (!githubStatus?.configured) {
        return t('home.source.github_not_connected_title');
      }
      return value.githubRepoName.trim().length > 0
        ? null
        : t('home.source.err_missing_repo_name');
  }
}

export async function resolveProjectSource(
  client: Pick<
    WarshaClient,
    'prepareProjectFolder' | 'cloneProjectRepo' | 'createGithubRepo'
  >,
  value: ProjectSourceValue,
  idea: string
): Promise<ResolvedProjectSource> {
  switch (value.mode) {
    case 'new_folder': {
      const parent = value.parentDir.trim();
      const folder = value.folderName.trim();
      if (!parent && !folder) {
        return {};
      }
      const prepared = await client.prepareProjectFolder(parent, folder);
      return { repoPath: prepared.repoPath };
    }
    case 'existing':
      return { repoPath: value.existingPath.trim() };
    case 'github_link': {
      const cloned = await client.cloneProjectRepo(
        value.repoUrl.trim(),
        value.parentDir.trim() || undefined,
        value.folderName.trim() || undefined
      );
      return {
        repoPath: cloned.repoPath,
        repoUrl: cloned.repoUrl ?? undefined,
      };
    }
    case 'github_create': {
      const created = await client.createGithubRepo(
        value.githubRepoName.trim(),
        idea,
        value.parentDir.trim() || undefined
      );
      return {
        repoPath: created.repoPath,
        repoUrl: created.repoUrl,
      };
    }
  }
}

export interface ProjectSourcePickerProps {
  value: ProjectSourceValue;
  onChange: (next: ProjectSourceValue) => void;
  client: Pick<WarshaClient, 'getGithubStatus'> | null;
  t: (key: string) => string;
  onOpenIntegrations: () => void;
  githubStatus: GithubStatus | null;
  onGithubStatusChange: (status: GithubStatus | null) => void;
  disabled?: boolean;
  idPrefix?: string;
}

type PickerNotice = 'none' | 'unavailable' | 'error';

export function ProjectSourcePicker({
  value,
  onChange,
  client,
  t,
  onOpenIntegrations,
  githubStatus,
  onGithubStatusChange,
  disabled = false,
  idPrefix = 'home-source',
}: ProjectSourcePickerProps): React.ReactElement {
  const [githubChecking, setGithubChecking] = useState(false);
  const [pickerNotice, setPickerNotice] = useState<PickerNotice>('none');
  const tauriActive = isTauriRuntime();

  const needsGithubCheck = value.mode === 'github_link' || value.mode === 'github_create';

  useEffect(() => {
    if (!needsGithubCheck) return;
    let cancelled = false;
    setGithubChecking(true);
    const check = async (): Promise<void> => {
      try {
        if (client && typeof client.getGithubStatus === 'function') {
          const status = await client.getGithubStatus();
          if (!cancelled) {
            onGithubStatusChange(status);
          }
        } else if (!cancelled) {
          onGithubStatusChange({ configured: false, source: null });
        }
      } catch {
        if (!cancelled) {
          onGithubStatusChange({ configured: false, source: null });
        }
      } finally {
        if (!cancelled) {
          setGithubChecking(false);
        }
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [needsGithubCheck, client, onGithubStatusChange]);

  const handleBrowseFolder = async (
    target: 'existingPath' | 'parentDir',
    title: string
  ): Promise<void> => {
    if (disabled) return;
    try {
      const result = await pickProjectFolder(title);
      if (result.status === 'selected') {
        setPickerNotice('none');
        onChange({ ...value, [target]: result.path });
      } else if (result.status === 'unavailable') {
        setPickerNotice('unavailable');
      }
    } catch {
      setPickerNotice('error');
    }
  };

  const options = [
    {
      value: 'new_folder',
      label: (
        <span className="v3-source-option-label">
          <IconPlus size={14} />
          <span>{t('home.source.opt_new_folder')}</span>
        </span>
      ),
    },
    {
      value: 'existing',
      label: (
        <span className="v3-source-option-label">
          <IconFolder size={14} />
          <span>{t('home.source.opt_existing')}</span>
        </span>
      ),
    },
    {
      value: 'github_link',
      label: (
        <span className="v3-source-option-label">
          <IconLink size={14} />
          <span>{t('home.source.opt_github_link')}</span>
        </span>
      ),
    },
    {
      value: 'github_create',
      label: (
        <span className="v3-source-option-label">
          <IconGitBranch size={14} />
          <span>{t('home.source.opt_github_create')}</span>
        </span>
      ),
    },
  ];

  const showUnavailableHint =
    pickerNotice === 'unavailable' || (value.mode === 'existing' && !tauriActive);

  return (
    <div className="v3-source-picker" data-testid={`${idPrefix}-picker`}>
      <div className="v3-source-header">
        <span className="v3-source-label">{t('home.source.label')}</span>
        {needsGithubCheck ? (
          <span
            className={`v3-source-gh-badge ${
              githubChecking
                ? 'is-checking'
                : githubStatus?.configured
                  ? 'is-connected'
                  : 'is-disconnected'
            }`}
            data-testid={`${idPrefix}-github-status`}
          >
            {githubChecking
              ? t('home.source.github_checking')
              : githubStatus?.configured
                ? t('home.source.github_connected')
                : t('home.source.github_settings_cta')}
          </span>
        ) : null}
      </div>

      <Segmented
        options={options}
        value={value.mode}
        onChange={(nextMode) => {
          if (!isProjectSourceMode(nextMode)) return;
          setPickerNotice('none');
          onChange({ ...value, mode: nextMode });
        }}
        disabled={disabled}
        className="v3-source-segmented"
        data-testid={`${idPrefix}-segmented`}
      />

      {value.mode === 'new_folder' ? (
        <div className="v3-source-panel" data-testid={`${idPrefix}-panel-new-folder`}>
          <p className="v3-source-hint">{t('home.source.new_folder_hint')}</p>
          <div className="v3-source-grid">
            <div className="v3-source-browse-field">
              <TextField
                id={`${idPrefix}-parent-dir`}
                label={t('home.source.parent_dir_label')}
                value={value.parentDir}
                onChange={(e) => onChange({ ...value, parentDir: e.target.value })}
                placeholder={t('home.source.parent_dir_placeholder')}
                disabled={disabled}
                data-testid={`${idPrefix}-parent-dir-input`}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<IconFolder size={14} />}
                onClick={() =>
                  void handleBrowseFolder('parentDir', t('home.source.parent_dir_label'))
                }
                disabled={disabled}
                data-testid={`${idPrefix}-browse-button`}
              >
                {t('home.source.browse_folder')}
              </Button>
            </div>
            <TextField
              id={`${idPrefix}-folder-name`}
              label={t('home.source.folder_name_label')}
              value={value.folderName}
              onChange={(e) => onChange({ ...value, folderName: e.target.value })}
              placeholder={t('home.source.folder_name_placeholder')}
              disabled={disabled}
              data-testid={`${idPrefix}-folder-name-input`}
            />
          </div>
        </div>
      ) : null}

      {value.mode === 'existing' ? (
        <div className="v3-source-panel" data-testid={`${idPrefix}-panel-existing`}>
          <p className="v3-source-hint">{t('home.source.existing_hint')}</p>
          <div className="v3-source-browse-field">
            <TextField
              id={`${idPrefix}-existing-path`}
              label={t('home.source.existing_label')}
              value={value.existingPath}
              onChange={(e) => onChange({ ...value, existingPath: e.target.value })}
              placeholder={t('home.source.existing_placeholder')}
              disabled={disabled}
              data-testid={`${idPrefix}-existing-path-input`}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<IconFolder size={14} />}
              onClick={() =>
                void handleBrowseFolder('existingPath', t('home.source.existing_label'))
              }
              disabled={disabled}
              data-testid={`${idPrefix}-browse-button`}
            >
              {t('home.source.browse_folder')}
            </Button>
          </div>
        </div>
      ) : null}

      {value.mode === 'github_link' ? (
        <div className="v3-source-panel" data-testid={`${idPrefix}-panel-github-link`}>
          <p className="v3-source-hint">{t('home.source.github_link_hint')}</p>
          <TextField
            id={`${idPrefix}-repo-url`}
            label={t('home.source.repo_url_label')}
            value={value.repoUrl}
            onChange={(e) => onChange({ ...value, repoUrl: e.target.value })}
            placeholder={t('home.source.repo_url_placeholder')}
            disabled={disabled}
            data-testid={`${idPrefix}-repo-url-input`}
          />
          <div className="v3-source-grid">
            <div className="v3-source-browse-field">
              <TextField
                id={`${idPrefix}-parent-dir`}
                label={t('home.source.parent_dir_label')}
                value={value.parentDir}
                onChange={(e) => onChange({ ...value, parentDir: e.target.value })}
                placeholder={t('home.source.parent_dir_placeholder')}
                disabled={disabled}
                data-testid={`${idPrefix}-parent-dir-input`}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<IconFolder size={14} />}
                onClick={() =>
                  void handleBrowseFolder('parentDir', t('home.source.parent_dir_label'))
                }
                disabled={disabled}
                data-testid={`${idPrefix}-browse-button`}
              >
                {t('home.source.browse_folder')}
              </Button>
            </div>
            <TextField
              id={`${idPrefix}-folder-name`}
              label={t('home.source.clone_folder_name_label')}
              value={value.folderName}
              onChange={(e) => onChange({ ...value, folderName: e.target.value })}
              placeholder={t('home.source.clone_folder_name_placeholder')}
              disabled={disabled}
              data-testid={`${idPrefix}-folder-name-input`}
            />
          </div>
          {!githubChecking && githubStatus && !githubStatus.configured ? (
            <div className="v3-source-inline-note" data-testid={`${idPrefix}-github-link-note`}>
              <span>{t('home.source.github_link_unconnected_note')}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onOpenIntegrations}
                data-testid={`${idPrefix}-integrations-button`}
              >
                {t('home.source.github_settings_cta')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {value.mode === 'github_create' ? (
        <div className="v3-source-panel" data-testid={`${idPrefix}-panel-github-create`}>
          {githubChecking ? (
            <p className="v3-source-hint" data-testid={`${idPrefix}-github-checking`}>
              {t('home.source.github_checking')}
            </p>
          ) : !githubStatus?.configured ? (
            <div data-testid={`${idPrefix}-github-missing-banner`}>
              <Banner
                variant="attention"
                title={t('home.source.github_not_connected_title')}
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onOpenIntegrations}
                    data-testid={`${idPrefix}-integrations-button`}
                  >
                    {t('home.source.github_settings_cta')}
                  </Button>
                }
              >
                {t('home.source.github_not_connected_body')}
              </Banner>
            </div>
          ) : (
            <>
              <p className="v3-source-hint">{t('home.source.github_create_hint')}</p>
              <div className="v3-source-grid">
                <TextField
                  id={`${idPrefix}-github-repo-name`}
                  label={t('home.source.github_repo_name_label')}
                  value={value.githubRepoName}
                  onChange={(e) => onChange({ ...value, githubRepoName: e.target.value })}
                  placeholder={t('home.source.github_repo_name_placeholder')}
                  disabled={disabled}
                  data-testid={`${idPrefix}-github-repo-name-input`}
                />
                <div className="v3-source-browse-field">
                  <TextField
                    id={`${idPrefix}-parent-dir`}
                    label={t('home.source.parent_dir_label')}
                    value={value.parentDir}
                    onChange={(e) => onChange({ ...value, parentDir: e.target.value })}
                    placeholder={t('home.source.parent_dir_placeholder')}
                    disabled={disabled}
                    data-testid={`${idPrefix}-parent-dir-input`}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<IconFolder size={14} />}
                    onClick={() =>
                      void handleBrowseFolder('parentDir', t('home.source.parent_dir_label'))
                    }
                    disabled={disabled}
                    data-testid={`${idPrefix}-browse-button`}
                  >
                    {t('home.source.browse_folder')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {pickerNotice === 'error' ? (
        <p className="v3-source-picker-msg is-error" data-testid={`${idPrefix}-picker-error`}>
          {t('home.source.picker_error')}
        </p>
      ) : showUnavailableHint ? (
        <p className="v3-source-picker-msg" data-testid={`${idPrefix}-picker-unavailable`}>
          {t('home.source.picker_unavailable')}
        </p>
      ) : null}
    </div>
  );
}
