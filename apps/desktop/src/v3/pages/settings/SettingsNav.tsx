// apps/desktop/src/v3/pages/settings/SettingsNav.tsx — Settings SideNav with Simple/Advanced disclosure
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Button,
  IconAlert,
  IconCalendar,
  IconChevron,
  IconCode,
  IconCpu,
  IconGitBranch,
  IconInfo,
  IconLink,
  IconPhone,
  IconPlug,
  IconSettings,
  IconSparkle,
  IconWallet,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React from 'react';

import { SETTINGS_SECTIONS, type SettingsSectionId } from './types';

export interface SettingsNavProps {
  activeSection: SettingsSectionId;
  onSelectSection: (id: SettingsSectionId) => void;
  mode: 'simple' | 'advanced';
  advancedExpanded: boolean;
  onToggleAdvanced: () => void;
}

function getSectionIcon(id: SettingsSectionId): React.ReactNode {
  switch (id) {
    case 'general':
      return <IconSettings size={18} />;
    case 'models':
      return <IconCpu size={18} />;
    case 'devices':
      return <IconPhone size={18} />;
    case 'about':
      return <IconInfo size={18} />;
    case 'workflows':
      return <IconGitBranch size={18} />;
    case 'skills':
      return <IconSparkle size={18} />;
    case 'plugins':
      return <IconPlug size={18} />;
    case 'integrations':
      return <IconLink size={18} />;
    case 'routines':
      return <IconCalendar size={18} />;
    case 'budgets':
      return <IconWallet size={18} />;
    case 'postlaunch':
      return <IconAlert size={18} />;
    case 'backend':
      return <IconCode size={18} />;
  }
}

export function SettingsNav({
  activeSection,
  onSelectSection,
  mode,
  advancedExpanded,
  onToggleAdvanced,
}: SettingsNavProps): React.ReactElement {
  const t = useT();

  const primarySections = SETTINGS_SECTIONS.filter((s) => !s.isAdvanced);
  const advancedSections = SETTINGS_SECTIONS.filter((s) => s.isAdvanced);

  const showAdvanced = mode === 'advanced' || advancedExpanded;

  return (
    <nav
      className="v3-settings-nav"
      aria-label={t('settings.nav.label')}
    >
      <ul className="v3-settings-nav-list">
        {primarySections.map((sec) => {
          const isActive = sec.id === activeSection;
          return (
            <li key={sec.id}>
              <a
                href={`#/settings/${sec.id}`}
                aria-current={isActive ? 'page' : undefined}
                data-action="settings.nav.open"
                className="v3-settings-nav-link"
                onClick={(e) => {
                  e.preventDefault();
                  onSelectSection(sec.id);
                }}
              >
                <span className="v3-settings-nav-icon" aria-hidden="true">
                  {getSectionIcon(sec.id)}
                </span>
                <span>{t(sec.labelKey)}</span>
              </a>
            </li>
          );
        })}
      </ul>

      {mode === 'simple' && (
        <div style={{ paddingInline: 'var(--w-space-1)' }}>
          <Button
            variant="ghost"
            size="sm"
            icon={
              <span
                style={{
                  display: 'inline-flex',
                  transform: showAdvanced ? 'rotate(180deg)' : 'none',
                  transition: 'transform var(--w-dur-fast) var(--w-ease)',
                }}
              >
                <IconChevron size={14} />
              </span>
            }
            aria-expanded={advancedExpanded}
            data-action="settings.advanced.toggle"
            onClick={onToggleAdvanced}
            style={{ width: '100%', justifyContent: 'flex-start' }}
          >
            {showAdvanced
              ? t('settings.nav.advanced_hide')
              : t('settings.nav.advanced_show')}
          </Button>
        </div>
      )}

      {showAdvanced && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-1)',
          }}
        >
          <div className="v3-settings-nav-group-title">
            {t('settings.nav.advanced_group')}
          </div>
          <ul className="v3-settings-nav-list">
            {advancedSections.map((sec) => {
              const isActive = sec.id === activeSection;
              return (
                <li key={sec.id}>
                  <a
                    href={`#/settings/${sec.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    data-action="settings.nav.open"
                    className="v3-settings-nav-link"
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectSection(sec.id);
                    }}
                  >
                    <span className="v3-settings-nav-icon" aria-hidden="true">
                      {getSectionIcon(sec.id)}
                    </span>
                    <span>{t(sec.labelKey)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </nav>
  );
}
