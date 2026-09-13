import { render, screen, cleanup } from '@testing-library/svelte';
import EventTime from './EventTime.svelte';

afterEach(cleanup);
test('a converted time includes its next-day date context', () => {
  render(EventTime, { at: '2026-09-14T00:41:00Z', timezone: 'Europe/London', date: '2026-09-13' });
  expect(screen.getByText('1:41')).toBeInTheDocument();
  expect(screen.getByText('AM')).toBeInTheDocument();
  expect(screen.getByText('Next day')).toBeInTheDocument();
});
test('an upstream failure is not described as an astronomical absence', () => {
  render(EventTime, { at: null, status: 'unavailable', timezone: 'UTC', date: '2026-09-13' });
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Doesn’t occur')).not.toBeInTheDocument();
});
