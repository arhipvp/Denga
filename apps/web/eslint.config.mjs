import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    files: ['components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../lib/api', '../lib/dashboard-api', '../lib/dashboard-loader'],
              message: 'Dashboard UI components must use controller/data hooks instead of low-level API helpers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['hooks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../components/*'],
              message: 'Hooks should not depend on UI components.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
