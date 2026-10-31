import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { Box, Text, Button, Card } from './components';

describe('ui components', () => {
  it('renders Box with children', () => {
    render(<Box>Hello</Box>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders Text with size and weight', () => {
    render(<Text size="xl" weight="bold">Title</Text>);
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('renders Button with variant', () => {
    render(<Button variant="secondary">Click</Button>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });

  it('renders Card with children', () => {
    render(<Card>Content</Card>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('Button calls onClick handler', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    screen.getByRole('button').click();
    expect(handleClick).toHaveBeenCalledOnce();
  });
});

// `Text` renders a block-level box by default. That is a regression fix, not a preference: every
// screen in this repository hands `Text` block-level props (`marginBottom`/`marginBlock`,
// `textAlign`, `maxWidth`, centred headings), and an inline box silently drops all of them — the
// three headlines of the desktop onboarding card collapsed onto one line and their boxes
// overlapped. These tests pin the default so it cannot go back to `inline` unnoticed.
describe('Text box model', () => {
  /** The rendered box of a `Text`, as the browser would cascade it. */
  function boxOf(text: string): HTMLElement {
    const element = screen.getByText(text);
    expect(element.tagName).toBe('SPAN');
    return element;
  }

  it('renders a block-level box by default', () => {
    render(<Text>Block by default</Text>);

    expect(getComputedStyle(boxOf('Block by default')).display).toBe('block');
  });

  it('renders an inline box when `inline` is set', () => {
    render(<Text inline>Inline on request</Text>);

    expect(getComputedStyle(boxOf('Inline on request')).display).toBe('inline');
  });

  it('keeps className, dir, style, size and weight working in both modes', () => {
    render(
      <>
        <Text className="heading" dir="rtl" size="xl" weight="bold" style={{ textAlign: 'center' }}>
          Heading
        </Text>
        <Text className="count" dir="ltr" size="xs" weight="medium" inline>
          12
        </Text>
      </>
    );

    const heading = boxOf('Heading');
    expect(heading).toHaveClass('heading');
    expect(heading).toHaveAttribute('dir', 'rtl');
    expect(heading.style.textAlign).toBe('center');
    expect(heading.style.fontWeight).toBe('var(--warsha-font-weight-bold)');

    const count = boxOf('12');
    expect(count).toHaveClass('count');
    expect(count).toHaveAttribute('dir', 'ltr');
    expect(getComputedStyle(count).display).toBe('inline');
  });

  it('stacks a run of Text elements with marginBottom into separate boxes', () => {
    // The exact shape of the onboarding card: a heading, a tagline and a label, each asking for
    // vertical space below it. jsdom has no layout engine, so the assertion is on the box model
    // that makes stacking true — each box is block-level, so the next one starts below the
    // previous one's bottom edge and the run cannot collapse onto a single line. The geometric
    // half of this regression (no intersecting bounding boxes, at both viewports) is asserted in
    // `apps/desktop/e2e/`, where a real layout engine is present.
    const { container } = render(
      <div data-testid="stack">
        <Text size="xl" weight="bold" style={{ marginBottom: 'var(--warsha-space-2)' }}>
          ورشة
        </Text>
        <Text style={{ marginBottom: 'var(--warsha-space-8)' }}>مصنع برمجيات</Text>
        <Text size="sm" weight="medium">
          اختر اللغة
        </Text>
      </div>
    );

    const boxes = Array.from(container.querySelectorAll('span'));
    expect(boxes).toHaveLength(3);

    for (const box of boxes) {
      expect(getComputedStyle(box).display).toBe('block');
    }

    // A block-level box in normal flow honours the vertical margin it was given. An inline box
    // ignores it, which is what let the three runs overlap.
    expect(boxes[0].style.marginBottom).toBe('var(--warsha-space-2)');
    expect(boxes[1].style.marginBottom).toBe('var(--warsha-space-8)');
    expect(boxes[2].style.marginBottom).toBe('');
  });

  it('does not force a block box onto a component that asked for inline elsewhere', () => {
    // The opt-out has to be per-element: one inline run next to a block one is the supported shape.
    const { container } = render(
      <div>
        <Text>Approve Gate B</Text>
        <Text inline>(2 pending)</Text>
      </div>
    );

    const [block, inline] = Array.from(container.querySelectorAll('span'));
    expect(getComputedStyle(block).display).toBe('block');
    expect(getComputedStyle(inline).display).toBe('inline');
  });
});
