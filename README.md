# Gloam

[Live Demo](https://gloam-today.vercel.app)

## Run locally

Clone the GitHub repository into the current local folder. The current folder should be empty before running this command:

```sh
git clone git@github.com:asher-nyu/Gloam.git .
```

Use Node.js 24.15.0 or a newer 24.x release with pnpm 11.19.0. Install dependencies and start the development server:

```sh
pnpm install
pnpm dev
```

Open the local address printed by Vite. Gloam estimates an initial city through ipwho.is. Use **Change city** to choose a location; your selection is saved in browser storage for subsequent visits.

## Stack and structure

- Svelte 5, SvelteKit, strict TypeScript, and Vite, with Vercel and standalone Node build targets.
- Component-scoped SCSS, shared CSS custom-property tokens, system typography, and Bits UI dialogs.
- Jest and Svelte Testing Library for calendar, data parsing, and component behavior.
- Cypress and axe for user flows, error recovery, and responsive accessibility checks.
- Storybook for shared component states; ESLint, Prettier, and a GitHub Actions workflow.

Appearance follows the operating system through CSS `prefers-color-scheme`, from the initial render through changes while the page is open. Shared light/dark tokens cover the page, dialogs, controls, focus indicators, and UV bars. Native controls inherit `color-scheme`; browser theme colors and the shared logo/favicon adapt as well.

`src/lib/domain` contains shared time/date logic and validated data contracts. `src/lib/server` contains server-only source adapters and bounded caches. `src/lib/components` contains reusable UI. `src/routes/api` exposes same-origin endpoints. City queries are resolved on the server against an automatically refreshed GeoNames catalog.

## Data and scientific behavior

**USNO:** all four event times are retrieved directly from the [annual table service](https://aa.usno.navy.mil/data/RS_OneYear). Tasks 0, 2, 3, and 4 supply sunset, civil, nautical, and astronomical events. Tables are requested in Universal Time; the parser preserves fixed-width cells, continuation rows, blank fields, and continuous-above/below markers. Successful annual-table responses are cached for 24 hours with request coalescing.

The selected date belongs to the city. A sunset before noon is valid. Later twilight events are associated with that sunset, including events after local midnight. The city’s IANA time zone converts event instants with date-correct daylight saving. Choosing another city automatically updates the local date, clock, event times, UV hour labels, forecast timestamp, and copyright year. The time-zone label shows the full name and UTC offset for the planning date, such as “Time zone · Eastern Daylight Time (UTC−04:00)”. Today advances at the selected city’s midnight. The live clock continues to show the city’s current time, including seconds, while browsing future evenings. Its current date appears when it differs from the planning date.

**NOAA:** the server downloads hourly GRIB2 files from [NOAA’s UV forecast archive](https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/) and reads the surface erythemal irradiance field (discipline 0, category 7, parameter 196). UV Index = irradiance in W/m² × 40. The field’s run and valid-time metadata are checked, and the nearest grid point supplies the city estimate. The app prefers the newest complete run; an earlier complete run can be used when the latest run is still being published. Each chart uses a single run and displays its model run time. Missing hours retain null values and appear as unavailable. Available run files determine the forecast window.

**Solar events** presents four boundaries: Sunset, Civil twilight ends, Nautical twilight ends, and Astronomical twilight ends. Each time has a concise explanation of its meaning. Event labels and time values share a first-line baseline; text reflows for narrow screens and enlarged fonts. The copyright year follows the current date in the selected city, independently of the planning date.

The UV chart starts roughly three hours before sunset and shows eight hourly forecast values. Twilight angles describe the Sun’s position relative to the horizon; they do not establish a medically safe or UV-free time outdoors.

**Location:** ipwho.is estimates the initial location from the visitor’s IP address. Gloam uses the returned location fields to initialize the planner. VPN and mobile-network estimates can be inaccurate. City search uses the [GeoNames cities15000 catalog](https://download.geonames.org/export/dump/), which primarily covers places with population above 15,000 and administrative capitals. Smaller locations can use a nearby city.

The server refreshes the city catalog automatically when a search or saved-city lookup occurs and its cached data is more than 24 hours old. Searches continue using the last valid catalog during a refresh. Downloads are validated before replacing it; failed refreshes retain the working data and retry after a delay. Saved city selections are checked when the planner opens so corrected names, coordinates, and time zones can take effect without a new deployment.

On Vercel, validated catalogs are stored in [Runtime Cache](https://vercel.com/docs/caching/runtime-cache), shared across the project’s function instances within a region and preserved across deployments. Instances check that shared cache before downloading an update. Background refreshes use `waitUntil` to continue after a search response is sent. Cache entries can be evicted; the app retains a bundled catalog to keep city search available during recovery.

Standalone Node deployments save validated catalogs in `.cache/geonames-cities-v1.json` for reuse after a server restart. Keep `.cache` on writable, persistent storage to retain runtime updates across restarts; the server can continue with an in-memory cache when storage is unavailable. Attribution and the bundled catalog’s retrieval date are recorded in `src/lib/server/data/NOTICE.md`. `pnpm data:cities` refreshes that fallback for a future build.

## Quality checks

```sh
pnpm check
pnpm lint
pnpm test
node --test scripts/*.test.mjs
pnpm build
pnpm check:vercel
pnpm build:storybook
pnpm build:node
node scripts/e2e.mjs
```

`pnpm check:vercel` verifies the generated Vercel routes, isolated server functions, and packaged NOAA decoder. `pnpm build:node` prepares the standalone server for `node scripts/e2e.mjs`, which starts it on an available local port, runs Cypress, and shuts down its server and browser processes. Set `E2E_PORT` to use a specific port.

With `pnpm dev` running, use `pnpm test:e2e --browser chrome` or `pnpm test:e2e:open`. E2E tests use deterministic source-response fixtures. USNO parser regressions use captured official responses with provenance in `tests/fixtures/usno/README.md`.

Run `pnpm storybook` to inspect event times, cross-midnight labels, polar states, source failures, and the UV loading/unavailable states.

See [the validation record](docs/QA.md) for the executed checks, Safari Responsive Design Mode coverage, live-source verification, and remaining release work.

## Production deployment

### Vercel

`pnpm build` uses the SvelteKit Vercel adapter and generates `.vercel/output`. The repository’s `vercel.json` selects the SvelteKit framework preset and pins the install and build commands to pnpm 11.19.0. `package.json` selects the Node.js 24 runtime.

To deploy from GitHub:

1. Push the project to `asher-nyu/Gloam`.
2. Create a [new Vercel project](https://vercel.com/new) and import that repository, using the repository root as the project’s root directory.
3. Keep the Output Directory at its framework default and select **Deploy**. Vercel reads the build configuration from the repository.

After import, pushes to the configured production branch create production deployments; other branches receive preview deployments. See [Vercel’s Git deployment documentation](https://vercel.com/docs/git).

### Standalone Node

```sh
pnpm build:node
HOST=127.0.0.1 PORT=3000 ORIGIN=https://gloam.example.com pnpm start
```

This target writes the Node server to `build`. Set `ORIGIN` to the actual trusted origin and configure the reverse proxy, TLS, and audience access controls for the chosen environment. The example binds to loopback. Cache limits and outbound NOAA concurrency are bounded for a single process; a larger deployment should share agency caches across instances and apply rate limits at the gateway.
