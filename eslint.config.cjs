const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettier = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
      '**/cdk.out/**',
      '**/coverage/**',
      '**/*.{js,cjs,mjs}',
      'docs/**',
      'fixtures/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.packages.json', tsconfigRootDir: __dirname },
      globals: { ...globals.node, ...globals.jest },
    },
    plugins: { '@typescript-eslint': tsPlugin, prettier },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      ...prettierConfig.rules,
      'no-console': 'warn',
      'prettier/prettier': 'error',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['packages/sitemaps-cdk/.projenrc.ts'],
    languageOptions: {
      parserOptions: { project: './packages/sitemaps-cdk/projenrc/tsconfig.json' },
    },
  },
];
