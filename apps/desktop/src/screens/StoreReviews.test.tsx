// Tests for the post-launch Store reviews screen (PLAN.md M17).
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import { LocaleProvider } from '@warsha/i18n';
import { describe, expect, it } from 'vitest';

import {
  clampRating,
  MAX_RATING,
  MIN_RATING,
  ratingIsKnown,
  ratingLabel,
  ratingStars,
  StoreReviews,
  type StoreReview,
} from './StoreReviews';

const reviews: StoreReview[] = [
  {
    id: 'review-1',
    store: 'microsoft_store',
    rating: 5,
    body: 'Works offline and the install was clean.',
    author: 'owner-a',
    receivedAt: 1_760_000_000,
  },
  {
    id: 'review-2',
    store: 'crates_io',
    rating: 2,
    body: 'The docs are thin.',
    author: 'owner-b',
    receivedAt: 1_760_000_100,
  },
  {
    id: 'review-3',
    store: 'crates_io',
    rating: 9,
    body: 'Duplicate row from a broken feed.',
    author: 'anonymous',
    receivedAt: 1_760_000_200,
  },
];

function renderScreen(list: StoreReview[] = reviews, locale: 'ar' | 'en' = 'en') {
  render(
    <LocaleProvider initialLocale={locale}>
      <StoreReviews reviews={list} />
    </LocaleProvider>
  );
}

describe('StoreReviews', () => {
  it('renders one row per review with its stars, body, author and store', () => {
    renderScreen();

    const list = screen.getByTestId('store-reviews-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    const first = screen.getByTestId('store-review-review-1');
    expect(within(first).getByTestId('store-review-review-1-stars')).toHaveTextContent('★★★★★');
    expect(within(first).getByTestId('store-review-review-1-body')).toHaveTextContent(
      'Works offline and the install was clean.'
    );
    expect(within(first).getByTestId('store-review-review-1-author')).toHaveTextContent('owner-a');
    expect(within(first).getByTestId('store-review-review-1-store')).toHaveTextContent(
      'microsoft_store'
    );

    expect(screen.getByTestId('store-review-review-2-stars')).toHaveTextContent('★★☆☆☆');
    expect(screen.getByTestId('store-reviews-count')).toHaveTextContent('3 reviews');
  });

  it('renders an empty state when there are no reviews', () => {
    renderScreen([]);

    expect(screen.getByTestId('store-reviews-count')).toHaveTextContent('0 reviews');
    expect(screen.getByTestId('store-reviews-empty')).toHaveTextContent('No store reviews yet.');
    expect(screen.queryByTestId('store-reviews-list')).toBeNull();
  });

  it('flags a rating outside the store range while drawing the clamped stars', () => {
    renderScreen();

    const broken = screen.getByTestId('store-review-review-3');
    expect(broken).toHaveAttribute('data-rating', '9');
    expect(within(broken).getByTestId('store-review-review-3-stars')).toHaveTextContent('★★★★★');
    expect(within(broken).getByTestId('store-review-review-3-out-of-range')).toHaveTextContent(
      'Rating out of range'
    );

    // A rating inside the range is not flagged.
    expect(screen.queryByTestId('store-review-review-1-out-of-range')).toBeNull();
  });

  it('keeps rating helpers consistent with the store range', () => {
    expect(MIN_RATING).toBe(1);
    expect(MAX_RATING).toBe(5);

    expect(clampRating(0)).toBe(1);
    expect(clampRating(3)).toBe(3);
    expect(clampRating(3.6)).toBe(4);
    expect(clampRating(9)).toBe(5);
    expect(clampRating(Number.NaN)).toBe(1);

    expect(ratingStars(1)).toBe('★☆☆☆☆');
    expect(ratingStars(3)).toBe('★★★☆☆');
    expect(ratingStars(5)).toBe('★★★★★');
    expect(ratingStars(9)).toBe('★★★★★');

    expect(ratingLabel(3, 'en')).toBe('3 of 5');
    expect(ratingLabel(3, 'ar')).toBe('3 من 5');

    expect(ratingIsKnown(1)).toBe(true);
    expect(ratingIsKnown(5)).toBe(true);
    expect(ratingIsKnown(0)).toBe(false);
    expect(ratingIsKnown(6)).toBe(false);
    expect(ratingIsKnown(Number.NaN)).toBe(false);
  });

  it('uses the Arabic labels and direction, keeping stars and store tags LTR', () => {
    renderScreen(reviews, 'ar');

    expect(screen.getByTestId('store-reviews')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'تقييمات المتاجر' })).toBeInTheDocument();
    expect(screen.getByTestId('store-reviews-count')).toHaveTextContent('3 تقييم');

    const first = screen.getByTestId('store-review-review-1');
    const stars = within(first).getByTestId('store-review-review-1-stars');
    expect(stars).toHaveAttribute('dir', 'ltr');
    expect(within(first).getByRole('img', { name: '5 من 5' })).toBeInTheDocument();
    expect(within(first).getByTestId('store-review-review-1-store')).toHaveAttribute('dir', 'ltr');
  });
});
