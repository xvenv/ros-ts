import type { ParsedReply } from '../protocol/index.js';
import {
  AsyncQueue,
  CancelledError,
  type CommandResult,
  FatalError,
  ProtocolError,
  type RosRecord,
  TimeoutError,
  TrapError,
} from '../shared/index.js';

export interface TagMuxOptions {
  readonly timeoutMs: number;
  readonly cancelGraceMs: number;
  readonly streamHighWaterMark: number;
  readonly write: (words: readonly string[]) => Promise<void>;
  readonly sendCancel: (targetTag: string) => Promise<void>;
  readonly setPaused?: (paused: boolean) => void;
  readonly onFatal: (error: FatalError) => void;
  readonly onProtocolError: (error: ProtocolError) => void;
}

interface TrapDetails {
  readonly category: number;
  readonly message: string;
}

interface Pending {
  readonly tag: string;
  readonly streaming: boolean;
  readonly records: RosRecord[];
  readonly queue: AsyncQueue<RosRecord> | undefined;
  done: RosRecord | undefined;
  trap: TrapDetails | undefined;
  cancelling: boolean;
  cancelReason: unknown;
  cancelPromise: Promise<void> | undefined;
  onSettled: (() => void) | undefined;
  timer: NodeJS.Timeout | undefined;
  graceTimer: NodeJS.Timeout | undefined;
  signal: AbortSignal | undefined;
  abortListener: (() => void) | undefined;
  resolve: ((value: CommandResult) => void) | undefined;
  reject: ((reason: Error) => void) | undefined;
}

export class TagMux {
  private readonly options: TagMuxOptions;
  private readonly pending = new Map<string, Pending>();
  private readonly zombies = new Set<string>();
  private counter = 0;
  private failed: Error | undefined;

  constructor(options: TagMuxOptions) {
    this.options = options;
  }

