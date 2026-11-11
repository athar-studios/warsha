import type { Meta, StoryObj } from '@storybook/react';

import { CodeView } from './CodeView';

const SAMPLE_CODE = `// Cargo.toml
[package]
name = "warsha-core"
version = "0.2.1"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1.0", features = ["full"] }`;

const meta = {
  title: 'v3/Composites/CodeView',
  component: CodeView,
  args: {
    filename: 'Cargo.toml',
    language: 'toml',
    code: SAMPLE_CODE,
    copyLabel: 'نسخ المحتوى',
    copiedLabel: 'تم النسخ!',
  },
} satisfies Meta<typeof CodeView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutLineNumbers: Story = {
  args: {
    showLineNumbers: false,
  },
};
