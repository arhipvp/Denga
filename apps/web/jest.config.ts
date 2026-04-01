import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/lib'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@denga/shared$': '<rootDir>/../../packages/shared/src',
    '^@denga/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
};

export default config;
