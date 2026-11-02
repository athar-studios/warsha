// Post-launch care — Store reviews (PLAN.md M17), redrawn for the bench (REDESIGN §5).
//
// The list half of "store reviews ingestion": a ledger with one row per review we read back from the
// stores we ship to, tagged with the store, the star rating, the body and the author. Nothing here fetches,
// tags or routes anything on its own — the rows arrive from the caller, so the same list serves every store
// and a later ingestion job drops in unchanged.
//
// The bench shape:
//
//   * a plate and a ledger, ruled rows rather than a grid of cards (§1.1, §1.2);
//   * the stars are a graphic with a name: `role="img"` and `aria-label` carry `4 of 5`, and the filled and
//     hollow glyphs are the colour-free half (§5's "accessible star graphics", §9);
//   * the store tag and the received time are machine data — mono, tabular, `translate="no"`, isolated
//     left-to-right inside the Arabic line (§11);
//   * a rating outside the range the stores use is *flagged in words* while the clamped stars still render,
//     so the reader sees both what the store said and how the bench maps it (§7);
//   * the filters are real (they read the list the caller passed), and so is the one action a review has
//     without an ingestion RPC: copy it into the feedback loop.
//
// Every word is `@warsha/i18n` (`post_launch.reviews.*`): the `{ ar, en }` table, the fallback shim and the
// `locale === 'ar' ? '… تقييم' : '… reviews'` count line are gone.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Banner, Button, Chip, EmptyState, Lamp, Ledger, Skeleton, Stamp } from '@warsha/ui';
import React, { useCallback, useMemo, useState } from 'react';

export interface StoreReview {
  id: string;
  /** Which store the review came from, e.g. `microsoft_store`. */
  store: string;
  /** The rating as the store reported it (`u8` on the Rust side). */
  rating: number;
  /** The review body, verbatim. */
  body: string;
  /** The display name the store reports, or `anonymous`. */
  author: string;
  /** When the review was received, in seconds since the Unix epoch. */
  receivedAt: number;
}

/** The lowest rating the stores we ship to use. */
export const MIN_RATING = 1;

/** The highest rating the stores we ship to use. */
export const MAX_RATING = 5;

/**
 * Bring a rating into `MIN_RATING`..=`MAX_RATING` so five stars can render.
 *
 * The store's value is not rewritten in the daemon (a rewritten rating hides a data problem); the row
 * draws the clamped stars *and* flags an out-of-range value in words, so the reader sees both what the
 * store said and how it maps.
 */
export function clampRating(rating: number): number {
  if (!Number.isFinite(rating)) return MIN_RATING;
  return Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(rating)));
}

/** Whether the rating is inside the range the stores we ship to use. */
export function ratingIsKnown(rating: number): boolean {
  return Number.isFinite(rating) && rating >= MIN_RATING && rating <= MAX_RATING;
}

/** Five stars, filled up to the clamped rating and hollow after it. */
export function ratingStars(rating: number): string {
  const filled = clampRating(rating);
  return '★'.repeat(filled) + '☆'.repeat(MAX_RATING - filled);
}

/** The rating in words, e.g. `4 of 5` / `4 من 5` — the accessible name of the star graphic. */
export function ratingLabel(rating: number, locale: Locale): string {
  return t('post_launch.reviews.rating_of', { value: clampRating(rating), max: MAX_RATING }, locale);
}

/** Which reviews the bench shows: all of them, or the ones the owner is most likely to answer. */
export type ReviewFilter = 'all' | 'low' | 'high';

const REVIEW_FILTERS: readonly ReviewFilter[] = ['all', 'low', 'high'];

/** Low is the queue worth reading; high is the proof the bench is doing its job. */
export function reviewPassesFilter(rating: number, filter: ReviewFilter): boolean {
  if (filter === 'all') return true;
  const value = clampRating(rating);
  return filter === 'low' ? value <= 3 : value >= 4;
}

