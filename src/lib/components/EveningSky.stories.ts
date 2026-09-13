import type { Meta, StoryObj } from '@storybook/sveltekit';
import EveningSky from './EveningSky.svelte';
import type { Evening } from '$lib/domain/types';

const evening: Evening = {
  date: '2026-09-13',
  source: 'USNO',
  sourceUrl: 'https://aa.usno.navy.mil/data/RS_OneYear',
  retrievedAt: '2026-09-13T18:00:00Z',
  events: [
    { kind: 'sunset', at: '2026-09-13T23:08:00Z', status: 'occurs' },
    { kind: 'civil', at: '2026-09-13T23:36:00Z', status: 'occurs' },
    { kind: 'nautical', at: '2026-09-14T00:08:00Z', status: 'occurs' },
    { kind: 'astronomical', at: '2026-09-14T00:41:00Z', status: 'occurs' },
  ],
};
const meta = {
  title: 'Evening/Event times',
  component: EveningSky,
  args: {
    evening,
    timezone: 'America/New_York',
  },
} satisfies Meta<typeof EveningSky>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EveningTimes: Story = {};
export const CrossMidnight: Story = { args: { timezone: 'UTC' } };
export const PolarDay: Story = {
  args: {
    evening: {
      ...evening,
      events: evening.events.map((e) => ({ ...e, at: null, status: 'above' })),
    },
  },
};
export const PartialSourceFailure: Story = {
  args: {
    evening: {
      ...evening,
      events: evening.events.map((e) =>
        e.kind === 'sunset' ? { ...e, at: null, status: 'unavailable' } : e,
      ),
    },
  },
};
