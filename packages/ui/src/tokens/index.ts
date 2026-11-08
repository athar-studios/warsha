// @warsha/ui — token barrel.
//
// Import tokens through `@warsha/ui` (or `@warsha/ui/tokens`) rather than reaching into a single
// token module, so a rename only ever touches this file.
//
// What is intentionally *not* here: physical directions (`left`, `right`, `marginLeft`, …) and any
// colour or length literal. The type scale carries exactly one letter-spacing token (`code`, mono
// pairing codes only — DS v2 §2.3), because Arabic is a connected script; alignment belongs to
// `textAlign: 'start'` at the call site, never to a token.

export * from './aliases';
export * from './breakpoints';
export * from './colors';
export * from './elevation';
export * from './lines';
export * from './motion';
export * from './radius';
export * from './shadow';
export * from './sizes';
export * from './spacing';
export * from './typography';
export { cssVar, kebabCase, TOKEN_PREFIX } from './vars';
