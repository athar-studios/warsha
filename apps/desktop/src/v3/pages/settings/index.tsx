// apps/desktop/src/v3/pages/settings/index.tsx — Settings page shell (UI_V3_PLAN §3.7)
import React, { useEffect, useState } from 'react';

import { useDensity } from '../../app/DensityContext';
import { useNavigate, useRoute } from '../../router';

import { SettingsNav } from './SettingsNav';
import { AboutSection } from './sections/AboutSection';
import { DevicesSection } from './sections/DevicesSection';
import { GeneralSection } from './sections/GeneralSection';
import { ModelsSection } from './sections/ModelsSection';
import { isSettingsSectionId, SETTINGS_SECTIONS, type SettingsSectionId } from './types';
import './settings.css';

export default function SettingsPage(): React.ReactElement {
  const { params } = useRoute();
  const navigate = useNavigate();
  const { mode } = useDensity();

  const rawSection = params.section ?? 'general';
  const activeSection: SettingsSectionId = isSettingsSectionId(rawSection)
    ? rawSection
    : 'general';

  const activeMeta = SETTINGS_SECTIONS.find((s) => s.id === activeSection);
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
        return <GeneralSection />;
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
