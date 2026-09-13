export interface City {
  id: number;
  name: string;
  region: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export type EventKind = 'sunset' | 'civil' | 'nautical' | 'astronomical';
export type EventStatus = 'occurs' | 'above' | 'below' | 'no-crossing' | 'unavailable';
export function eventStatusLabel(status: EventStatus): string {
  if (status === 'unavailable') return 'Unavailable';
  if (status === 'below') return 'Sun remains below';
  return 'Doesn’t occur';
}

export interface EveningEvent {
  kind: EventKind;
  at: string | null;
  status: EventStatus;
}
export interface Evening {
  date: string;
  events: EveningEvent[];
  retrievedAt: string;
  source: 'USNO';
  sourceUrl: string;
}
export interface UvPoint {
  at: string;
  index: number | null;
}
export interface UvForecast {
  status: 'available' | 'partial' | 'outside-horizon' | 'unavailable';
  points: UvPoint[];
  modelRun: string | null;
  retrievedAt: string;
  sourceUrl: string;
  gridResolution?: number;
}

// Boundary definitions: https://aa.usno.navy.mil/faq/RST_defs
// Visibility guidance: https://www.weather.gov/lmk/twilight-types
export const phases = [
  {
    kind: 'sunset',
    name: 'Sunset',
    short: 'Sunset',
    angle: 'Horizon',
    heading: 'Sunset',
    description:
      'The Sun’s upper edge drops below the horizon. Scattered sunlight keeps the sky lit.',
    color: '#e4b08d',
  },
  {
    kind: 'civil',
    name: 'Civil twilight ends',
    short: 'Civil',
    angle: '−6°',
    heading: 'Civil twilight ends',
    description:
      'The Sun’s center reaches 6° below the horizon. Artificial light is generally needed outdoors.',
    color: '#d2a2ad',
  },
  {
    kind: 'nautical',
    name: 'Nautical twilight ends',
    short: 'Nautical',
    angle: '−12°',
    heading: 'Nautical twilight ends',
    description:
      'The Sun’s center reaches 12° below the horizon. The sea horizon is no longer clearly visible.',
    color: '#aca4d7',
  },
  {
    kind: 'astronomical',
    name: 'Astronomical twilight ends',
    short: 'Astronomical',
    angle: '−18°',
    heading: 'Astronomical twilight ends',
    description:
      'The Sun’s center reaches 18° below the horizon. Astronomical night begins, though moonlight and light pollution can still brighten the sky.',
    color: '#929cca',
  },
] as const;
