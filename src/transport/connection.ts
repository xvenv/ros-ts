import { connect as netConnect, type Socket } from 'node:net';
import { type ConnectionOptions, connect as tlsConnect } from 'node:tls';

import {
  ClosedError,
  ConnectionError,
  FatalError,
  LoginError,
  ProtocolError,
  RouterOSError,
  TimeoutError,
} from '../errors.js';
import { encodeSentence } from '../protocol/codec.js';
import { StreamDecoder } from '../protocol/decoder.js';
import { type ParsedReply, parseReply } from '../protocol/sentence.js';
import type { ClientState, CommandResult, RosRecord } from '../types.js';
import { PauseCounter } from './pause-counter.js';
import { TagMux } from './tag-mux.js';
import { WriteQueue } from './write-queue.js';

export interface NativeConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean | ConnectionOptions;
  readonly user: string;
  readonly password: string;
  readonly encoding: 'utf8' | 'latin1';
  readonly timeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly keepAlive: boolean;
  readonly maxWordBytes: number;
  readonly streamHighWaterMark: number;
  readonly cancelGraceMs: number;
}

export class NativeConnection {
  private readonly options: Omit<NativeConnectionOptions, 'password'>;
  private readonly socket: Socket;
  private readonly decoder: StreamDecoder;
  private readonly writeQueue: WriteQueue;
  private readonly mux: TagMux;
  private readonly closedPromise: Promise<void>;
  private resolveClosed: (() => void) | undefined;
  private password: string | undefined;
  private stateValue: ClientState = 'idle';
  private loginResolve: (() => void) | undefined;
  private loginReject: ((error: Error) => void) | undefined;
  private connectTimer: NodeJS.Timeout | undefined;
  private failure: Error | undefined;
  private closedByUser = false;

  private constructor(
    options: NativeConnectionOptions,
    socket: Socket,
    password: string,
  ) {
    const { password: _password, ...rest } = options;
    this.options = rest;
    this.password = password;
    this.socket = socket;
    this.decoder = new StreamDecoder({
      maxWordBytes: options.maxWordBytes,
      encoding: options.encoding,
    });
    this.writeQueue = new WriteQueue(socket);
    this.closedPromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    const pauseCounter = new PauseCounter(
      () => this.socket.pause(),
      () => this.socket.resume(),
    );
    this.mux = new TagMux({
      timeoutMs: options.timeoutMs,
      cancelGraceMs: options.cancelGraceMs,
      streamHighWaterMark: options.streamHighWaterMark,
      write: (words) => this.writeQueue.write(this.encode(words)),
      sendCancel: (tag) =>
        this.writeQueue.write(this.encode(['/cancel', `=tag=${tag}`])),
      setPaused: (paused) => pauseCounter.update(paused),
      onFatal: (error) => this.fail(error, true),
      onProtocolError: (error) => this.fail(error, true),
    });

    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('error', (error: Error) => this.onSocketError(error));
    this.socket.on('end', () => this.onSocketEnd());
    this.socket.on('close', () => this.onSocketClose());
  }

  static async connect(
    options: NativeConnectionOptions,
  ): Promise<NativeConnection> {
    const socket =
      options.tls === false
        ? netConnect({ host: options.host, port: options.port })
        : tlsConnect({
            host: options.host,
            port: options.port,
            ...(typeof options.tls === 'object' ? options.tls : {}),
          });
    const connection = new NativeConnection(options, socket, options.password);
    await connection.open();
    return connection;
  }

  get state(): ClientState {
    return this.stateValue;
  }

  get closed(): Promise<void> {
    return this.closedPromise;
  }

