import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/lib', '<rootDir>/hooks', '<rootDir>/components'],
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        sourceMaps: 'inline',
        module: {
          type: 'commonjs',
        },
        jsc: {
          target: 'es2022',
          parser: {
            syntax: 'typescript',
            tsx: true,
          },
          transform: {
            react: {
              runtime: 'automatic',
            },
          },
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@denga/shared$': '<rootDir>/../../packages/shared/src',
    '^@denga/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
};

export default config;
