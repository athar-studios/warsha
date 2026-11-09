import type { Meta, StoryObj } from '@storybook/react';

import { Link } from './Link';

const meta = {
  title: 'v3/Primitives/Link',
  component: Link,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['inline', 'standalone'] },
    external: { control: 'boolean' },
  },
  args: { children: 'دليل الاستخدام', href: '#', variant: 'inline' },
} satisfies Meta<typeof Link>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {};
export const Standalone: Story = { args: { variant: 'standalone' } };
export const External: Story = { args: { external: true, href: 'https://warsha.io' } };
