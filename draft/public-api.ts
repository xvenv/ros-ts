/**
 * Draft public API types for the RouterOS native-API client.
 *
 * Type-level design artifact only: this file declares the intended public
 * surface and contains no runtime implementation. It is not yet part of a
 * build.
 *
 * Design invariants:
 * - Every value on the wire is a string.
 * - Typed records are a projection of the router schema, not a runtime
 *   guarantee. Unknown fields stay reachable through `raw()`.
 * - Paths, attribute keys, query keys, and `.proplist` keys are checked at
 *   compile time where the schema is known.
 * - The client is transport-agnostic internally, but v1 only ships the
 *   native (TCP/TLS) transport.
 *
 * @example
 * await using client = await RouterOS.connect({
 *   host: '192.168.88.1',
 *   user: 'admin',
 *   password: process.env.ROS_PASSWORD!,
 * });
 *
 * const rows = await client.call('/ip/address/print', {
 *   proplist: ['address', 'interface'],
 *   query: q => q.and(q.eq('interface', 'ether1'), q.absent('disabled')),
 * });
 */

import type { ConnectionOptions as NodeTlsOptions } from 'node:tls';

/* -------------------------------------------------------------------------- *
 * Wire values
 * -------------------------------------------------------------------------- */

/** Every value on the native API wire is a string. */
export type RosValue = string;

/** Lossless record returned by `raw()` and used for `!done` attributes. */
export type RosRecord = Readonly<Record<string, RosValue>>;

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
 * Query language
 * -------------------------------------------------------------------------- */

declare const queryExprBrand: unique symbol;

/**
 * Opaque query expression produced by {@link QueryBuilder}.
 * The builder compiles to the documented `?` and `?#ops` words.
 */
export interface QueryExpr {
  readonly [queryExprBrand]: true;
}

/**
 * Typed builder for RouterOS query words. Keys are constrained to the
 * record fields of the target command. Regex is not supported by RouterOS
 * and is deliberately absent.
 */
export interface QueryBuilder<K extends string> {
  eq(name: K, value: string): QueryExpr;
  lt(name: K, value: string): QueryExpr;
  gt(name: K, value: string): QueryExpr;
  exists(name: K): QueryExpr;
  absent(name: K): QueryExpr;
  not(expression: QueryExpr): QueryExpr;
  and(...expressions: readonly QueryExpr[]): QueryExpr;
  or(...expressions: readonly QueryExpr[]): QueryExpr;
  /** Escape hatch for raw query words, e.g. `['?#|!']`. */
  raw(words: readonly string[]): QueryExpr;
}

/**
 * Either a typed builder callback or a raw list of `?` words.
 * The callback form is preferred; the raw form exists for commands whose
 * keys are outside the pinned catalog.
 */
export type QuerySpec<K extends string> =
  | ((builder: QueryBuilder<K>) => QueryExpr)
  | readonly string[];

/* -------------------------------------------------------------------------- *
 * Call options
 * -------------------------------------------------------------------------- */

export interface CallBase {
  /** Cancels the command; rejects with {@link CancelledError}. */
  readonly signal?: AbortSignal;
  /** Per-command timeout. Defaults to `ConnectOptions.timeoutMs`. */
  readonly timeoutMs?: number;
}

export interface PrintOptions<Row> extends CallBase {
  /** Narrows the projected row type. */
  readonly proplist?: readonly (keyof Row & string)[];
  readonly query?: QuerySpec<keyof Row & string>;
}

export interface NarrowPrintOptions<
  Row,
  K extends keyof Row & string,
> extends CallBase {
  readonly proplist: readonly K[];
  readonly query?: QuerySpec<keyof Row & string>;
}

export type MutateOptions<Args extends object> = Args & CallBase;

export interface RawOptions extends CallBase {
  /** Attribute words without their `=` prefix. Flags use an empty string. */
  readonly attrs?: Readonly<Record<string, RosValue | number>>;
  /** Raw `?` words. */
  readonly query?: readonly string[];
  /** Raw `.proplist` entries. */
  readonly proplist?: readonly string[];
}

