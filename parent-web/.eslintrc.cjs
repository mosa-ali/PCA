module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['dist', 'coverage', 'playwright-report', 'test-results', '*.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: 'detect' } },
  plugins: ['react-refresh'],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-restricted-properties': [
      'error',
      {
        object: 'window',
        property: 'localStorage',
        message: 'Never store secrets in localStorage. Use src/security/secureStorage.ts abstraction.',
      },
    ],
  },
  overrides: [
    {
      files: ['tests/**/*', 'e2e/**/*', '**/*.test.ts', '**/*.test.tsx'],
      env: { node: true },
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};
