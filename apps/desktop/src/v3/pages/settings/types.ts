export type SettingsSectionId =
  | 'general'
  | 'models'
  | 'devices'
  | 'workflows'
  | 'skills'
  | 'plugins'
  | 'integrations'
  | 'routines'
  | 'budgets'
  | 'postlaunch'
  | 'backend'
  | 'about';

export interface SectionMeta {
  id: SettingsSectionId;
  labelKey: string;
  descKey: string;
  scopeKey: string;
  isAdvanced: boolean;
}

export const SETTINGS_SECTIONS: readonly SectionMeta[] = [
  // Primary sections (shown in Simple mode)
  {
    id: 'general',
    labelKey: 'settings.section.general',
    descKey: 'settings.section.general.desc',
    scopeKey: 'settings.scope.device',
    isAdvanced: false,
  },
  {
    id: 'models',
    labelKey: 'settings.section.models',
    descKey: 'settings.section.models.desc',
    scopeKey: 'settings.scope.system',
    isAdvanced: false,
  },
  {
    id: 'devices',
    labelKey: 'settings.section.devices',
    descKey: 'settings.section.devices.desc',
    scopeKey: 'settings.scope.daemon',
    isAdvanced: false,
  },
  {
    id: 'about',
    labelKey: 'settings.section.about',
    descKey: 'settings.section.about.desc',
    scopeKey: 'settings.scope.device',
    isAdvanced: false,
  },

  // Advanced sections
  {
    id: 'workflows',
    labelKey: 'settings.section.workflows',
    descKey: 'settings.section.workflows.desc',
    scopeKey: 'settings.scope.project',
    isAdvanced: true,
  },
  {
    id: 'skills',
    labelKey: 'settings.section.skills',
    descKey: 'settings.section.skills.desc',
    scopeKey: 'settings.scope.daemon',
    isAdvanced: true,
  },
  {
    id: 'plugins',
    labelKey: 'settings.section.plugins',
    descKey: 'settings.section.plugins.desc',
    scopeKey: 'settings.scope.daemon',
    isAdvanced: true,
  },
  {
    id: 'integrations',
    labelKey: 'settings.section.integrations',
    descKey: 'settings.section.integrations.desc',
    scopeKey: 'settings.scope.daemon',
    isAdvanced: true,
  },
  {
    id: 'routines',
    labelKey: 'settings.section.routines',
    descKey: 'settings.section.routines.desc',
    scopeKey: 'settings.scope.daemon',
    isAdvanced: true,
  },
  {
    id: 'budgets',
    labelKey: 'settings.section.budgets',
    descKey: 'settings.section.budgets.desc',
    scopeKey: 'settings.scope.project',
    isAdvanced: true,
  },
  {
    id: 'postlaunch',
    labelKey: 'settings.section.postlaunch',
    descKey: 'settings.section.postlaunch.desc',
    scopeKey: 'settings.scope.all_runs',
    isAdvanced: true,
  },
  {
    id: 'backend',
    labelKey: 'settings.section.backend',
    descKey: 'settings.section.backend.desc',
    scopeKey: 'settings.scope.run',
    isAdvanced: true,
  },
];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((s) => s.id === value);
}
