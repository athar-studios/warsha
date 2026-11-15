// apps/desktop/src/v3/webmcp/modelContext.test.ts — T1: the platform edge.
//
// The detector is a structural slice of `document.modelContext ?? navigator.modelContext` with no dependency
// and no `any`. These cases pin the precedence and the "an object that cannot register is not a context"
// guard, which is what keeps a partially-implemented webview from throwing on the first tool.
import { describe, expect, it } from 'vitest';

import { detectModelContext, type ModelContextLike } from './modelContext';

function registeringContext(): ModelContextLike {
  return { registerTool: () => Promise.resolve() };
}

describe('detectModelContext (T1)', () => {
  it('prefers document.modelContext over navigator.modelContext', () => {
    const fromDocument = registeringContext();
    const fromNavigator = registeringContext();

    expect(
      detectModelContext({ modelContext: fromDocument }, { modelContext: fromNavigator })
    ).toBe(fromDocument);
  });

  it('falls back to navigator.modelContext when the document has none', () => {
    const fromNavigator = registeringContext();

    expect(detectModelContext({}, { modelContext: fromNavigator })).toBe(fromNavigator);
  });

  it('returns null when neither source carries a context', () => {
    expect(detectModelContext({}, {})).toBeNull();
    expect(detectModelContext(undefined, undefined)).toBeNull();
  });

  it('returns null for an object whose registerTool is not a function', () => {
    expect(
      detectModelContext({ modelContext: {} }, { modelContext: { registerTool: 1 } })
    ).toBeNull();
    expect(detectModelContext({ modelContext: null }, { modelContext: 'nope' })).toBeNull();
  });
});
