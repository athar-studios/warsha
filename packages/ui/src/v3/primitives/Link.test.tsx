import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { Link } from './Link';

describe('Link primitive', () => {
  it('renders inline link with href', () => {
    render(<Link href="/docs">التوثيق</Link>);
    const link = screen.getByRole('link', { name: 'التوثيق' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/docs');
  });

  it('adds target="_blank" and rel for external link', () => {
    render(<Link href="https://example.com" external>رابط خارجي</Link>);
    const link = screen.getByRole('link', { name: 'رابط خارجي' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('forwards data-action and data-testid', () => {
    render(<Link href="/test" data-action="nav.docs" data-testid="doc-link">وثيقة</Link>);
    expect(screen.getByTestId('doc-link')).toHaveAttribute('data-action', 'nav.docs');
  });
});
