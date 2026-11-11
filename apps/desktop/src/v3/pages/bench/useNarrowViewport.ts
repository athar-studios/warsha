import { useEffect, useState } from 'react';

/**
 * Is the window at phone width (the narrow Workbench breakpoint)?
 *
 * The rail leaves the layout below 768px (DESIGN_SYSTEM_V3 planner decision 4), and CSS alone cannot
 * move a whole region into a Sheet: the *rendering* differs, not only the paint. This hook is the one
 * place the decision is made: DESIGN_SYSTEM_V3 §10's 768 is the floor, and the query is "below it".
 *
 * A test environment without `matchMedia` (jsdom in unit tests) answers "wide", which keeps every unit
 * test on the layout it was written against; the e2e browser answers honestly.
 */
const NARROW_FLOOR = 768;
const NARROW_QUERY = `(max-width: ${NARROW_FLOOR - 1}px)`;

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setNarrow(event.matches);
    setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
