<script lang="ts">
  let {
    now,
    timezone,
    showDate = false,
  }: { now: number; timezone: string; showDate?: boolean } = $props();
  const clockFormat = $derived(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
  );
  const dateFormat = $derived(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  );
  const parts = $derived(clockFormat.formatToParts(now));
  const digits = $derived(
    parts
      .filter((p) => p.type !== 'dayPeriod')
      .map((p) => p.value)
      .join('')
      .trim(),
  );
  const period = $derived(parts.find((p) => p.type === 'dayPeriod')?.value);
</script>

<div class="city-clock" aria-label="Current date and time" aria-live="off">
  <time
    datetime={new Date(now).toISOString()}
    aria-label={dateFormat.format(now) + ', ' + clockFormat.format(now)}
  >
    <span class="clock-digits">{digits}</span><span class="clock-period">{period}</span>
  </time>
  <p class="clock-label">Current time</p>
  {#if showDate}<p class="clock-date">{dateFormat.format(now)}</p>{/if}
</div>

<style lang="scss">
  .city-clock {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  time {
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 6px;
  }
  .clock-digits {
    white-space: nowrap;
    font-size: 1.75rem;
    font-weight: 500;
    letter-spacing: -0.035em;
    line-height: 1.25;
  }
  .clock-period {
    font-size: 0.8125rem;
    color: var(--secondary);
  }
  .clock-label,
  .clock-date {
    color: var(--secondary);
    font-size: 0.8125rem;
    line-height: 1.5;
    margin-top: 8px;
  }
  .clock-date {
    margin-top: 3px;
  }
  @media (max-width: 640px) {
    .city-clock {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px 16px;
      text-align: left;
    }
    time {
      order: 2;
      justify-content: flex-start;
    }
    .clock-digits {
      font-size: 1.25rem;
    }
    .clock-label {
      order: 1;
      margin: 0;
    }
    .clock-date {
      order: 3;
      flex-basis: 100%;
      margin: 0;
    }
  }
</style>
