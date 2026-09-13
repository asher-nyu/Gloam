import { Temporal } from '@js-temporal/polyfill';

export function dateInZone(instant: string | number | Date, timezone: string): string {
  return Temporal.Instant.from(new Date(instant).toISOString())
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
export function shiftDate(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
export function nextYear(date: string): string {
  return Temporal.PlainDate.from(date).add({ years: 1 }).toString();
}
export function localInstant(date: string, timezone: string, hour = 12): number {
  return Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: timezone, plainTime: { hour } })
    .epochMilliseconds;
}
export function formatTime(
  instant: string,
  timezone: string,
  hour12 = true,
): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  }).formatToParts(new Date(instant));
  return {
    time: parts
      .filter((p) => p.type !== 'dayPeriod')
      .map((p) => p.value)
      .join('')
      .trim(),
    period: parts.find((p) => p.type === 'dayPeriod')?.value ?? '',
  };
}
export function fullTimeZoneLabel(timezone: string, date: string): string {
  const instant = localInstant(date, timezone);
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'long' })
      .formatToParts(new Date(instant))
      .find((part) => part.type === 'timeZoneName')?.value ?? timezone.replaceAll('_', ' ');
  const offset = Temporal.Instant.fromEpochMilliseconds(instant)
    .toZonedDateTimeISO(timezone)
    .offset.replace('-', '−');
  return `${name} (UTC${offset})`;
}
export function dayOffsetLabel(instant: string, timezone: string, date: string): string {
  const delta = Temporal.PlainDate.from(date).until(
    Temporal.PlainDate.from(dateInZone(instant, timezone)),
  ).days;
  if (!delta) return '';
  if (delta === 1) return 'Next day';
  if (delta === -1) return 'Previous day';
  return `${delta > 0 ? '+' : ''}${delta} days`;
}
export function readableDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' },
): string {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}
