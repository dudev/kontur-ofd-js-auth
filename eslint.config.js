// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Braceless if bodies are fine on one line, but once Prettier wraps them onto the next line
    // they must get braces.
    rules: {
      curly: ['error', 'multi-line'],
    },
  },
  {
    // vi.fn() mocks are safe to pass around unbound — this rule's false-positive on them is a
    // well-known typescript-eslint/vitest interaction, not a real risk in test code.
    files: ['tests/**/*.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
