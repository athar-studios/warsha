import React from 'react';

import type { Decorator, Preview } from '@storybook/react';

// The token stylesheet is imported once, here. Every story then reads `var(--warsha-…)` and the
// theme/direction globes below change the result — no story carries its own colour.
import '../src/tokens/tokens.css';

// Two globes, both first-class:
//
//   * Direction — RTL is the default, because Arabic is the canonical layout and English is the
//     secondary one. The decorator sets `dir` on the story container, so a physical property
//     anywhere in a component shows up immediately as a broken layout.
//   * Theme — light is the default; dark is the `#0E0E0E` surface with the same `#FFD60A` accent.
//
// The decorator is written with `React.createElement` rather than JSX so this file stays `.ts`
// (Storybook's default preview entry point) instead of needing a `.tsx` rename.
const withDirectionAndTheme: Decorator = (Story, context) => {
  const direction = context.globals.dir === 'ltr' ? 'ltr' : 'rtl';
  const theme = context.globals.theme === 'dark' ? 'dark' : 'light';

  return React.createElement(
    'div',
    {
      dir: direction,
      'data-theme': theme,
      style: {
        direction,
        backgroundColor: 'var(--warsha-color-bg)',
        color: 'var(--warsha-color-text)',
        fontFamily: 'var(--warsha-font-sans)',
        fontSize: 'var(--warsha-font-size-md)',
        lineHeight: 'var(--warsha-line-height-base)',
        padding: 'var(--warsha-space-6)',
        minHeight: '100%',
      },
    },
    React.createElement(Story)
  );
};

const preview: Preview = {
  decorators: [withDirectionAndTheme],

  globalTypes: {
    dir: {
      name: 'Direction',
      description: 'RTL (Arabic, the canonical layout) or LTR (English)',
      defaultValue: 'rtl',
      toolbar: {
        icon: 'transfer',
        title: 'Direction',
        items: [
          { value: 'rtl', title: 'RTL — العربية' },
          { value: 'ltr', title: 'LTR — English' },
        ],
        dynamicTitle: true,
      },
    },
    theme: {
      name: 'Theme',
      description: 'Light or dark; `data-theme` switches the token values',
      defaultValue: 'light',
      toolbar: {
        icon: 'paintbrush',
        title: 'Theme',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark — #0E0E0E' },
        ],
        dynamicTitle: true,
      },
    },
  },

  parameters: {
    // Storybook's own background addon would paint over the token background, so the decorator owns
    // the surface and the addon is off.
    backgrounds: { disable: true },
    controls: { expanded: true },
    options: {
      storySort: { order: ['Foundations'] },
    },
  },
};

export default preview;
