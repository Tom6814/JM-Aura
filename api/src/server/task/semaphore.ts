/**
 * A tiny async semaphore for limiting concurrency.
 *
 * Design notes:
 * - `acquire()` resolves only when a permit is granted.
 * - `release()` transfers the permit directly to the next waiter (FIFO),
 *   avoiding temporarily increasing `available` which can lead to over-acquire
 *   due to microtask scheduling.
 */
export class Semaphore {
  private readonly max: number;
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.max = Math.max(1, Math.floor(concurrency));
    this.available = this.max;
  }

  /**
   * Acquire a permit. Resolves to a release function that must be called exactly once.
   */
  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }

    // Wait until `release()` hands a permit directly to us.
    await new Promise<void>((resolve) => this.queue.push(resolve));
    return () => this.release();
  }

  /**
   * Release a permit back to the semaphore.
   *
   * If there are waiters, pass the permit to the next waiter immediately (FIFO).
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }

    this.available += 1;
    if (this.available > this.max) {
      // Prevent silent misuse (double release). Keep state consistent.
      this.available = this.max;
      throw new Error("Semaphore.release() called too many times");
    }
  }

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

