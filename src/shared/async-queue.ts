export interface AsyncQueueOptions {
  readonly highWaterMark?: number;
  readonly onFull?: () => void;
  readonly onDrain?: () => void;
}

interface Waiter<T> {
  readonly resolve: (result: IteratorResult<T>) => void;
  readonly reject: (reason: unknown) => void;
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<Waiter<T>> = [];
  private readonly highWaterMark: number;
  private readonly onFull: (() => void) | undefined;
  private readonly onDrain: (() => void) | undefined;
  private full = false;
  private closed = false;
  private failed = false;
  private error: unknown;

  constructor(options: AsyncQueueOptions = {}) {
    const highWaterMark = options.highWaterMark ?? 1024;
    if (!Number.isInteger(highWaterMark) || highWaterMark < 1) {
      throw new RangeError(`Invalid highWaterMark: ${highWaterMark}`);
    }
    this.highWaterMark = highWaterMark;
    this.onFull = options.onFull;
    this.onDrain = options.onDrain;
  }

  get size(): number {
    return this.values.length;
  }

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ value, done: false });
      return;
    }
    this.values.push(value);
    if (!this.full && this.values.length >= this.highWaterMark) {
      this.full = true;
      this.onFull?.();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
    if (this.full) {
      this.full = false;
      this.onDrain?.();
    }
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failed = true;
    this.error = error;
    this.values.length = 0;
    if (this.full) {
      this.full = false;
      this.onDrain?.();
    }
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.failed) return Promise.reject(this.error);
    if (this.values.length > 0) {
      const value = this.values.shift() as T;
      if (
        this.full &&
        this.values.length <= Math.floor(this.highWaterMark / 2)
      ) {
        this.full = false;
        this.onDrain?.();
      }
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}
