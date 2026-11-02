import type { Meta, StoryObj } from '@storybook/react';

import { Segmented } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// The owner's choices, in one row (§5): language, theme, eco. A group of toggle buttons, each announcing
// its own pressed state, and the chosen one lifting to a `surface` plate so the state is not only a colour.
const meta = {
  title: 'Bench/Segmented',
  component: Segmented,
  parameters: { layout: 'padded' },
  args: {
    label: 'اللغة',
    value: 'ar',
    onChange: () => undefined,
    options: [
      { value: 'ar', label: 'العربية', glyph: 'AR' },
      { value: 'en', label: 'English', glyph: 'EN' },
    ],
  },
} satisfies Meta<typeof Segmented>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Language: Story = {};

/** Theme is an owner choice with three rungs, and the direction does not allow a media query here (§12). */
export const Theme: Story = {
  args: {
    label: 'المظهر',
    value: 'dark',
    options: [
      { value: 'light', label: 'فاتح', glyph: '☀' },
      { value: 'dark', label: 'داكن', glyph: '☾' },
      { value: 'auto', label: 'تلقائي', glyph: '◐' },
    ],
  },
};

/** A switch that is one choice: eco mode. */
export const Eco: Story = {
  args: {
    label: 'وضع التوفير',
    value: 'on',
    options: [
      { value: 'on', label: 'مفعّل' },
      { value: 'off', label: 'متوقف' },
    ],
  },
};

/** The settings plate's density. */
export const Compact: Story = {
  args: { size: 'sm' },
};

/** The three controls a settings plate holds, stacked. */
export const Settings: Story = {
  render: (args) => (
    <DemoStack>
      <Segmented {...args} />
      <Segmented
        label="المظهر"
        value="light"
        onChange={() => undefined}
        options={[
          { value: 'light', label: 'فاتح', glyph: '☀' },
          { value: 'dark', label: 'داكن', glyph: '☾' },
        ]}
      />
      <Segmented
        label="وضع التوفير"
        value="off"
        onChange={() => undefined}
        options={[
          { value: 'on', label: 'مفعّل' },
          { value: 'off', label: 'متوقف' },
        ]}
      />
    </DemoStack>
  ),
};

export const AllCorners: Story = {
  render: (args) => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <Segmented
          {...args}
          label={locale === 'ar' ? 'المظهر' : 'theme'}
          options={[
            { value: 'light', label: locale === 'ar' ? 'فاتح' : 'light', glyph: '☀' },
            { value: 'dark', label: locale === 'ar' ? 'داكن' : 'dark', glyph: '☾' },
          ]}
        />
      )}
    />
  ),
};
