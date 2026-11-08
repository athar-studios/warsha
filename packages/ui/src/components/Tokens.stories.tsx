import type { Meta, StoryObj } from '@storybook/react';
import type { CSSProperties } from 'react';

import { FourCorners } from '../storySupport';
import {
  aliasTokenNames,
  aliasVar,
  colorTokenNames,
  colorVar,
  elevationVar,
  fontSize,
  layoutSizeNames,
  layerTokenNames,
  layerTokens,
  lineTokenNames,
  lineVar,
  radiusTokenNames,
  shadowTokenNames,
  size,
  sizeTokenNames,
  sizeVarName,
  spacingTokens,
  spacingVarName,
  SPACING_STEPS,
} from '../tokens';

// A live view of the token layer. Every value is rendered through the token variable rather than
// the hex, so flipping the theme globe (or the RTL/LTR globe) changes this page and nothing here has
// a second copy of the palette to keep in sync. The DS v2 families (§4.2–§4.5) render through
// `FourCorners` as well, so the tints, the scrim and the lines are reviewed on both plates in both
// directions instead of only in the story's default corner.
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

/** The bench facts, without the layout family — a target height and a 1100px cap are different jobs. */
const BENCH_SIZE_NAMES = sizeTokenNames.filter(
  (name) => !(layoutSizeNames as readonly string[]).includes(name)
);

/** Every status tint with the ink the contrast gate proves on it (DS v2 §4.2). */
const TINT_PAIRS = [
  { tint: 'successTint', ink: colorVar('success'), caption: 'success · passing · approved' },
  { tint: 'warningTint', ink: colorVar('warning'), caption: 'warning · pending · needs attention' },
  { tint: 'errorTint', ink: colorVar('error'), caption: 'error · failing · blocked' },
  // The accent tint is a lamp surface, so its ink is the lamp-as-text alias, not a colour token.
  { tint: 'accentTint', ink: aliasVar('signalText'), caption: 'accent · the lamp as an opaque surface' },
] as const;

/** What each layer holds, in the product's own words (DS v2 §4.4). */
const LAYER_USES: Record<(typeof layerTokenNames)[number], string> = {
  raised: 'the composer’s sticky bar',
  popover: 'a picker listbox over its trigger',
  sticky: 'the remote sticky composer',
  chrome: 'topbars',
  scrim: 'the gate bell’s overlay',
  sheet: 'a popover sheet',
  banner: 'offline and alert banners',
  modal: 'device and project dialogs',
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

/**
 * The five derived colours (DS v2 §4.2): four status tints and the scrim. Each tint is the status
 * colour over `surface` at 6% light / 10% dark, stored opaque so `contrast.test.ts` can measure the
 * ink that sits on it — the caption under every plate is body `text`, which clears 4.5:1 on all four.
 * Flip the theme globe: the dark tints are a different mix, not a filter over the light ones.
 */
export const Tints: Story = {
  render: () => (
    <FourCorners
      columns={4}
      render={() => (
        <div style={{ display: 'grid', gap: 'var(--warsha-space-2)' }}>
          {TINT_PAIRS.map(({ tint, ink, caption }) => (
            <div
              key={tint}
              style={{
                backgroundColor: colorVar(tint),
                border: lineVar('edge'),
                borderRadius: 'var(--warsha-radius-md)',
                padding: 'var(--warsha-space-3)',
                display: 'grid',
                gap: 'var(--warsha-space-1)',
              }}
            >
              <span
                style={{
                  color: ink,
                  fontSize: fontSize('sm'),
                  fontWeight: 'var(--warsha-font-weight-semibold)',
                }}
              >
                {caption}
              </span>
              <span style={{ ...label, color: colorVar('text') }}>{`--warsha-color-${tint}`}</span>
            </div>
          ))}
          <span style={label}>
            a tint is a status surface: it may appear only where signal-wash would, when an opaque fill is
            required
          </span>
        </div>
      )}
    />
  ),
};

/**
 * The scrim (DS v2 §4.2): `bg` at 55% alpha, the value `GateBell.tsx` already used. On the day shift
 * it frosts the bench; on the night shift it dims it. The dialog plate above it is `surface` plus the
 * one permitted lift, which is what makes the scrim legible as a layer rather than a wash.
 */
export const Scrim: Story = {
  render: () => (
    <FourCorners
      columns={4}
      render={() => (
        <div
          style={{
            position: 'relative',
            minBlockSize: 'var(--warsha-space-32)',
            backgroundColor: aliasVar('benchPlate'),
            border: lineVar('rule'),
            borderRadius: 'var(--warsha-radius-md)',
            overflow: 'hidden',
            padding: 'var(--warsha-space-3)',
          }}
        >
          <span style={{ ...label, color: colorVar('text') }}>the work column behind the bell</span>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: colorVar('scrim'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                backgroundColor: colorVar('surface'),
                boxShadow: elevationVar('lift'),
                borderRadius: 'var(--warsha-radius-xl)',
                paddingInline: 'var(--warsha-space-4)',
                paddingBlock: 'var(--warsha-space-3)',
                color: colorVar('text'),
                fontSize: fontSize('sm'),
              }}
            >
              a gate that waits on the owner
            </div>
          </div>
        </div>
      )}
    />
  ),
};

