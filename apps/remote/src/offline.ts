// @warsha/remote — handing the installed shell to the browser.
//
// An installable PWA needs three things on the built page: a manifest (served from
// `public/manifest.webmanifest`, declared in `index.html`), icons big enough for the launcher (the same
// directory's `icons/`), and a registered service worker. Only the third is this file's business: the
// worker itself is generated at build time by `scripts/generate-service-worker.mjs` from
// `workbox-config.cjs`, and what it caches — the shell and its hashed assets, and nothing of the
// daemon's — is decided there, not here.
//
// Three rules shape this module:
//
//   * **a development server has no worker to register.** `vite dev` serves `index.html` and never runs
//     the post-build step, so `dist/sw.js` does not exist and `/sw.js` is a 404. Registering anyway
//     would put a red console error on every reload of the screen being worked on, and — worse — leave
//     a stale worker from an earlier `vite preview` intercepting the dev server's responses. So
//     registration is a production-build behaviour, read from the caller rather than from
//     `import.meta.env` inside this module, which is what makes it testable in both directions.
//   * **the platform may simply not have one.** jsdom has no `navigator.serviceWorker`; an in-app
//     webview or a frozen browser may not either. Absent is the normal case this app must survive, not
//     an error: the bench works online with no worker at all.
//   * **a failure is not a message.** If the browser refuses — an insecure origin, a blocked storage, a
//     fetch that could not read `/sw.js` — the owner is not told. There is no sentence worth telling
//     them: nothing about the bench changed, and the daemon is unreachable on a plain `http://<lan-ip>`
//     origin for reasons that have nothing to do with this worker. The outcome goes back to the caller
//     and to the console, where the developer who can act on it will read it.
//
// Nothing here decides what is cached, and nothing here retries.

/** The worker's address, as `vite build` + `workbox generateSW` emit it: the site's root. */
export const SERVICE_WORKER_PATH = '/sw.js';

/** The scope the worker is asked to control — the whole origin, which is what the manifest's scope is. */
export const SERVICE_WORKER_SCOPE = '/';

/** What asking the browser for a worker can end up as. */
export type RegistrationOutcome = 'registered' | 'skipped-build' | 'skipped-platform' | 'failed';

/** The one thing this module calls on the platform; a test hands in its own. */
export interface ServiceWorkerRegistrar {
  register(scriptURL: string, options?: { scope?: string }): Promise<unknown>;
}

/** `navigator` as it actually is: the container is optional on every real engine this runs on. */
interface ServiceWorkerCapableNavigator {
  readonly serviceWorker?: ServiceWorkerRegistrar;
}

/**
 * The browser's container, or `null` where there is none.
 *
 * The `in`-style read is deliberate: `lib.dom` types `navigator.serviceWorker` as always present, so a
 * plain property read would be typed as a container even in jsdom, where it is `undefined`.
 */
export function serviceWorkerRegistrar(): ServiceWorkerRegistrar | null {
  if (typeof navigator === 'undefined') return null;
  const host = navigator as unknown as ServiceWorkerCapableNavigator;
  return host.serviceWorker ?? null;
}

/** Run `task` once the document has finished loading, so the worker does not compete with first paint. */
export function whenDocumentIdle(task: () => void): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    task();
    return;
  }
  if (document.readyState === 'complete') {
    task();
    return;
  }
  window.addEventListener('load', task, { once: true });
}

export interface ShellWorkerOptions {
  /** Only a production build emits a worker; a dev server's `/sw.js` is a 404. */
  readonly prod: boolean;
  /** The container to register on, `null` when the platform has none. */
  readonly registrar?: ServiceWorkerRegistrar | null;
  /** The scheduler for the registration; tests run theirs synchronously. */
  readonly idle?: (task: () => void) => void;
  /** Where a refusal is written. Defaults to `console.warn`. */
  readonly report?: (message: string, error: unknown) => void;
}

/** Where a refusal is written by default: the developer's console, not the owner's screen. */
function reportRefusal(message: string, error: unknown): void {
  console.warn(message, error);
}

/**
 * Take over the shell, once the page is idle.
 *
 * Resolves with what happened rather than throwing with it: the caller (`main.tsx`) has nothing to do
 * about a browser that will not install, and a rejected promise with no handler would be a console
 * error of its own.
 */
export function registerShellWorker(options: ShellWorkerOptions): Promise<RegistrationOutcome> {
  const registrar = options.registrar === undefined ? serviceWorkerRegistrar() : options.registrar;
  const idle = options.idle ?? whenDocumentIdle;
  const report = options.report ?? reportRefusal;

  if (!options.prod) return Promise.resolve('skipped-build');
  if (registrar === null) return Promise.resolve('skipped-platform');

  return new Promise<RegistrationOutcome>((resolve) => {
    idle(() => {
      registrar
        .register(SERVICE_WORKER_PATH, { scope: SERVICE_WORKER_SCOPE })
        .then(() => {
          resolve('registered');
        })
        .catch((error: unknown) => {
          // Developer-facing diagnostics, not owner-facing copy: see the third rule above.
          report('Warsha Remote: the shell service worker could not be registered.', error);
          resolve('failed');
        });
    });
  });
}
