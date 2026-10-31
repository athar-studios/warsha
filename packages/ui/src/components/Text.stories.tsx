import type { Meta, StoryObj } from '@storybook/react';

import { Text } from '../components';

// The type scale is Arabic-first: the family token leads with IBM Plex Sans Arabic. Sizes are rem
// tokens, weights are unitless, so a story and the product share one scale.
//
// `inline` is the opt-out, not the default: `Text` renders a block-level box so the vertical
// margins and the alignment a screen asks for actually apply. See the component's `TextProps`.
const meta = {
  title: 'Foundations/Text',
  component: Text,
  parameters: { layout: 'padded' },
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    weight: { control: 'inline-radio', options: ['normal', 'medium', 'bold'] },
    dir: { control: 'inline-radio', options: ['auto', 'rtl', 'ltr'] },
    inline: { control: 'boolean' },
  },
  args: { children: 'Approve Gate B to continue', size: 'md', weight: 'normal', inline: false },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Bold: Story = { args: { weight: 'bold' } };

/**
 * The default: a block-level box. Each line is one box, so the margins and the centring below
 * apply. This is how every screen in the app uses `Text`.
 */
export const BlockByDefault: Story = {
  render: () => (
    <div style={{ maxWidth: '480px', margin: '0 auto' }}>
      <Text size="xl" weight="bold" style={{ marginBottom: 'var(--warsha-space-2)', textAlign: 'center' }}>
        ورشة
      </Text>
      <Text
        style={{
          color: 'var(--warsha-color-text-muted)',
          textAlign: 'center',
          marginBottom: 'var(--warsha-space-8)',
        }}
      >
        مصنع برمجيات بالذكاء الاصطناعي، عربي أولاً
      </Text>
      <Text size="sm" weight="medium">
        اختر اللغة
      </Text>
    </div>
  ),
};

/** The opt-out: `inline` keeps a run inside the surrounding line, for copy that must flow. */
export const InlineRun: Story = {
  render: () => (
    <Text>
      Approve Gate B to continue —{' '}
      <Text inline size="sm" weight="medium">
        2 pending
      </Text>
    </Text>
  ),
};

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
