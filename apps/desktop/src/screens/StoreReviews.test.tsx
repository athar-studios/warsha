// Tests for the post-launch Store reviews ledger (PLAN.md M17, REDESIGN §5).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocaleProvider } from '@warsha/i18n';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clampRating,
  formatReviewTime,
  MAX_RATING,
  MIN_RATING,
  ratingIsKnown,
  ratingLabel,
  ratingStars,
  reviewPassesFilter,
  reviewText,
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

function renderScreen(
  list: StoreReview[] = reviews,
  locale: 'ar' | 'en' = 'en',
  props: { loading?: boolean; failed?: boolean; onRetry?: () => void } = {}
) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <StoreReviews reviews={list} {...props} />
    </LocaleProvider>
  );
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

describe('StoreReviews', () => {
  it('renders a ruled ledger with one row per review', () => {
    renderScreen();

    expect(screen.getByRole('list', { name: 'Store reviews' })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3);

    const first = screen.getByTestId('store-review-review-1');
    expect(within(first).getByTestId('store-review-review-1-stars')).toHaveTextContent('★★★★★');
    expect(within(first).getByTestId('store-review-review-1-body')).toHaveTextContent(
      'Works offline and the install was clean.'
    );
    expect(within(first).getByTestId('store-review-review-1-author')).toHaveTextContent('owner-a');
    // A store tag is an identifier: mono, isolated, untranslated (§11).
    expect(within(first).getByText('microsoft_store')).toHaveAttribute('dir', 'ltr');

    expect(screen.getByTestId('store-review-review-2-stars')).toHaveTextContent('★★☆☆☆');
    expect(screen.getByTestId('store-reviews-count')).toHaveTextContent('3 reviews');
  });

  it('names the stars in words, so the score is never a shape alone (§9)', () => {
    renderScreen();

    // review-1 (5) and review-3 (9, clamped to 5) both read `5 of 5` — the word is the answer, the
    // clamped shape is not a silent rewrite of what the store said.
    expect(screen.getAllByRole('img', { name: '5 of 5' })).toHaveLength(2);
    expect(screen.getByRole('img', { name: '2 of 5' })).toBeInTheDocument();
  });

  it('filters the ledger the owner asked for, and says when a filter matches nothing', () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Three or fewer' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByTestId('store-review-review-2-body')).toHaveTextContent('The docs are thin.');

    fireEvent.click(screen.getByRole('button', { name: 'Four or more' }));
    expect(screen.getByTestId('store-review-review-1')).toBeInTheDocument();
    expect(screen.queryByTestId('store-review-review-2')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('flags a rating outside the store range while drawing the clamped stars', () => {
    renderScreen();

    const broken = screen.getByTestId('store-review-review-3');
    expect(broken).toHaveAttribute('data-rating', '9');
    expect(within(broken).getByTestId('store-review-review-3-stars')).toHaveTextContent('★★★★★');
    // The finding is a word and a glyph on a chip, not a red tint (§9).
    expect(within(broken).getByTestId('store-review-review-3-out-of-range')).toHaveTextContent(
      'Rating out of range'
    );
    expect(within(broken).getByText('Rating out of range').closest('[data-tone="fail"]')).toBeInstanceOf(
      HTMLElement
    );

    // A rating inside the range is not flagged.
    expect(screen.queryByTestId('store-review-review-1-out-of-range')).toBeNull();
  });

  it('copies a review, which is the one next action an ingestion RPC cannot do yet', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    renderScreen();
    await act(async () => {
      fireEvent.click(screen.getByTestId('store-review-review-1-copy'));
    });

    expect(writeText).toHaveBeenCalledWith(reviewText(reviews[0], 'en'));
    expect(await screen.findByRole('status')).toHaveTextContent('review copied');
  });

  it('renders an empty ledger with one next step, and its loading and failed readings', () => {
    const { unmount } = renderScreen([], 'en', { onRetry: () => undefined });
    expect(screen.getByTestId('store-reviews-count')).toHaveTextContent('no reviews');
    expect(screen.getByTestId('store-reviews-empty')).toHaveTextContent('No store reviews yet.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    unmount();

    const loading = renderScreen([], 'en', { loading: true });
    expect(loading.container).toHaveTextContent('loading store reviews');
    loading.unmount();

    renderScreen(reviews, 'en', { failed: true, onRetry: () => undefined });
    expect(screen.getByRole('alert')).toHaveTextContent('The daemon did not answer the review list.');
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

    expect(reviewPassesFilter(3, 'low')).toBe(true);
    expect(reviewPassesFilter(4, 'low')).toBe(false);
    expect(reviewPassesFilter(4, 'high')).toBe(true);
    expect(reviewPassesFilter(1, 'high')).toBe(false);
    expect(reviewPassesFilter(9, 'all')).toBe(true);
  });

  it('reads a received time in UTC', () => {
    expect(formatReviewTime(1_760_000_000)).toBe('2025-10-09 08:53 UTC');
    expect(formatReviewTime(-1)).toBe('—');
  });

  it('uses the Arabic labels and direction, keeping stars and store tags LTR', () => {
    renderScreen(reviews, 'ar');

    expect(screen.getByTestId('store-reviews')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'تقييمات المتاجر' })).toBeInTheDocument();
    // Arabic counts are catalog plurals, not a locale ternary (§13).
    expect(screen.getByTestId('store-reviews-count')).toHaveTextContent('3 تقييمات');

    const first = screen.getByTestId('store-review-review-1');
    const stars = within(first).getByTestId('store-review-review-1-stars');
    expect(stars).toHaveAttribute('dir', 'ltr');
    expect(within(first).getByRole('img', { name: '5 من 5' })).toBeInTheDocument();
    expect(within(first).getByText('microsoft_store')).toHaveAttribute('dir', 'ltr');
  });
});
