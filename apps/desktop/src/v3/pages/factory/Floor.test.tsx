// apps/desktop/src/v3/pages/factory/Floor.test.tsx
// Design pass: GUI re-test 3 saw the break-area label («منطقة الاستراحة») touch its neighbouring station box.
// These pin the geometry (label clear of the station row and above its own box) and the RTL mirror.
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { Floor, markerPosition, markerRoleKey, showsNeedsYou } from './Floor';
import type { AgentStatus } from './state';

const t = (key: string): string => key;

function agent(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    key: 'run-1:coder',
    runId: 'run-1',
    role: 'coder',
    state: 'idle',
    stage: null,
    lastAction: '',
    lastUpdated: '1970-01-01T00:00:00.000Z',
    costCents: 0,
    model: null,
    handoffFrom: null,
    ...overrides,
  };
}

function idler(key: string): AgentStatus {
  return {
    key,
    runId: 'run-1',
    role: 'coder',
    state: 'idle',
    stage: null,
    lastAction: '',
    lastUpdated: '1970-01-01T00:00:00.000Z',
    costCents: 0,
    model: null,
    handoffFrom: null,
  } as unknown as AgentStatus;
}

function draw(dir: 'ltr' | 'rtl', agents: AgentStatus[] = []): SVGSVGElement {
  render(
    <Floor
      agents={agents}
      nowMs={0}
      reducedMotion
      onSelect={() => undefined}
      selectedKey={null}
      swarmCounts={new Map()}
      t={t}
      dir={dir}
    />
  );
  return screen.getByTestId('factory-floor').querySelector('svg') as SVGSVGElement;
}

function num(element: Element, attr: string): number {
  return Number(element.getAttribute(attr));
}

describe('Factory floor geometry', () => {
  it('keeps the break-area label clear of the station row and above its own box', () => {
    const svg = draw('ltr');
    const rects = Array.from(svg.querySelectorAll('rect'));
    const stationBottom = Math.max(
      ...rects
        .filter((r) => !r.hasAttribute('stroke-dasharray'))
        .map((r) => num(r, 'y') + num(r, 'height'))
    );
    const breakBox = rects.find((r) => r.hasAttribute('stroke-dasharray')) as SVGRectElement;
    const label = screen.getByTestId('factory-break-label');
    const labelTop = num(label, 'y') - num(label, 'font-size');

    expect(labelTop).toBeGreaterThanOrEqual(stationBottom + 8);
    expect(num(label, 'y')).toBeLessThan(num(breakBox, 'y'));
    const viewHeight = Number((svg.getAttribute('viewBox') ?? '').split(' ')[3]);
    expect(num(breakBox, 'y') + num(breakBox, 'height')).toBeLessThanOrEqual(viewHeight);
  });

  it('mirrors the floor in RTL so work flows right to left', () => {
    const ltr = draw('ltr', [idler('a1')]);
    const ltrFirstStation = num(ltr.querySelectorAll('rect')[0], 'x');
    const ltrIdler = screen.getByTestId('factory-agent-a1').getAttribute('transform');
    cleanup();

    const rtl = draw('rtl', [idler('a1')]);
    const first = rtl.querySelectorAll('rect')[0];
    // Planning (the first station) moves from the left edge to the right edge.
    expect(num(first, 'x') + num(first, 'width')).toBe(1000 - ltrFirstStation);
    expect(screen.getByTestId('factory-agent-a1').getAttribute('transform')).not.toBe(ltrIdler);
  });

  it('stands an agent waiting on the owner at Your decisions, not in the break area', () => {
    const waiting = markerPosition(
      agent({ state: 'waiting_on_owner', stage: 'gate_a' }),
      0,
      [agent({ state: 'waiting_on_owner', stage: 'gate_a' })]
    );
    expect(waiting.stationKey).toBe('gates');
    expect(waiting.y).not.toBe(258);
    const idle = markerPosition(agent({ state: 'idle', stage: null }), 0, [agent()]);
    expect(idle.stationKey).toBeNull();
    expect(idle.y).toBe(258);
  });

  it('spreads agents that share a station so Needs-you labels do not share one point', () => {
    const waiting = Array.from({ length: 6 }, (_, index) =>
      agent({
        key: `run-${index}:intake`,
        runId: `run-${index}`,
        role: 'intake',
        state: 'waiting_on_owner',
        stage: 'gate_a',
      })
    );
    const positions = waiting.map((status, index) => markerPosition(status, index, waiting));
    expect(positions.every((position) => position.stationKey === 'gates')).toBe(true);
    const xs = positions.map((position) => position.x);
    expect(new Set(xs).size).toBe(6);
    expect(positions.every((position) => position.y === positions[0].y)).toBe(true);
    // Six circles stay inside the station box and the floor (view width 1000).
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(650 + 11);
    expect(Math.max(...xs)).toBeLessThanOrEqual(800 - 11);
  });

  it('paints Needs you once for six waiting agents at one station', () => {
    const waiting = Array.from({ length: 6 }, (_, index) =>
      agent({
        key: `run-${index}:intake`,
        runId: `run-${index}`,
        role: 'intake',
        state: 'waiting_on_owner',
        stage: 'gate_a',
      })
    );
    const shown = waiting.map((status, index) => showsNeedsYou(status, index, waiting));
    expect(shown.filter(Boolean)).toHaveLength(1);
    expect(shown[0]).toBe(true);

    draw('ltr', waiting);
    const labels = screen.getAllByTestId('factory-needs-you');
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toBe('factory.needsYou');
    // Centered on Your decisions (x 650, width 150), so the caption stays on the floor.
    const host = labels[0].parentElement as Element;
    const hostX = Number(host.getAttribute('transform')?.match(/-?\d+(\.\d+)?/)?.[0]);
    expect(hostX + num(labels[0], 'x')).toBe(725);
  });

  it('paints the catalog short role, not a three-character slice of the role id', () => {
    expect(markerRoleKey('intake')).toBe('factory.role.intake');
    expect(markerRoleKey(null)).toBe('factory.panel.unknown');
    draw('ltr', [
      agent({ key: 'run-1:intake', role: 'intake', state: 'waiting_on_owner', stage: 'gate_a' }),
    ]);
    const marker = screen.getByTestId('factory-agent-run-1:intake');
    const initials = marker.querySelector('text');
    expect(initials?.textContent).toBe('factory.role.intake');
    expect(initials?.textContent).not.toBe('int');
  });

  it('draws markers with declared status tokens only', () => {
    const svg = draw('ltr', [idler('a1')]);
    const circle = svg.querySelector('circle') as SVGCircleElement;
    expect(circle.getAttribute('fill')).toBe('var(--w-surface)');
    expect(circle.getAttribute('stroke')).toBe('var(--w-line-strong)');
  });
});
