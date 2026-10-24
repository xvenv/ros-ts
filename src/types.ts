import type { ConnectionOptions as NodeTlsOptions } from 'node:tls';

import type { QuerySpec } from './client/query.js';

/** Every value on the native API wire is a string. */
export type RosValue = string;

/** Lossless key/value set exactly as read from the wire: the row for a path no
 *  schema declares, and the `!done` attributes of every command. */
export type RosRecord = Readonly<Record<string, RosValue>>;

/** Lossless result envelope `command()` resolves with. */
export interface CommandResult<R = RosRecord, Done = RosRecord> {
  /** All `!re` records, in arrival order. */
  readonly records: readonly R[];
  /** Attributes carried by the final `!done` (e.g. `ret`). */
  readonly done: Done;
}

/** Lifecycle state of one native API connection. */
export type ClientState =
  | 'idle'
  | 'connecting'
  | 'logging-in'
  | 'ready'
  | 'closing'
  | 'closed';

/* -------------------------------------------------------------------------- *
 * Wire values
 * -------------------------------------------------------------------------- */

/** RouterOS `yes`/`no` literal, verified for protocol events such as `dead=yes`. */
export type RosFlag = 'yes' | 'no';

/** Boolean-style value observed in RouterOS output captures. */
export type RosBool = 'true' | 'false';

/**
 * Boolean-like value accepted or returned across RouterOS versions.
 * Output fields have been observed as `true`/`false` while some protocol
 * events use `yes`/`no`; keep both until version-specific schemas exist.
 */
export type RosSwitch = RosFlag | RosBool;

/** One item or a list of items; lists are joined with commas on the wire. */
export type RosNumbers = string | readonly string[];

/* -------------------------------------------------------------------------- *
 * Command catalog
 * -------------------------------------------------------------------------- */

/**
 * Type-level command descriptor. Never instantiated; it exists so a generated
 * or hand-written schema can declare its own catalog without changing the API.
 */
export interface PrintCommand<Row> {
  readonly kind: 'print';
  readonly row: Row;
}

export interface MutateCommand<Args extends object, Result> {
  readonly kind: 'mutate';
  readonly args: Args;
  readonly result: Result;
}

export interface StreamCommand<Item> {
  readonly kind: 'stream';
  readonly item: Item;
}

export type RowOf<D> = D extends PrintCommand<infer Row> ? Row : never;
export type ArgsOf<D> =
  D extends MutateCommand<infer Args, unknown> ? Args : never;
export type ResultOf<D> =
  D extends MutateCommand<object, infer Result> ? Result : never;
export type ItemOf<D> = D extends StreamCommand<infer Item> ? Item : never;

/**
 * Type-level schema contract. Bundles the command and stream catalogs with
 * the RouterOS version they were derived from, so code generation produces
 * exactly one type argument for the client.
 */
export interface SchemaShape {
  readonly rosVersion: string;
  readonly commands: object;
  readonly streams: object;
}

/** Default schema: it types no commands, so the client promises nothing. */
export interface EmptySchema extends SchemaShape {
  readonly rosVersion: 'none';
  readonly commands: object;
  readonly streams: object;
}

export type CommandsOf<S extends SchemaShape> = S['commands'];
export type StreamsOf<S extends SchemaShape> = S['streams'];

export type CommandAt<
  S extends SchemaShape,
  P extends string,
> = CommandsOf<S>[P & keyof CommandsOf<S>];

export type StreamAt<S extends SchemaShape, P extends string> = StreamsOf<S>[P &
  keyof StreamsOf<S>];

export type PrintPath<S extends SchemaShape> = {
  [P in keyof CommandsOf<S>]: CommandsOf<S>[P] extends PrintCommand<unknown>
    ? P
    : never;
}[keyof CommandsOf<S>] &
  string;

export type MutatePath<S extends SchemaShape> = {
  [P in keyof CommandsOf<S>]: CommandsOf<S>[P] extends MutateCommand<
    object,
    unknown
  >
    ? P
    : never;
}[keyof CommandsOf<S>] &
  string;

