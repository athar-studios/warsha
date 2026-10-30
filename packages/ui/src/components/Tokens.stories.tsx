import type { Meta, StoryObj } from '@storybook/react';
import type { CSSProperties } from 'react';

import {
  colorTokenNames,
  colorVar,
  radiusTokenNames,
  shadowTokenNames,
  SPACING_STEPS,
} from '../tokens';

// A live view of the token layer. Every value is rendered through the token variable rather than
// the hex, so flipping the theme globe (or the RTL/LTR globe) changes this page and nothing here has
// a second copy of the palette to keep in sync.
const meta = {
  title: 'Foundations/Tokens',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const label: CSSProperties = {
  fontFamily: 'var(--warsha-font-mono)',
  fontSize: 'var(--warsha-font-size-xs)',
  color: 'var(--warsha-color-text-muted)',
};

export const Colors: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 'var(--warsha-space-3)',
      }}
    >
      {colorTokenNames.map((name) => (
        <div
          key={name}
          style={{
            border: '1px solid var(--warsha-color-border)',
            borderRadius: 'var(--warsha-radius-lg)',
            overflow: 'hidden',
          }}
        >
          <div style={{ height: 'var(--warsha-space-12)', backgroundColor: colorVar(name) }} />
          <div style={{ padding: 'var(--warsha-space-2)' }}>
            <span style={label}>{`color-${name}`}</span>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Spacing: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
      {SPACING_STEPS.map((step) => (
        <div
          key={step}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}
        >
          <span style={{ ...label, width: 'var(--warsha-space-24)' }}>{`space-${step}`}</span>
          <div
            style={{
              height: 'var(--warsha-space-3)',
              width: `var(--warsha-space-${step})`,
              backgroundColor: 'var(--warsha-color-accent)',
            }}
          />
        </div>
      ))}
    </div>
  ),
};

export const Radius: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap' }}>
      {radiusTokenNames.map((name) => (
        <div
          key={name}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)' }}
        >
          <div
            style={{
              width: 'var(--warsha-space-16)',
              height: 'var(--warsha-space-16)',
              backgroundColor: 'var(--warsha-color-surface-muted)',
              border: '1px solid var(--warsha-color-border)',
              borderRadius: `var(--warsha-radius-${name})`,
            }}
          />
          <span style={label}>{`radius-${name}`}</span>
        </div>
      ))}
    </div>
  ),
};

export const Shadow: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--warsha-space-6)', flexWrap: 'wrap' }}>
      {shadowTokenNames.map((name) => (
        <div
          key={name}
          style={{
            width: 'var(--warsha-space-24)',
            height: 'var(--warsha-space-16)',
            backgroundColor: 'var(--warsha-color-surface)',
            borderRadius: 'var(--warsha-radius-xl)',
            boxShadow: `var(--warsha-shadow-${name})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={label}>{`shadow-${name}`}</span>
        </div>
      ))}
    </div>
  ),
};
