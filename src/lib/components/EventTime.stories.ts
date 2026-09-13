import type { Meta, StoryObj } from '@storybook/sveltekit';
import EventTime from './EventTime.svelte';

const meta = {
  title: 'Evening/Event time',
  component: EventTime,
  args: { at: '2026-09-14T00:41:00Z', timezone: 'America/New_York', date: '2026-09-13' },
} satisfies Meta<typeof EventTime>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LocalEvening: Story = {};
export const NextDayInLondon: Story = { args: { timezone: 'Europe/London' } };
export const UpstreamUnavailable: Story = { args: { at: null, status: 'unavailable' } };
export const ContinuousDaylight: Story = { args: { at: null, status: 'above' } };
export const LargeTime: Story = { args: { large: true } };
