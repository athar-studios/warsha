// apps/desktop/src/v3/app/useSoundCues.test.ts — R-UI-3 T4/D2-d: the hook is a pure observer of two signals.
import { act, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type AudioContextFactory,
  type AudioContextLike,
  SOUND_CUES_STORAGE_KEY,
  writeSoundCuesEnabled,
} from './soundCues';
import { type UseSoundCuesOptions, useSoundCues } from './useSoundCues';

/** Counts the oscillators a cue asks for: two for the waiting rise, one for the finished note. */
function recordingFactory(): { factory: AudioContextFactory; notes: () => number } {
  let notes = 0;
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  });
  const factory: AudioContextFactory = (): AudioContextLike => ({
    currentTime: 0,
    state: 'running',
    destination: {},
    createOscillator: () => {
      notes += 1;
      return {
        type: 'sine',
        frequency: param(),
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      };
    },
    createGain: () => ({ gain: param(), connect: () => undefined }),
  });

  return { factory, notes: () => notes };
}

const NO_RUNS: Record<string, readonly { id: string; status: string }[]> = {};

function Probe(props: UseSoundCuesOptions): null {
  useSoundCues(props);
  return null;
}

/** `.ts`, not `.tsx` (the packet names this file), so the probe is built with createElement. */
function probe(props: UseSoundCuesOptions): React.ReactElement {
  return React.createElement(Probe, props);
}

describe('useSoundCues (R-UI-3 D2-d/D2-e, T4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing and mutates none of the signals it observes', () => {
    const { factory } = recordingFactory();
    const runsByProject = { 'proj-1': [{ id: 'run-1', status: 'running' }] };

    const { container, rerender } = render(
      probe({ inboxCount: 0, runsByProject, createAudioContext: factory })
    );

    expect(container.innerHTML).toBe('');
    rerender(probe({ inboxCount: 1, runsByProject, createAudioContext: factory }));

    expect(container.innerHTML).toBe('');
    expect(runsByProject).toEqual({ 'proj-1': [{ id: 'run-1', status: 'running' }] });
  });

  it('constructs no AudioContext and plays nothing with the default (off) storage', () => {
    let constructed = 0;
    const factory: AudioContextFactory = () => {
      constructed += 1;
      return null;
    };

    const { rerender } = render(
      probe({ inboxCount: 0, runsByProject: NO_RUNS, createAudioContext: factory })
    );
    rerender(probe({ inboxCount: 3, runsByProject: NO_RUNS, createAudioContext: factory }));
    rerender(
      probe({
        inboxCount: 3,
        runsByProject: { 'proj-1': [{ id: 'run-1', status: 'running' }] },
        createAudioContext: factory,
      })
    );
    rerender(
      probe({
        inboxCount: 3,
        runsByProject: { 'proj-1': [{ id: 'run-1', status: 'completed' }] },
        createAudioContext: factory,
      })
    );

    expect(constructed).toBe(0);
  });

  it('plays nothing on first load, even when the first snapshot already has waiting decisions and finished runs', () => {
    window.localStorage.setItem(SOUND_CUES_STORAGE_KEY, 'on');
    const { factory, notes } = recordingFactory();

    render(
      probe({
        inboxCount: 2,
        runsByProject: { 'proj-1': [{ id: 'run-1', status: 'completed' }] },
        createAudioContext: factory,
      })
    );

    expect(notes()).toBe(0);
  });

  it('plays decision-waiting once when the waiting count rises, and not again for the same count', () => {
    window.localStorage.setItem(SOUND_CUES_STORAGE_KEY, 'on');
    const { factory, notes } = recordingFactory();

    const { rerender } = render(
      probe({ inboxCount: 1, runsByProject: NO_RUNS, createAudioContext: factory })
    );
    expect(notes()).toBe(0);

    rerender(probe({ inboxCount: 2, runsByProject: NO_RUNS, createAudioContext: factory }));
    expect(notes()).toBe(2); // the two-note rise

    // A new runs map with the same count is not a new edge.
    rerender(
      probe({
        inboxCount: 2,
        runsByProject: { 'proj-1': [{ id: 'run-9', status: 'running' }] },
        createAudioContext: factory,
      })
    );
    expect(notes()).toBe(2);
  });

  it('plays run-finished once on a non-terminal → completed transition', () => {
    window.localStorage.setItem(SOUND_CUES_STORAGE_KEY, 'on');
    const { factory, notes } = recordingFactory();

    const { rerender } = render(
      probe({
        inboxCount: 0,
        runsByProject: { 'proj-1': [{ id: 'run-1', status: 'running' }] },
        createAudioContext: factory,
      })
    );
    expect(notes()).toBe(0);

    rerender(
      probe({
        inboxCount: 0,
        runsByProject: { 'proj-1': [{ id: 'run-1', status: 'completed' }] },
        createAudioContext: factory,
      })
    );
    expect(notes()).toBe(1);

    // The same completed run seen again does not repeat the cue.
    rerender(
      probe({
        inboxCount: 0,
        runsByProject: { 'proj-1': [{ id: 'run-1', status: 'completed' }] },
        createAudioContext: factory,
      })
    );
    expect(notes()).toBe(1);
  });

  it('starts playing only after the Settings switch turns the cue on', () => {
    const { factory, notes } = recordingFactory();

    const { rerender } = render(
      probe({ inboxCount: 0, runsByProject: NO_RUNS, createAudioContext: factory })
    );
    rerender(probe({ inboxCount: 1, runsByProject: NO_RUNS, createAudioContext: factory }));
    expect(notes()).toBe(0);

    act(() => writeSoundCuesEnabled(true));
    rerender(probe({ inboxCount: 2, runsByProject: NO_RUNS, createAudioContext: factory }));
    expect(notes()).toBe(2);
  });
});
