import type { Meta, StoryObj } from '@storybook/react';

import { Text } from '../components';

// The type scale is Arabic-first: the family token leads with IBM Plex Sans Arabic. Sizes are rem
// tokens, weights are unitless, so a story and the product share one scale.
const meta = {
  title: 'Foundations/Text',
  component: Text,
  parameters: { layout: 'padded' },
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    weight: { control: 'inline-radio', options: ['normal', 'medium', 'bold'] },
    dir: { control: 'inline-radio', options: ['auto', 'rtl', 'ltr'] },
  },
  args: { children: 'Approve Gate B to continue', size: 'md', weight: 'normal' },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Bold: Story = { args: { weight: 'bold' } };

/** The whole scale, from caption to heading. */
export const Scale: Story = {
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
      {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Text {...args} key={size} size={size}>
          {`size="${size}" — ورشة`}
        </Text>
      ))}
    </div>
  ),
};

/** Mixed Arabic and Latin in one run: the fallback stack keeps both scripts in one family. */
export const Bilingual: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
      <Text weight="medium">ورشة — مصنع برمجيات بالذكاء الاصطناعي</Text>
      <Text weight="medium" dir="ltr">
        Warsha — an Arabic-first software factory
      </Text>
    </div>
  ),
};
