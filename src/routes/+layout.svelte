<script lang="ts">
  import '../lib/styles/global.scss';
  let { children } = $props();
</script>

<svelte:head><title>Gloam</title></svelte:head>

<a class="skip-link" href="#main">Skip to evening times</a>
{@render children()}
