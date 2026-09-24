// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      'apps/web/public/cesium/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // The root Vitest config belongs to no package tsconfig.
          allowDefaultProject: ['vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Provider interfaces are async by contract; fixture and test implementations often resolve
      // synchronously. Requiring an `await` there adds noise, not safety.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@worldview/*'],
              message:
                'LightMap has no runtime dependency on WorldView (docs/WORLDVIEW_REUSE_AUDIT.md).',
            },
            {
              regex: '^cesium(/|$)',
              message: 'Import @cesium/engine, not cesium (ADR-0002).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Provider SDKs must never be called from components (plan §12).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@worldview/*'], message: 'No WorldView runtime dependency.' },
            { regex: '^cesium(/|$)', message: 'Import @cesium/engine, not cesium (ADR-0002).' },
            {
              group: ['stripe', 'postgres', 'drizzle-orm', 'drizzle-orm/*'],
              message: 'Server-only SDKs belong in packages/*, not in the web app UI.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'apps/web/app/api/**/*.ts',
      'apps/web/lib/server/**/*.ts',
      'apps/web/auth.ts',
      'apps/web/middleware.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@worldview/*'], message: 'No WorldView runtime dependency.' },
            { regex: '^cesium(/|$)', message: 'Import @cesium/engine, not cesium (ADR-0002).' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}', 'scripts/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
