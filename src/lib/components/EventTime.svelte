<script lang="ts">
  import { formatTime, dayOffsetLabel } from '$lib/domain/time';
  import { eventStatusLabel, type EventStatus } from '$lib/domain/types';
  let {
    at,
    status = 'occurs',
    timezone,
    date,
    large = false,
  }: {
    at: string | null;
    status?: EventStatus;
    timezone: string;
    date: string;
    large?: boolean;
  } = $props();
  const formatted = $derived(at ? formatTime(at, timezone) : null);
  const offset = $derived(at ? dayOffsetLabel(at, timezone, date) : '');
  const missing = $derived(eventStatusLabel(status));
</script>

<span class:large class="event-time">
  {#if formatted}
    <span class="digits">{formatted.time}</span><span class="period">{formatted.period}</span>
    {#if offset}<span class="offset">{offset}</span>{/if}
  {:else}<span class="missing">{missing}</span>{/if}
</span>

<style lang="scss">
  .event-time {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    column-gap: 5px;
    row-gap: 5px;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.035em;
  }
  .digits {
    font-size: 2rem;
    font-weight: 500;
    line-height: 1.15;
  }
  .period {
    font-size: 0.8125rem;
    font-weight: 550;
    letter-spacing: 0;
  }
  .offset {
    width: 100%;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0;
    opacity: 0.8;
  }
  .missing {
    font-size: 1rem;
    letter-spacing: -0.015em;
  }
  .large {
    column-gap: 12px;
    .digits {
      font-size: clamp(3.8rem, 7.5vw, 6.5rem);
      font-weight: 400;
      letter-spacing: -0.065em;
      line-height: 1;
    }
    .period {
      font-size: 1.25rem;
      font-weight: 450;
    }
    .missing {
      font-size: clamp(2rem, 4vw, 3.5rem);
      line-height: 1.2;
    }
  }
  @media (max-width: 380px) {
    .digits {
      font-size: 1.65rem;
    }
  }
</style>
