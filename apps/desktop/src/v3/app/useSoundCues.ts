// apps/desktop/src/v3/app/useSoundCues.ts — R-UI-3 D2-e: mount point for the two optional cues.
//
// The hook is a pure observer (D2-d): it renders nothing, returns nothing, and never touches the state of the
// pages it watches. It takes the two signals that already exist — the Frame's waiting count and the runs it
// lists — and plays a cue only on a rising edge, never on first load, so a re-render or a reconnect cannot repeat
// one. It never polls, never subscribes to the daemon and never calls an RPC of its own; the gap that leaves
// (a decision that arrives while no page refreshes) is recorded in the packet report.

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type AudioContextFactory,
  type CueSignal,
  type RunStatusSnapshot,
  nextCues,
  playSoundCue,
  readSoundCuesEnabled,
  subscribeSoundCuesEnabled,
} from './soundCues';

export interface UseSoundCuesOptions {
  /** The `inboxCount` the Frame already computes from `runs.list` + `gates.list`. */
  inboxCount: number;
  /** The `runsByProject` map the Frame already holds. */
  runsByProject: Record<string, readonly RunStatusSnapshot[]>;
  /** Test seam: the real Web Audio factory by default. */
  createAudioContext?: AudioContextFactory;
}

export function useSoundCues({
  inboxCount,
  runsByProject,
  createAudioContext,
}: UseSoundCuesOptions): void {
  const [enabled, setEnabled] = useState<boolean>(() => readSoundCuesEnabled());
  const previousRef = useRef<CueSignal | null>(null);

  // The switch is per device and per tab: the Settings switch writes storage and announces itself.
  useEffect(() => subscribeSoundCuesEnabled(setEnabled), []);

  const runs = useMemo(
    () =>
      Object.values(runsByProject)
        .flat()
        .map((run) => ({ id: run.id, status: run.status })),
    [runsByProject]
  );

  useEffect(() => {
    const next: CueSignal = { inboxCount, runs };
    const previous = previousRef.current;
    // The baseline always advances, even while the switch is off: turning the cue on must not replay history.
    previousRef.current = next;

    if (!enabled) return;

    for (const cue of nextCues(previous, next)) {
      playSoundCue(cue, createAudioContext);
    }
  }, [enabled, inboxCount, runs, createAudioContext]);
}