/** Streams run until cancelled, so they accept no command timeout. */
export interface StreamCallBase {
  /** Cancels the stream; rejects with {@link CancelledError}. */
  readonly signal?: AbortSignal;
}

export interface StreamOptions<Item> extends StreamCallBase {
  readonly proplist?: readonly (keyof Item & string)[];
  readonly query?: QuerySpec<keyof Item & string>;
  /** Buffered records before the underlying socket is paused. Default 1024. */
  readonly highWaterMark?: number;
}

export interface RawStreamOptions extends StreamCallBase {
  /** Attribute words without their `=` prefix. Flags use an empty string. */
  readonly attrs?: Readonly<Record<string, RosValue | number>>;
  /** Raw `?` words. */
  readonly query?: readonly string[];
  /** Raw `.proplist` entries. */
  readonly proplist?: readonly string[];
  /** Buffered records before the underlying socket is paused. Default 1024. */
  readonly highWaterMark?: number;
}

/* -------------------------------------------------------------------------- *
 * Results
 * -------------------------------------------------------------------------- */

/** Lossless result envelope used by `raw()`. */
export interface CommandResult<R = RosRecord> {
  /** All `!re` records, in arrival order. */
  readonly records: readonly R[];
  /** Attributes carried by the final `!done` (e.g. `ret`). */
  readonly done: RosRecord;
}

/* -------------------------------------------------------------------------- *
 * Command catalog
 * -------------------------------------------------------------------------- */

/**
 * Type-level command descriptor. Never instantiated; it exists so a
 * generated schema can replace `CoreCommands` without changing the API.
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
export type ArgsOf<D> = D extends MutateCommand<infer Args, unknown> ? Args : never;
export type ResultOf<D> = D extends MutateCommand<object, infer Result> ? Result : never;
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

export type CommandsOf<S extends SchemaShape> = S['commands'];
export type StreamsOf<S extends SchemaShape> = S['streams'];

export type CommandAt<S extends SchemaShape, P extends string> =
  CommandsOf<S>[P & keyof CommandsOf<S>];

export type StreamAt<S extends SchemaShape, P extends string> =
  StreamsOf<S>[P & keyof StreamsOf<S>];

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

/* -------------------------------------------------------------------------- *
 * Core schema subset (ROS 6.43+ / 7.x)
 * -------------------------------------------------------------------------- */

export interface InterfaceRecord {
  readonly '.id': string;
  readonly name: string;
  readonly type: string;
  readonly mtu?: string;
  readonly l2mtu?: string;
  readonly 'max-l2mtu'?: string;
  readonly 'mac-address'?: string;
  readonly running?: RosSwitch;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
  readonly 'rx-byte'?: string;
  readonly 'tx-byte'?: string;
}

/** `!re` event emitted by `/interface/listen`; `dead=yes` on removal. */
export interface InterfaceEvent extends InterfaceRecord {
  readonly dead?: RosFlag;
}

export interface EthernetRecord extends InterfaceRecord {
  readonly 'orig-mac-address'?: string;
  readonly arp?: string;
  readonly 'arp-timeout'?: string;
  readonly 'auto-negotiation'?: RosSwitch;
  readonly advertise?: string;
  readonly speed?: string;
  readonly 'tx-flow-control'?: RosSwitch;
  readonly 'rx-flow-control'?: RosSwitch;
  readonly 'fec-mode'?: string;
  readonly 'loop-protect'?: RosSwitch;
}

export interface BridgeRecord extends InterfaceRecord {
  readonly 'protocol-mode'?: string;
  readonly 'vlan-filtering'?: RosSwitch;
  readonly priority?: string;
  readonly 'auto-mac'?: RosSwitch;
  readonly 'admin-mac'?: string;
  readonly 'ageing-time'?: string;
  readonly 'forward-delay'?: string;
  readonly 'max-message-age'?: string;
  readonly 'igmp-snooping'?: RosSwitch;
  readonly 'fast-forward'?: RosSwitch;
}

