import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: { baseUrl: 'http://127.0.0.1:5173', supportFile: 'cypress/support/e2e.ts' },
  viewportWidth: 1440,
  viewportHeight: 1000,
  video: false,
  screenshotOnRunFailure: true,
  trashAssetsBeforeRuns: false,
  allowCypressEnv: false,
  defaultCommandTimeout: 10000,
});