  async run(
    words: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CommandResult> {
    this.assertUsable(options.signal);
    const tag = this.nextTag();
    const pending: Pending = {
      tag,
      streaming: false,
      records: [],
      queue: undefined,
      done: undefined,
      trap: undefined,
      cancelling: false,
      cancelReason: undefined,
      cancelPromise: undefined,
      onSettled: undefined,
      timer: undefined,
      graceTimer: undefined,
      signal: options.signal,
      abortListener: undefined,
      resolve: undefined,
      reject: undefined,
    };
    this.pending.set(tag, pending);
    const result = new Promise<CommandResult>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    // If failAll settles result before the write returns, the caller may never
    // observe this rejection through run() itself; mark it handled.
    void result.catch(() => undefined);
    try {
      await this.options.write([...words, `.tag=${tag}`]);
    } catch (error) {
      this.pending.delete(tag);
      throw error;
    }
    if (!this.pending.has(tag)) {
      return result;
    }
    this.startTimer(pending, options.timeoutMs ?? this.options.timeoutMs);
    this.attachAbort(pending);
    return result;
  }

  stream(
    words: readonly string[],
    options: { signal?: AbortSignal; highWaterMark?: number } = {},
  ): AsyncIterable<RosRecord> {
    return this.streamImpl(words, options);
  }

  route(reply: ParsedReply): void {
    if (reply.kind === 'fatal') {
      const error = new FatalError(reply.fatalReason ?? 'RouterOS fatal error');
      this.failAll(error);
      this.options.onFatal(error);
      return;
    }
    if (reply.tag === undefined) {
      if (this.hasCancelling()) {
        return;
      }
      this.options.onProtocolError(
        new ProtocolError('Untagged reply after login'),
      );
      return;
    }

    const pending = this.pending.get(reply.tag);
    if (pending === undefined) {
      if (this.zombies.has(reply.tag)) {
        // A data-less !empty may precede the terminal !done.
        if (reply.kind === 'done') this.zombies.delete(reply.tag);
        return;
      }
      this.options.onProtocolError(
        new ProtocolError(`Reply for unknown tag ${reply.tag}`),
      );
      return;
    }

    if (pending.cancelling) {
      if (reply.kind === 'done') {
        this.zombies.delete(reply.tag);
        this.finishCancelled(pending);
      }
      return;
    }

    switch (reply.kind) {
      case 're':
        if (pending.streaming) pending.queue?.push(reply.attributes);
        else pending.records.push(reply.attributes);
        return;
      case 'trap':
        pending.trap = {
          category: parseCategory(reply.attributes.category),
          message: reply.attributes.message ?? '',
        };
        return;
      case 'empty':
        // !empty is a data-less reply, not the terminator; !done is last.
        return;
      case 'done':
        this.finish(pending, reply.attributes);
        return;
    }
  }

  failAll(error: Error): void {
    if (this.failed !== undefined) return;
    this.failed = error;
    for (const pending of this.pending.values()) {
      this.clearTimers(pending);
      this.detachAbort(pending);
      pending.onSettled?.();
      if (pending.queue !== undefined) pending.queue.fail(error);
      else pending.reject?.(error);
    }
    this.pending.clear();
    this.zombies.clear();
  }

  async cancel(
    tag: string,
    reason: Error = new CancelledError('Command cancelled'),
  ): Promise<void> {
    const pending = this.pending.get(tag);
    if (pending === undefined) return;
    if (pending.cancelling) {
      await (pending.cancelPromise ?? Promise.resolve());
      return;
    }

    pending.cancelling = true;
    pending.cancelReason = reason;
    pending.cancelPromise = new Promise<void>((resolve) => {
      pending.onSettled = resolve;
    });
    this.zombies.add(tag);
    this.clearTimers(pending);

    try {
      await this.options.sendCancel(tag);
    } catch {
      // The connection reports write failures; cancellation still completes.
    }

    if (!this.pending.has(tag)) {
      await pending.cancelPromise;
      return;
    }

    this.startGraceTimer(pending);
    await pending.cancelPromise;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get zombieCount(): number {
    return this.zombies.size;
  }

  private async *streamImpl(
    words: readonly string[],
    options: { signal?: AbortSignal; highWaterMark?: number },
  ): AsyncGenerator<RosRecord> {
    this.assertUsable(options.signal);
    const tag = this.nextTag();
    const queue = new AsyncQueue<RosRecord>({
      highWaterMark: options.highWaterMark ?? this.options.streamHighWaterMark,
      onFull: () => this.options.setPaused?.(true),
      onDrain: () => this.options.setPaused?.(false),
    });
    const pending: Pending = {
      tag,
      streaming: true,
      records: [],
      queue,
      done: undefined,
      trap: undefined,
      cancelling: false,
      cancelReason: undefined,
      cancelPromise: undefined,
      onSettled: undefined,
      timer: undefined,
      graceTimer: undefined,
      signal: options.signal,
      abortListener: undefined,
      resolve: undefined,
      reject: undefined,
    };
    this.pending.set(tag, pending);

    try {
      await this.options.write([...words, `.tag=${tag}`]);
    } catch (error) {
      this.pending.delete(tag);
      throw error;
    }

    if (this.pending.has(tag)) {
      this.attachAbort(pending);
    }
    try {
      for await (const record of queue) {
        yield record;
      }
    } finally {
      this.detachAbort(pending);
      this.clearTimers(pending);
      if (this.pending.has(tag)) {
        await this.cancel(tag, new CancelledError('Stream closed by consumer'));
      }
    }
  }

  private assertUsable(signal?: AbortSignal): void {
    if (this.failed !== undefined) throw this.failed;
    if (signal?.aborted) {
      throw new CancelledError('Aborted before send', signal.reason);
    }
  }

  private nextTag(): string {
    this.counter += 1;
    return String(this.counter);
  }

  private hasCancelling(): boolean {
    for (const pending of this.pending.values()) {
      if (pending.cancelling) return true;
    }
    return false;
  }

  private startTimer(pending: Pending, timeoutMs: number): void {
    const timer = setTimeout(() => {
      if (!this.pending.has(pending.tag)) return;
      const error = new TimeoutError('Command timed out', 'command', timeoutMs);
      void this.cancel(pending.tag, error);
    }, timeoutMs);
    pending.timer = timer;
    timer.unref();
  }

  private startGraceTimer(pending: Pending): void {
    const timer = setTimeout(() => {
      this.finishCancelled(pending);
    }, this.options.cancelGraceMs);
    pending.graceTimer = timer;
    timer.unref();
  }

  private finishCancelled(pending: Pending): void {
    if (!this.pending.has(pending.tag)) return;
    this.pending.delete(pending.tag);
    this.clearTimers(pending);
    this.detachAbort(pending);
    pending.onSettled?.();
    const error =
      pending.cancelReason instanceof Error
        ? pending.cancelReason
        : new CancelledError('Command cancelled', pending.cancelReason);
    if (pending.queue !== undefined) pending.queue.fail(error);
    else pending.reject?.(error);
  }

  private finish(pending: Pending, done: RosRecord): void {
    if (!this.pending.has(pending.tag)) return;
    this.pending.delete(pending.tag);
    this.clearTimers(pending);
    this.detachAbort(pending);

    if (pending.trap !== undefined) {
      const error = new TrapError(
        pending.trap.category,
        pending.trap.message,
        done,
      );
      if (pending.queue !== undefined) pending.queue.fail(error);
      else pending.reject?.(error);
      return;
    }

    if (pending.queue !== undefined) {
      pending.done = done;
      pending.queue.close();
      return;
    }

    pending.resolve?.({ records: pending.records, done });
  }

  private attachAbort(pending: Pending): void {
    const signal = pending.signal;
    if (signal === undefined) return;
    const listener = (): void => {
      const reason =
        signal.reason === undefined
          ? new CancelledError('Command aborted')
          : new CancelledError('Command aborted', signal.reason);
      void this.cancel(pending.tag, reason);
    };
    pending.abortListener = listener;
    if (signal.aborted) listener();
    else signal.addEventListener('abort', listener, { once: true });
  }

  private detachAbort(pending: Pending): void {
    if (pending.signal !== undefined && pending.abortListener !== undefined) {
      pending.signal.removeEventListener('abort', pending.abortListener);
      pending.abortListener = undefined;
    }
  }

  private clearTimers(pending: Pending): void {
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
      pending.timer = undefined;
    }
    if (pending.graceTimer !== undefined) {
      clearTimeout(pending.graceTimer);
      pending.graceTimer = undefined;
    }
  }
}

function parseCategory(value: string | undefined): number {
  if (value === undefined) return -1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : -1;
}
