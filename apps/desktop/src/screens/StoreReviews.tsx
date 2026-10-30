// Post-launch care — Store reviews (PLAN.md M17).
//
// The list half of "store reviews ingestion": one row per review we read back
// from the stores we ship to, tagged with the store, the star rating, the body
// and the author. Nothing here fetches, tags or routes anything — the screen is
// read-only and takes its reviews from the caller, so the same list serves every
// store and a later ingestion job drops in unchanged.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';

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

const labels = {
  title: { ar: 'تقييمات المتاجر', en: 'Store reviews' },
  note: {
    ar: 'كل تقييم بوسم متجره، جاهز لدخول حلقة الملاحظات.',
    en: 'Every review keeps its store tag, ready for the feedback loop.',
  },
  empty: { ar: 'لا توجد تقييمات بعد.', en: 'No store reviews yet.' },
  outOfRange: { ar: 'تقييم خارج المدى', en: 'Rating out of range' },
} satisfies Record<string, Record<Locale, string>>;

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
}

function countLabel(count: number, locale: Locale): string {
  return locale === 'ar' ? `${count} تقييم` : `${count} reviews`;
}

/**
 * Bring a rating into `MIN_RATING`..=`MAX_RATING` so five stars can render.
 *
 * The store's value is not rewritten in the daemon (a rewritten rating hides a
 * data problem); the row draws the clamped stars *and* flags an out-of-range
 * value in red, so the reader sees both what the store said and how it maps.
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

/** The rating in words, e.g. `4 of 5` / `4 من 5`. */
export function ratingLabel(rating: number, locale: Locale): string {
  const value = clampRating(rating);
  return locale === 'ar' ? `${value} من ${MAX_RATING}` : `${value} of ${MAX_RATING}`;
}

export interface StoreReviewsProps {
  reviews: StoreReview[];
}

export function StoreReviews({ reviews }: StoreReviewsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const title = localized('post_launch.reviews.title', labels.title[locale], locale);
  const note = localized('post_launch.reviews.note', labels.note[locale], locale);
  const empty = localized('post_launch.reviews.empty', labels.empty[locale], locale);
  const outOfRange = localized(
    'post_launch.reviews.out_of_range',
    labels.outOfRange[locale],
    locale
  );

  return (
    <section
      dir={dir}
      aria-label={title}
      data-testid="store-reviews"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--warsha-space-2)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--warsha-font-size-lg)', fontWeight: 700 }}>{title}</h2>
          <span
            data-testid="store-reviews-count"
            style={{
              paddingInline: 'var(--warsha-space-2)',
              paddingBlock: '1px',
              borderRadius: '999px',
              border: '1px solid var(--warsha-color-border)',
              color: 'var(--warsha-color-text-muted)',
              fontSize: 'var(--warsha-font-size-xs)',
              fontWeight: 600,
            }}
          >
            {countLabel(reviews.length, locale)}
          </span>
        </div>
        <p
          data-testid="store-reviews-note"
          style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--warsha-color-text-muted)' }}
        >
          {note}
        </p>
      </header>

      {reviews.length === 0 ? (
        <p
          data-testid="store-reviews-empty"
          style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)', color: 'var(--warsha-color-text-muted)' }}
        >
          {empty}
        </p>
      ) : (
        <ul
          data-testid="store-reviews-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-2)',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {reviews.map((review) => (
            <li
              key={review.id}
              data-testid={`store-review-${review.id}`}
              data-rating={review.rating}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                paddingInline: '14px',
                paddingBlock: 'var(--warsha-space-3)',
                borderRadius: '10px',
                border: '1px solid var(--warsha-color-border)',
                backgroundColor: 'var(--warsha-color-surface)',
                listStyle: 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--warsha-space-2)',
                }}
              >
                {/* Stars read left-to-right in both languages: pinned and isolated. */}
                <span
                  data-testid={`store-review-${review.id}-stars`}
                  dir="ltr"
                  role="img"
                  aria-label={ratingLabel(review.rating, locale)}
                  style={{
                    flex: '0 0 auto',
                    color: 'var(--warsha-color-warning)',
                    fontSize: '0.9375rem',
                    letterSpacing: '0.06em',
                    unicodeBidi: 'isolate',
                  }}
                >
                  {ratingStars(review.rating)}
                </span>
                <span
                  data-testid={`store-review-${review.id}-store`}
                  dir="ltr"
                  style={{
                    flex: '0 0 auto',
                    paddingInline: 'var(--warsha-space-2)',
                    paddingBlock: '2px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--warsha-color-surface-muted)',
                    color: 'var(--warsha-color-text-muted)',
                    fontFamily: 'var(--warsha-font-mono)',
                    fontSize: 'var(--warsha-font-size-xs)',
                    unicodeBidi: 'isolate',
                  }}
                >
                  {review.store}
                </span>
              </div>

              <span
                data-testid={`store-review-${review.id}-body`}
                style={{ fontSize: 'var(--warsha-font-size-sm)', color: 'var(--warsha-color-text)', lineHeight: 1.5 }}
              >
                {review.body}
              </span>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span
                  data-testid={`store-review-${review.id}-author`}
                  style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--warsha-color-text)' }}
                >
                  {review.author}
                </span>
                {ratingIsKnown(review.rating) ? null : (
                  <span
                    data-testid={`store-review-${review.id}-out-of-range`}
                    style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-error)' }}
                  >
                    {outOfRange}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
