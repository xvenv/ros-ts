export type RouterOSErrorCode =
  | 'CONNECTION'
  | 'CLOSED'
  | 'PROTOCOL'
  | 'LOGIN'
  | 'TRAP'
  | 'FATAL'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'RECONNECT';

export class RouterOSError extends Error {
  readonly code: RouterOSErrorCode;

  constructor(code: RouterOSErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export interface ConnectionErrorDetails {
  readonly syscall?: string;
  readonly errno?: number;
  readonly cause?: unknown;
}

export class ConnectionError extends RouterOSError {
  readonly syscall: string | undefined;
  readonly errno: number | undefined;

  constructor(message: string, details: ConnectionErrorDetails = {}) {
    super(
      'CONNECTION',
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.syscall = details.syscall;
    this.errno = details.errno;
  }
}

export class ClosedError extends RouterOSError {
  constructor(message = 'Client is closed') {
    super('CLOSED', message);
  }
}

export class ProtocolError extends RouterOSError {
  readonly detail: string;

  constructor(detail: string) {
    super('PROTOCOL', detail);
    this.detail = detail;
  }
}

export class LoginError extends RouterOSError {
  constructor(message: string) {
    super('LOGIN', message);
  }
}

export class TrapError extends RouterOSError {
  readonly category: number;
  readonly trapMessage: string;
  readonly done: Readonly<Record<string, string>>;

  constructor(
    category: number,
    trapMessage: string,
    done: Readonly<Record<string, string>>,
  ) {
    super('TRAP', `RouterOS trap (category ${category}): ${trapMessage}`);
    this.category = category;
    this.trapMessage = trapMessage;
    this.done = done;
  }
}

export class FatalError extends RouterOSError {
  readonly reason: string;

  constructor(reason: string) {
    super('FATAL', reason);
    this.reason = reason;
  }
}

export type TimeoutPhase = 'connect' | 'command';

export class TimeoutError extends RouterOSError {
  readonly phase: TimeoutPhase;
  readonly timeoutMs: number;

  constructor(message: string, phase: TimeoutPhase, timeoutMs: number) {
    super('TIMEOUT', message);
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

export class CancelledError extends RouterOSError {
  readonly reason: unknown;

  constructor(message: string, reason?: unknown) {
    super('CANCELLED', message);
    this.reason = reason;
  }
}

/** Raised when a reconnect displaces pending work, rejects new work while a
 *  replacement is in progress, or refuses a concurrent reconnect. Code
 *  `'RECONNECT'`. */
export class ReconnectError extends RouterOSError {
  declare readonly code: 'RECONNECT';

  constructor(message = 'Connection replaced by reconnect') {
    super('RECONNECT', message);
  }
}
