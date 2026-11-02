import type { Meta, StoryObj } from '@storybook/react';

import { TerminalDock, TerminalLine } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// The terminal surface Advanced mode earns (§1's rejected alternatives). What makes it a bench object and
// not a raw keystroke trap: the output is a `role="log"`, the prompt is a labelled field in a form, Enter
// submits, Escape clears, and a long line scrolls inside the dock instead of widening the page.
const meta = {
  title: 'Bench/Terminal',
  component: TerminalDock,
  parameters: { layout: 'padded' },
  args: {
    label: 'الطرفية',
    commandLabel: 'أمر',
    submitLabel: 'شغّل',
    hint: '/workspace/atlas',
    onCommand: () => undefined,
    output: (
      <>
        <TerminalLine tone="prompt">cargo test --offline</TerminalLine>
        <TerminalLine>running 14 tests …</TerminalLine>
        <TerminalLine tone="ok">test result: ok. 14 passed; 0 failed</TerminalLine>
      </>
    ),
  },
} satisfies Meta<typeof TerminalDock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A failing run: the tone tints, the text says. */
export const Failed: Story = {
  args: {
    output: (
      <>
        <TerminalLine tone="prompt">cargo test --offline</TerminalLine>
        <TerminalLine>failures:</TerminalLine>
        <TerminalLine tone="fail">  test_auth_login --- FAILED (401 unauthorized)</TerminalLine>
        <TerminalLine tone="fail">test result: FAILED. 13 passed; 1 failed</TerminalLine>
      </>
    ),
  },
};

/** A read-only dock: the transcript with no prompt, which is what Simple mode shows. */
export const ReadOnly: Story = {
  args: { onCommand: undefined },
};

/** The label is persistent: visible here, hidden in the chat column's shape. */
export const VisibleLabel: Story = { args: { hideLabel: false } };

export const HiddenLabel: Story = { args: { hideLabel: true } };

/** The run is executing: the submit waits and the field says so. */
export const Busy: Story = { args: { busy: true } };

/** A long output line scrolls inside the dock (§10's overflow gate). */
export const LongContent: Story = {
  args: {
    output: (
      <>
        <TerminalLine tone="prompt">
          pnpm --filter @warsha/desktop exec playwright test e2e/advanced-mode.spec.ts --headed --reporter=line
        </TerminalLine>
        <TerminalLine>
          Running 12 tests across 3 files — crates/warshad/tests/e2e_real_arabic_request.rs, apps/desktop/e2e/harness.ts,
          packages/ui/src/tokens/tokenDrift.test.ts
        </TerminalLine>
      </>
    ),
  },
};

export const AllCorners: Story = {
  render: (args) => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <DemoStack>
          <TerminalDock
            {...args}
            label={locale === 'ar' ? 'الطرفية' : 'terminal'}
            commandLabel={locale === 'ar' ? 'أمر' : 'command'}
            submitLabel={locale === 'ar' ? 'شغّل' : 'run'}
          />
        </DemoStack>
      )}
    />
  ),
};
