# Validation record

Validated locally on September 13, 2026, including the change to city-local time only. This records exercised behavior and visual inspection; it does not certify every device or accessibility use case. Earlier Storybook and Safari Responsive Design Mode checks are identified separately below.

## Current interface

The main planner contains one chronological list with four static event rows: Sunset, Civil twilight ends, Nautical twilight ends, and Astronomical twilight ends. Every event has one displayed time and one concise explanation. Countdown UI, duration bands, repeated event endpoints, selected-phase controls, and the separate selected-phase explanation have been removed. Their unused domain helpers and surrounding solar-cycle payload were removed as well.

The date appears once in the date control. Previous/next controls support planning, and a Today button appears when viewing another date. The selected city determines the time zone for the date, clock, event times, UV readings, forecast timestamp, and footer year. Changing cities updates these automatically. The passive time-zone label displays the full name and UTC offset for the selected date, for example “Time zone · Eastern Daylight Time (UTC−04:00)”. The current clock retains seconds; its date appears only when it differs from the planning date. Today advances at the city’s midnight, while a future planning date leaves the live clock and current footer year unchanged. The browser title is always “Gloam”, set in the root layout.

The UV panel contains one semantic list of hourly readings. Each hour, value, and bar appears once, without a duplicate selected reading. Missing values stay distinct from model values of zero. The NOAA forecast timestamp remains visible in the city’s local time.

Layout uses shared card insets, matching section-heading edges, common event label/time baselines, and a single aligned time column. At enlarged text sizes event content stacks to remain readable. On phones the estimated-location label occupies its own line without an orphan separator. The footer retains a live year and the requested Asher Bloom profile link, underlined on hover and keyboard focus.

