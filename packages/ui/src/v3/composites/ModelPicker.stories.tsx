import type { Meta, StoryObj } from '@storybook/react';

import { ModelPicker } from './ModelPicker';

const meta = {
  title: 'v3/Composites/ModelPicker',
  component: ModelPicker,
  args: {
    options: [
      { id: 'local-mistral', label: 'النموذج المحلي', providerLabel: 'أولاما' },
      { id: 'cloud-reasoning', label: 'النموذج التحليلي', providerLabel: 'سحابي' },
    ],
    value: 'local-mistral',
    addModelLabel: 'إضافة نموذج جديد',
    emptyLabel: 'لا يوجد نموذج مسجل',
  },
} satisfies Meta<typeof ModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    options: [],
    onAddModel: () => {},
  },
};
