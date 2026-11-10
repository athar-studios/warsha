#!/bin/sh
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/f4/apps/desktop || exit 99
npx vitest run src/screens/ModelsSettings.test.tsx
