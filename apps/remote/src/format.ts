// @warsha/remote — machine data, formatted the way the bench reads it (docs/design/REDESIGN.md §11).
//
// The split is semantic: *who speaks* is sans, *what the machines did* is mono. Everything in this
// file produces the mono half — a cost, a clock reading, an id — and the rules that make it legible
// on a phone are the direction's, not habit:
//
//   * **Western Arabic digits (0–9) in both locales.** A phone screen is scanned in seconds and two
//     rows of costs only compare when the digits are the same shape, so Arabic formats are asked for
//     Latin numerals (`ar-u-nu-latn`) rather than the Arabic-Indic defaults. The catalog's `locale`
//     still drives the words; this is a number, not a sentence.
//   * **tabular alignment happens in CSS** (`font-variant-numeric: tabular-nums`), so these helpers
//     return plain strings and never pad or wrap.
//   * **a value that was not reported is not zero.** Callers pass `null` and render a word instead
//     (§7: `bench.not_reported`), because `$0.00` claims "free" and nothing reported claims that.

import type { Locale } from '@warsha/i18n';

/** The BCP-47 tag for one locale's *machine* readings: Arabic words, Latin digits. */
export function machineLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
}

/** `$4.20` — the accepted money shape: Western digits, two decimals, mono upstream. */
export function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** `$1.37` from the daemon's cents — the unit an event reports a cost in. */
export function moneyFromCents(cents: number): string {
  return money(cents / 100);
}

/**
 * `14:22:07` from an ISO instant, for a line an owner reads once.
 *
 * An unparseable value is returned untouched: a machine id or a raw timestamp the daemon sent is
 * evidence, and inventing a clock reading for it would be worse than showing what arrived.
 */
export function clock(iso: string, locale: Locale): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(machineLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed);
}

/**
 * `14:22:07.318` for the event stream (§11: millisecond timestamps, so a fast run still reads in order).
 *
 * The daemon's `created_at` is an ISO string; the milliseconds come out of the same parse rather
 * than a second `Date`, so the two halves can never disagree.
 */
export function clockWithMs(iso: string, locale: Locale): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const seconds = clock(iso, locale);
  const ms = `${parsed.getMilliseconds()}`.padStart(3, '0');
  return `${seconds}.${ms}`;
}

/** A percentage with one decimal at most — what a budget meter's readout says. */
export function percent(value: number, max: number): string {
  if (max <= 0) return '0%';
  const ratio = Math.min(1, Math.max(0, value / max));
  return `${Math.round(ratio * 100)}%`;
}

/**
 * A machine id, shortened for a 390px row.
 *
 * `prj_9f3a2b7c…` keeps its prefix — the prefix is what tells an owner which kind of thing it is —
 * and the full value stays in the row's `title` (§11: ledgers truncate with the whole value
 * reachable).
 */
export function shortId(value: string, keep = 8): string {
  if (value.length <= keep) return value;
  return `${value.slice(0, keep)}…`;
}
