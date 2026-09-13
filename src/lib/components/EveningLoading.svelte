<section class="loading-evening" aria-busy="true" aria-label="Loading solar events">
  <h2>Solar events</h2>
  <p class="sr-only" role="status">Loading solar events…</p>
  <div class="loading-events" aria-hidden="true">
    {#each [0, 1, 2, 3] as event (event)}
      <div class="loading-event">
        <span class="placeholder label"></span><span class="placeholder value"></span><span
          class="placeholder description"
        ></span>
      </div>
    {/each}
  </div>
</section>

<style lang="scss">
  .loading-evening {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 26px var(--card-inset);
  }
  h2 {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.5;
  }
  .loading-event {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 90px;
    align-items: center;
    gap: 18px 32px;
    padding-block: 25px;
    min-height: 135px;
  }
  .loading-event + .loading-event {
    border-top: 1px solid var(--line);
  }
  .placeholder {
    display: block;
    background: var(--soft);
    border-radius: 5px;
  }
  .label {
    width: 80%;
    max-width: 210px;
    height: 16px;
  }
  .value {
    height: 28px;
  }
  .description {
    grid-column: 1 / -1;
    width: 85%;
    max-width: 490px;
    height: 14px;
  }
</style>
