// Single ESLint config for the whole workspace. ESLint 10 looks the config up from each
// linted file upwards, so `eslint .` works from the root or from inside any package — as
// long as no package adds its own eslint.config.*. Glob patterns are relative to this file
// and always use forward slashes, on Windows too.

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(
    [
      '**/node_modules/',
      '**/dist/',
      '**/coverage/',
      '**/.vitest/',
      '**/playwright-report/',
      '**/test-results/',
      '**/*.tsbuildinfo',
      'site/',
    ],
    'rhizom/global-ignores',
  ),

  {
    name: 'rhizom/base',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    extends: [js.configs.recommended],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // Type-aware linting. projectService finds the nearest tsconfig.json for every file and
  // follows solution-style references, so each package's build, test and tooling projects
  // are all covered.
  {
    name: 'rhizom/typescript',
    files: ['**/*.{ts,mts,cts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Plain JavaScript: this file and the scripts/ folder run on Node.
  {
    name: 'rhizom/javascript',
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // packages/core is a pure library and gets no runtime globals on purpose.

  {
    name: 'rhizom/server',
    files: ['apps/server/**/*.{ts,mts,cts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    name: 'rhizom/web',
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Tooling files inside packages run on Node, not in the browser.
  {
    name: 'rhizom/package-tooling',
    files: [
      '**/vitest.config.ts',
      '**/vite.config.ts',
      '**/playwright.config.ts',
      'scripts/**/*.ts',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Must stay last so its rule "off" entries win over everything above.
  eslintConfigPrettier,
]);
