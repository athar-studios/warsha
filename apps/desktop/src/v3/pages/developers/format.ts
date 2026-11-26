/** Translator shape shared with the copy helpers (`packages/i18n` `useT`). */
type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Elapsed milliseconds in the active locale (`developers.duration.*`). The units
 * are catalog copy, never bare Latin: Arabic gets Arabic units (U-1). Seconds and
 * minutes are abbreviated so no numeral inflects the noun; milliseconds are
 * spelled out because `مللي ث` is not a standard abbreviation.
 */
export function formatMs(ms: number, t: T): string {
  if (ms < 1000) return t('developers.duration.ms', { value: ms });
  const seconds = ms / 1000;
  if (seconds < 60) return t('developers.duration.s', { value: seconds.toFixed(1) });
  return t('developers.duration.m_s', {
    minutes: Math.floor(seconds / 60),
    seconds: Math.round(seconds % 60),
  });
}
