<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { onMount } from 'svelte';
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
  import { Search, MapPin, ChevronDown, X, ChevronRight, LocateFixed } from '@lucide/svelte';
  import type { City } from '$lib/domain/types';
  let {
    city,
    onselect,
    ondetect,
    detecting = false,
  }: {
    city: City | null;
    onselect: (city: City) => void;
    ondetect: () => void;
    detecting?: boolean;
  } = $props();
  let open = $state(false);
  let query = $state('');
  let results = $state<City[]>([]);
  let loading = $state(false);
  let error = $state('');
  let retry = $state(0);
  let input = $state<HTMLInputElement>();
  $effect(() => {
    const q = query.trim();
    void retry;
    if (!open || q.length < 2) {
      results = [];
      loading = false;
      error = '';
      return;
    }
    const controller = new AbortController();
    loading = true;
    error = '';
    results = [];
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/cities?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        results = (await response.json()).cities;
      } catch {
        if (!controller.signal.aborted) error = 'We couldn’t search for cities. Try again.';
      } finally {
        if (!controller.signal.aborted) loading = false;
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });
  function choose(value: City) {
    onselect(value);
    open = false;
    query = '';
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger
    disabled={!ready}
    class="city-trigger"
    aria-label={city ? `Change city, currently ${city.name}` : 'Choose a city'}
    ><MapPin size={16} strokeWidth={1.7} /><span>{city ? 'Change city' : 'Choose a city'}</span
    ><ChevronDown size={14} /></Dialog.Trigger
  >
  {#if open}
    <Dialog.Portal>
      <Dialog.Overlay class="dialog-overlay" />
      <Dialog.Content
        class="dialog-content"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input?.focus();
        }}
      >
        <Dialog.Title class="dialog-title">Choose a city</Dialog.Title>
        <Dialog.Description class="dialog-description"
          >Times are shown in the city’s local time zone.</Dialog.Description
        >
        <Dialog.Close class="icon-button dialog-close" aria-label="Close city search"
          ><X size={20} /></Dialog.Close
        >
        <div class="search-field">
          <Search size={19} /><input
            bind:this={input}
            bind:value={query}
            type="search"
            placeholder="Search by city name"
            aria-label="Search cities"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="results" aria-busy={loading}>
          {#if loading}<p class="search-status" role="status">Searching…</p>
          {:else if error}<p class="search-status" role="alert">{error}</p>
            <button class="text-button search-retry" onclick={() => retry++}>Try again</button>
          {:else if query.trim().length >= 2 && !results.length}<p
              class="search-status"
              role="status"
            >
              No cities found. Check the spelling or try a nearby city.
            </p>
          {:else if results.length}
            <ul aria-label="Matching cities">
              {#each results as result (result.id)}<li>
                  <button onclick={() => choose(result)}
                    ><MapPin size={17} /><span
                      ><strong>{result.name}</strong><small
                        >{[result.region, result.country].filter(Boolean).join(', ')}</small
                      ></span
                    ><ChevronRight size={16} /></button
                  >
                </li>{/each}
            </ul>
          {:else}<div class="search-hint">
              <MapPin size={26} strokeWidth={1.3} />
              <p>Enter a city name to search.</p>
            </div>{/if}
        </div>
        <button
          class="detect-button"
          disabled={detecting}
          onclick={() => {
            ondetect();
            open = false;
          }}
          ><LocateFixed size={17} />{detecting
            ? 'Finding your city…'
            : 'Use approximate location'}</button
        >
        <p class="privacy">Uses your IP address to estimate your city.</p>
      </Dialog.Content>
    </Dialog.Portal>
  {/if}
</Dialog.Root>

<style lang="scss">
  :global(.city-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 13px;
    min-height: 44px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 22px;
    font-size: 0.8125rem;
    font-weight: 550;
    white-space: nowrap;
  }
  :global(.city-trigger:enabled:hover) {
    background: var(--hover);
  }
  .search-field {
    margin-top: 24px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--soft);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 0 14px;
    color: var(--secondary);
    &:focus-within {
      outline: 3px solid var(--focus);
      outline-offset: 3px;
    }
  }
  input {
    min-width: 0;
    width: 100%;
    background: none;
    border: 0;
    height: 50px;
    color: var(--ink);
    outline-offset: 1px;
    &:focus-visible {
      outline: none;
    }
  }
  .results {
    min-height: 180px;
    max-height: 320px;
    overflow-y: auto;
    margin-top: 12px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li button {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 10px;
    text-align: left;
    width: 100%;
    border-radius: 10px;
    background: transparent;
    min-height: 62px;
  }
  li button:hover,
  li button:focus-visible {
    background: var(--soft);
  }
  li span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  li strong {
    display: block;
    font-size: 0.9375rem;
    font-weight: 550;
  }
  li small {
    display: block;
    margin-top: 4px;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--secondary);
  }
  .search-retry {
    margin: 0 12px 16px;
  }
  .search-status {
    padding: 28px 12px;
    color: var(--secondary);
    font-size: 0.9375rem;
    line-height: 1.6;
  }
  .search-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 30px 0;
    color: var(--secondary);
    text-align: center;
    p {
      color: var(--ink);
      font-weight: 500;
    }
  }
  .detect-button {
    border-top: 1px solid var(--line);
    background: transparent;
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 20px 8px 12px;
    color: var(--accent);
    font-size: 0.875rem;
    min-height: 44px;
  }
  .privacy {
    font-size: 0.75rem;
    color: var(--secondary);
    text-align: center;
    margin-top: 6px;
    line-height: 1.5;
  }
</style>
