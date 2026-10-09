/**
 * Root lint for packages/* and the Node apps. apps/web is a Next.js app with
 * its own ESLint 9 flat config (apps/web/eslint.config.mjs) and lints itself.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  rules: {
    // `const { a: _a, ...rest } = x` is how the tests drop a field.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
  },
  ignorePatterns:['node_modules/', 'dist/', 'build/', 'coverage/', 'apps/web/'],
};