  run(
    words: readonly string[],
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CommandResult> {
    if (this.stateValue !== 'ready') {
      return Promise.reject(this.unavailableError());
    }
    return this.mux.run(words, options);
  }

  stream(
    words: readonly string[],
    options: { signal?: AbortSignal; highWaterMark?: number } = {},
  ): AsyncIterable<RosRecord> {
    if (this.stateValue !== 'ready') {
      return this.failedIterable(this.unavailableError());
    }
    return this.mux.stream(words, options);
  }

  async close(): Promise<void> {
    if (this.stateValue === 'closed' || this.stateValue === 'closing') {
      await this.closedPromise;
      return;
    }
    this.closedByUser = true;
    this.stateValue = 'closing';
    const error = new ClosedError();
    this.mux.failAll(error);
    this.writeQueue.fail(error);
    this.loginReject?.(error);
    this.loginReject = undefined;
    this.socket.end();
    const timer = setTimeout(() => this.socket.destroy(), 1000);
    timer.unref();
    await this.closedPromise;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async open(): Promise<void> {
    this.stateValue = 'connecting';
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new TimeoutError(
            'Connect timed out',
            'connect',
            this.options.connectTimeoutMs,
          ),
        );
      }, this.options.connectTimeoutMs);
      this.connectTimer = timer;
      timer.unref();
    });

    try {
      await Promise.race([this.waitForConnect(), timeout]);
      this.socket.setNoDelay(true);
      this.socket.setKeepAlive(this.options.keepAlive);
      this.stateValue = 'logging-in';

      const login = new Promise<void>((resolve, reject) => {
        this.loginResolve = resolve;
        this.loginReject = reject;
      });

      const password = this.password ?? '';
      const words = [
        '/login',
        `=name=${this.options.user}`,
        `=password=${password}`,
      ];
      this.password = undefined;
      await this.writeQueue.write(this.encode(words));
      await Promise.race([login, timeout]);

      if (this.failure !== undefined) {
        throw this.failure;
      }

      this.stateValue = 'ready';
      if (this.connectTimer !== undefined) {
        clearTimeout(this.connectTimer);
        this.connectTimer = undefined;
      }
    } catch (error) {
      const wrapped =
        error instanceof RouterOSError
          ? error
          : new ConnectionError(
              error instanceof Error ? error.message : String(error),
              { cause: error },
            );
      this.fail(wrapped, true);
      throw wrapped;
    }
  }

  private waitForConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.options.tls === false) {
        this.socket.once('connect', () => resolve());
      } else {
        this.socket.once('secureConnect', () => resolve());
      }
      this.socket.once('error', (error: Error) => {
        const errno = (error as NodeJS.ErrnoException).errno;
        const syscall = (error as NodeJS.ErrnoException).syscall;
        const details: { cause: unknown; syscall?: string; errno?: number } = {
          cause: error,
        };
        if (typeof syscall === 'string') details.syscall = syscall;
        if (typeof errno === 'number') details.errno = errno;
        reject(new ConnectionError(error.message, details));
      });
    });
  }

  private encode(words: readonly string[]): Buffer {
    return encodeSentence(words, this.options.encoding);
  }

  private onData(chunk: Buffer): void {
    if (this.stateValue === 'closing' || this.stateValue === 'closed') return;
    let sentences: string[][];
    try {
      sentences = this.decoder.feed(chunk);
    } catch (error) {
      this.fail(
        error instanceof Error ? error : new ProtocolError(String(error)),
        true,
      );
      return;
    }

    for (const words of sentences) {
      try {
        this.handleReply(parseReply(words));
      } catch (error) {
        this.fail(
          error instanceof Error ? error : new ProtocolError(String(error)),
          true,
        );
        return;
      }
    }
  }

  private handleReply(reply: ParsedReply): void {
    if (this.stateValue === 'logging-in') {
      switch (reply.kind) {
        case 'done':
          this.stateValue = 'ready';
          this.loginResolve?.();
          this.loginResolve = undefined;
          this.loginReject = undefined;
          return;
        case 'trap':
          this.loginReject?.(
            new LoginError(reply.attributes.message ?? 'Login failed'),
          );
          this.loginReject = undefined;
          this.loginResolve = undefined;
          return;
        case 'fatal':
          this.loginReject?.(
            new FatalError(reply.fatalReason ?? 'RouterOS fatal error'),
          );
          this.loginReject = undefined;
          this.loginResolve = undefined;
          return;
        default:
          this.loginReject?.(
            new ProtocolError(`Unexpected ${reply.kind} reply during login`),
          );
          this.loginReject = undefined;
          this.loginResolve = undefined;
          return;
      }
    }

    if (this.stateValue === 'ready') {
      this.mux.route(reply);
    }
  }

  private onSocketError(error: Error): void {
    this.fail(
      error instanceof ConnectionError
        ? error
        : new ConnectionError(error.message, { cause: error }),
      false,
    );
  }

  private onSocketEnd(): void {
    if (this.stateValue === 'closing' || this.stateValue === 'closed') return;
    this.fail(new ConnectionError('Connection ended by peer'), false);
  }

  private onSocketClose(): void {
    if (this.stateValue !== 'closed') {
      const error =
        this.stateValue === 'closing'
          ? new ClosedError()
          : new ConnectionError('Connection closed');
      this.fail(error, false, true);
    }
    this.stateValue = 'closed';
    this.resolveClosed?.();
  }

  private fail(error: Error, destroySocket: boolean, closed = false): void {
    if (this.stateValue === 'closed') return;
    if (this.failure === undefined) this.failure = error;
    if (this.connectTimer !== undefined) {
      clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
    if (this.stateValue !== 'closing') this.stateValue = 'closing';
    this.mux.failAll(error);
    this.writeQueue.fail(error);
    this.loginReject?.(error);
    this.loginReject = undefined;
    if (destroySocket) this.socket.destroy();
    if (closed) {
      this.stateValue = 'closed';
      this.resolveClosed?.();
    }
  }

  private unavailableError(): Error {
    if (this.closedByUser) return new ClosedError();
    if (this.failure !== undefined) return this.failure;
    if (this.stateValue === 'closed' || this.stateValue === 'closing') {
      return new ConnectionError('Connection closed');
    }
    return new ConnectionError('Client is not ready');
  }

  private failedIterable(error: Error): AsyncIterable<RosRecord> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<RosRecord> => ({
        next: () => Promise.reject(error),
      }),
    };
  }
}
