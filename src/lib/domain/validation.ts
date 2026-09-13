import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';

export const timezoneSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid time zone.');
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    try {
      return Temporal.PlainDate.from(value).toString() === value;
    } catch {
      return false;
    }
  }, 'Choose a valid calendar date.');
export const citySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(150),
  region: z.string().max(150),
  country: z.string().max(100),
  countryCode: z.string().length(2),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: timezoneSchema,
});
export const requestSchema = z.object({
  date: dateSchema,
  timezone: timezoneSchema,
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});
