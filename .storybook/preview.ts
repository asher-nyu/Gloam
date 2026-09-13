import type { Preview } from '@storybook/sveltekit';
import '../src/lib/styles/global.scss';

const preview: Preview = { parameters: { layout: 'padded' } };
export default preview;