Educational wording was checked against [USNO definitions](https://aa.usno.navy.mil/faq/RST_defs) and [National Weather Service guidance](https://www.weather.gov/lmk/twilight-types). IP-location and scientific-source explanations remain in the location picker and About the data sheet.

## Automated checks

| Check                                 | Result                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| Svelte and TypeScript diagnostics     | No errors or warnings                                   |
| ESLint and Prettier                   | Passed                                                  |
| Jest                                  | 27 tests passed                                         |
| Production Node build                 | Passed                                                  |
| Storybook production build            | Previous revision passed; component stories unchanged   |
| Cypress on the production Node server | 35 tests passed in Chrome 153: 30 planner, 5 appearance |

Cypress ran against the current production Node server at `http://127.0.0.1:4173`. It checked the single presentation of all four event times and definitions during daytime, twilight, night, and future planning, and the absence of countdown, duration, selection, and duplicate-detail UI. It measured label left edges, time right edges, and actual first-line text baselines at 320, 768, and 1440 pixels, including Stockholm event times with next-day offsets.

The city-local-time checks verified a visible, passive time-zone label and the absence of a time-zone picker. Changing New York City to London updated the clock, event times, UV readings, API coordinates and time zone, and saved city after reload. Future planning crossed EDT/EST boundaries while leaving the live clock unchanged. Changing London to Los Angeles updated the local calendar and footer year across the year boundary.

The expanded label is verified with full standard/daylight names and signed UTC offsets. Thirteen additional Jest cases cover daylight-saving transition dates, UTC zero, positive and negative fractional offsets, and independence from the current browser date. The existing 320-pixel browser scenario checks Sydney’s longer name wrapping without clipping. Browser title assertions remain exactly “Gloam” through initial load, city changes, reload, date changes, source errors, and appearance changes. Server HTML checks also confirmed a single “Gloam” title on the homepage and a 404 response.

Responsive and axe checks cover 320, 375, 390, 430, 640, 641, 768, 1024, 1440, and 2560 CSS pixels. A separate 320-pixel check uses 200% root text size. Axe rules include WCAG 2 A/AA, 2.1 AA, and 2.2 AA tags.

Other browser coverage included actual one-second browser timer progression, deterministic clock ticks, current-date rollover, future planning independent of the clock, same-query city-search retry, a late IP-location response, saved city choice, source failure and recovery, partial UV availability, dialog dismissal/focus restoration, and copyright year rollover/profile URL.

Five appearance tests emulated the operating-system media preference in Chrome. They covered initial light/dark rendering, live changes without a reload, preserved city and date selections, an open search query and keyboard focus, native control appearance, adaptive brand assets and theme-color metadata, and missing/partial forecast states. Fifteen axe scans exercised both appearances, including search and About dialogs. Dark-mode layout checks covered 320 and 1440 CSS pixels, with an additional 200% text check at 320 pixels. UV bars met a measured contrast ratio of at least 3:1 against their card in both appearances. Each test cleared its browser media override afterward.

Jest covers time-zone and daylight-saving behavior, event display semantics, and USNO parsing/assembly. Cases include continuation rows, twilight after UTC midnight, a missing sunset feed, sunset before local noon, polar conditions, and a December 31 sunset followed by January 1 twilight endings. Captured response provenance is in `tests/fixtures/usno/README.md`.

Browser agency responses are explicit deterministic fixtures. The product has no mock-data mode and uses actual USNO and NOAA endpoints.

## Safari visual review

The current production build was checked in native Safari with the tab title “Gloam” and the full label “Time zone · Eastern Daylight Time (UTC−04:00)” displayed as plain text. Safari Responsive Design Mode at 320 CSS pixels confirmed that the full label wraps cleanly above Solar events, with no time-zone popup.

The preceding revision was inspected in Safari's actual Responsive Design Mode at phone, tablet, and desktop widths. That review covered the four-row hierarchy, inline education, matched time baselines, wrapping labels, the compact live clock, date controls, the former custom UTC display with Next day offsets, the static UV forecast, and the copyright footer. The large chart and countdown were absent from that reviewed production build. This broader responsive review predates removal of the manual time-zone control.

After automatic appearance support was added, the rebuilt page was rechecked in Safari Responsive Design Mode at 390 CSS pixels using the current light system preference. Dark desktop, narrow-phone, and search-dialog screenshots were visually reviewed from Chrome's emulated system preference. The macOS appearance setting was not changed; a native Safari dark-mode visual check remains unperformed.

## Live source check

The production Node server returned the four official USNO evening events and eight NOAA hourly forecast points for New York City on September 13, 2026. The selected date belongs to the city. The current interface presents event instants in that city’s local time; the UTC column below is a reference for verifying the source instants.

| Event                      | America/New_York | UTC                 |
| -------------------------- | ---------------- | ------------------- |
| Sunset                     | 7:08 PM          | September 13, 23:08 |
| Civil twilight ends        | 7:36 PM          | September 13, 23:36 |
| Nautical twilight ends     | 8:08 PM          | September 14, 00:08 |
| Astronomical twilight ends | 8:41 PM          | September 14, 00:41 |

The NOAA September 13, 12 UTC run decoded successfully. Its first displayed nearest-grid-point UV Index values were approximately 2.378, 0.923, and 0.205, followed by model zeroes. These are forecasts, not current observations or an exposure-safety threshold.

## Scope

Physical iPhones/iPads and VoiceOver have not been manually tested. Automated axe results do not replace a full accessibility audit. No controlled Lighthouse/Core Web Vitals benchmark or production load test was performed. The CI workflow is configured but has not run on a remote repository; hosting, TLS, and audience authentication are not provisioned by this local build. The optional WebMCP integration remains feature-detected and has not been tested against a browser exposing that draft API.

## USNO connection investigation: October 1, 2026

The deployed evening API returned HTTP 502 for New York City and London. Direct Node, curl, and native Safari requests to USNO also encountered dropped TLS connections. Local, Google, and Cloudflare DNS resolved the same official address. USNO’s current documentation still identifies `aa.usno.navy.mil` and the annual-table endpoint used by Gloam. Some later requests returned valid annual tables, confirming an intermittent live connection failure rather than a uniformly unavailable service.

The local patch introduces a dedicated Undici connection pool, with one connection per origin and ordinary TLS certificate verification. It retries `ECONNRESET` at most twice, after 500 milliseconds and two seconds, within a shared 18-second deadline. HTTP errors, certificate errors, and parser failures are not retried. Error response bodies are cancelled to release the connection. Requests identify Gloam using its own application ID. These changes remain local and have not been pushed or deployed.

Scientific result caching was removed from the USNO and NOAA source adapters. Browser requests and all scientific API responses use `no-store`. Repeated identical queries request upstream data again, and refreshing clears the previous results. Deterministic fixtures remain confined to automated tests. GeoNames catalog storage is separate from the scientific source adapters.

Validation completed:

- All 86 Jest tests passed, including real local HTTP-server checks for connection reuse and cancellation while waiting for the connection, reset recovery, the retry limit, body-read resets, non-retryable errors, cancellation during backoff, fresh upstream requests, source outages following successful requests, and transport-code logging.
- Svelte and TypeScript diagnostics passed without errors or warnings on the final local patch.
- ESLint and Prettier passed on the final local patch.
- The production Vercel build passed. Its artifact check verified an isolated Node.js 24 function, four routes, static assets, the NOAA decoder, and Runtime Cache / `waitUntil` integration.
- Native Safari testing exposed a development CommonJS-loading error in `@vercel/functions`. Vite now applies its existing `noExternal` setting only during builds, allowing Node to load the SDK normally during development. City search worked in Safari after this adjustment.

A live localhost request returned all four events, but subsequent cold-server requests for New York City and London returned HTTP 502. Safari testing at `http://127.0.0.1:5173` also displayed the source error after selecting New York City. The live-source issue therefore remains unresolved; successful requests and passing tests are not evidence of reliable upstream availability. Astronomy response bodies from diagnostic requests are not kept as runtime data or recovery data.

Further connection-level checks reproduced `ECONNRESET` before TLS completion on three direct attempts spaced five seconds apart. A subsequent fresh localhost request succeeded in 4.11 seconds, but a fresh Node process immediately afterward logged three failed handshakes and zero secure connections while requesting all four annual tables through the production request helper. A controlled connector check confirmed that the four concurrent calls share one TLS attempt per retry wave, with at most one simultaneous handshake.

At 23:16:17 UTC, TCP connected to `140.19.33.121:443` in 67 milliseconds. The TLS session reset 22 milliseconds later, after 1,593 outbound bytes and zero received bytes. At 23:17:29 UTC, `pnpm check:usno` reproduced a 17-millisecond TCP connection and a TLS reset before receiving any bytes. Its four fresh annual-table requests then failed after three shared connection attempts. IPv4 TLS to NOAA succeeded with certificate validation. The Navy's main website also completed verified TLS. OpenSSL 3.6.4 probes using TLS 1.2 and TLS 1.3 with X25519 both reset. No proxy, active VPN service, or installed network-filter system extension was reported on the Mac; the route used its normal Wi-Fi gateway.

Safari inspection of Vercel's runtime logs confirmed that the production request at 23:06:48 UTC made four external requests to the annual-table endpoint and returned HTTP 502 after a 75-millisecond function invocation. The existing deployed handler logged no underlying exception, so that record does not establish the production failure's precise transport code. The local handler now logs the original errors, including nested transport causes, without logging response bodies or event times.

No current USNO or Navy maintenance, migration, or connection-reset explanation was found in public official sources. The destination resolves consistently to the official hostname's DoD address. The observed boundary is a TCP connection followed by a TLS reset before HTTP. It does not establish whether a USNO front end, a perimeter device, or an intermediary on the route generates the reset. Exact attribution requires operator-side connection/firewall logs correlated with a failing attempt. A packet capture could add evidence, but macOS denied capture access and no administrator credentials were available. No security protections were disabled, no operator was contacted, and no exact provider-side cause is claimed.

Further TLS comparisons varied protocol versions, ALPN offers, and the predicted hybrid key share. Successful connections negotiated verified TLS 1.2 with both HTTP/1.1 and HTTP/2, but other connections reset under each of these configurations. An isolated comparison stopped the local development server and waited six seconds between fresh handshakes: HTTP/1.1 succeeded, then no ALPN, an HTTP/1.1 plus HTTP/2 offer, and a smaller key share each reset. No tested TLS configuration consistently prevented the failure. HTTP/2 and alternate key-share settings were therefore not added as an unverified production workaround. No operator inquiry was sent.

After restoring localhost and reloading Safari, the interface cleared the earlier events and UV results and displayed the source error. The server's new structured logs reported `ECONNRESET` in all four nested fetch failures. The final local patch passed all 86 tests, type checking, lint, the production build, and the Vercel artifact check. The connection issue remains unresolved.

One operational tradeoff of a single connection is that a slow USNO response can consume the deadline of requests waiting behind it. Cancellation keeps the total request budget bounded, but the application cannot force the upstream service to accept a TLS connection.

The user's exact annual-table URL was then compared with Gloam's query for the same coordinates. All nine Node connection attempts reset before secure negotiation, including six attempts to the exact supplied URL; curl also reset before TLS completion. Safari displayed the table, and its Web Inspector verified HTTP 200 from the network at `140.19.33.121:443`, with new TCP and TLS connection timings and verified TLS 1.2. A fresh private Safari window also displayed the table. This establishes live browser access; the data service is not uniformly down. It does not identify the issuer or policy behind the resets. Changing Node's ALPN offer and matching the successful cipher did not prevent its failures.

USNO's successful response permits credentialless cross-origin access. A direct JavaScript fetch from localhost read all four current annual tables with HTTP 200. The interface now retrieves and parses USNO tables in the browser, using `no-store`, omitted credentials, no referrer, a shared 18-second deadline, and bounded network retries. The existing parser and event calculations are shared with the server adapter; USNO HTML is never rendered. The UV endpoint receives the fresh sunset, validates its selected local date, and requests NOAA without making another USNO connection. Scientific responses and forecasts are not saved for reuse.

Live Safari verification of the implemented page covered New York today, New York tomorrow, and London. A fresh New York reload recorded four direct USNO fetches with HTTP 200 in 278–410 milliseconds; the response inspector showed `Source: Network`, a localhost origin, cross-origin fetch mode, and no-cache headers. All four event values and eight NOAA hourly values appeared in the page. Native Chrome also loaded all four live USNO events and eight NOAA hours for New York. No response tables, GRIB data, or real-data screenshots were saved from these checks.

The browser patch passed 114 Jest tests across 11 suites, including transport retries, cancellation, repeated fresh requests, source failure after a successful response, and validated sunset handoff. All 47 Cypress regressions passed in Electron 138 and Chrome 154, including direct source requests, clearing previous scientific results on failure, date/city response races, saved-city lookup, responsive layouts, and accessibility. Browser regressions use fictional generated annual tables, not saved live results. Type checking passed with zero errors or warnings; ESLint, Prettier, the production Vercel build, and the Vercel artifact check also passed on the final code. The separate Node evening API remains subject to the unresolved TLS failures; the interface and UV endpoint no longer depend on that connection. Passing deterministic tests and these successful live checks do not establish continuous provider availability.

The scope remains localhost only. A further Safari reload at approximately 00:04 UTC on October 2 recorded four direct USNO requests with HTTP 200 in 558–624 milliseconds. The inspected sunset response showed `Source: Network`, the official address, a localhost origin, and no-cache headers. Selecting October 2 initiated four additional successful USNO requests in 318–353 milliseconds and changed all four event times. Its UV request included the newly fetched sunset and returned HTTP 200 with `Source: Network` and `Cache-Control: no-store`; all eight hourly values appeared. Returning to October 1 requested and displayed fresh results again. Safari was left on the local page with Web Inspector closed. No changes have been pushed to GitHub or deployed, and no live scientific response files were saved.
