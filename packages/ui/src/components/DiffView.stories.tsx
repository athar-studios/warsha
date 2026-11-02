import type { Meta, StoryObj } from '@storybook/react';

import { DiffView } from '../compounds';
import { FourCorners } from '../storySupport';

// A change set is proved by a glyph in the gutter and a number in the readout, and the wash under an added
// line is the second channel, never the first (§6, §9). The whole block scrolls sideways inside its own
// region so a long line cannot widen the page (§10).
const meta = {
  title: 'Bench/DiffView',
  component: DiffView,
  parameters: { layout: 'padded' },
  args: {
    label: 'الفرق في src/auth.ts',
    // A container's children belong to each story; this sample keeps the args type complete.
    children: <DiffView.Line kind="add" newNumber={1}>{'let key = keychain.read("provider")?;'}</DiffView.Line>,
  },
} satisfies Meta<typeof DiffView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A hunk with both directions and a line of context between them. */
export const Hunk: Story = {
  render: (args) => (
    <DiffView {...args}>
      <DiffView.Line kind="meta" newNumber={24}>
        {'@@ -24,7 +24,8 @@'}
      </DiffView.Line>
      <DiffView.Line kind="context" oldNumber={24} newNumber={24}>
        {'export async function signIn(session: Session) {'}
      </DiffView.Line>
      <DiffView.Line kind="del" oldNumber={25}>
        {'const token = readFromEnv("WARSHA_TOKEN");'}
      </DiffView.Line>
      <DiffView.Line kind="add" oldNumber={25} newNumber={25}>
        {'const token = await keychain.read("warsha/provider");'}
      </DiffView.Line>
      <DiffView.Line kind="context" oldNumber={26} newNumber={26}>
        {'  return verify(token, session);'}
      </DiffView.Line>
    </DiffView>
  ),
};

/** The `−`/`+` in the gutter are what a reviewer who cannot see the tint reads. */
export const AddedAndRemoved: Story = {
  render: (args) => (
    <DiffView {...args} label="diff in crates/warshad/src/lib.rs">
      <DiffView.Line kind="del" oldNumber={112}>
        cors_layer.allow_origin(AllowOrigin::any());
      </DiffView.Line>
      <DiffView.Line kind="add" newNumber={112}>
        cors_layer.allow_origin(allowed_origins);
      </DiffView.Line>
    </DiffView>
  ),
};

/** A line long enough to need the region's own scroll, never the page's. */
export const LongLine: Story = {
  args: { label: 'diff in static/index.html' },
  render: (args) => (
    <DiffView {...args}>
      <DiffView.Line kind="add" newNumber={3}>
        {'  <div class="clinic-appointment-form-wrapper" data-i18n="clinic.form.container" id="booking">'}
      </DiffView.Line>
    </DiffView>
  ),
};

/** Two hunks in one region: the numbers are a column each, so they compare. */
export const TwoHunks: Story = {
  render: (args) => (
    <DiffView {...args}>
      <DiffView.Line kind="meta">{'@@ -1,3 +1,4 @@'}</DiffView.Line>
      <DiffView.Line kind="add" newNumber={1}>
        {'// the key lives in the OS keychain'}
      </DiffView.Line>
      <DiffView.Line kind="meta">{'@@ -40,2 +41,3 @@'}</DiffView.Line>
      <DiffView.Line kind="del" oldNumber={40}>
        {'let key = "";'}
      </DiffView.Line>
      <DiffView.Line kind="add" newNumber={40}>
        {'let key = keychain.read("provider")?;'}
      </DiffView.Line>
    </DiffView>
  ),
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <DiffView label={locale === 'ar' ? 'الفرق في src/auth.ts' : 'diff in src/auth.ts'}>
          <DiffView.Line kind="del" oldNumber={25}>
            {'const token = readFromEnv("WARSHA_TOKEN");'}
          </DiffView.Line>
          <DiffView.Line kind="add" newNumber={25}>
            {'const token = await keychain.read("warsha/provider");'}
          </DiffView.Line>
        </DiffView>
      )}
    />
  ),
};
