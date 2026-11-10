// apps/desktop/src/v3/pages/settings/index.tsx — Settings page shell (UI_V3_PLAN §3.7)
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import { EmptyState, SettingsSection } from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useEffect, useState } from 'react';

import { useDataReady } from '../../app/DataReadyContext';
import { useDensity } from '../../app/DensityContext';
import { useNavigate, useRoute } from '../../router';

import { SettingsNav } from './SettingsNav';
import { AboutSection } from './sections/AboutSection';
import { DevicesSection } from './sections/DevicesSection';
import { GeneralSection } from './sections/GeneralSection';
import { ModelsSection } from './sections/ModelsSection';
import {
  isSettingsSectionId,
  type SectionMeta,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from './types';
import './settings.css';

function PendingAdvancedSection({ meta }: { meta: SectionMeta }): React.ReactElement {
  const t = useT();
  const { setReady } = useDataReady();

  useEffect(() => {
    setReady(true);
  }, [setReady]);

  return (
    <div data-testid={`settings-section-${meta.id}`}>
      <SettingsSection
        title={t(meta.labelKey)}
        description={t(meta.descKey)}
        scope={t(meta.scopeKey)}
      >
        <EmptyState title={t(meta.labelKey)} description={t(meta.descKey)} />
      </SettingsSection>
    </div>
  );
}

export default function SettingsPage(): React.ReactElement {
  const { params } = useRoute();
  const navigate = useNavigate();
  const { mode } = useDensity();

  const rawSection = params.section ?? 'general';
  const activeSection: SettingsSectionId = isSettingsSectionId(rawSection)
    ? rawSection
    : 'general';

  const activeMeta = SETTINGS_SECTIONS.find((s) => s.id === activeSection) ?? SETTINGS_SECTIONS[0];
  const [advancedExpanded, setAdvancedExpanded] = useState<boolean>(
    () => Boolean(activeMeta?.isAdvanced)
  );

  useEffect(() => {
    if (activeMeta?.isAdvanced) {
      setAdvancedExpanded(true);
    }
  }, [activeMeta]);

  const handleSelectSection = (id: SettingsSectionId): void => {
    navigate(`/settings/${id}`);
  };

  const renderSection = (): React.ReactElement => {
    switch (activeSection) {
      case 'general':
        return <GeneralSection />;
      case 'models':
        return <ModelsSection />;
      case 'devices':
        return <DevicesSection />;
      case 'about':
        return <AboutSection />;
      default:
        return <PendingAdvancedSection meta={activeMeta} />;
    }
  };

  return (
    <div className="v3-settings-root" data-testid="settings-page">
      <SettingsNav
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        mode={mode}
        advancedExpanded={advancedExpanded}
        onToggleAdvanced={() => setAdvancedExpanded((prev) => !prev)}
      />
      <div className="v3-settings-content">{renderSection()}</div>
    </div>
  );
}