export type StreamPath<S extends SchemaShape> = {
  [P in keyof StreamsOf<S>]: StreamsOf<S>[P] extends StreamCommand<unknown>
    ? P
    : never;
}[keyof StreamsOf<S>] &
  string;

/** The `!done` attributes a successful `add` is required to carry. */
export interface AddDone {
  readonly ret: string;
}

/** `add` replies are typed; every other verb keeps the lossless record shape. */
export type DoneFor<P extends string> = P extends `${string}/add`
  ? AddDone
  : RosRecord;

/** The row type for a path: the schema's item for a stream path, the
 *  schema's row for a print path, otherwise the lossless record. Resolves in
 *  that order, so a path no schema declares stays a `RosRecord`.
 *
 *  The stream catalog wins a conflict: a schema that declares one path in both
 *  `streams` and `commands` resolves to the stream item for `stream()` and for
 *  `command()` alike, because the stream branch is tested first. Pinned by
 *  `streamCatalogWinsADualDeclaredPath` in `types-test/client.ts`. */
export type RowFor<S extends SchemaShape, P extends string> =
  P extends StreamPath<S>
    ? ItemOf<StreamAt<S, P>>
    : P extends PrintPath<S>
      ? RowOf<CommandAt<S, P>>
      : RosRecord;

/* -------------------------------------------------------------------------- *
 * Command options
 * -------------------------------------------------------------------------- */

export interface CommandOptions<Row> {
  /** Attribute words without their `=` prefix. Flags use an empty string;
   *  a {@link RosNumbers} list is joined with commas on the wire. */
  readonly attrs?: Readonly<Record<string, RosNumbers | number>>;
  readonly proplist?: readonly (keyof Row & string)[];
  readonly query?: QuerySpec<keyof Row & string>;
  /** Cancels the command; rejects with {@link CancelledError}. */
  readonly signal?: AbortSignal;
  /** Per-command timeout. Defaults to `ConnectOptions.timeoutMs`. */
  readonly timeoutMs?: number;
}

/** Streams run until cancelled, so they accept no command timeout. */
export interface StreamCommandOptions<Row> {
  /** Cancels the stream; rejects with {@link CancelledError}. */
  readonly signal?: AbortSignal;
  /** Attribute words, exactly as {@link CommandOptions.attrs} states the rule. */
  readonly attrs?: Readonly<Record<string, RosNumbers | number>>;
  readonly proplist?: readonly (keyof Row & string)[];
  readonly query?: QuerySpec<keyof Row & string>;
  /** Buffered records before the underlying socket is paused. Default 1024. */
  readonly highWaterMark?: number;
}

/* -------------------------------------------------------------------------- *
 * Connection options
 * -------------------------------------------------------------------------- */

/** Node TLS options minus the fields the client owns. */
export type TLSOptions = Omit<NodeTlsOptions, 'host' | 'port'>;

export interface ConnectOptions {
  readonly host: string;
  /**
   * Defaults to 8728, or 8729 when `tls` is enabled. An explicit value
   * always wins.
   */
  readonly port?: number;
  readonly user: string;
  readonly password: string;
  /**
   * `true` or an options object enables TLS. Certificate verification is on
   * unless `rejectUnauthorized: false` is supplied explicitly.
   */
  readonly tls?: boolean | TLSOptions;
  /** Wire text encoding. Default 'utf8'. */
  readonly encoding?: 'utf8' | 'latin1';
  /** Default per-command timeout. Default 10_000 ms. */
  readonly timeoutMs?: number;
  /** Connection and login timeout. Default 10_000 ms. */
  readonly connectTimeoutMs?: number;
  /** TCP keepalive. Default true. */
  readonly keepAlive?: boolean;
  /** Hard limit on a single protocol word. Default 32 MiB. */
  readonly maxWordBytes?: number;
  /** Max buffered records per stream before pausing the socket. Default 1024. */
  readonly streamHighWaterMark?: number;
  /** Grace period for a cancelled command to receive `!done`. Default 2_000 ms. */
  readonly cancelGraceMs?: number;
}