/**
 * The eight lines (DS v2 §4.3). Every border the bench draws is one of these, composed from a size and
 * an alias so the theme still decides the colour; `internal.ts`'s `RULE_BORDER`/`SIGNAL_EDGE`/`INSCRIBE`
 * are `lineVar('rule')`/`('signal')`/`('inscribe')`, so the package and the apps share one source.
 */
export const Lines: Story = {
  render: () => (
    <FourCorners
      columns={4}
      render={() => (
        <div style={{ display: 'grid', gap: 'var(--warsha-space-3)', color: colorVar('text') }}>
          {lineTokenNames.map((name) => (
            <div key={name} style={{ display: 'grid', gap: 'var(--warsha-space-1)' }}>
              <div style={{ borderBlockStart: lineVar(name), minBlockSize: 0 }} />
              <span style={label}>{lineVar(name)}</span>
            </div>
          ))}
        </div>
      )}
    />
  ),
};

/**
 * The stacking order (DS v2 §4.4), at today's values so nothing re-stacks. A layer is a number, not a
 * theme decision: it is declared in the light block only, and R6.7 forbids a bare `zIndex: <n>` in the
 * package so a new overlay cannot invent a number between two known ones.
 */
export const Layers: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--warsha-space-1)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--warsha-space-2)',
          paddingBlockEnd: 'var(--warsha-space-1)',
          borderBlockEnd: lineVar('rule'),
        }}
      >
        <span style={label}>layer</span>
        <span style={label}>value</span>
        <span style={label}>used by</span>
      </div>
      {layerTokenNames.map((name) => (
        <div
          key={name}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 'var(--warsha-space-2)',
          }}
        >
          <span style={{ ...label, color: colorVar('text') }}>{`--warsha-layer-${name}`}</span>
          <span style={{ ...label, color: colorVar('text') }}>{layerTokens[name]}</span>
          <span style={label}>{LAYER_USES[name]}</span>
        </div>
      ))}
    </div>
  ),
};

/**
 * The three half-steps (DS v2 §4.5): `0.5` = 2px, `1.5` = 6px, `2.5` = 10px. They are published
 * tokens, not off-scale fallbacks, because the Button's block paddings (6px, 10px) and the picker's
 * row gap (2px) need them; the names replace the decimal point with a dash.
 */
export const HalfSteps: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
      {([0.5, 1.5, 2.5] as const).map((step) => (
        <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}>
          <span style={{ ...label, width: 'var(--warsha-space-24)' }}>{spacingVarName(step)}</span>
          <div
            style={{
              blockSize: 'var(--warsha-space-3)',
              inlineSize: spacingVarName(step),
              backgroundColor: 'var(--warsha-color-accent)',
            }}
          />
          <span style={label}>{spacingTokens[step]}</span>
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
          <span style={{ ...label, width: 'var(--warsha-space-24)' }}>
            {spacingVarName(step).replace('--warsha-space-', 'space-')}
          </span>
          <div
            style={{
              blockSize: 'var(--warsha-space-3)',
              inlineSize: spacingVarName(step),
              backgroundColor: 'var(--warsha-color-accent)',
            }}
          />
          <span style={label}>{spacingTokens[step]}</span>
        </div>
      ))}
    </div>
  ),
};

/**
 * The layout family (DS v2 §4.5): the caps, dialogs, panes and picker widths the apps drew as
 * literals, each token pixel-identical to the literal it replaces. W5 points the apps at these names;
 * until it lands, R6.9's ratchet holds the app count to the budget measured at this packet's base.
 */
export const LayoutSizes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--warsha-space-2)' }}>
      {layoutSizeNames.map((name) => (
        <div key={name} style={{ display: 'grid', gap: 'var(--warsha-space-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)' }}>
            <span style={{ ...label, width: 'var(--warsha-space-48)' }}>{sizeVarName(name)}</span>
            <span style={{ ...label, color: colorVar('text') }}>{size(name)}</span>
          </div>
          <div
            aria-hidden="true"
            style={{
              blockSize: 'var(--warsha-space-1)',
              inlineSize: size(name),
              maxInlineSize: '100%',
              backgroundColor: 'var(--warsha-signal-text)',
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
 * either as a number, which is what makes the floor enforceable instead of aspirational. The layout
 * family has its own story above; this one stays the physical facts a control is built from.
 */
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--warsha-space-2)' }}>
      {BENCH_SIZE_NAMES.map((name) => (
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
