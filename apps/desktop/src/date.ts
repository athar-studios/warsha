// @warsha/desktop — safe date formatting.
//
// Every timestamp a screen renders arrives from the daemon wire, and the wire can answer
// `''`, a field under a name the decode did not recognise, or a malformed string. The raw
// pattern — `new Intl.DateTimeFormat(locale, opts).format(new Date(iso))` — throws
// `RangeError: Invalid time value` on `Invalid Date`, and an uncaught throw during render
// blacked the whole desktop window. These helpers are the one place the desktop turns a
// wire value into display text: `parseSafeDate` says whether the value is a real instant,
// and every formatter returns the fallback instead of throwing when it is not.

/** Fallback when nothing parseable was reported — a dash reads as "no date", never as a lie. */
export const DATE_FALLBACK = '—';

/**
 * The wire value as a real `Date`, or `null` when it is not one.
 *
 * Accepts what the daemon and its harnesses actually send: an RFC 3339 string, an epoch
 * number, or a `Date`. `undefined`, `null`, `''`, whitespace and unparseable strings all
 * answer `null` — which is what stops `new Date(iso)` from ever reaching a formatter as an
 * `Invalid Date`.
 */
export function parseSafeDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const fromString = new Date(trimmed);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }
  return null;
}

/** Arabic keeps Western digits (§11): the machine-facing numerals of a date row compare at a glance. */
function formatterLocale(locale: string | undefined): string | undefined {
  if (locale === undefined) return undefined;
  return locale === 'ar' ? 'ar-u-nu-latn' : locale;
}

/** `Jan 28, 2026` in English, `28 يناير، 2026` in Arabic — with Western digits either way. */
export function formatDate(
  iso: unknown,
  locale?: string,
  fallback: string = DATE_FALLBACK
): string {
  const date = parseSafeDate(iso);
  if (date === null) return fallback;
  return new Intl.DateTimeFormat(formatterLocale(locale), {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

/** A paired-at/last-seen instant: date and short time in the owner's locale. */
export function formatInstant(
  iso: unknown,
  locale?: string,
  fallback: string = DATE_FALLBACK
): string {
  const date = parseSafeDate(iso);
  if (date === null) return fallback;
  return new Intl.DateTimeFormat(formatterLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** `14:22:07` — 0–9 even in Arabic, so two lines of a feed can be compared at a glance (§11). */
export function formatTime(
  iso: unknown,
  locale?: string,
  fallback: string = DATE_FALLBACK
): string {
  const date = parseSafeDate(iso);
  if (date === null) return fallback;
  return new Intl.DateTimeFormat(formatterLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
