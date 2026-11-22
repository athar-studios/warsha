// apps/desktop/src/v3/webmcp/modelContext.ts — X9a: the platform edge, and nothing else.
//
// A structural slice of the WebMCP registration API, shaped the way `soundCues.ts` shapes Web Audio: the app
// declares the two members it uses, and `unknown` plus a guard decides whether the window actually has them. No
// dependency, no `any`, and no reference to the provider-side members (`getTools`/`executeTool` and friends):
// Warsha is a provider, never an in-page agent.
//
// Runtime reach is narrow and the report says so: `document.modelContext` is expected in Chrome 149+ / Edge 150+
// and in some agent shells, and is *not* expected in a Tauri webview today (WebView2, WKWebView, WebKitGTK are
// unverified). `detectModelContext` returning null is therefore the normal case in the installed app, and it is
// the case the Settings row reports instead of hiding.

export interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, never> };
  annotations: { readOnlyHint: true };
  execute: () => Promise<{ content: { type: 'text'; text: string }[] }>;
}

export interface ModelContextLike {
  registerTool(tool: ModelContextTool, options: { signal: AbortSignal }): Promise<void>;
}

function contextOf(scope: unknown): ModelContextLike | null {
  if (typeof scope !== 'object' || scope === null) return null;

  const candidate = (scope as { modelContext?: unknown }).modelContext;
  if (typeof candidate !== 'object' || candidate === null) return null;

  const registerTool = (candidate as { registerTool?: unknown }).registerTool;
  if (typeof registerTool !== 'function') return null;

  return candidate as ModelContextLike;
}

/**
 * `document.modelContext ?? navigator.modelContext`, or null when neither carries a registerable context.
 *
 * The two scopes are parameters so a test can pass fakes, and default to the real globals so the app can call it
 * with nothing.
 */
export function detectModelContext(doc?: unknown, nav?: unknown): ModelContextLike | null {
  const documentScope = doc ?? (typeof document === 'undefined' ? undefined : document);
  const navigatorScope = nav ?? (typeof navigator === 'undefined' ? undefined : navigator);

  return contextOf(documentScope) ?? contextOf(navigatorScope);
}
