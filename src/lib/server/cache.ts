/** Bounded, expiring cache with concurrent request coalescing. Rejections are never cached. */
export class AsyncCache<T> {
  private entries = new Map<string, { expires: number; value: Promise<T> }>();
  constructor(
    private maximum: number,
    private ttl: number,
  ) {}
  delete(key: string): void {
    this.entries.delete(key);
  }
  get(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expires > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.value;
    }
    this.entries.delete(key);
    const value = factory().catch((error) => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { expires: Date.now() + this.ttl, value });
    if (this.entries.size > this.maximum) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }
}
