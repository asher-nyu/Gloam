<script lang="ts">
  import { phases, type Evening, type EveningEvent } from '$lib/domain/types';
  import { ArrowUpRight } from '@lucide/svelte';
  import EventTime from './EventTime.svelte';

  let { evening, timezone }: { evening: Evening; timezone: string } = $props();

  function eventNote(event: EveningEvent, angle: string) {
    if (event.status === 'above')
      return event.kind === 'sunset'
        ? 'The Sun remains above the horizon on this date.'
        : `The Sun does not reach ${angle.slice(1)} below the horizon on this date.`;
    if (event.status === 'below')
      return event.kind === 'sunset'
        ? 'The Sun remains below the horizon on this date.'
        : `The Sun remains more than ${angle.slice(1)} below the horizon on this date.`;
    if (event.status === 'unavailable') return 'This event’s time is currently unavailable.';
    if (event.status === 'no-crossing') return 'This event does not occur on this date.';
    return '';
  }
</script>

<section class="evening-card" aria-label="Solar events">
  <header class="evening-header"><h2>Solar events</h2></header>
  <ol class="events">
    {#each phases as phase (phase.kind)}
      {@const event = evening.events.find((e) => e.kind === phase.kind)!}
      {@const note = eventNote(event, phase.angle)}
      <li class="event">
        <h3 class="event-label">{phase.name}</h3>
        <div class="boundary-time">
          <EventTime at={event.at} status={event.status} {timezone} date={evening.date} />
        </div>
        <p class="event-description">{phase.description}</p>
        {#if note}<p class="event-note">{note}</p>{/if}
      </li>
    {/each}
  </ol>
  <footer class="event-source">
    <a href={evening.sourceUrl} target="_blank" rel="external noreferrer"
      >U.S. Naval Observatory <ArrowUpRight size={13} /></a
    >
  </footer>
</section>

<style lang="scss">
  .evening-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding-inline: var(--card-inset);
    container-type: inline-size;
  }
  .evening-header {
    padding-block: 26px 4px;
  }
  h2 {
    font-size: 1rem;
    line-height: 1.5;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .events {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .event {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    column-gap: 40px;
    row-gap: 8px;
    padding-block: 25px;
  }
  .event + .event {
    border-top: 1px solid var(--line);
  }
  .event-label {
    grid-column: 1;
    grid-row: 1;
    font-size: 1.125rem;
    font-weight: 550;
    line-height: 1.4;
    letter-spacing: -0.025em;
  }
  .boundary-time {
    grid-column: 2;
    grid-row: 1 / span 2;
    text-align: right;
  }
  .boundary-time :global(.event-time) {
    justify-content: flex-end;
  }
  .boundary-time :global(.digits) {
    font-size: 1.75rem;
    font-weight: 500;
    line-height: 1.2;
  }
  .boundary-time :global(.period) {
    font-size: 0.8125rem;
    font-weight: 400;
    color: var(--secondary);
  }
  .boundary-time :global(.offset) {
    color: var(--secondary);
    opacity: 1;
  }
  .boundary-time :global(.missing) {
    font-size: 0.9375rem;
    color: var(--secondary);
  }
  .event-description,
  .event-note {
    grid-column: 1;
    color: var(--secondary);
    font-size: 0.875rem;
    line-height: 1.6;
    max-width: 60ch;
  }
  .event-description {
    grid-row: 2;
  }
  .event-note {
    grid-column: 1 / -1;
    color: var(--ink);
  }
  .event-source {
    padding-block: 10px;
    border-top: 1px solid var(--line);
  }
  .event-source a {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--secondary);
    font-size: 0.75rem;
    line-height: 1.5;
    text-decoration: none;
  }
  .event-source a:hover {
    text-decoration: underline;
  }
  @media (max-width: 640px) {
    .evening-header {
      padding-top: 22px;
    }
    .event {
      column-gap: 18px;
      padding-block: 22px;
    }
    .event-label {
      font-size: 1rem;
    }
    .boundary-time {
      grid-row: 1;
    }
    .boundary-time :global(.digits) {
      font-size: 1.375rem;
    }
    .event-description {
      grid-column: 1 / -1;
    }
  }
  @container (max-width: 12rem) {
    .event {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }
    .boundary-time {
      grid-column: 1;
      grid-row: 2;
      text-align: left;
    }
    .boundary-time :global(.event-time) {
      justify-content: flex-start;
    }
    .event-description {
      grid-row: 3;
    }
  }
</style>
