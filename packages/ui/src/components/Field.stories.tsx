import type { Meta, StoryObj } from '@storybook/react';

import { Field, fieldControl } from '../compounds';
import { DemoStack, FourCorners } from '../storySupport';

// A labelled control with its hint and its error, wired the way §7 asks: the label is a real `<label for>`,
// the messages have stable ids the control can describe itself with, and an invalid field says so in the tree
// instead of only turning red.
const meta = {
  title: 'Bench/Field',
  component: Field,
  parameters: { layout: 'padded' },
  args: {
    id: 'key',
    label: 'مفتاح API',
    hint: 'يُحفظ في سلسلة مفاتيح النظام ولا يُطبع في السجل.',
    required: true,
    // A field's control is its story's; this sample keeps the args type complete.
    children: <input id="key-sample" />,
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A clean field: label, control, hint. */
export const Default: Story = {
  render: (args) => (
    <Field {...args}>
      <input
        {...fieldControl(args.id, { hint: true })}
        type="password"
        name="api-key"
        // Paste is a right, not a privilege: the key comes from a password manager.
        autoComplete="off"
      />
    </Field>
  ),
};

/** An invalid field: `aria-invalid`, `aria-describedby` at the error, and the reason beside the field. */
export const Invalid: Story = {
  render: (args) => (
    <Field {...args} error="المفتاح ناقص: 32 حرفًا على الأقل.">
      <input {...fieldControl(args.id, { hint: true, error: true })} type="password" defaultValue="sk-" />
    </Field>
  ),
};

/** The endpoint field of the provider form — a LTR value inside an Arabic plate (§11). */
export const Endpoint: Story = {
  args: { id: 'endpoint', label: 'النقطة النهائية', hint: 'مثال: https://api.openai.com/v1', required: false },
  render: (args) => (
    <Field {...args}>
      <input {...fieldControl(args.id, { hint: true })} dir="ltr" translate="no" defaultValue="https://" />
    </Field>
  ),
};

/** Two fields side by side, the way a 768px settings plate lays them out (§10). */
export const Pair: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1rem' }}>
      <Field {...args}>
        <input {...fieldControl(args.id, { hint: true })} />
      </Field>
      <Field id="model" label="النموذج" hint="ar-7b · أقل تكلفة">
        <input {...fieldControl('model', { hint: true })} defaultValue="gpt-4o-mini" dir="ltr" />
      </Field>
    </div>
  ),
};

/** A long Arabic hint must wrap inside the field, not push the plate wider. */
export const LongContent: Story = {
  args: {
    label: 'مفتاح الوصول الخاص بالمزوّد الذي يستخدمه فريق التنفيذ في هذه الورشة',
    hint: 'يُحفظ المفتاح في سلسلة مفاتيح نظام التشغيل ولا يُرسل إلى الخادم ولا يُطبع في سجلّ الأحداث مطلقًا.',
  },
};

export const AllCorners: Story = {
  render: (args) => (
    <FourCorners
      columns={1}
      render={({ locale }) => (
        <DemoStack>
          <Field
            {...args}
            label={locale === 'ar' ? 'مفتاح API' : 'API key'}
            hint={
              locale === 'ar'
                ? 'يُحفظ في سلسلة مفاتيح النظام.'
                : 'Stored in your OS keychain, never in the log.'
            }
          >
            <input {...fieldControl(args.id, { hint: true })} type="password" />
          </Field>
          <Field
            id="model"
            label={locale === 'ar' ? 'النموذج' : 'Model'}
            error={locale === 'ar' ? 'النموذج مطلوب.' : 'A model is required.'}
          >
            <input {...fieldControl('model', { error: true })} dir="ltr" />
          </Field>
        </DemoStack>
      )}
    />
  ),
};
