import {
  type ClientState,
  ClosedError,
  type CommandOptions,
  type CommandResult,
  type ConnectOptions,
  type DoneFor,
  type EmptySchema,
  ProtocolError,
  ReconnectError,
  type RowFor,
  type RosNumbers,
  type SchemaShape,
  type StreamCommandOptions,
} from '../shared/index.js';
import { NativeConnection, type NativeConnectionOptions } from '../transport/index.js';
import { compileQuerySpec } from './query.js';

export class RouterOS<S extends SchemaShape = EmptySchema> {
  private connection: NativeConnection;
  private closedByUser = false;
  private reconnectInProgress: Promise<void> | undefined;
  private reconnectAbort: AbortController | undefined;
  private terminalFailure: Error | undefined;

  private constructor(connection: NativeConnection) {
    this.connection = connection;
  }

  static async connect<S extends SchemaShape = EmptySchema>(
    options: ConnectOptions,
  ): Promise<RouterOS<S>> {
    const connection = await NativeConnection.connect(normalizeConnectOptions(options));
    return new RouterOS<S>(connection);
  }

  get state(): ClientState {
    if (this.reconnectInProgress !== undefined) return 'reconnecting';
    if (this.terminalFailure !== undefined) return 'closed';
    return this.connection.state;
  }

  get closed(): Promise<void> {
    return this.connection.closed;
  }

  /** Runs `path` with wire-shaped options: `attrs` become `=key=value` words,
   *  `proplist` and `query` become projection words, and the reply resolves as
   *  the lossless `{ records, done }` envelope. Rows keep the consumer's schema
   *  type when it knows the path; an `add` reply without `ret` rejects with
   *  {@link ProtocolError}. */
  command<P extends string>(
    path: P,
    options?: CommandOptions<RowFor<S, P>>,
  ): Promise<CommandResult<RowFor<S, P>, DoneFor<P>>> {
    if (this.reconnectInProgress !== undefined) {
      return Promise.reject(new ReconnectError('Reconnecting'));
    }
    if (this.terminalFailure !== undefined) {
      return Promise.reject(this.terminalFailure);
    }
    const words = buildWords(path, options as CommandOptions<string> | undefined);
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs;
    // Checked here, not only at connect time: an unvalidated value reaches
    // `setTimeout` as-is, and Node clamps a negative or NaN delay to an
    // immediate fire, so the command would time out before the router saw it.
    validatePositiveNumber('timeoutMs', timeoutMs);
    return this.connection
      .run(words, {
        ...(signal !== undefined ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      })
      .then((result) => requireAddDone<RowFor<S, P>, DoneFor<P>>(path, result));
  }

  /** Runs `path` as a stream — `command()` for a path that keeps replying, with
   *  the same `attrs`, `proplist`, and `query` options and the item type the
   *  schema declares for the path. Takes no `timeoutMs`: a stream has no
   *  completion time, so only the router or the caller ends it. `!done` closes
   *  the iteration normally; `break`, `return()`, or an aborted `signal` send
   *  `/cancel` and wait for that `!done`. `highWaterMark` bounds how many
   *  records buffer (default 1024) before the socket is paused. */
  stream<P extends string>(
    path: P,
    options?: StreamCommandOptions<RowFor<S, P>>,
  ): AsyncIterable<RowFor<S, P>> {
    if (this.reconnectInProgress !== undefined) {
      return failedIterable<RowFor<S, P>>(new ReconnectError('Reconnecting'));
    }
    if (this.terminalFailure !== undefined) {
      return failedIterable<RowFor<S, P>>(this.terminalFailure);
    }
    const words = buildWords(path, options as CommandOptions<string> | undefined);
    const signal = options?.signal;
    const highWaterMark = options?.highWaterMark;
    // Checked at call time, not when the first record is requested: the queue
    // that validates it is built inside the generator, so an invalid bound
    // would otherwise surface as a rejection from `next()` far from the call.
    validatePositiveInteger('highWaterMark', highWaterMark);
    return this.connection.stream(words, {
      ...(signal !== undefined ? { signal } : {}),
      ...(highWaterMark !== undefined ? { highWaterMark } : {}),
    }) as AsyncIterable<RowFor<S, P>>;
  }

  async reconnect(options: ConnectOptions): Promise<void> {
    if (this.closedByUser) throw new ClosedError();
    if (this.reconnectInProgress !== undefined) {
      throw new ReconnectError('Reconnect already in progress');
    }
    const normalized = normalizeConnectOptions(options);
    const controller = new AbortController();
    const operation = this.performReconnect(normalized, controller.signal);
    this.reconnectInProgress = operation;
    this.reconnectAbort = controller;
    try {
      await operation;
    } finally {
      if (this.reconnectInProgress === operation) {
        this.reconnectInProgress = undefined;
      }
      if (this.reconnectAbort === controller) {
        this.reconnectAbort = undefined;
      }
    }
  }

  private async performReconnect(
    options: NativeConnectionOptions,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.connection.close(
        new ReconnectError('Connection replaced by reconnect'),
      );
      if (this.closedByUser) throw new ClosedError();
      const next = await NativeConnection.connect(options, signal);
      if (this.closedByUser) {
        await next.close(new ClosedError());
        throw new ClosedError();
      }
      this.connection = next;
      this.terminalFailure = undefined;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.terminalFailure = failure;
      throw failure;
    }
  }

