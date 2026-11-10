import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Stepper, type StepperStage } from './Stepper';

const STAGES: StepperStage[] = [
  { key: 'idea', label: 'الفكرة', state: 'done' },
  { key: 'plan', label: 'الخطة', state: 'current' },
  { key: 'build', label: 'البناء', state: 'waiting' },
  { key: 'check', label: 'الفحص', state: 'todo' },
  { key: 'deliver', label: 'التسليم', state: 'todo' },
];

describe('Stepper composite', () => {
  it('renders all stages with state attributes', () => {
    const { container } = render(<Stepper stages={STAGES} />);

    expect(screen.getByText('الفكرة')).toBeInTheDocument();
    expect(screen.getByText('الخطة')).toBeInTheDocument();
    expect(screen.getByText('البناء')).toBeInTheDocument();

    const currentStage = container.querySelector('[data-state="current"]');
    expect(currentStage).toBeInTheDocument();
  });

  it('triggers onStageClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Stepper stages={STAGES} onStageClick={handleClick} />);

    fireEvent.click(screen.getByText('الفكرة'));
    expect(handleClick).toHaveBeenCalledWith('idea');
  });
});
