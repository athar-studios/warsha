import type { Meta, StoryObj } from '@storybook/react';

import { Card } from '../components';

// The card is the `md` shadow and the `xl` radius, on the `surface` colour, so it lifts off `bg` in
// light mode and off `#0E0E0E` in dark mode without any component-level theme branch.
const meta = {
  title: 'Foundations/Card',
  component: Card,
  parameters: { layout: 'padded' },
  args: {
    children: 'Gate B — Review the spec, then approve or reject.',
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Two directions in one row: the card is direction-agnostic, the content follows `dir`. */
export const Directions: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 'var(--warsha-space-4)' }}>
      <Card {...args} dir="rtl">
        بوابة ب — راجع المواصفات ثم اعتمد أو ارفض.
      </Card>
      <Card {...args} dir="ltr">
        Gate B — review the spec, then approve or reject.
      </Card>
    </div>
  ),
};

/** A stack of cards, the shape the gates inbox renders. */
export const Stack: Story = {
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-3)' }}>
      <Card {...args}>Gate A — the brief</Card>
      <Card {...args}>Gate B — the spec</Card>
      <Card {...args}>Gate C — the build</Card>
    </div>
  ),
};
