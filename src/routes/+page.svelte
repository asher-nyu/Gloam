<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { registerPlannerTools } from '$lib/agent-tools';
  import { Dialog } from 'bits-ui';
  import {
    Sunset,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    Clock3,
    Info,
    X,
    ArrowUpRight,
    RefreshCw,
  } from '@lucide/svelte';
  import CityPicker from '$lib/components/CityPicker.svelte';
  import CityClock from '$lib/components/CityClock.svelte';
  import EveningSky from '$lib/components/EveningSky.svelte';
  import EveningLoading from '$lib/components/EveningLoading.svelte';
  import UvOutlook from '$lib/components/UvOutlook.svelte';
  import {
    dateInZone,
    shiftDate,
    nextYear,
    readableDate,
    fullTimeZoneLabel,
  } from '$lib/domain/time';
  import { citySchema } from '$lib/domain/validation';
  import type { City, Evening, UvForecast } from '$lib/domain/types';

  let city = $state<City | null>(null);
  let approximate = $state(false);
  let aboutOpen = $state(false);
  let detecting = $state(true);
  let locationMessage = $state('');
  let date = $state('');
  let evening = $state<Evening | null>(null);
  let loading = $state(false);
  let error = $state('');
  let now = $state(Date.now());
  let uv = $state<UvForecast | null>(null);
  let uvLoading = $state(false);
  let detectionId = 0;
  let detectionAbort: AbortController | null = null;
  let savedCityAbort: AbortController | null = null;
  let followingToday = true;
  let requestId = 0;
  let abort: AbortController | null = null;
  const today = $derived(dateInZone(now, city?.timezone ?? 'UTC'));
  const timezone = $derived(city?.timezone ?? 'UTC');
  const isToday = $derived(date === today);
  const copyrightYear = $derived(dateInZone(now, timezone).slice(0, 4));

  async function refresh() {
    if (!city || !date) return;
    const id = ++requestId;
    abort?.abort();
    abort = new AbortController();
    loading = true;
    error = '';
    evening = null;
    uv = null;
    void refreshUv(id, abort.signal);
    const query = new URLSearchParams({
      latitude: String(city.latitude),
      longitude: String(city.longitude),
      timezone: city.timezone,
      date,
    });
    try {
      const response = await fetch(`/api/evening?${query}`, { signal: abort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (id === requestId) evening = body;
    } catch {
      if (id === requestId && !abort.signal.aborted)
        error = 'We couldn’t load evening times. Please try again.';
    } finally {
      if (id === requestId) loading = false;
    }
  }
  async function refreshUv(id = requestId, signal = abort?.signal) {
    if (!city || !date) return;
    uvLoading = true;
    const query = new URLSearchParams({
      latitude: String(city.latitude),
      longitude: String(city.longitude),
      timezone: city.timezone,
      date,
    });
    try {
      const response = await fetch(`/api/uv?${query}`, { signal });
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (id === requestId) uv = value;
    } catch {
      if (id === requestId && !signal?.aborted) uv = null;
    } finally {
      if (id === requestId) uvLoading = false;
    }
  }
  function chooseCity(value: City, estimate = false) {
    savedCityAbort?.abort();
    if (!estimate) {
      detectionId++;
      detectionAbort?.abort();
      detecting = false;
    }
    followingToday = true;
    city = value;
    approximate = estimate;
    date = dateInZone(Date.now(), value.timezone);
    locationMessage = '';
    if (!estimate) {
      try {
        localStorage.setItem('gloam.city.v1', JSON.stringify(value));
      } catch {
        /* Device storage is optional. */
      }
    }
    void refresh();
  }
  async function revalidateSavedCity(saved: City) {
    if (saved.id <= 0) return;
    const id = detectionId;
    savedCityAbort = new AbortController();
    const signal = savedCityAbort.signal;
    try {
      const response = await fetch(`/api/cities?id=${saved.id}`, { signal });
      if (!response.ok) return;
      const body = await response.json();
      const updated = citySchema.safeParse(body.city);
      if (
        signal.aborted ||
        id !== detectionId ||
        !updated.success ||
        updated.data.id !== saved.id ||
        city?.id !== saved.id
      )
        return;
      const value = updated.data;
      const currentDate = followingToday ? dateInZone(Date.now(), value.timezone) : date;
      const eventsChanged =
        city.latitude !== value.latitude ||
        city.longitude !== value.longitude ||
        city.timezone !== value.timezone ||
        date !== currentDate;
      city = value;
      date = currentDate;
      try {
        localStorage.setItem('gloam.city.v1', JSON.stringify(value));
      } catch {
        /* Device storage is optional. */
      }
      if (eventsChanged) void refresh();
    } catch {
      /* Keep the saved city available when the catalog cannot be reached. */
    }
  }
  async function detectCity() {
    savedCityAbort?.abort();
    detecting = true;
    locationMessage = '';
    const id = ++detectionId;
    detectionAbort?.abort();
    detectionAbort = new AbortController();
    const signal = AbortSignal.any([detectionAbort.signal, AbortSignal.timeout(7000)]);
    try {
      const response = await fetch(
        'https://ipwho.is/?fields=success,city,region,country,country_code,latitude,longitude,timezone',
        { signal, referrerPolicy: 'no-referrer' },
      );
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!data.success) throw new Error();
      const parsed = citySchema.parse({
        id: 0,
        name: data.city,
        region: data.region,
        country: data.country,
        countryCode: data.country_code,
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone.id,
      });
      if (id === detectionId) {
        try {
          localStorage.removeItem('gloam.city.v1');
        } catch {
          /* Storage is optional. */
        }
        chooseCity(parsed, true);
      }
    } catch {
      if (id === detectionId)
        locationMessage = 'We couldn’t find your location. Choose a city to continue.';
    } finally {
      if (id === detectionId) detecting = false;
    }
  }
  async function chooseDate(value: string) {
    if (!value || value < today || value > nextYear(today)) return;
    followingToday = value === today;
    date = value;
    await refresh();
  }
  onMount(() => {
    const disposeTools = registerPlannerTools({
      read: () => ({ city, date, timezone, evening, uv, loading, error }),
      selectDate: async (value) => {
        if (!city || value < today || value > nextYear(today))
          throw new Error('Choose a city and a date within the planning range.');
        await chooseDate(value);
        if (error || !evening) throw new Error(error || 'Evening times are unavailable.');
        return { city: city.name, date, timezone, evening };
      },
    });
    try {
      const saved = citySchema.safeParse(
        JSON.parse(localStorage.getItem('gloam.city.v1') ?? 'null'),
      );
      if (saved.success) {
        chooseCity(saved.data);
        detecting = false;
        void revalidateSavedCity(saved.data);
      } else void detectCity();
    } catch {
      void detectCity();
    }
    function updateClock() {
      now = Date.now();
      if (city && followingToday) {
        const currentDay = dateInZone(now, city.timezone);
        if (date !== currentDay) {
          date = currentDay;
          void refresh();
        }
      }
    }
    const timer = setInterval(updateClock, 1000);
    document.addEventListener('visibilitychange', updateClock);
    window.addEventListener('pageshow', updateClock);
    return () => {
      disposeTools();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', updateClock);
      window.removeEventListener('pageshow', updateClock);
      abort?.abort();
      detectionAbort?.abort();
      savedCityAbort?.abort();
    };
  });
</script>

<svelte:head>
  <meta
    name="description"
    content="Sunset, twilight times, and hourly UV forecasts for your city."
  />
</svelte:head>

<div class="page-shell">
  <header class="header">
    <a class="brand" href={resolve('/')} aria-label="Gloam home"
      ><img src="/favicon.svg?v=3" alt="" width="32" height="32" /><span>Gloam</span></a
    >
    <Dialog.Root bind:open={aboutOpen}>
      <Dialog.Trigger class="about-button"
        ><Info size={16} /><span>About the data</span></Dialog.Trigger
      >
      {#if aboutOpen}
        <Dialog.Portal
          ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="dialog-content">
            <Dialog.Title class="dialog-title">About the data</Dialog.Title>
            <Dialog.Description class="dialog-description"
              >Sources, accuracy, and location.</Dialog.Description
            >
            <Dialog.Close class="icon-button dialog-close" aria-label="Close about the data"
              ><X size={20} /></Dialog.Close
            >
            <div class="about-copy">
              <h2>Solar events</h2>
              <p>
                Sunset and twilight times are provided by the U.S. Naval Observatory for the
                selected city and date, rounded to the nearest minute. Terrain and atmospheric
                conditions can affect what you see. Each event marks sunset or the end of a twilight
                stage.
              </p>
              <a
                class="source-link"
                href="https://aa.usno.navy.mil/data/RS_OneYear"
                target="_blank"
                rel="external noreferrer">U.S. Naval Observatory <ArrowUpRight size={13} /></a
              >
              <h2>UV forecast</h2>
              <p>
                Hourly UV forecasts are provided by NOAA for the area around the selected city.
                Availability varies by date. These are forecasts, not current measurements. Twilight
                times do not measure UV exposure or establish a safe time outdoors.
              </p>
              <a
                class="source-link"
                href="https://www.cpc.ncep.noaa.gov/products/stratosphere/uv_index/uv_global.shtml"
                target="_blank"
                rel="external noreferrer"
                >NOAA Climate Prediction Center <ArrowUpRight size={13} /></a
              >
              <h2>Your location</h2>
              <p>
                Gloam uses your IP address through ipwho.is to estimate your city. This can be
                inaccurate when using a VPN or mobile network. You can change the city at any time.
                Your choice is saved in this browser.
              </p>
              <p>
                City search uses <a
                  href="https://www.geonames.org/"
                  target="_blank"
                  rel="external noreferrer">GeoNames</a
                >
                data under
                <a
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="external noreferrer">CC BY 4.0</a
                >.
              </p>
            </div>
          </Dialog.Content></Dialog.Portal
        >
      {/if}
    </Dialog.Root>
  </header>

  <main id="main">
    <section class="location-heading" aria-label="Location">
      <div class="location-copy">
        <div class="city-name-row">
          <h1>{city?.name ?? (detecting ? 'Finding your city…' : 'Choose a city')}</h1>
          <CityPicker {city} onselect={chooseCity} ondetect={detectCity} {detecting} />
        </div>
        <p class="location-detail">
          {#if city}
            <span>{city.region ? `${city.region}, ` : ''}{city.country}</span>
            {#if approximate}<span class="location-estimate">Approximate location</span>{/if}
          {:else}See sunset, twilight times, and the UV forecast.{/if}
        </p>
      </div>
      {#if city}<CityClock {now} {timezone} showDate={date !== dateInZone(now, timezone)} />{/if}
    </section>

    {#if locationMessage}<p class="location-notice" role="status">{locationMessage}</p>{/if}
    {#if city}
      <div class="toolbar">
        <div class="date-controls">
          <label class="date-picker"
            ><CalendarDays size={16} /><span
              >{readableDate(date, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}</span
            ><ChevronDown size={13} /><input
              type="date"
              aria-label="Choose evening date"
              value={date}
              min={today}
              max={nextYear(today)}
              onchange={(event) => chooseDate(event.currentTarget.value)}
            /></label
          >
          <div class="date-arrows">
            <button
              class="icon-button"
              aria-label="Previous evening"
              disabled={date <= today}
              onclick={() => chooseDate(shiftDate(date, -1))}><ChevronLeft size={18} /></button
            ><button
              class="icon-button"
              aria-label="Next evening"
              disabled={date >= nextYear(today)}
              onclick={() => chooseDate(shiftDate(date, 1))}><ChevronRight size={18} /></button
            >
          </div>
          {#if !isToday}<button class="today-button" onclick={() => chooseDate(today)}>Today</button
            >{/if}
        </div>
        <p class="timezone-label">
          <Clock3 size={14} /><span>Time zone · {fullTimeZoneLabel(timezone, date)}</span>
        </p>
      </div>
    {/if}

    {#if loading && city && !detecting}
      <EveningLoading />
      <UvOutlook forecast={null} loading={true} {timezone} {date} onretry={() => {}} />
    {:else if detecting}
      <section class="loading-card" aria-busy="true" aria-label="Loading evening times">
        <div class="loading-content">
          {@render MoonPlaceholder()}
          <p role="status">Finding your city…</p>
        </div>
      </section>
    {:else if error}
      <section class="empty-card">
        <Sunset size={38} strokeWidth={1.2} />
        <h2>Evening times unavailable</h2>
        <p role="alert">{error}</p>
        <button class="text-button" onclick={refresh}><RefreshCw size={16} />Try again</button>
      </section>
    {:else if evening && city}
      <EveningSky {evening} {timezone} />
      <UvOutlook
        forecast={uv}
        loading={uvLoading}
        {timezone}
        {date}
        onretry={() => void refreshUv()}
      />
    {:else}
      <section class="empty-card">
        <Sunset size={46} strokeWidth={1.1} />
        <h2>Evening times for your city</h2>
        <p>Choose a city to view sunset, twilight times, and the UV forecast.</p>
        <CityPicker {city} onselect={chooseCity} ondetect={detectCity} {detecting} />
      </section>
    {/if}
  </main>
  <footer class="footer">
    <p>
      Copyright © {copyrightYear}
      <a href="https://asher-nyu.com" target="_blank" rel="noopener noreferrer">Asher Bloom</a>. All
      rights reserved.
    </p>
  </footer>
</div>

{#snippet MoonPlaceholder()}<Sunset size={32} strokeWidth={1.2} />{/snippet}

<style lang="scss">
  .page-shell {
    width: min(960px, calc(100% - 80px));
    margin-inline: auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 88px;
    border-bottom: 1px solid var(--line);
    gap: 24px;
  }
  .brand {
    display: inline-flex;
    gap: 9px;
    align-items: center;
    text-decoration: none;
    color: var(--ink);
    font-size: 1.625rem;
    letter-spacing: -0.055em;
    font-weight: 650;
  }
  :global(.about-button) {
    display: inline-flex;
    gap: 7px;
    align-items: center;
    min-height: 44px;
    background: transparent;
    font-size: 0.8125rem;
    color: var(--secondary);
    padding: 8px 0;
  }
  :global(.about-button:hover) {
    color: var(--ink);
  }
  main {
    padding-block: 36px 40px;
  }
  .location-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 32px;
  }
  .location-copy {
    min-width: 0;
  }
  .city-name-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .city-name-row :global(.city-trigger) {
    flex-shrink: 0;
  }
  h1 {
    overflow-wrap: anywhere;
    font-size: clamp(2rem, 1.4rem + 2vw, 2.5rem);
    letter-spacing: -0.045em;
    line-height: 1.2;
    font-weight: 600;
  }
  .location-detail {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    font-size: 0.8125rem;
    color: var(--secondary);
    margin-top: 8px;
    line-height: 1.5;
  }
  .location-estimate {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .location-estimate::before {
    content: '';
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px 24px;
    margin-block: 28px 24px;
  }
  .date-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .date-picker {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    font-size: 0.875rem;
    line-height: 1.5;
    padding: 8px 0;
    border-radius: 8px;
    cursor: pointer;
  }
  .date-picker:hover {
    color: var(--accent);
  }
  .date-picker input {
    position: absolute;
    inset: 0;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .date-picker:focus-within {
    outline: 3px solid var(--focus);
    outline-offset: 3px;
  }
  .date-arrows {
    display: flex;
  }
  .today-button {
    min-height: 44px;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    font-size: 0.8125rem;
  }
  .today-button:hover {
    background: var(--hover);
  }
  .timezone-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 0;
    font-size: 0.8125rem;
    color: var(--secondary);
    min-height: 44px;
    max-width: 100%;
    line-height: 1.5;
  }
  .timezone-label :global(svg) {
    flex-shrink: 0;
  }
  .location-notice {
    font-size: 0.8125rem;
    color: var(--secondary);
    line-height: 1.5;
    margin-bottom: 20px;
  }
  .location-notice {
    margin-top: 20px;
  }
  main > :global(.uv-card) {
    margin-top: 24px;
  }
  .loading-card,
  .empty-card {
    min-height: 320px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    text-align: center;
    padding: 40px var(--card-inset);
    margin-top: 24px;
  }
  .loading-content p {
    margin-top: 20px;
    font-size: 1rem;
    color: var(--secondary);
  }
  .empty-card h2 {
    font-size: 1.5rem;
    font-weight: 550;
    letter-spacing: -0.035em;
  }
  .empty-card p {
    max-width: 420px;
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--secondary);
  }
  .footer {
    border-top: 1px solid var(--line);
    padding-block: 24px 32px;
    color: var(--secondary);
    font-size: 0.75rem;
    line-height: 1.7;
  }
  .footer a {
    color: inherit;
    text-decoration: none;
  }
  .footer a:hover,
  .footer a:focus-visible {
    text-decoration: underline;
  }
  .about-copy {
    margin-top: 26px;
  }
  .about-copy h2 {
    font-size: 1rem;
    margin-top: 24px;
  }
  .about-copy p {
    font-size: 0.9375rem;
    line-height: 1.65;
    color: var(--secondary);
    margin-top: 10px;
  }
  .about-copy p a {
    font: inherit;
  }
  .about-copy .source-link {
    font-size: 0.875rem;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
  }
  @media (max-width: 900px) {
    .page-shell {
      width: calc(100% - 48px);
    }
  }
  @media (max-width: 640px) {
    .page-shell {
      width: calc(100% - 32px);
    }
    .header {
      min-height: 72px;
      gap: 16px;
    }
    .brand {
      font-size: 1.5rem;
    }
    main {
      padding-block: 28px 32px;
    }
    .location-heading {
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
    }
    .city-name-row {
      flex-wrap: nowrap;
      justify-content: space-between;
      gap: 12px;
    }
    .location-heading :global(.city-trigger) {
      padding: 8px;
    }
    .location-heading :global(.city-trigger span) {
      display: none;
    }
    .location-estimate {
      flex-basis: 100%;
    }
    .location-estimate::before {
      display: none;
    }
    .toolbar {
      margin-block: 20px;
      gap: 4px;
    }
    .date-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      width: 100%;
      column-gap: 8px;
    }
    .date-picker {
      font-size: 0.8125rem;
      gap: 6px;
    }
    .date-picker > :global(svg:last-of-type) {
      display: none;
    }
    .date-arrows {
      justify-self: end;
    }
    .today-button {
      grid-column: 1 / -1;
      justify-self: start;
    }
    .empty-card {
      padding: 30px var(--card-inset);
    }
  }
</style>
