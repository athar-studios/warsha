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

interface DurationUnits {
  d: string;
  h: string;
  m: string;
  s: string;
}

const DURATION_UNITS_EN: DurationUnits = {
  d: 'd',
  h: 'h',
  m: 'm',
  s: 's',
};

const DURATION_UNITS_AR: DurationUnits = {
  d: 'ي',
  h: 'س',
  m: 'د',
  s: 'ث',
};

/** Coerce a seconds value (number or numeric string) into a whole non-negative number, or null. */
function coerceSeconds(seconds: unknown): number | null {
  let sec: number;
  if (typeof seconds === 'number') {
    sec = seconds;
  } else if (typeof seconds === 'string') {
    const trimmed = seconds.trim();
    if (trimmed.length === 0) return null;
    sec = Number(trimmed);
  } else {
    return null;
  }
  if (!Number.isFinite(sec) || sec < 0) return null;
  return Math.floor(sec);
}

function unitsForLocale(locale: string): DurationUnits {
  return locale === 'ar' ? DURATION_UNITS_AR : DURATION_UNITS_EN;
}

function renderDuration(total: number, u: DurationUnits): string {
  if (total < 60) {
    return `${total}${u.s}`;
  }
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h < 1) {
    return `${m}${u.m} ${s}${u.s}`;
  }
  if (h < 24) {
    return `${h}${u.h} ${m}${u.m} ${s}${u.s}`;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return `${d}${u.d} ${remH}${u.h} ${m}${u.m}`;
}

/**
 * Format uptime seconds into human-readable duration (`45s`, `2m 5s`, `3h 12m 4s`, `2d 4h 10m`).
 *
 * Falls back to `—` for null, undefined, negative numbers, or non-finite inputs.
 */
export function formatUptime(seconds: unknown, fallback: string = DATE_FALLBACK): string {
  const total = coerceSeconds(seconds);
  if (total === null) return fallback;
  return renderDuration(total, DURATION_UNITS_EN);
}

/**
 * Format uptime seconds with the duration units of `locale` (`45ث`, `2د 5ث`, `3س 12د 4ث`, `2ي 4س 10د` for `ar`).
 *
 * Falls back to `—` for null, undefined, negative numbers, or non-finite inputs.
 */
export function formatUptimeLocalized(
  seconds: unknown,
  locale: string,
  fallback: string = DATE_FALLBACK
): string {
  const total = coerceSeconds(seconds);
  if (total === null) return fallback;
  return renderDuration(total, unitsForLocale(locale));
}

/**
 * Format relative duration from an ISO timestamp to now (`45s`, `2m 5s`, `3h 12m 4s`, `2d 4h 10m`).
 *
 * Uses `formatUptime` to produce compact, scannable durations.
 * Falls back to `—` for null, undefined, unparseable, or invalid inputs.
 */
export function formatRelativeDuration(
  iso: unknown,
  nowMs: number = Date.now(),
  fallback: string = DATE_FALLBACK
): string {
  const date = parseSafeDate(iso);
  if (date === null) return fallback;
  const elapsedSec = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  return formatUptime(elapsedSec, fallback);
}

/**
 * Format relative duration from an ISO timestamp to now using the duration units of `locale`.
 *
 * Uses `formatUptimeLocalized` to produce compact, scannable durations (`45ث`, `2د 5ث` for `ar`).
 * Falls back to `—` for null, undefined, unparseable, or invalid inputs.
 */
export function formatRelativeDurationLocalized(
  iso: unknown,
  locale: string,
  nowMs: number = Date.now(),
  fallback: string = DATE_FALLBACK
): string {
  const date = parseSafeDate(iso);
  if (date === null) return fallback;
  const elapsedSec = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  return formatUptimeLocalized(elapsedSec, locale, fallback);
}
