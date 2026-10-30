// ESLint 9 flat config for the whole Warsha workspace.
//
// Every workspace package runs plain `eslint src`, so ESLint walks up from that package to this
// file: there is exactly one config for all seven members. The root package.json has no
// `"type": "module"`, so this file is loaded as CommonJS — that is why it uses `require`.
//
// It is a superset of the old `.eslintrc.cjs` (see docs/ARCHITECTURE.md, PROGRESS.md M20): every
// preset that config extended is represented here, plus the M20 rules:
//
//   * no `any` — as a type annotation or as an assertion (`as any`);
//   * no hardcoded UI strings in the two apps: apps/desktop/src and apps/remote/src;
//   * RTL-safe inline styles in those apps (no physical left/right/marginLeft/…).
//
// Import resolution uses `eslint-plugin-import`'s bundled Node resolver plus the TypeScript
// extensions. `eslint-import-resolver-typescript` is deliberately not used: it is not installed,
// and the TypeScript compiler (`pnpm -r typecheck`, which CI runs) is what actually resolves
// `@warsha/*` workspace paths.
//
// DELIBERATE, RECORDED DEFERRAL — the old `.eslintrc.cjs` also extended
// `plugin:@typescript-eslint/recommended-type-checked`. Those rules are not enabled here, because
// that config never actually ran at HEAD (ESLint 9 could not find `eslint.config.js`), and turning
// them on would turn ~280 existing app-screen lines red: `require-await` (19),
// `no-unnecessary-type-assertion` (21), `no-floating-promises` (15), `no-unsafe-argument` (15),
// `no-misused-promises` (14), `no-unsafe-assignment` (6), `no-unsafe-member-access` (5). Clearing
// them means rewriting component logic, which the M20 foundations brief forbids. The decision and
// the rule-by-rule counts are in DECISIONS.md (2026-10-31, M20) and PROGRESS.md, and the follow-up
// is a tracked PLAN.md M20 item. Every other preset the old config extended is carried over.

const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');
const importPlugin = require('eslint-plugin-import');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

const TS_FILES = ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'];
const TS_EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.mjs', '.cjs'];
const APP_SOURCES = ['apps/desktop/src/**/*.{ts,tsx}', 'apps/remote/src/**/*.{ts,tsx}'];

// The logical counterpart of each physical property the RTL rule forbids, so a failing line tells
// the author what to write instead.
const LOGICAL_PROPERTY = {
  left: 'insetInlineStart',
  right: 'insetInlineEnd',
  marginLeft: 'marginInlineStart',
  marginRight: 'marginInlineEnd',
  paddingLeft: 'paddingInlineStart',
  paddingRight: 'paddingInlineEnd',
  borderLeft: 'borderInlineStart',
  borderRight: 'borderInlineEnd',
  borderLeftWidth: 'borderInlineStartWidth',
  borderRightWidth: 'borderInlineEndWidth',
  borderTopLeftRadius: 'borderStartStartRadius',
  borderTopRightRadius: 'borderStartEndRadius',
  borderBottomLeftRadius: 'borderEndStartRadius',
  borderBottomRightRadius: 'borderEndEndRadius',
};

const physicalStyleProperties = Object.keys(LOGICAL_PROPERTY).map((property) => ({
  // Any object key named after a physical direction inside a style object. Property *reads*
  // (`node.style.left`) are not AST `Property` keys and are therefore not matched.
  selector: `Property[key.name='${property}']`,
  message: `RTL-unsafe style property \`${property}\` — use the logical property \`${LOGICAL_PROPERTY[property]}\` (AGENTS.md: RTL-safe CSS, logical properties only).`,
}));

const NO_ANY_SELECTORS = [
  {
    selector: 'TSAsExpression > TSAnyKeyword',
    message:
      'no `as any` — use the shared type instead (@warsha/client exports the branded ProjectId/RunId/DeviceId types for exactly this).',
  },
  {
    selector: 'TSTypeAssertion > TSAnyKeyword',
    message: 'no `<any>` assertion — use the shared type from @warsha/client.',
  },
];

// JSX text carrying a letter in a script this product ships in (Latin, Arabic) is a UI string.
// Pure punctuation, symbols, arrows, currency signs, emoji and whitespace are language-neutral and
// allowed: `•`, `←`, `$`, `%`, `(`, `🎉` and friends are not copy.
const TEXT_WITH_LETTERS = '/[A-Za-z\\u0600-\\u06FF]/';
const NON_TEXT_JSX = `JSXText[value=${TEXT_WITH_LETTERS}], JSXExpressionContainer > Literal[value=${TEXT_WITH_LETTERS}]`;
module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/target/**',
      'docs/book/**',
      '**/src-tauri/**',
      '**/coverage/**',
      '**/*.config.*',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,

  // ---------------------------------------------------------------- TypeScript (all packages)
  {
    files: TS_FILES,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    settings: {
      react: { version: '18' },
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.cts', '.mts'] },
      'import/extensions': TS_EXTENSIONS,
      'import/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import/resolver': { node: { extensions: TS_EXTENSIONS } },
    },
    rules: {
      // `eslint-recommended` overrides first: it turns off the base rules TypeScript supersedes
      // (`no-undef`, `no-unused-vars`, `no-redeclare`, …), which is what `plugin:@typescript-eslint/
      // recommended` + `eslint:recommended` meant together in the old config.
      ...tseslint.configs['eslint-recommended'].overrides[0].rules,
      ...tseslint.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,

      // ---- carried over verbatim from .eslintrc.cjs
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],

      // ---- additions (M20)
      'no-restricted-syntax': ['error', ...NO_ANY_SELECTORS],
    },
  },

  // ------------------------------------------------------------------------ React (TSX only)
  {
    files: ['**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },

  // ------------------------------------------- i18n + RTL rules for the two applications only
  {
    files: APP_SOURCES,
    rules: {
      'no-restricted-syntax': [
        'error',
        // `no-restricted-syntax` is replaced, not merged, when a later config sets it, so the no-any
        // selectors are repeated here.
        ...NO_ANY_SELECTORS,
        {
          selector: NON_TEXT_JSX,
          message:
            'hardcoded UI string — user-visible text goes through @warsha/i18n: `{t("key")}` with a key in the ar+en catalog, or the established `locale === "ar" ? … : …` fallback for text the catalog does not carry yet (AGENTS.md: UI strings only via i18n catalogs).',
        },
        ...physicalStyleProperties,
      ],
    },
  },

  // Test files assert on rendered Arabic/English text, and a fixture asserting a label is the one
  // place a literal belongs. This relaxes the JSX-string rule only; no-any and the RTL rules still
  // apply to tests.
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...NO_ANY_SELECTORS,
        ...physicalStyleProperties,
      ],
    },
  },

  // Must stay last: turns off every stylistic rule Prettier owns.
  prettier,
];
