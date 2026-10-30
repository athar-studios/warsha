import type { StorybookConfig } from '@storybook/react-vite';

// Storybook 8 for @warsha/ui.
//
// It is a per-package config (this directory), not a repo-root one: the design system is the only
// package with stories, and keeping it here means `pnpm --filter @warsha/ui storybook` works without
// the root package needing a Storybook dependency.
//
// `@storybook/react-vite` is the builder because the UI package already builds with Vite (vitest),
// so a story is compiled by the same toolchain as the tests — the tokens resolve identically.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],

  addons: ['@storybook/addon-essentials'],

  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  docs: {
    // A component opts in with `tags: ['autodocs']`; nothing here generates docs implicitly.
    autodocs: 'tag',
  },

  core: {
    disableTelemetry: true,
  },

  // The preview is a normal page: no static assets are served.
  staticDirs: [],
};

export default config;