  async close(): Promise<void> {
    this.closedByUser = true;
    this.reconnectAbort?.abort();
    const reconnect = this.reconnectInProgress;
    try {
      await this.connection.close();
    } finally {
      if (reconnect !== undefined) await reconnect.catch(() => undefined);
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

/** Builds the wire words for `command()` and `stream()`: attribute words first,
 *  then the projection words, in the order RouterOS expects. */
function buildWords(
  path: string,
  options: CommandOptions<string> | undefined,
): string[] {
  const words = [path];
  if (options?.attrs !== undefined) {
    for (const [key, value] of Object.entries(options.attrs)) {
      appendAttribute(words, key, value);
    }
  }
  if (options?.proplist !== undefined) {
    // A JavaScript caller may hand a bare string or a number here, so the shape
    // is checked before any array method is reached; both failures report the
    // same declared message.
    if (
      !Array.isArray(options.proplist) ||
      !options.proplist.every((entry) => typeof entry === 'string')
    ) {
      throw new TypeError('proplist must be an array of strings');
    }
    words.push(`.proplist=${options.proplist.join(',')}`);
  }
  if (options?.query !== undefined) {
    words.push(...compileQuerySpec(options.query));
  }
  return words;
}

/** The transport envelope is lossless and stringly typed; this is the single
 *  place a command's row and `!done` types are claimed from it. The claim is
 *  checked where it can be: an `add` reply must carry `ret`, so a ret-less add
 *  rejects instead of handing back a phantom id. */
function requireAddDone<Row, Done>(
  path: string,
  result: CommandResult,
): CommandResult<Row, Done> {
  if (path.endsWith('/add') && typeof result.done.ret !== 'string') {
    throw new ProtocolError(`Command ${path} finished without ret`);
  }
  return result as CommandResult<Row, Done>;
}

function appendAttribute(
  words: string[],
  key: string,
  value: RosNumbers | number | undefined,
): void {
  if (value === undefined) return;
  if (key === '' || key.startsWith('.') || key.includes('=')) {
    throw new TypeError(`Invalid attribute key: ${key}`);
  }
  if (Array.isArray(value)) {
    words.push(`=${key}=${value.map((entry) => String(entry)).join(',')}`);
    return;
  }
  words.push(`=${key}=${String(value)}`);
}

function normalizeConnectOptions(options: ConnectOptions): NativeConnectionOptions {
  validateConnectOptions(options);
  const tls = options.tls ?? false;
  const port = options.port ?? (tls === false ? 8728 : 8729);
  return {
    host: options.host,
    port,
    tls,
    user: options.user,
    password: options.password,
    encoding: options.encoding ?? 'utf8',
    timeoutMs: options.timeoutMs ?? 10_000,
    connectTimeoutMs: options.connectTimeoutMs ?? 10_000,
    keepAlive: options.keepAlive ?? true,
    maxWordBytes: options.maxWordBytes ?? 32 * 1024 * 1024,
    streamHighWaterMark: options.streamHighWaterMark ?? 1024,
    cancelGraceMs: options.cancelGraceMs ?? 2_000,
  };
}

function failedIterable<T>(error: Error): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: (): AsyncIterator<T> => ({
      next: () => Promise.reject(error),
    }),
  };
}

function validateConnectOptions(options: ConnectOptions): void {
  if (typeof options.host !== 'string' || options.host.length === 0) {
    throw new TypeError('host must be a non-empty string');
  }
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
  ) {
    throw new RangeError('port must be an integer between 1 and 65535');
  }
  if (typeof options.user !== 'string') {
    throw new TypeError('user must be a string');
  }
  if (typeof options.password !== 'string') {
    throw new TypeError('password must be a string');
  }
  if (
    options.tls !== undefined &&
    options.tls !== null &&
    typeof options.tls !== 'boolean' &&
    typeof options.tls !== 'object'
  ) {
    throw new TypeError('tls must be a boolean or a TLS options object');
  }
  if (options.tls === null) {
    throw new TypeError('tls must not be null');
  }
  validatePositiveNumber('timeoutMs', options.timeoutMs);
  validatePositiveNumber('connectTimeoutMs', options.connectTimeoutMs);
  validatePositiveInteger('maxWordBytes', options.maxWordBytes);
  validatePositiveInteger('streamHighWaterMark', options.streamHighWaterMark);
  if (
    options.cancelGraceMs !== undefined &&
    (!Number.isFinite(options.cancelGraceMs) || options.cancelGraceMs < 0)
  ) {
    throw new RangeError('cancelGraceMs must be a finite number >= 0');
  }
  if (
    options.encoding !== undefined &&
    options.encoding !== 'utf8' &&
    options.encoding !== 'latin1'
  ) {
    throw new TypeError("encoding must be 'utf8' or 'latin1'");
  }
}

function validatePositiveNumber(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`${name} must be a finite number > 0`);
  }
}

function validatePositiveInteger(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new RangeError(`${name} must be an integer > 0`);
  }
}
