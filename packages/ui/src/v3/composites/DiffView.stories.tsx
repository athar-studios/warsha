import type { Meta, StoryObj } from '@storybook/react';

import { DiffView } from './DiffView';

const SAMPLE_DIFF = `@@ -10,6 +10,7 @@
 export interface AppConfig {
   port: number;
   host: string;
-  debug: boolean;
+  debug: false;
+  telemetry: boolean;
 }`;

const meta = {
  title: 'v3/Composites/DiffView',
  component: DiffView,
  args: {
    filename: 'src/config.ts',
    diff: SAMPLE_DIFF,
    copyLabel: 'نسخ الفروقات',
    copiedLabel: 'تم النسخ!',
  },
} satisfies Meta<typeof DiffView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
