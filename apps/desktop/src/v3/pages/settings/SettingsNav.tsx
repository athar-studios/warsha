// apps/desktop/src/v3/pages/settings/SettingsNav.tsx — Settings SideNav with Simple/Advanced disclosure
import { arCatalog, enCatalog, useT } from '@warsha/i18n/v3';
import {
  Button,
  IconAlert,
  IconCalendar,
  IconChevron,
  IconCode,
  IconCpu,
  IconGitBranch,
  IconInfo,
  IconKey,
  IconLink,
  IconPhone,
  IconPlug,
  IconSettings,
  IconSparkle,
  IconTerminal,
  IconWallet,
  TextField,
} from '@warsha/ui/v3';
import React from 'react';

import { SETTINGS_SECTIONS, type SectionMeta, type SettingsSectionId } from './types';

export type SettingsLayer = 'quick' | 'developers';

export interface SettingsNavProps {
  activeSection: SettingsSectionId;
  onSelectSection: (id: SettingsSectionId) => void;
  mode: 'simple' | 'factory' | 'developers';
  layer: SettingsLayer;
  onLayerChange: (layer: SettingsLayer) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
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
    case 'connections':
      return <IconTerminal size={18} />;
    case 'mcp':
      return <IconKey size={18} />;
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
    case 'coding-engines':
      return <IconTerminal size={18} />;
    default:
      return <IconSettings size={18} />;
  }
}

function matchesSearch(sec: SectionMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [
    sec.id,
    enCatalog[sec.labelKey] ?? '',
    enCatalog[sec.descKey] ?? '',
    arCatalog[sec.labelKey] ?? '',
    arCatalog[sec.descKey] ?? '',
  ];
  return fields.some((f) => f.toLowerCase().includes(q));
}

export function SettingsNav({
  activeSection,
  onSelectSection,
  mode,
  layer,
  onLayerChange,
  searchQuery,
  onSearchChange,
  advancedExpanded,
  onToggleAdvanced,
}: SettingsNavProps): React.ReactElement {
  const t = useT();

  const isSearching = searchQuery.trim().length > 0;

  let visiblePrimary: SectionMeta[] = [];
  let visibleAdvanced: SectionMeta[] = [];

  if (isSearching) {
    const matched = SETTINGS_SECTIONS.filter((s) => matchesSearch(s, searchQuery));
    visiblePrimary = matched.filter((s) => !s.isAdvanced);
    visibleAdvanced = matched.filter((s) => s.isAdvanced);
  } else if (layer === 'quick') {
    const quick = SETTINGS_SECTIONS.filter((s) => s.isQuick);
    visiblePrimary = quick;
    visibleAdvanced = [];
  } else {
    visiblePrimary = SETTINGS_SECTIONS.filter((s) => !s.isAdvanced);
    visibleAdvanced = SETTINGS_SECTIONS.filter((s) => s.isAdvanced);
  }

  const showAdvanced =
    isSearching || (layer === 'developers' && (mode !== 'simple' || advancedExpanded));

  return (
    <nav className="v3-settings-nav" aria-label={t('settings.nav.label')}>
      <div
        style={{
          padding: 'var(--w-space-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-2)',
        }}
      >
        <TextField
          label={t('settings.search.label')}
          placeholder={t('settings.search.placeholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          data-testid="settings-search-input"
        />

        {!isSearching && (
          <div
            role="radiogroup"
            aria-label={t('settings.nav.label')}
            className="v3-settings-segmented-group"
            style={{ width: '100%' }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={layer === 'quick'}
              data-action="settings.layer.quick"
              className="v3-settings-segmented-item"
              onClick={() => onLayerChange('quick')}
              style={{ flex: 1 }}
            >
              {t('settings.layer.quick')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={layer === 'developers'}
              data-action="settings.layer.advanced"
              className="v3-settings-segmented-item"
              onClick={() => onLayerChange('developers')}
              style={{ flex: 1 }}
            >
              {t('settings.layer.advanced')}
            </button>
          </div>
        )}
      </div>

      {isSearching && visiblePrimary.length === 0 && visibleAdvanced.length === 0 && (
        <div
          style={{
            padding: 'var(--w-space-4)',
            color: 'var(--w-text-muted)',
            fontSize: 'var(--w-font-size-sm)',
          }}
        >
          {t('settings.search.empty')}
        </div>
      )}

      <ul className="v3-settings-nav-list">
        {visiblePrimary.map((sec) => {
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

      {!isSearching && layer === 'developers' && mode === 'simple' && (
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
            {showAdvanced ? t('settings.nav.advanced_hide') : t('settings.nav.advanced_show')}
          </Button>
        </div>
      )}

      {showAdvanced && visibleAdvanced.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-1)',
          }}
        >
          {!isSearching && (
            <div className="v3-settings-nav-group-title">{t('settings.nav.advanced_group')}</div>
          )}
          <ul className="v3-settings-nav-list">
            {visibleAdvanced.map((sec) => {
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
