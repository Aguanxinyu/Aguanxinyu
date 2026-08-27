import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/miniprogram_npm/**', '**/node_modules/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.test.json',
          './packages/contracts/tsconfig.json',
          './packages/domain/tsconfig.json',
          './packages/backend/tsconfig.json',
          './miniprogram/tsconfig.json',
          './web/tsconfig.json'
        ],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    files: ['web/vite.config.ts', 'packages/backend/scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked
  }
);
