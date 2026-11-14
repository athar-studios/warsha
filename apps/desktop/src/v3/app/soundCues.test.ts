// apps/desktop/src/v3/app/soundCues.test.ts — R-UI-3 D2/T4: the cue decisions, the switch, and the synthesis.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AudioContextFactory,
  type AudioContextLike,
  type CueSignal,
  CUE_PATTERNS,
  SOUND_CUES_STORAGE_KEY,
  createBrowserAudioContext,
  nextCues,
  playSoundCue,
  readSoundCuesEnabled,
  subscribeSoundCuesEnabled,
  writeSoundCuesEnabled,
} from './soundCues';

interface RecordedNote {
  type: string;
  frequency: number;
  start: number;
  stop: number;
  peakGain: number;
}

/**
 * A structural stand-in for `AudioContext`: it records what the cue asks the platform for, which is the only
 * thing a jsdom test can honestly assert (G2: the real webview is not measured here).
 */
function fakeAudioContext(
  notes: RecordedNote[],
  options?: { throwOnOscillator?: boolean }
): AudioContextLike {
  const param = (onRamp: (value: number) => void) => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: onRamp,
    exponentialRampToValueAtTime: () => undefined,
  });

  return {
    currentTime: 5,
    state: 'running',
    destination: {},
    createOscillator: () => {
      if (options?.throwOnOscillator) throw new Error('no audio device');
      const note: RecordedNote = { type: '', frequency: 0, start: 0, stop: 0, peakGain: 0 };
      notes.push(note);
      const frequency = {
        set value(next: number) {
          note.frequency = next;
        },
        get value(): number {
          return note.frequency;
        },
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      };
      return {
        set type(next: string) {
          note.type = next;
        },
        get type(): string {
          return note.type;
        },
        frequency,
        connect: () => undefined,
        start: (when: number) => {
          note.start = when;
        },
        stop: (when: number) => {
          note.stop = when;
        },
      };
    },
    createGain: () => ({
      gain: param((value: number) => {
        const note = notes[notes.length - 1];
        note.peakGain = Math.max(note.peakGain, value);
      }),
      connect: () => undefined,
    }),
  };
}

function spyFactory(
  notes: RecordedNote[],
  extra?: { throwOnOscillator?: boolean }
): {
  factory: AudioContextFactory;
  calls: () => number;
} {
  let calls = 0;
  return {
    factory: () => {
      calls += 1;
      return fakeAudioContext(notes, extra);
    },
    calls: () => calls,
  };
}

const NO_RUNS: CueSignal = { inboxCount: 0, runs: [] };

describe('nextCues — rising edges only (D2-e)', () => {
  it('plays nothing on first load, however loud the snapshot is', () => {
    expect(nextCues(null, { inboxCount: 4, runs: [{ id: 'run-1', status: 'completed' }] })).toEqual(
      []
    );
  });

  it('plays decision-waiting when the waiting count rises', () => {
    const previous: CueSignal = { inboxCount: 1, runs: [] };
    expect(nextCues(previous, { inboxCount: 2, runs: [] })).toEqual(['decision-waiting']);
  });

  it('plays nothing when the same count is seen twice, or when it falls', () => {
    const previous: CueSignal = { inboxCount: 2, runs: [] };
    expect(nextCues(previous, { inboxCount: 2, runs: [] })).toEqual([]);
    expect(nextCues(previous, { inboxCount: 1, runs: [] })).toEqual([]);
  });

  it('plays run-finished only on an observed non-terminal → completed transition', () => {
    const previous: CueSignal = { inboxCount: 0, runs: [{ id: 'run-1', status: 'running' }] };
    expect(
      nextCues(previous, { inboxCount: 0, runs: [{ id: 'run-1', status: 'completed' }] })
    ).toEqual(['run-finished']);

    // Already completed: a re-render, a reconnect or a second refresh must not repeat it.
    const done: CueSignal = { inboxCount: 0, runs: [{ id: 'run-1', status: 'completed' }] };
    expect(nextCues(done, { inboxCount: 0, runs: [{ id: 'run-1', status: 'completed' }] })).toEqual(
      []
    );

    // A run that is first seen already completed has no observed transition to cue on.
    expect(
      nextCues(NO_RUNS, { inboxCount: 0, runs: [{ id: 'run-2', status: 'completed' }] })
    ).toEqual([]);

    // Cancelled and failed are terminal too.
    const cancelled: CueSignal = { inboxCount: 0, runs: [{ id: 'run-3', status: 'cancelled' }] };
    expect(
      nextCues(cancelled, { inboxCount: 0, runs: [{ id: 'run-3', status: 'completed' }] })
    ).toEqual([]);
  });

  it('can report both cues in one refresh', () => {
    const previous: CueSignal = { inboxCount: 0, runs: [{ id: 'run-1', status: 'running' }] };
    expect(
      nextCues(previous, { inboxCount: 1, runs: [{ id: 'run-1', status: 'completed' }] })
    ).toEqual(['decision-waiting', 'run-finished']);
  });
});

