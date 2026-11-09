import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { V3App } from './V3App';

describe('V3App', () => {
  it('renders Frame with route page and main data-ready="true"', () => {
    const { container } = render(<V3App initialRoute="/projects" />);

    expect(screen.getByRole('heading', { level: 1, name: /Projects|المشاريع/ })).toBeDefined();
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    expect(main?.getAttribute('data-ready')).toBe('true');
  });

  it('renders Onboarding placeholder at /onboarding', () => {
    render(<V3App initialRoute="/onboarding" />);
    expect(screen.getByRole('heading', { level: 1, name: /Onboarding|التهيئة الأولى/ })).toBeDefined();
  });
});