/** `2025-10-09 08:13 UTC` — a received time without a zone is a different time in every zone. */
export function formatReviewTime(receivedAt: number): string {
  if (!Number.isFinite(receivedAt) || receivedAt < 0) return '—';
  const date = new Date(Math.trunc(receivedAt) * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

/** What the copy action puts on the clipboard: the review, its store, its score and its author. */
export function reviewText(review: StoreReview, locale: Locale): string {
  return `${review.store} · ${ratingLabel(review.rating, locale)}\n${review.author}: ${review.body}`.trim();
}

export interface StoreReviewsProps {
  reviews: StoreReview[];
  /** A read is in flight (§7). */
  loading?: boolean;
  /** The last read failed. */
  failed?: boolean;
  /** Ask the caller to read the reviews again. */
  onRetry?: () => void;
}

/** One review: the stars, the words, the store tag and the copy action. */
function ReviewRow({ review, locale }: { review: StoreReview; locale: Locale }) {
  const dir = useDirection();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const known = ratingIsKnown(review.rating);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(reviewText(review, locale));
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }, [locale, review]);

  return (
    <Ledger.Row
      meta={<span dir="ltr" translate="no">{formatReviewTime(review.receivedAt)}</span>}
      actions={
        <Button variant="secondary" size="sm" dir={dir} data-testid={`store-review-${review.id}-copy`} onClick={() => void copy()}>
          {t('post_launch.reviews.copy', {}, locale)}
        </Button>
      }
    >
      <div
        data-testid={`store-review-${review.id}`}
        data-rating={review.rating}
        style={{ display: 'grid', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
          {/* Stars read left-to-right in both languages: pinned, isolated, and named in words (§9). */}
          <span
            data-testid={`store-review-${review.id}-stars`}
            dir="ltr"
            role="img"
            aria-label={ratingLabel(review.rating, locale)}
            translate="no"
            style={{
              flex: '0 0 auto',
              fontFamily: 'var(--warsha-font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 'var(--warsha-font-size-sm)',
              color: 'var(--warsha-color-text)',
              unicodeBidi: 'isolate',
            }}
          >
            {ratingStars(review.rating)}
          </span>
          <Chip>
            <span dir="ltr" translate="no">{review.store}</span>
          </Chip>
          {!known && (
            // The word, not the red, is the finding (§9).
            <Chip tone="fail" glyph="✗">
              <span data-testid={`store-review-${review.id}-out-of-range`}>
                {t('post_launch.reviews.out_of_range', {}, locale)}
              </span>
            </Chip>
          )}
        </span>

        <span
          data-testid={`store-review-${review.id}-body`}
          dir={dir}
          style={{ fontSize: 'var(--warsha-font-size-sm)', color: 'var(--warsha-color-text)', lineHeight: 'var(--warsha-line-height-relaxed)' }}
        >
          {review.body}
        </span>

        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
          <span data-testid={`store-review-${review.id}-author`} style={{ fontSize: 'var(--warsha-font-size-xs)', fontWeight: 'var(--warsha-font-weight-semibold)' }}>
            {`${review.author} · ${t('post_launch.reviews.received', {}, locale)}`}
          </span>
        </span>

        {copied && (
          <span role="status">
            <Stamp tone="ok">{t('post_launch.reviews.copied', {}, locale)}</Stamp>
          </span>
        )}
        {copyFailed && <Banner tone="error">{t('post_launch.reviews.copy_failed', {}, locale)}</Banner>}
      </div>
    </Ledger.Row>
  );
}

export function StoreReviews({ reviews, loading = false, failed = false, onRetry }: StoreReviewsProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [filter, setFilter] = useState<ReviewFilter>('all');

  const title = t('post_launch.reviews.title', {}, locale);
  const note = t('post_launch.reviews.note', {}, locale);
  const shown = useMemo(
    () => reviews.filter((review) => reviewPassesFilter(review.rating, filter)),
    [filter, reviews]
  );

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="store-reviews"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-3)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        minInlineSize: 0,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)', minInlineSize: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
        {/* B4 §9 (axe `page-has-heading-one`): a settings sub-screen IS the page while its tab is
           selected — §4 gives all six one tab strip — so it opens with the page's own heading, not a
           sub-heading under a page that has none. */}
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-lg)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {title}
          </h1>
          <span
            data-testid="store-reviews-count"
            dir="ltr"
            translate="no"
            style={{
              fontFamily: 'var(--warsha-font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 'var(--warsha-font-size-xs)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {t('post_launch.reviews.count', { count: reviews.length }, locale)}
          </span>
        </div>
        <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)', color: 'var(--warsha-color-text)' }}>
          {note}
        </p>
      </header>

      <div className="bench-filters" role="group" aria-label={t('post_launch.reviews.filter_label', {}, locale)}>
        {REVIEW_FILTERS.map((candidate) => (
          <Chip
            key={candidate}
            selected={filter === candidate}
            onPress={() => setFilter(candidate)}
          >
            {t(`post_launch.reviews.filter_${candidate}`, {}, locale)}
          </Chip>
        ))}
      </div>

      {failed && (
        <Banner
          tone="error"
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" dir={dir} data-testid="store-reviews-retry" onClick={onRetry}>
                {t('common.retry', {}, locale)}
              </Button>
            ) : undefined
          }
        >
          {t('post_launch.reviews.failed', {}, locale)}
        </Banner>
      )}

      {loading ? (
        <Skeleton label={t('post_launch.reviews.loading', {}, locale)} lines={3} variant="row" />
      ) : reviews.length === 0 ? (
        <div data-testid="store-reviews-empty" dir={dir}>
          <EmptyState
            title={t('post_launch.reviews.empty', {}, locale)}
            description={t('post_launch.reviews.next_action', {}, locale)}
            action={
              onRetry ? (
                <Button variant="secondary" size="sm" dir={dir} data-testid="store-reviews-empty-retry" onClick={onRetry}>
                  {t('common.retry', {}, locale)}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : shown.length === 0 ? (
        // §7: an empty filter result is not an empty ledger — it says what to press next.
        <Lamp state="idle" size="sm">
          {t('post_launch.reviews.filtered_empty', {}, locale)}
        </Lamp>
      ) : (
        <Ledger label={title} recessed style={{ borderBlockStart: 'none', borderRadius: 'var(--warsha-radius-md)' }}>
          {shown.map((review) => (
            <ReviewRow key={review.id} review={review} locale={locale} />
          ))}
        </Ledger>
      )}
    </section>
  );
}
