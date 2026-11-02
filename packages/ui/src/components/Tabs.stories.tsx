import type { Meta, StoryObj } from '@storybook/react';

import { Chip, Tabs } from '../compounds';
import { FourCorners } from '../storySupport';

// Six settings screens share one horizontally scrollable tablist (§4), and a tablist earns its role by
// using a roving tabindex (§9): one tab in the Tab order, arrows moving between the rest, Enter selecting.
const meta = {
  title: 'Bench/Tabs',
  component: Tabs,
  parameters: { layout: 'padded' },
  args: {
    label: 'شاشات الإعدادات',
    // A container's children belong to each story; this sample keeps the args type complete.
    children: (
      <Tabs.Tab panelId="general" selected onSelect={() => undefined}>
        عام
      </Tabs.Tab>
    ),
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole settings family. The badge on `بوّابات` is a lit lamp, not a decoration. */
export const Settings: Story = {
  render: (args) => (
    <Tabs {...args}>
      <Tabs.Tab panelId="settings" selected onSelect={() => undefined}>
        عام
      </Tabs.Tab>
      <Tabs.Tab panelId="settings-providers" onSelect={() => undefined}>
        المزوّدون
      </Tabs.Tab>
      <Tabs.Tab panelId="routines" onSelect={() => undefined}>
        روتينات
      </Tabs.Tab>
      <Tabs.Tab panelId="crash-reports" badge={<Chip tone="fail" glyph="✗">2</Chip>} onSelect={() => undefined}>
        تقارير الأعطال
      </Tabs.Tab>
      <Tabs.Tab panelId="store-reviews" onSelect={() => undefined}>
        مراجع المتجر
      </Tabs.Tab>
      <Tabs.Tab panelId="backend-kit" onSelect={() => undefined}>
        حزمة الخادم
      </Tabs.Tab>
    </Tabs>
  ),
};

/** The run view's three panes, in English. */
export const RunView: Story = {
  args: {
    label: 'run view',
    children: (
      <>
        <Tabs.Tab panelId="events" selected onSelect={() => undefined}>
          Events
        </Tabs.Tab>
        <Tabs.Tab panelId="files" onSelect={() => undefined}>
          Files
        </Tabs.Tab>
        <Tabs.Tab panelId="artifacts" badge={<Chip tone="lit" glyph="!">1</Chip>} onSelect={() => undefined}>
          Artifacts
        </Tabs.Tab>
      </>
    ),
  },
};

/** A disabled tab keeps its place and says it cannot be taken. */
export const Disabled: Story = {
  args: {
    children: (
      <>
        <Tabs.Tab panelId="a" selected onSelect={() => undefined}>
          الأحداث
        </Tabs.Tab>
        <Tabs.Tab panelId="b" disabled onSelect={() => undefined}>
          الطرفية
        </Tabs.Tab>
      </>
    ),
  },
};

/** Long Arabic labels: the strip scrolls inside itself and the page never widens (§10). */
export const LongContent: Story = {
  args: {
    children: (
      <>
        <Tabs.Tab panelId="a" selected onSelect={() => undefined}>
          ملخّص الفريق والنشاط الأخير
        </Tabs.Tab>
        <Tabs.Tab panelId="b" onSelect={() => undefined}>
          سجلّ الأحداث والأدوات والتكاليف
        </Tabs.Tab>
        <Tabs.Tab panelId="c" onSelect={() => undefined}>
          الملفات والفرق والطرفية
        </Tabs.Tab>
      </>
    ),
  },
};

export const AllCorners: Story = {
  render: () => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <Tabs label={locale === 'ar' ? 'شاشات الإعدادات' : 'settings screens'}>
          <Tabs.Tab panelId="general" selected onSelect={() => undefined}>
            {locale === 'ar' ? 'عام' : 'general'}
          </Tabs.Tab>
          <Tabs.Tab panelId="providers" onSelect={() => undefined}>
            {locale === 'ar' ? 'المزوّدون' : 'providers'}
          </Tabs.Tab>
          <Tabs.Tab panelId="routines" badge={<Chip tone="lit">2</Chip>} onSelect={() => undefined}>
            {locale === 'ar' ? 'روتينات' : 'routines'}
          </Tabs.Tab>
        </Tabs>
      )}
    />
  ),
};
