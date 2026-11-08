// @warsha/ui — SettingsScopeSentence stories

import type { Meta, StoryObj } from '@storybook/react';

import { SettingsScopeSentence as SettingsScopeSentenceComponent } from './SettingsScopeSentence';

const meta: Meta<typeof SettingsScopeSentenceComponent> = {
  title: 'Bench/SettingsScopeSentence',
  component: SettingsScopeSentenceComponent,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    project: {
      control: 'object',
      description: 'The project this screen is scoped to, or null/undefined for global settings',
    },
    dir: {
      control: 'select',
      options: ['ltr', 'rtl', 'auto'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof SettingsScopeSentenceComponent>;

// Named export that matches the component name for the tokenDrift test
export const Default: Story = {
  args: {
    project: { id: 'proj-123', name: 'My Awesome Project' },
    dir: 'ltr',
  },
};

export const GlobalScope: Story = {
  args: {
    project: null,
    dir: 'ltr',
  },
};

export const GlobalScopeArabic: Story = {
  args: {
    project: null,
    dir: 'rtl',
  },
};

export const ProjectScope: Story = {
  args: {
    project: { id: 'proj-123', name: 'My Awesome Project' },
    dir: 'ltr',
  },
};

export const ProjectScopeArabic: Story = {
  args: {
    project: { id: 'proj-123', name: 'مشروع رائع' },
    dir: 'rtl',
  },
};

export const ProjectScopeUndefined: Story = {
  args: {
    project: undefined,
    dir: 'ltr',
  },
};