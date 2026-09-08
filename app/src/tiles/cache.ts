interface Entry<T> {
  value: T;
  bytes: number;
}

/** LRU cache under a byte budget. Map insertion order carries the recency. */
export class TileCache<T> {
  onEvict: (path: string, value: T) => void = () => {};

  private readonly entries = new Map<string, Entry<T>>();
  private bytes = 0;

  constructor(private readonly byteBudget: number) {}

  get byteCount(): number {
    return this.bytes;
  }

  get size(): number {
    return this.entries.size;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get(path: string): T | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    this.entries.delete(path);
    this.entries.set(path, entry);
    return entry.value;
  }

  touch(path: string): void {
    this.get(path);
  }

  set(path: string, value: T, bytes: number): void {
    const existing = this.entries.get(path);
    if (existing) {
      this.bytes -= existing.bytes;
      this.entries.delete(path);
      // The replaced value still owns GPU resources and, downstream, a slot
      // registration that would otherwise point at a discarded mesh.
      if (existing.value !== value) this.onEvict(path, existing.value);
    }
    this.entries.set(path, { value, bytes });
    this.bytes += bytes;
    this.evictToBudget(path);
  }

  clear(): void {
    for (const [path, entry] of this.entries) this.onEvict(path, entry.value);
    this.entries.clear();
    this.bytes = 0;
  }

  private evictToBudget(protectedPath: string): void {
    for (const [path, entry] of this.entries) {
      if (this.bytes <= this.byteBudget) return;
      // An oversized tile would otherwise evict itself and never settle.
      if (path === protectedPath) continue;
      this.entries.delete(path);
      this.bytes -= entry.bytes;
      this.onEvict(path, entry.value);
    }
  }
}
