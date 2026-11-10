import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  { ignores: ['.next/**', 'generated/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Deliberate in this codebase: plain links do full navigations between areas, images are served by the app's own
      // media routes rather than next/image, and `module` is the product's word for a feature area.
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-img-element': 'off',
      '@next/next/no-assign-module-variable': 'off',
      // Reported, not blocking, until the existing cases are cleaned up.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
    },
  },
];
