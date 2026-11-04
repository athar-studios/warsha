// @warsha/remote — asking for the shell worker.
//
// What this file pins is the shape of a "no": a dev build, a browser without service workers, and a
// browser that refuses the registration are three different answers, and none of them is an exception
// reaching `main.tsx`. The other half is the promise the module makes about *when* — after the load
// event, so a worker install never competes with the first paint the owner is waiting for.
import { describe, expect, it, vi } from 'vitest';

import {
  registerShellWorker,
  SERVICE_WORKER_PATH,
  SERVICE_WORKER_SCOPE,
  serviceWorkerRegistrar,
  whenDocumentIdle,
  type ServiceWorkerRegistrar,
} from './offline';

interface RegisterCall {
  readonly scriptURL: string;
  readonly scope: string | undefined;
}

/** A container that records what it was asked for, and answers the way the browser would. */
function fakeRegistrar(refuse: boolean): { registrar: ServiceWorkerRegistrar; calls: RegisterCall[] } {
  const calls: RegisterCall[] = [];
  return {
    calls,
    registrar: {
      register: (scriptURL: string, options?: { scope?: string }): Promise<unknown> => {
        calls.push({ scriptURL, scope: options?.scope });
        return refuse ? Promise.reject(new Error('The origin is not secure.')) : Promise.resolve({});
      },
    },
  };
}

/** Run `body` with the document claiming to be in `state`, then put the prototype's own getter back. */
function withReadyState(state: DocumentReadyState, body: () => void): void {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });
  try {
    body();
  } finally {
    Reflect.deleteProperty(document, 'readyState');
  }
}

describe('serviceWorkerRegistrar', () => {
  it('finds no container under jsdom, which is the case the app must survive', () => {
    // jsdom implements no service workers at all. Reading the property anyway is what the module
    // refuses to do, because `lib.dom` types it as always present.
    expect(serviceWorkerRegistrar()).toBeNull();
  });
});

describe('registerShellWorker', () => {
  it('does not register on a dev build, whatever the browser offers', async () => {
    const { registrar, calls } = fakeRegistrar(false);

    const outcome = await registerShellWorker({
      prod: false,
      registrar,
      idle: (task: () => void) => task(),
    });

    expect(outcome).toBe('skipped-build');
    expect(calls).toHaveLength(0);
  });

  it('does not register where the platform has no container', async () => {
    const outcome = await registerShellWorker({
      prod: true,
      registrar: null,
      idle: (task: () => void) => task(),
    });

    expect(outcome).toBe('skipped-platform');
  });

  it('asks for the built worker at the root scope', async () => {
    const { registrar, calls } = fakeRegistrar(false);

    const outcome = await registerShellWorker({
      prod: true,
      registrar,
      idle: (task: () => void) => task(),
    });

    expect(outcome).toBe('registered');
    expect(calls).toEqual([{ scriptURL: SERVICE_WORKER_PATH, scope: SERVICE_WORKER_SCOPE }]);
  });

  it('waits for the document to be idle before it asks', async () => {
    const { registrar, calls } = fakeRegistrar(false);
    let release: () => void = () => undefined;
    const idle = (task: () => void): void => {
      release = task;
    };

    const pending = registerShellWorker({ prod: true, registrar, idle });

    expect(calls).toHaveLength(0);
    release();

    expect(await pending).toBe('registered');
    expect(calls).toHaveLength(1);
  });

  it('reports a refusal as an outcome, never as a rejection', async () => {
    const { registrar, calls } = fakeRegistrar(true);
    const report = vi.fn();

    const outcome = await registerShellWorker({
      prod: true,
      registrar,
      idle: (task: () => void) => task(),
      report,
    });

    expect(outcome).toBe('failed');
    expect(calls).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('whenDocumentIdle', () => {
  it('runs at once when the document has already loaded', () => {
    const task = vi.fn();

    withReadyState('complete', () => whenDocumentIdle(task));

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('waits for the load event when the document is still parsing', () => {
    const task = vi.fn();

    withReadyState('loading', () => {
      whenDocumentIdle(task);
      expect(task).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('load'));
    });

    expect(task).toHaveBeenCalledTimes(1);
  });
});
