import { jest } from '@jest/globals';
import {
  dateInZone,
  shiftDate,
  nextYear,
  formatTime,
  localInstant,
  dayOffsetLabel,
  fullTimeZoneLabel,
} from './time';
import { dateSchema, timezoneSchema } from './validation';

test('today is defined in the selected city, independently of the browser', () => {
  expect(dateInZone('2026-09-14T00:30:00Z', 'America/New_York')).toBe('2026-09-13');
  expect(dateInZone('2026-09-14T00:30:00Z', 'Asia/Tokyo')).toBe('2026-09-14');
});
test('display zone conversion preserves the instant and labels midnight crossings', () => {
  const at = '2026-09-14T00:41:00Z';
  expect(formatTime(at, 'America/New_York')).toEqual({ time: '8:41', period: 'PM' });
  expect(formatTime(at, 'Europe/London')).toEqual({ time: '1:41', period: 'AM' });
  expect(dayOffsetLabel(at, 'Europe/London', '2026-09-13')).toBe('Next day');
  expect(dayOffsetLabel('2026-09-13T00:30:00Z', 'America/Los_Angeles', '2026-09-13')).toBe(
    'Previous day',
  );
});
test('calendar navigation respects leap years and DST days', () => {
  expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
  expect(nextYear('2028-02-29')).toBe('2029-02-28');
  expect(
    localInstant('2026-03-09', 'America/New_York', 0) -
      localInstant('2026-03-08', 'America/New_York', 0),
  ).toBe(23 * 3_600_000);
  expect(
    localInstant('2026-11-02', 'America/New_York', 0) -
      localInstant('2026-11-01', 'America/New_York', 0),
  ).toBe(25 * 3_600_000);
});
test('invalid calendar dates and zones are rejected rather than silently normalized', () => {
  expect(dateSchema.safeParse('2026-02-30').success).toBe(false);
  expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
});

test.each([
  ['America/New_York', '2026-07-01', 'Eastern Daylight Time (UTC−04:00)'],
  ['America/New_York', '2026-01-01', 'Eastern Standard Time (UTC−05:00)'],
  ['America/New_York', '2026-03-07', 'Eastern Standard Time (UTC−05:00)'],
  ['America/New_York', '2026-03-08', 'Eastern Daylight Time (UTC−04:00)'],
  ['America/New_York', '2026-10-31', 'Eastern Daylight Time (UTC−04:00)'],
  ['America/New_York', '2026-11-01', 'Eastern Standard Time (UTC−05:00)'],
  ['Europe/London', '2026-07-01', 'British Summer Time (UTC+01:00)'],
  ['Europe/London', '2026-01-01', 'Greenwich Mean Time (UTC+00:00)'],
  ['UTC', '2026-07-01', 'Coordinated Universal Time (UTC+00:00)'],
  ['Asia/Kolkata', '2026-07-01', 'India Standard Time (UTC+05:30)'],
  ['Asia/Kathmandu', '2026-07-01', 'Nepal Time (UTC+05:45)'],
  ['America/St_Johns', '2026-01-01', 'Newfoundland Standard Time (UTC−03:30)'],
])('names %s on %s with its date-correct signed UTC offset', (timezone, date, expected) => {
  expect(fullTimeZoneLabel(timezone, date)).toBe(expected);
});

test('the full time-zone label uses the planning date independently of the browser clock', () => {
  jest.useFakeTimers({ now: Date.UTC(2026, 11, 31, 23, 30) });
  try {
    expect(fullTimeZoneLabel('America/New_York', '2026-07-01')).toBe(
      'Eastern Daylight Time (UTC−04:00)',
    );
  } finally {
    jest.useRealTimers();
  }
});
