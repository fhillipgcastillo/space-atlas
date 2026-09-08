type FetchFn<T> = (path: string) => Promise<T>;

interface QueueEntry {
  path: string;
  priority: number;
}

/** Priority queue over tile fetches with a hard in-flight cap. */
export class TileLoader<T> {
  onLoaded: (path: string, value: T) => void = () => {};
  onFailed: (path: string, error: unknown) => void = () => {};

  private readonly queue: QueueEntry[] = [];
  private readonly inFlight = new Set<string>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly fetchFn: FetchFn<T>,
    private readonly maxInFlight = 8,
  ) {}

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get queuedPaths(): string[] {
    return this.queue.map((entry) => entry.path);
  }

  enqueue(path: string, priority: number): void {
    if (this.seen.has(path)) return;
    this.seen.add(path);
    this.queue.push({ path, priority });
    this.pump();
  }

  /** Drops queued work no longer wanted. In-flight requests are left to finish. */
  retainOnly(paths: Set<string>): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const entry = this.queue[i]!;
      if (paths.has(entry.path)) continue;
      this.queue.splice(i, 1);
      this.seen.delete(entry.path);
    }
  }

  forget(path: string): void {
    this.seen.delete(path);
  }

  private pump(): void {
    while (this.inFlight.size < this.maxInFlight && this.queue.length > 0) {
      let bestIndex = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i]!.priority > this.queue[bestIndex]!.priority) bestIndex = i;
      }
      const [entry] = this.queue.splice(bestIndex, 1);
      if (!entry) return;

      this.inFlight.add(entry.path);
      void this.run(entry.path);
    }
  }

  private async run(path: string): Promise<void> {
    try {
      this.onLoaded(path, await this.fetchFn(path));
    } catch (error) {
      this.seen.delete(path);
      this.onFailed(path, error);
    } finally {
      this.inFlight.delete(path);
      this.pump();
    }
  }
}
