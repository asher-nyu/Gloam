import type { Meta, StoryObj } from '@storybook/sveltekit';
import UvOutlook from './UvOutlook.svelte';

const meta = {
  title: 'Evening/UV outlook',
  component: UvOutlook,
  args: {
    forecast: null,
    loading: false,
    timezone: 'America/New_York',
    date: '2026-09-13',
    onretry: () => {},
  },
} satisfies Meta<typeof UvOutlook>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unavailable: Story = {};
export const Loading: Story = { args: { loading: true } };
export const BeyondForecast: Story = {
  args: {
    forecast: {
      status: 'outside-horizon',
      points: [],
      modelRun: null,
      retrievedAt: '2026-09-13T18:00:00Z',
      sourceUrl: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/',
    },
  },
};

export const HourlyForecast: Story = {
  args: {
    forecast: {
      status: 'available',
      points: [2.1, 1.4, 0.7, 0.2, 0, 0, 0, 0].map((index, hour) => ({
        at: new Date(Date.UTC(2026, 8, 13, 20 + hour)).toISOString(),
        index,
      })),
      modelRun: '2026-09-13T12:00:00Z',
      retrievedAt: '2026-09-13T18:00:00Z',
      sourceUrl: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/',
    },
  },
};

export const PartialForecast: Story = {
  args: {
    ...HourlyForecast.args,
    timezone: 'UTC',
    forecast: {
      ...HourlyForecast.args!.forecast!,
      status: 'partial',
      points: HourlyForecast.args!.forecast!.points.map((point, index) => ({
        ...point,
        index: index === 3 ? null : point.index,
      })),
    },
  },
};
