import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat ESLint config.
 *
 * `eslint-config-next` 16 ships native flat-config arrays, so they are spread
 * directly. Routing them through `@eslint/eslintrc`'s FlatCompat — the usual
 * pattern for older Next versions — throws on a circular structure, because it
 * tries to JSON-stringify a config that already contains resolved plugin
 * objects.
 */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // This codebase handles money; `any` is how a wrong type reaches an
      // amount unnoticed.
      '@typescript-eslint/no-explicit-any': 'error',
      'react/no-unescaped-entities': 'off',

      /*
        Downgraded to a warning, deliberately, and only after fixing every
        genuine instance the rule caught — a conditional hook, a ref read
        during render, `Date.now()` in render, and three synchronous form
        resets that are now `key`-based remounts.

        What remains is one pattern the rule cannot see through: an effect
        whose body is `void load()`, where `load` is async and sets state in a
        promise continuation. That is not a synchronous setState and does not
        cascade renders — but the rule only sees the call. Fetching on mount
        is also unavoidable here: these screens depend on a client-held
        session token, so a server component cannot fetch for them.

        Kept as a warning rather than disabled so a real violation still shows
        up in review instead of being silenced for good.
      */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'public/**'],
  },
]

export default config;
