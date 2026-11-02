import type { Meta, StoryObj } from '@storybook/react';
import type { CSSProperties } from 'react';

import {
  aliasTokenNames,
  aliasVar,
  colorTokenNames,
  colorVar,
  radiusTokenNames,
  shadowTokenNames,
  size,
  sizeTokenNames,
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

/**
 * The Bench & Signal aliases (REDESIGN §12), which is the layer a component is actually allowed to reach
 * for. Each swatch is named by what it *means* — the lamp, the plate, the fastener, the ring — so a screen
 * never has to know that the lamp is `#FFD60A`. Flip the theme globe: `signalText`, `lampWorking` and
 * `focusRing` resolve to a different token per theme, which is the night shift doing its job.
 */
export const Aliases: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 'var(--warsha-space-3)',
      }}
    >
      {aliasTokenNames.map((name) => (
        <div
          key={name}
          style={{
            border: '1px solid var(--warsha-bench-rule)',
            borderRadius: 'var(--warsha-radius-md)',
            overflow: 'hidden',
            backgroundColor: 'var(--warsha-color-surface)',
          }}
        >
          <div style={{ height: 'var(--warsha-space-8)', backgroundColor: aliasVar(name) }} />
          <div style={{ padding: 'var(--warsha-space-2)', display: 'grid', gap: 'var(--warsha-space-1)' }}>
            <span style={{ ...label, color: 'var(--warsha-color-text)' }}>{aliasVar(name)}</span>
            <span style={label}>
              {name === 'signalText' || name === 'focusRing' || name === 'lampWorking'
                ? 'theme-dependent'
                : 'stable across themes'}
            </span>
          </div>
        </div>
      ))}
    </div>
  ),
};

/**
 * The bench sizes. Two of these are accessibility facts rather than taste — `size-touch` (the 44px WCAG
 * floor) and `size-inscribe` (the 2px focus ring and stamp border) — and R6 forbids a component writing
 * either as a number, which is what makes the floor enforceable instead of aspirational.
 */
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--warsha-space-2)' }}>
      {sizeTokenNames.map((name) => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}>
          <span style={{ ...label, width: 'var(--warsha-space-32)' }}>{`size-${name}`}</span>
          <span
            aria-hidden="true"
            style={{
              blockSize: size(name),
              inlineSize: 'var(--warsha-space-8)',
              backgroundColor: 'var(--warsha-signal)',
              border: '1px solid var(--warsha-bench-edge)',
              flex: 'none',
            }}
          />
          <span style={label}>{size(name)}</span>
        </div>
      ))}
    </div>
  ),
};
