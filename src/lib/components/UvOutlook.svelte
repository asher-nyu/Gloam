<script lang="ts">
  import { ArrowUpRight, RefreshCw, CloudSun } from '@lucide/svelte';
  import { formatTime, dayOffsetLabel } from '$lib/domain/time';
  import type { UvForecast } from '$lib/domain/types';

  let {
    forecast,
    loading,
    timezone,
    date,
    onretry,
  }: {
    forecast: UvForecast | null;
    loading: boolean;
    timezone: string;
    date: string;
    onretry: () => void;
  } = $props();

  const points = $derived(forecast?.points ?? []);
  const max = $derived(Math.max(3, ...points.map((point) => point.index ?? 0)));
  const unavailable = $derived(
    !loading &&
      (!forecast || forecast.status === 'unavailable' || forecast.status === 'outside-horizon'),
  );
  const modelTime = $derived(
    forecast?.modelRun
      ? new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(new Date(forecast.modelRun))
      : null,
  );
</script>

<section class="uv-card" aria-label="UV forecast" aria-busy={loading}>
  <div class="uv-header">
    <h2>UV forecast</h2>
  </div>
  {#if loading}
    <div class="uv-empty" role="status">
      <CloudSun size={25} strokeWidth={1.3} aria-hidden="true" />
      <p>Loading forecast…</p>
    </div>
  {:else if unavailable}
    <div class="uv-empty">
      <CloudSun size={27} strokeWidth={1.3} aria-hidden="true" />
      <div>
        <h3>
          {forecast?.status === 'outside-horizon'
            ? 'Forecast not available for this date'
            : 'Forecast unavailable'}
        </h3>
        <p>
          {forecast?.status === 'outside-horizon'
            ? 'Forecasts cover the next few days. Check back closer to the date.'
            : 'Try again in a few minutes.'}
        </p>
      </div>
      {#if forecast?.status !== 'outside-horizon'}
        <button class="icon-button" aria-label="Retry UV forecast" onclick={onretry}>
          <RefreshCw size={17} />
        </button>
      {/if}
    </div>
  {:else}
    <div class="forecast-body">
      <ul class="uv-hours" aria-label="Hourly UV forecast">
        {#each points as item (item.at)}
          {@const time = formatTime(item.at, timezone)}
          {@const offset = dayOffsetLabel(item.at, timezone, date)}
          <li>
            <span class="hour-value">
              <span class="sr-only">UV Index </span>
              {#if item.index == null}
                <span aria-hidden="true">—</span><span class="sr-only">unavailable</span>
              {:else}
                {item.index.toFixed(1)}
              {/if}
            </span>
            <span class="bar-track" class:missing={item.index == null} aria-hidden="true">
              <span
                class="bar"
                style={`height: ${item.index == null ? 0 : (item.index / max) * 100}%`}
              ></span>
            </span>
            <time class="hour-time" datetime={item.at}>
              {time.time.replace(':00', '')}<small>{time.period}</small>
            </time>
            {#if offset}<span class="hour-offset">{offset}</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
    <div class="uv-footer">
      <p>
        {#if modelTime}Forecast issued {modelTime}{/if}
        {#if forecast?.status === 'partial'}
          <span class="partial-note">Some hours are unavailable.</span>
        {/if}
      </p>
      <a
        href={forecast?.sourceUrl ?? 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/'}
        target="_blank"
        rel="external noreferrer">NOAA <ArrowUpRight size={14} /></a
      >
    </div>
  {/if}
</section>

<style lang="scss">
  @use '../styles/tokens' as t;

  .uv-card {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 28px var(--card-inset) 16px;
    border: 1px solid var(--line);
  }
  .uv-header {
    display: flex;
    align-items: center;
    gap: 9px;
    h2 {
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
  }
  .forecast-body {
    container-type: inline-size;
    margin-top: 24px;
  }
  .uv-hours {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    column-gap: 12px;
    row-gap: 24px;
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .uv-hours li {
    min-width: 0;
    display: grid;
    grid-template-rows: auto 48px auto auto;
    justify-items: center;
    align-content: start;
    gap: 8px;
  }
  .hour-value {
    font-size: 0.9375rem;
    font-weight: 550;
    line-height: 1.3;
    font-variant-numeric: tabular-nums;
  }
  .bar-track {
    display: flex;
    align-items: flex-end;
    width: 18px;
    height: 48px;
    border-bottom: 1px solid var(--uv-bar);
  }
  .bar-track.missing {
    border-bottom-style: dashed;
    border-color: var(--secondary);
  }
  .bar {
    width: 100%;
    background: var(--uv-bar);
    border-radius: 4px 4px 0 0;
  }
  .hour-time {
    color: var(--secondary);
    font-size: 0.8125rem;
    line-height: 1.4;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    small {
      margin-left: 3px;
      font-size: inherit;
    }
  }
  .hour-offset {
    color: var(--secondary);
    font-size: 0.75rem;
    line-height: 1.4;
    text-align: center;
  }
  .uv-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
    justify-content: space-between;
    align-items: center;
    margin-top: 20px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    color: var(--secondary);
    font-size: 0.75rem;
    line-height: 1.6;
    p {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    a {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: inherit;
      text-decoration: none;
      min-height: 44px;
      &:hover {
        text-decoration: underline;
      }
    }
  }
  .partial-note {
    display: block;
  }
  .uv-empty {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 130px;
    h3 {
      font-size: 0.9375rem;
      font-weight: 550;
      line-height: 1.5;
    }
    p {
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--secondary);
    }
    h3 + p {
      margin-top: 5px;
    }
    > div,
    > p {
      flex: 1;
      min-width: 0;
    }
  }
  @container (max-width: 32rem) {
    .uv-hours {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  @container (max-width: 14rem) {
    .uv-hours {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @include t.narrow {
    .uv-card {
      padding-block: 24px 16px;
    }
    .forecast-body {
      margin-top: 20px;
    }
    .uv-empty {
      align-items: flex-start;
      padding-block: 24px;
    }
  }
</style>