export interface BridgePortRecord {
  readonly '.id': string;
  readonly bridge: string;
  readonly interface: string;
  readonly pvid?: string;
  readonly priority?: string;
  readonly 'path-cost'?: string;
  readonly edge?: string;
  readonly 'point-to-point'?: string;
  readonly learn?: string;
  readonly horizon?: string;
  readonly hw?: RosSwitch;
  readonly 'frame-types'?: string;
  readonly 'ingress-filtering'?: RosSwitch;
  readonly trusted?: RosSwitch;
  readonly disabled?: RosSwitch;
  readonly dynamic?: RosSwitch;
  readonly inactive?: RosSwitch;
  readonly comment?: string;
}

export interface VlanRecord extends InterfaceRecord {
  readonly 'vlan-id'?: string;
  readonly interface?: string;
  readonly 'use-service-tag'?: RosSwitch;
  readonly arp?: string;
  readonly 'arp-timeout'?: string;
}

export interface InterfaceListRecord {
  readonly '.id': string;
  readonly name: string;
  readonly include?: string;
  readonly exclude?: string;
  readonly comment?: string;
}

export interface IpAddressRecord {
  readonly '.id': string;
  readonly address: string;
  readonly network?: string;
  readonly interface: string;
  readonly disabled?: RosSwitch;
  readonly dynamic?: RosSwitch;
  readonly comment?: string;
}

