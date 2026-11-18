# Packet E1 - Mode switch, settings redesign, legacy UI retirement

## Status
- Initialized packet E1.
- Implemented mode switch (Simple/Factory/Developers) with persistence.
- Implemented settings export/import (WIP: needs UI integration).
- Legacy UI audit completed.

## Legacy UI Retirement Inventory
| Screen | Reachable from V3App? | Status | Disposition | Follow-up Packet |
|---|---|---|---|---|
| AdvancedMode.tsx | Yes (Modes) | Retained | To be refactored | TBD |
| ArtifactViewer.tsx | Yes | Retained | Keep | N/A |
| Budgets.tsx | Yes | Retained | Keep | N/A |
| CrashReports.tsx | Yes | Retained | Keep | N/A |
| Devices.tsx | Yes | Retained | Keep | N/A |
| GatesInbox.tsx | Yes | Retained | Keep | N/A |
| HarnessesSettings.tsx | Yes | Retained | Keep | N/A |
| ModelsSettings.tsx | Yes | Retained | Keep | N/A |
| Onboarding.tsx | Yes | Retained | Keep | N/A |
| PluginsSettings.tsx | Yes | Retained | Keep | N/A |
| ProvidersSettings.tsx | Yes | Retained | Keep | N/A |
| RolesSettings.tsx | Yes | Retained | Keep | N/A |
| Routines.tsx | Yes | Retained | Keep | N/A |
| RunView.tsx | Yes | Retained | Keep | N/A |
| SettingsProviders.tsx | Yes | Retained | Keep | N/A |
| SettingsScreen.tsx | Yes | Retained | Keep | N/A |
| SettingsScreenIntegrations.tsx | Yes | Retained | Keep | N/A |
| SimpleMode.tsx | Yes (Modes) | Retained | To be refactored | TBD |
| SkillsSettings.tsx | Yes | Retained | Keep | N/A |
| StoreReviews.tsx | Yes | Retained | Keep | N/A |

## Decisions
- D-RN-E1-001: Extend WorkbenchMode to include 'developers' mode as a first-class mode.
- D-RN-E1-002: Settings export/import uses placeholder refs for secrets to ensure security.

## Gate Table
| Gate | Status | Findings |
|---|---|---|
| typecheck | Passed | |
| test | Passed | |
| i18n-gate | Passed | |
| check-arch | Passed | |
| check-wire | Passed | |
| gitleaks | Passed | |
