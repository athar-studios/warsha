import type { Meta, StoryObj } from '@storybook/react';

import { Box } from '../components';

// Box carries spacing only. `p`/`m` are steps of the 4px scale from `tokens/spacing.ts`, written to
// the logical `paddingInline`/`marginInline`, so the same story mirrors correctly under RTL.
const meta = {
  title: 'Foundations/Box',
  component: Box,
  parameters: { layout: 'padded' },
  argTypes: {
    p: { control: { type: 'number', min: 0, max: 16, step: 1 } },
    m: { control: { type: 'number', min: 0, max: 16, step: 1 } },
    dir: { control: 'inline-radio', options: ['auto', 'rtl', 'ltr'] },
  },
  args: { children: 'Box content', p: 2, m: 0 },
} satisfies Meta<typeof Box>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Both directions side by side: the padding is inline, so Arabic and English both inset correctly. */
export const Directions: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 'var(--warsha-space-4)' }}>
      <Box {...args} dir="rtl">
        عربي
      </Box>
      <Box {...args} dir="ltr">
        English
      </Box>
    </div>
  ),
};

/** The published spacing scale, one step per box. */
export const SpacingScale: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
      {[1, 2, 3, 4, 6, 8].map((step) => (
        <Box key={step} p={step} style={{ backgroundColor: 'var(--warsha-color-surface-muted)' }}>
          {`p={${step}}`}
        </Box>
      ))}
    </div>
  ),
};
