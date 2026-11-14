// apps/desktop/src/v3/app/soundCues.ts — R-UI-3 D2: the two optional sound cues.
//
// Everything in here is pure or self-contained so it can be tested without a webview:
//   * `nextCues` decides which cue a snapshot pair deserves (no state, no audio);
//   * `readSoundCuesEnabled` / `writeSoundCuesEnabled` own the device-scoped switch;
//   * `playSoundCue` synthesises the cue through the Web Audio API and is a no-op — no throw, no log — when
//     the platform has no AudioContext (G2: WebKitGTK/WebView2/WKWebView are expected to have one, but that is
//     not measured here).
//
// The cue is never the only signal (D2-d): the Frame inbox badge and the run status chip already say the same
// thing, and nothing here adds or removes a visual.

export type SoundCue = 'decision-waiting' | 'run-finished';

/** Device-scoped, exactly like `warsha.theme` / the density key — a boolean has no place in the decaying
 *  preferences store (W11). `'on'` means on; absent means off, so a first run is silent. */
export const SOUND_CUES_STORAGE_KEY = 'warsha.sound_cues';

/** In-tab notification: `localStorage` only fires `storage` in *other* tabs. */
const SOUND_CUES_EVENT = 'warsha:sound-cues';

export interface RunStatusSnapshot {
  id: string;
  status: string;
}

/** The two inputs D2-e allows: the Frame's existing waiting count and the runs it already lists. */
export interface CueSignal {
  inboxCount: number;
  runs: readonly RunStatusSnapshot[];
}

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);

/**
 * The rising edges only: `null` (first load) never cues, a count that did not rise never cues, and a run cues
 * only on an observed non-terminal → completed transition, so a re-render or a reconnect cannot repeat it.
 */
export function nextCues(previous: CueSignal | null, next: CueSignal): SoundCue[] {
  if (!previous) return [];

  const cues: SoundCue[] = [];

  if (next.inboxCount > previous.inboxCount) {
    cues.push('decision-waiting');
  }

  const finished = next.runs.some((run) => {
    if (run.status !== 'completed') return false;
    const before = previous.runs.find((candidate) => candidate.id === run.id);
    return before !== undefined && !TERMINAL_STATUSES.has(before.status);
  });

  if (finished) {
    cues.push('run-finished');
  }

  return cues;
}

export function readSoundCuesEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SOUND_CUES_STORAGE_KEY) === 'on';
  } catch {
    // Storage blocked (private mode, disabled): the cue stays off rather than guessing.
    return false;
  }
}

export function writeSoundCuesEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    if (enabled) {
      window.localStorage.setItem(SOUND_CUES_STORAGE_KEY, 'on');
    } else {
      window.localStorage.removeItem(SOUND_CUES_STORAGE_KEY);
    }
  } catch {
    // Storage blocked: the switch still reflects the click for this session.
  }

  window.dispatchEvent(new Event(SOUND_CUES_EVENT));
}

/** Listens in this tab (the Settings switch) and across tabs (the plain `storage` event). */
export function subscribeSoundCuesEnabled(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onLocal = (): void => listener(readSoundCuesEnabled());
  const onStorage = (event: StorageEvent): void => {
    if (event.key === SOUND_CUES_STORAGE_KEY || event.key === null)
      listener(readSoundCuesEnabled());
  };

  window.addEventListener(SOUND_CUES_EVENT, onLocal);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(SOUND_CUES_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

// ---------------------------------------------------------------------------------------------
// Web Audio: a structural slice of the API, so the tests can inject a spy factory and the app can run on
// whatever the webview provides. No `any` anywhere — `unknown` plus a guard at the boundary.
// ---------------------------------------------------------------------------------------------

export interface AudioParamLike {
  value: number;
  setValueAtTime: (value: number, startTime: number) => void;
  linearRampToValueAtTime: (value: number, endTime: number) => void;
  exponentialRampToValueAtTime: (value: number, endTime: number) => void;
}

export interface OscillatorLike {
  type: string;
  frequency: AudioParamLike;
  connect: (destination: unknown) => void;
  start: (when: number) => void;
  stop: (when: number) => void;
}

export interface GainLike {
  gain: AudioParamLike;
  connect: (destination: unknown) => void;
}

export interface AudioContextLike {
  currentTime: number;
  state?: string;
  destination: unknown;
  createOscillator: () => OscillatorLike;
  createGain: () => GainLike;
  resume?: () => Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike | null;

interface AudioContextConstructor {
  new (): unknown;
}

function isAudioContextLike(value: unknown): value is AudioContextLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.createOscillator === 'function' &&
    typeof candidate.createGain === 'function' &&
    typeof candidate.currentTime === 'number'
  );
}

/**
 * The real factory. Autoplay-policy safe: the first cue may need `resume()`, but a refused resume is swallowed —
 * a cue is best-effort and the visual signal is the one that must work.
 */
export function createBrowserAudioContext(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;

  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Constructor) return null;

  try {
    const candidate: unknown = new Constructor();
    return isAudioContextLike(candidate) ? candidate : null;
  } catch {
    // A webview that throws on construction behaves like one that has none.
    return null;
  }
}

/** Peak gain stays under 0.12: a cue, not an alarm. */
export const CUE_PATTERNS: Record<
  SoundCue,
  { frequencies: readonly number[]; noteSeconds: number; peakGain: number }
> = {
  'decision-waiting': { frequencies: [523.25, 783.99], noteSeconds: 0.09, peakGain: 0.12 },
  'run-finished': { frequencies: [659.25], noteSeconds: 0.14, peakGain: 0.1 },
};

/** Plays one cue; returns whether it was audible at all (false when there is no AudioContext). */
export function playSoundCue(
  cue: SoundCue,
  factory: AudioContextFactory = createBrowserAudioContext
): boolean {
  const context = factory();
  if (!context) return false;

  try {
    if (context.state === 'suspended' && typeof context.resume === 'function') {
      void context.resume().catch(() => undefined);
    }

    const pattern = CUE_PATTERNS[cue];
    let startAt = context.currentTime + 0.01;

    for (const frequency of pattern.frequencies) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const attackAt = startAt + 0.01;
      const releaseAt = startAt + pattern.noteSeconds;

      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(pattern.peakGain, attackAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(startAt);
      oscillator.stop(releaseAt);

      // The waiting cue is a rise: the second note starts where the first ended.
      startAt = releaseAt;
    }

    return true;
  } catch {
    // A broken audio stack must not reach the page: the cue is optional.
    return false;
  }
}
