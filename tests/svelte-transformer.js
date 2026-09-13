import transformer from 'svelte-jester';

// Svelte preprocessing is asynchronous. Exposing only this entry point also
// prevents Jest's synchronous ESM optimization from calling the CJS transformer.
export default { processAsync: transformer.processAsync };
