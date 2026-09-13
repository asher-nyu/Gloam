import type { StorybookConfig } from '@storybook/sveltekit';

const config: StorybookConfig = {
  stories: ['../src/lib/components/**/*.stories.ts'],
  framework: { name: '@storybook/sveltekit', options: {} },
  core: { disableTelemetry: true },
};
export default config;
