// @warsha/ui — Shared React components for Warsha apps
// Re-exports from components.tsx to allow .ts entry point.
//
// Two families, one surface:
//
//   * `./components` — the four primitives the redesign kept (`Box`, `Text`, `Button`, `Card`), which are
//     the only styling entry points a screen may reach for (docs/design/REDESIGN.md §6).
//   * `./compounds` — the Bench & Signal inventory built on top of them: a lamp, a rail, a ledger, a gate
//     card, a diff, a terminal, a composer. Every label arrives as a prop or a child, so this package never
//     reads an i18n catalog and the desktop, the remote PWA and a story all speak through it.

export * from './components';
export * from './compounds';
export * from './tokens';