export interface IpRouteRecord {
  readonly '.id': string;
  readonly 'dst-address': string;
  readonly gateway?: string;
  readonly distance?: string;
  readonly active?: RosSwitch;
  readonly static?: RosSwitch;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export interface DnsRecord {
  readonly servers?: string;
  readonly 'dynamic-servers'?: string;
  readonly 'allow-remote-requests'?: RosSwitch;
  readonly 'cache-size'?: string;
  readonly 'cache-used'?: string;
}

export interface IdentityRecord {
  readonly name: string;
}

export interface ResourceRecord {
  readonly version: string;
  readonly 'board-name'?: string;
  readonly 'architecture-name'?: string;
  readonly 'cpu-load'?: string;
  readonly 'free-memory'?: string;
  readonly 'total-memory'?: string;
  readonly uptime?: string;
}

export interface FirewallFilterRecord {
  readonly '.id': string;
  readonly chain: string;
  readonly action: string;
  readonly protocol?: string;
  readonly 'src-address'?: string;
  readonly 'dst-address'?: string;
  readonly 'dst-port'?: string;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export interface LogRecord {
  readonly '.id'?: string;
  readonly time: string;
  readonly topics: string;
  readonly message: string;
}

export interface QueueSimpleRecord {
  readonly '.id': string;
  readonly name: string;
  readonly target?: string;
  readonly dst?: string;
  readonly parent?: string;
  readonly 'max-limit'?: string;
  readonly 'limit-at'?: string;
  readonly 'burst-limit'?: string;
  readonly 'burst-threshold'?: string;
  readonly 'burst-time'?: string;
  readonly priority?: string;
  readonly queue?: string;
  readonly 'packet-marks'?: string;
  readonly disabled?: RosSwitch;
  readonly dynamic?: RosSwitch;
  readonly comment?: string;
  readonly bytes?: string;
  readonly packets?: string;
  readonly dropped?: string;
  readonly rate?: string;
  readonly 'packet-rate'?: string;
  readonly 'queued-bytes'?: string;
  readonly 'queued-packets'?: string;
}

export interface QueueTreeRecord {
  readonly '.id': string;
  readonly name: string;
  readonly parent?: string;
  readonly 'packet-mark'?: string;
  readonly 'max-limit'?: string;
  readonly 'limit-at'?: string;
  readonly 'burst-limit'?: string;
  readonly 'burst-threshold'?: string;
  readonly 'burst-time'?: string;
  readonly priority?: string;
  readonly queue?: string;
  readonly disabled?: RosSwitch;
  readonly dynamic?: RosSwitch;
  readonly comment?: string;
  readonly bytes?: string;
  readonly packets?: string;
  readonly dropped?: string;
  readonly rate?: string;
  readonly 'packet-rate'?: string;
  readonly 'queued-bytes'?: string;
  readonly 'queued-packets'?: string;
}

export interface QueueTypeRecord {
  readonly '.id': string;
  readonly name: string;
  readonly kind?: string;
  readonly 'pfifo-limit'?: string;
  readonly 'bfifo-limit'?: string;
  readonly 'pcq-rate'?: string;
  readonly 'pcq-limit'?: string;
  readonly 'pcq-classifier'?: string;
  readonly 'pcq-total-limit'?: string;
  readonly 'red-avg-packet'?: string;
  readonly 'red-burst'?: string;
  readonly 'red-limit'?: string;
  readonly 'red-min-threshold'?: string;
  readonly 'red-max-threshold'?: string;
  readonly 'sfq-allot'?: string;
  readonly 'sfq-perturb'?: string;
  readonly 'codel-limit'?: string;
  readonly 'codel-target'?: string;
  readonly 'fq-codel-limit'?: string;
  readonly 'cake-bandwidth'?: string;
  readonly 'cake-flowmode'?: string;
}

export interface QueueInterfaceRecord {
  readonly '.id'?: string;
  readonly interface: string;
  readonly queue?: string;
}

export interface NumbersArgs {
  readonly numbers: RosNumbers;
}

export interface AddressAddArgs {
  readonly address: string;
  readonly interface: string;
  readonly network?: string;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export interface AddressSetArgs extends NumbersArgs {
  readonly address?: string;
  readonly interface?: string;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export interface InterfaceSetArgs extends NumbersArgs {
  readonly name?: string;
  readonly mtu?: string | number;
  readonly l2mtu?: string | number;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export interface AddResult {
  readonly ret: string;
}

/* -------------------------------------------------------------------------- *
 * Interface catalog
 * -------------------------------------------------------------------------- */

export interface EthernetSetArgs extends NumbersArgs {
  readonly name?: string;
  readonly mtu?: string | number;
  readonly l2mtu?: string | number;
  readonly arp?: string;
  readonly 'arp-timeout'?: string;
  readonly 'auto-negotiation'?: RosSwitch;
  readonly advertise?: string;
  readonly speed?: string;
  readonly 'rx-flow-control'?: RosSwitch;
  readonly 'tx-flow-control'?: RosSwitch;
  readonly 'fec-mode'?: string;
  readonly 'loop-protect'?: RosSwitch;
  readonly 'loop-protect-disable-time'?: string;
  readonly 'loop-protect-send-interval'?: string;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export interface BridgeAddArgs {
  readonly name?: string;
  readonly mtu?: string | number;
  readonly 'protocol-mode'?: string;
  readonly 'vlan-filtering'?: RosSwitch;
  readonly priority?: string | number;
  readonly 'auto-mac'?: RosSwitch;
  readonly 'admin-mac'?: string;
  readonly 'ageing-time'?: string;
  readonly 'forward-delay'?: string;
  readonly 'max-message-age'?: string;
  readonly 'igmp-snooping'?: RosSwitch;
  readonly 'fast-forward'?: RosSwitch;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export type BridgeSetArgs = NumbersArgs & Partial<BridgeAddArgs>;

export interface BridgePortAddArgs {
  readonly bridge: string;
  readonly interface: string;
  readonly pvid?: string | number;
  readonly priority?: string | number;
  readonly 'path-cost'?: string | number;
  readonly edge?: string;
  readonly 'point-to-point'?: string;
  readonly learn?: string;
  readonly horizon?: string | number;
  readonly hw?: RosSwitch;
  readonly 'frame-types'?: string;
  readonly 'ingress-filtering'?: RosSwitch;
  readonly trusted?: RosSwitch;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export type BridgePortSetArgs = NumbersArgs & Partial<BridgePortAddArgs>;

export interface VlanAddArgs {
  readonly name: string;
  readonly interface: string;
  readonly 'vlan-id': string | number;
  readonly mtu?: string | number;
  readonly arp?: string;
  readonly 'arp-timeout'?: string;
  readonly 'use-service-tag'?: RosSwitch;
  readonly mvrp?: RosSwitch;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export type VlanSetArgs = NumbersArgs & Partial<VlanAddArgs>;

export interface InterfaceListAddArgs {
  readonly name: string;
  readonly include?: string;
  readonly exclude?: string;
  readonly comment?: string;
}

export type InterfaceListSetArgs = NumbersArgs & Partial<InterfaceListAddArgs>;

/**
 * Interface commands verified against RouterOS 7.24.5 inspect data.
 * Fields not listed here remain reachable through `raw()`.
 */
export interface InterfaceCommands {
  '/interface/print': PrintCommand<InterfaceRecord>;
  '/interface/set': MutateCommand<InterfaceSetArgs, void>;
  '/interface/enable': MutateCommand<NumbersArgs, void>;
  '/interface/disable': MutateCommand<NumbersArgs, void>;
  '/interface/reset-counters': MutateCommand<NumbersArgs, void>;

  '/interface/ethernet/print': PrintCommand<EthernetRecord>;
  '/interface/ethernet/set': MutateCommand<EthernetSetArgs, void>;
  '/interface/ethernet/enable': MutateCommand<NumbersArgs, void>;
  '/interface/ethernet/disable': MutateCommand<NumbersArgs, void>;

  '/interface/bridge/print': PrintCommand<BridgeRecord>;
  '/interface/bridge/add': MutateCommand<BridgeAddArgs, AddResult>;
  '/interface/bridge/set': MutateCommand<BridgeSetArgs, void>;
  '/interface/bridge/remove': MutateCommand<NumbersArgs, void>;
  '/interface/bridge/enable': MutateCommand<NumbersArgs, void>;
  '/interface/bridge/disable': MutateCommand<NumbersArgs, void>;

  '/interface/bridge/port/print': PrintCommand<BridgePortRecord>;
  '/interface/bridge/port/add': MutateCommand<BridgePortAddArgs, AddResult>;
  '/interface/bridge/port/set': MutateCommand<BridgePortSetArgs, void>;
  '/interface/bridge/port/remove': MutateCommand<NumbersArgs, void>;
  '/interface/bridge/port/enable': MutateCommand<NumbersArgs, void>;
  '/interface/bridge/port/disable': MutateCommand<NumbersArgs, void>;

  '/interface/vlan/print': PrintCommand<VlanRecord>;
  '/interface/vlan/add': MutateCommand<VlanAddArgs, AddResult>;
  '/interface/vlan/set': MutateCommand<VlanSetArgs, void>;
  '/interface/vlan/remove': MutateCommand<NumbersArgs, void>;
  '/interface/vlan/enable': MutateCommand<NumbersArgs, void>;
  '/interface/vlan/disable': MutateCommand<NumbersArgs, void>;

  '/interface/list/print': PrintCommand<InterfaceListRecord>;
  '/interface/list/add': MutateCommand<InterfaceListAddArgs, AddResult>;
  '/interface/list/set': MutateCommand<InterfaceListSetArgs, void>;
  '/interface/list/remove': MutateCommand<NumbersArgs, void>;
}

/* -------------------------------------------------------------------------- *
 * Queue catalog
 * -------------------------------------------------------------------------- */

export interface QueueSimpleAddArgs {
  readonly name: string;
  readonly target: string;
  readonly dst?: string;
  readonly parent?: string;
  readonly 'max-limit'?: string;
  readonly 'limit-at'?: string;
  readonly 'burst-limit'?: string;
  readonly 'burst-threshold'?: string;
  readonly 'burst-time'?: string;
  readonly priority?: string | number;
  readonly queue?: string;
  readonly 'packet-marks'?: string;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export type QueueSimpleSetArgs = NumbersArgs & Partial<QueueSimpleAddArgs>;

export interface QueueTreeAddArgs {
  readonly name: string;
  readonly parent: string;
  readonly 'packet-mark'?: string;
  readonly 'max-limit'?: string;
  readonly 'limit-at'?: string;
  readonly 'burst-limit'?: string;
  readonly 'burst-threshold'?: string;
  readonly 'burst-time'?: string;
  readonly priority?: string | number;
  readonly queue?: string;
  readonly disabled?: RosSwitch;
  readonly comment?: string;
}

export type QueueTreeSetArgs = NumbersArgs & Partial<QueueTreeAddArgs>;

export interface QueueTypeAddArgs {
  readonly name: string;
  readonly kind: string;
  readonly 'pfifo-limit'?: string | number;
  readonly 'bfifo-limit'?: string | number;
  readonly 'pcq-rate'?: string;
  readonly 'pcq-limit'?: string | number;
  readonly 'pcq-classifier'?: string;
  readonly 'pcq-total-limit'?: string | number;
  readonly 'red-avg-packet'?: string | number;
  readonly 'red-burst'?: string | number;
  readonly 'red-limit'?: string | number;
  readonly 'red-min-threshold'?: string | number;
  readonly 'red-max-threshold'?: string | number;
  readonly 'sfq-allot'?: string | number;
  readonly 'sfq-perturb'?: string | number;
  readonly 'codel-limit'?: string | number;
  readonly 'codel-target'?: string;
  readonly 'fq-codel-limit'?: string | number;
  readonly 'cake-bandwidth'?: string;
  readonly 'cake-flowmode'?: string;
}

export type QueueTypeSetArgs = NumbersArgs & Partial<QueueTypeAddArgs>;

export interface QueueInterfaceSetArgs extends NumbersArgs {
  readonly queue?: string;
}

/**
 * Queue commands verified against RouterOS 7.24.5 inspect data.
 * `/queue/monitor` is intentionally not typed; use `streamRaw()` until its
 * output fields are verified for both target versions.
 */
export interface QueueCommands {
  '/queue/simple/print': PrintCommand<QueueSimpleRecord>;
  '/queue/simple/add': MutateCommand<QueueSimpleAddArgs, AddResult>;
  '/queue/simple/set': MutateCommand<QueueSimpleSetArgs, void>;
  '/queue/simple/remove': MutateCommand<NumbersArgs, void>;
  '/queue/simple/enable': MutateCommand<NumbersArgs, void>;
  '/queue/simple/disable': MutateCommand<NumbersArgs, void>;
  '/queue/simple/reset-counters': MutateCommand<NumbersArgs, void>;

  '/queue/tree/print': PrintCommand<QueueTreeRecord>;
  '/queue/tree/add': MutateCommand<QueueTreeAddArgs, AddResult>;
  '/queue/tree/set': MutateCommand<QueueTreeSetArgs, void>;
  '/queue/tree/remove': MutateCommand<NumbersArgs, void>;
  '/queue/tree/enable': MutateCommand<NumbersArgs, void>;
  '/queue/tree/disable': MutateCommand<NumbersArgs, void>;
  '/queue/tree/reset-counters': MutateCommand<NumbersArgs, void>;

  '/queue/type/print': PrintCommand<QueueTypeRecord>;
  '/queue/type/add': MutateCommand<QueueTypeAddArgs, AddResult>;
  '/queue/type/set': MutateCommand<QueueTypeSetArgs, void>;
  '/queue/type/remove': MutateCommand<NumbersArgs, void>;

  '/queue/interface/print': PrintCommand<QueueInterfaceRecord>;
  '/queue/interface/set': MutateCommand<QueueInterfaceSetArgs, void>;
}

/**
 * v1 core catalog. Everything outside this map is reachable through
 * `raw()`/`streamRaw()` with lossless `RosRecord` results.
 */
export interface CoreCommands extends InterfaceCommands, QueueCommands {
  '/ip/address/print': PrintCommand<IpAddressRecord>;
  '/ip/address/add': MutateCommand<AddressAddArgs, AddResult>;
  '/ip/address/set': MutateCommand<AddressSetArgs, void>;
  '/ip/address/remove': MutateCommand<NumbersArgs, void>;
  '/ip/address/enable': MutateCommand<NumbersArgs, void>;
  '/ip/address/disable': MutateCommand<NumbersArgs, void>;
  '/ip/route/print': PrintCommand<IpRouteRecord>;
  '/ip/dns/print': PrintCommand<DnsRecord>;
  '/ip/firewall/filter/print': PrintCommand<FirewallFilterRecord>;
  '/system/identity/print': PrintCommand<IdentityRecord>;
  '/system/identity/set': MutateCommand<{ readonly name: string }, void>;
  '/system/resource/print': PrintCommand<ResourceRecord>;
  '/log/print': PrintCommand<LogRecord>;
}

export interface CoreStreams {
  '/interface/listen': StreamCommand<InterfaceEvent>;
  '/ip/address/listen': StreamCommand<IpAddressRecord>;
}

/**
 * Default schema. It is the common denominator verified for ROS 6.43+ and
 * 7.x; generated per-version schemas extend the same shape.
 */
export interface CoreSchema extends SchemaShape {
  readonly rosVersion: 'core';
  readonly commands: CoreCommands;
  readonly streams: CoreStreams;
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

/* -------------------------------------------------------------------------- *
 * Errors
 * -------------------------------------------------------------------------- */

export type RouterOSErrorCode =
  | 'CONNECTION'
  | 'CLOSED'
  | 'PROTOCOL'
  | 'LOGIN'
  | 'TRAP'
  | 'FATAL'
  | 'TIMEOUT'
  | 'CANCELLED';

/** Documented `!trap =category=` values; newer routers may add more. */
export type KnownTrapCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export declare class RouterOSError extends Error {
  readonly code: RouterOSErrorCode;
}

export declare class ConnectionError extends RouterOSError {
  readonly code: 'CONNECTION';
  readonly syscall?: string;
  readonly errno?: number;
}

/** The local side closed the client while the command was pending. */
export declare class ClosedError extends RouterOSError {
  readonly code: 'CLOSED';
}

/** Unrecoverable protocol desync; the connection is closed. */
export declare class ProtocolError extends RouterOSError {
  readonly code: 'PROTOCOL';
  readonly detail: string;
}

export declare class LoginError extends RouterOSError {
  readonly code: 'LOGIN';
}

export declare class TrapError extends RouterOSError {
  readonly code: 'TRAP';
  readonly category: KnownTrapCategory | number;
  readonly trapMessage: string;
  readonly done: RosRecord;
}

export declare class FatalError extends RouterOSError {
  readonly code: 'FATAL';
  readonly reason: string;
}

export declare class TimeoutError extends RouterOSError {
  readonly code: 'TIMEOUT';
  readonly phase: 'connect' | 'command';
  readonly timeoutMs: number;
}

export declare class CancelledError extends RouterOSError {
  readonly code: 'CANCELLED';
  readonly reason?: unknown;
}

/* -------------------------------------------------------------------------- *
 * Client
 * -------------------------------------------------------------------------- */

export type ClientState =
  | 'idle'
  | 'connecting'
  | 'logging-in'
  | 'ready'
  | 'closing'
  | 'closed';

export declare class RouterOS<S extends SchemaShape = CoreSchema> {
  private constructor();

  static connect<S extends SchemaShape = CoreSchema>(
    options: ConnectOptions,
  ): Promise<RouterOS<S>>;

  readonly state: ClientState;

  /** Resolves once the socket is fully closed, for any reason. */
  readonly closed: Promise<void>;

  call<
    P extends PrintPath<S>,
    K extends keyof RowOf<CommandAt<S, P>> & string,
  >(
    path: P,
    options: NarrowPrintOptions<RowOf<CommandAt<S, P>>, K>,
  ): Promise<readonly Pick<RowOf<CommandAt<S, P>>, K>[]>;

  call<P extends PrintPath<S>>(
    path: P,
    options?: PrintOptions<RowOf<CommandAt<S, P>>>,
  ): Promise<readonly RowOf<CommandAt<S, P>>[]>;

  call<P extends MutatePath<S>>(
    path: P,
    options: MutateOptions<ArgsOf<CommandAt<S, P>>>,
  ): Promise<ResultOf<CommandAt<S, P>>>;

  /** Lossless escape hatch. Throws on `!trap`, like `call()`. */
  raw(path: string, options?: RawOptions): Promise<CommandResult>;

  stream<P extends StreamPath<S>>(
    path: P,
    options?: StreamOptions<ItemOf<StreamAt<S, P>>>,
  ): AsyncIterable<ItemOf<StreamAt<S, P>>>;

  /** Lossless streaming escape hatch. */
  streamRaw(
    path: string,
    options?: RawStreamOptions,
  ): AsyncIterable<RosRecord>;

  /** Idempotent. Pending commands reject with {@link ClosedError}. */
  close(): Promise<void>;

  [Symbol.asyncDispose](): Promise<void>;
}
