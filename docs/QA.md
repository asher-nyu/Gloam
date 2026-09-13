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
