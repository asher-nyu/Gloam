export default {
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  testEnvironment: '<rootDir>/tests/jsdom-environment.js',
  testEnvironmentOptions: { customExportConditions: ['browser'] },
  extensionsToTreatAsEsm: ['.ts', '.svelte'],
  transform: {
    '^.+\\.svelte(\\.(js|ts))?$': [
      '<rootDir>/tests/svelte-transformer.js',
      { preprocess: './svelte.jest.config.js' },
    ],
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          isolatedModules: true,
          esModuleInterop: true,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!\\.pnpm/|@testing-library/svelte(?:-core)?/|@lucide/svelte/)',
  ],
  moduleNameMapper: { '^\\$lib/(.*)$': '<rootDir>/src/lib/$1' },
  moduleFileExtensions: ['ts', 'js', 'svelte', 'json'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest-setup.js'],
  collectCoverageFrom: ['src/lib/domain/**/*.ts', 'src/lib/server/usno*.ts'],
};
