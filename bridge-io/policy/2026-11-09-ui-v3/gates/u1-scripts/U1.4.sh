#!/bin/sh
# U1.4 — frozen gate, verbatim from packets/U1/gates.md. Run in worktree C:/Users/Dragonfly/Downloads/warsha-wt/v3/u1
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/u1/packages/ui/src/v3/composites || exit 99
for c in AppFrame TopBar ProjectSwitcher SideNav Card ListRow EmptyState Banner Toast Dialog Sheet Menu Stepper DecisionCard Composer ModelPicker BudgetField ActivityFeed PreviewCard CodeView DiffView Transcript DataTable SettingsSection CopyField KeyValue QrCode; do test -f $c.tsx && test -f $c.test.tsx && test -f $c.stories.tsx || { echo "missing $c"; exit 1; }; done
