import type { EventStatus } from '../domain/types';

export interface TableDay {
  date: string;
  rising: string[];
  setting: string[];
  status: EventStatus;
}

/** USNO continuation rows are significant. Never trim or split fixed-width table cells. */
export function parseUsnoTable(html: string, year: number): TableDay[] {
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1];
  if (!pre || !pre.includes('Universal Time'))
    throw new Error('USNO returned an unexpected table.');
  const days = new Map<string, TableDay>();
  let rows = 0;
  for (const line of pre.split(/\r?\n/)) {
    if (!/^\d\d {2}/.test(line)) continue;
    rows++;
    const day = Number(line.slice(0, 2));
    for (let month = 0; month < 12; month++) {
      const check = new Date(Date.UTC(year, month, day));
      if (check.getUTCMonth() !== month) continue;
      const date = check.toISOString().slice(0, 10);
      const record = days.get(date) ?? {
        date,
        rising: [],
        setting: [],
        status: 'no-crossing' as EventStatus,
      };
      for (const [offset, direction] of [
        [4, 'rising'],
        [9, 'setting'],
      ] as const) {
        const field = line.slice(offset + 11 * month, offset + 11 * month + 4);
        if (/^\d{4}$/.test(field)) {
          const hour = Number(field.slice(0, 2));
          const minute = Number(field.slice(2));
          if (hour > 23 || minute > 59) throw new Error('Invalid USNO event time.');
          const at = `${date}T${field.slice(0, 2)}:${field.slice(2)}:00.000Z`;
          if (!record[direction].includes(at)) record[direction].push(at);
        } else if (field === '****' || field === '////') record.status = 'above';
        else if (field === '----' || field === '====') record.status = 'below';
        else if (field.trim()) throw new Error('Unrecognized USNO event marker.');
      }
      days.set(date, record);
    }
  }
  if (rows < 31 || days.size < 365) throw new Error('The USNO annual table is incomplete.');
  return [...days.values()];
}
