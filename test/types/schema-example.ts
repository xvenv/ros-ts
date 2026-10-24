/**
 * The schema example README links: a hand-written catalog for one operator's
 * routers. It is an example, not a shipped catalog — not published in the
 * package, not exported from `@xvenv/ros-ts`, not exhaustive, and nothing in the
 * client depends on it. Copy this shape into your own project and keep only the
 * menus you use; the import below names this repo's source files, and in your
 * project the same names come from `@xvenv/ros-ts`.
 *
 * What "verified" means for this file, stated at the level the evidence
 * supports:
 *
 * - Command paths and the typed argument interfaces were checked field-by-field
 *   against the RouterOS 7.24.5 `inspect.json` in the `tikoci/restraml` tree.
 *   That tree is not vendored here, so this is a recorded check, not one a
 *   fresh clone can rerun.
 *   Where this file composes a type out of another
 *   (`type BridgeSetArgs = NumbersArgs & Partial<BridgeAddArgs>`), the
 *   composition is derived from a verified interface, not separately verified.
 * - Record fields: only `/interface/print` and the interface submenu records
 *   (`EthernetRecord`, `BridgeRecord`, `VlanRecord`) were adjudicated against
 *   live replies on RouterOS 6.49.13 and 7.20.8. Every other record field is a
 *   conservative projection of the schema source, never compared to a reply, so
 *   treat it as a name you can ask for, not as a promise the router sends it.
 * - An `add` reply is typed with the shipped `AddDone` (`src/shared/types.ts`), not a
 *   second local copy: `command()` already resolves every `/add` path to it, so
 *   declaring `{ ret: string }` again here would teach the copied rule to
 *   diverge from the shipped one.
 */
import type {
  AddDone,
  MutateCommand,
  PrintCommand,
  RosFlag,
  RosNumbers,
  RosSwitch,
  SchemaShape,
  StreamCommand,
} from '../../src/index.js';

/* -------------------------------------------------------------------------- *
 * Records
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

/** Attributes `/interface/print` sends but its submenus do not (verified
 * 6.49.13 and 7.20.8, spec §7.2): the submenu replies omit them entirely. */
type InterfaceRowBase = Omit<
  InterfaceRecord,
  'type' | 'max-l2mtu' | 'rx-byte' | 'tx-byte'
>;

export interface EthernetRecord extends InterfaceRowBase {
  readonly 'orig-mac-address'?: string;
  readonly arp?: string;
  readonly 'arp-timeout'?: string;
  readonly 'auto-negotiation'?: RosSwitch;
  readonly advertise?: string;
  readonly speed?: string;
  readonly 'tx-flow-control'?: RosSwitch;
  readonly 'rx-flow-control'?: RosSwitch;
  readonly 'fec-mode'?: string;
  readonly 'loop-protect'?: string;
  readonly 'rx-bytes'?: string;
  readonly 'tx-bytes'?: string;
}

export interface BridgeRecord extends InterfaceRowBase {
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

export interface VlanRecord extends InterfaceRowBase {
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

/* -------------------------------------------------------------------------- *
 * Arguments
 * -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- *
 * Catalog
 * -------------------------------------------------------------------------- */

/**
 * Interface commands. Fields not listed here are still on the wire; the row
 * type only omits them.
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
  '/interface/bridge/add': MutateCommand<BridgeAddArgs, AddDone>;
  '/interface/bridge/set': MutateCommand<BridgeSetArgs, void>;
  '/interface/bridge/remove': MutateCommand<NumbersArgs, void>;
  '/interface/bridge/enable': MutateCommand<NumbersArgs, void>;
  '/interface/bridge/disable': MutateCommand<NumbersArgs, void>;

  '/interface/bridge/port/print': PrintCommand<BridgePortRecord>;
  '/interface/bridge/port/add': MutateCommand<BridgePortAddArgs, AddDone>;
  '/interface/bridge/port/set': MutateCommand<BridgePortSetArgs, void>;
  '/interface/bridge/port/remove': MutateCommand<NumbersArgs, void>;
  '/interface/bridge/port/enable': MutateCommand<NumbersArgs, void>;
  '/interface/bridge/port/disable': MutateCommand<NumbersArgs, void>;

  '/interface/vlan/print': PrintCommand<VlanRecord>;
  '/interface/vlan/add': MutateCommand<VlanAddArgs, AddDone>;
  '/interface/vlan/set': MutateCommand<VlanSetArgs, void>;
  '/interface/vlan/remove': MutateCommand<NumbersArgs, void>;
  '/interface/vlan/enable': MutateCommand<NumbersArgs, void>;
  '/interface/vlan/disable': MutateCommand<NumbersArgs, void>;

  '/interface/list/print': PrintCommand<InterfaceListRecord>;
  '/interface/list/add': MutateCommand<InterfaceListAddArgs, AddDone>;
  '/interface/list/set': MutateCommand<InterfaceListSetArgs, void>;
  '/interface/list/remove': MutateCommand<NumbersArgs, void>;
}

/**
 * Queue commands. `/queue/monitor` is intentionally not typed; stream it with
 * `stream()` until its output fields are verified for both target versions.
 */
export interface QueueCommands {
  '/queue/simple/print': PrintCommand<QueueSimpleRecord>;
  '/queue/simple/add': MutateCommand<QueueSimpleAddArgs, AddDone>;
  '/queue/simple/set': MutateCommand<QueueSimpleSetArgs, void>;
  '/queue/simple/remove': MutateCommand<NumbersArgs, void>;
  '/queue/simple/enable': MutateCommand<NumbersArgs, void>;
  '/queue/simple/disable': MutateCommand<NumbersArgs, void>;
  '/queue/simple/reset-counters': MutateCommand<NumbersArgs, void>;

  '/queue/tree/print': PrintCommand<QueueTreeRecord>;
  '/queue/tree/add': MutateCommand<QueueTreeAddArgs, AddDone>;
  '/queue/tree/set': MutateCommand<QueueTreeSetArgs, void>;
  '/queue/tree/remove': MutateCommand<NumbersArgs, void>;
  '/queue/tree/enable': MutateCommand<NumbersArgs, void>;
  '/queue/tree/disable': MutateCommand<NumbersArgs, void>;
  '/queue/tree/reset-counters': MutateCommand<NumbersArgs, void>;

  '/queue/type/print': PrintCommand<QueueTypeRecord>;
  '/queue/type/add': MutateCommand<QueueTypeAddArgs, AddDone>;
  '/queue/type/set': MutateCommand<QueueTypeSetArgs, void>;
  '/queue/type/remove': MutateCommand<NumbersArgs, void>;

  '/queue/interface/print': PrintCommand<QueueInterfaceRecord>;
  '/queue/interface/set': MutateCommand<QueueInterfaceSetArgs, void>;
}

/**
 * The example catalog. Everything outside this map is reachable through
 * `command()`/`stream()` with lossless `RosRecord` results.
 */
export interface CoreCommands extends InterfaceCommands, QueueCommands {
  '/ip/address/print': PrintCommand<IpAddressRecord>;
  '/ip/address/add': MutateCommand<AddressAddArgs, AddDone>;
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
 * Catalog schema for this example. It is not the client default: `RouterOS`
 * defaults to `EmptySchema`, so pass this as the type argument when you want
 * typed rows. Generated per-version schemas extend the same shape.
 */
export interface CoreSchema extends SchemaShape {
  readonly rosVersion: 'core';
  readonly commands: CoreCommands;
  readonly streams: CoreStreams;
}