describe('sound cue switch (D2-b/D2-c)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is OFF by default: absent storage reads as off', () => {
    expect(readSoundCuesEnabled()).toBe(false);
  });

  it('stores the device-scoped flag as "on" and removes it when switched off', () => {
    writeSoundCuesEnabled(true);
    expect(window.localStorage.getItem(SOUND_CUES_STORAGE_KEY)).toBe('on');
    expect(readSoundCuesEnabled()).toBe(true);

    writeSoundCuesEnabled(false);
    expect(window.localStorage.getItem(SOUND_CUES_STORAGE_KEY)).toBeNull();
    expect(readSoundCuesEnabled()).toBe(false);
  });

  it('notifies the listener in the same tab, and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSoundCuesEnabled(listener);

    writeSoundCuesEnabled(true);
    expect(listener).toHaveBeenCalledWith(true);

    writeSoundCuesEnabled(false);
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
    listener.mockClear();
    writeSoundCuesEnabled(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies on a storage event from another tab', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSoundCuesEnabled(listener);

    window.localStorage.setItem(SOUND_CUES_STORAGE_KEY, 'on');
    window.dispatchEvent(new StorageEvent('storage', { key: SOUND_CUES_STORAGE_KEY }));

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});

describe('playSoundCue (D2-a, G2)', () => {
  it('is a silent no-op when the platform has no AudioContext', () => {
    // jsdom has no Web Audio: this is the G2 path, and it must not throw or log.
    expect(createBrowserAudioContext()).toBeNull();
    expect(playSoundCue('decision-waiting')).toBe(false);
    expect(playSoundCue('run-finished')).toBe(false);
  });

  it('plays the waiting cue as a two-note rise of about 180ms, gain under 0.12', () => {
    const notes: RecordedNote[] = [];
    const { factory, calls } = spyFactory(notes);

    expect(playSoundCue('decision-waiting', factory)).toBe(true);
    expect(calls()).toBe(1);
    expect(notes.map((note) => note.frequency)).toEqual(
      CUE_PATTERNS['decision-waiting'].frequencies
    );
    expect(notes.map((note) => note.type)).toEqual(['sine', 'sine']);

    const start = Math.min(...notes.map((note) => note.start));
    const stop = Math.max(...notes.map((note) => note.stop));
    expect(stop - start).toBeCloseTo(0.18, 2);

    for (const note of notes) {
      expect(note.peakGain).toBeLessThanOrEqual(0.12);
      expect(note.peakGain).toBeGreaterThan(0);
    }
  });

  it('plays the finished cue as a single soft note of about 140ms', () => {
    const notes: RecordedNote[] = [];
    const { factory } = spyFactory(notes);

    expect(playSoundCue('run-finished', factory)).toBe(true);
    expect(notes).toHaveLength(1);
    expect(notes[0].frequency).toBe(CUE_PATTERNS['run-finished'].frequencies[0]);
    expect(notes[0].stop - notes[0].start).toBeCloseTo(0.14, 2);
    expect(notes[0].peakGain).toBeLessThanOrEqual(0.12);
  });

  it('returns false instead of throwing when the audio stack fails', () => {
    const notes: RecordedNote[] = [];
    const { factory } = spyFactory(notes, { throwOnOscillator: true });
    expect(playSoundCue('run-finished', factory)).toBe(false);
  });

  it('attempts nothing when the factory yields no context', () => {
    const factory = vi.fn<AudioContextFactory>(() => null);
    expect(playSoundCue('run-finished', factory)).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
