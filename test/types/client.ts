import type {
  PrintCommand,
  RosSwitch,
  RowFor,
  SchemaShape,
  StreamCommand,
} from '../../src/index.js';
import { RouterOS } from '../../src/index.js';
import type { CoreSchema, CoreStreams, IpAddressRecord } from './schema-example.js';

async function typedUsage(): Promise<void> {
  await using client = await RouterOS.connect<CoreSchema>({
    host: '192.168.88.1',
    user: 'admin',
    password: 'secret',
  });

  const projected = await client.command('/ip/address/print', {
    proplist: ['address', 'interface'],
  });
  const address: string | undefined = projected.records[0]?.address;
  // `.proplist` is a wire projection only: the row type is the schema's record,
  // so a declared field is reachable even when it was not projected.
  const idField: string = projected.records[0]?.['.id'] ?? '';
  // @ts-expect-error 'name' is not on the ip address record
  void projected.records[0]?.name;
  // @ts-expect-error a proplist entry must be a field of the row
  await client.command('/ip/address/print', { proplist: ['nope'] });

  const full = await client.command('/ip/address/print');
  const interfaceName: string | undefined = full.records[0]?.interface;
  // @ts-expect-error unknown field on the catalog record
  void full.records[0]?.notAField;

  const added = await client.command('/ip/address/add', {
    attrs: { address: '10.0.0.1/24', interface: 'ether1' },
  });
  const ret: string = added.done.ret;

  await client.command('/ip/address/remove', { attrs: { numbers: ret } });
  await client.command('/queue/simple/add', {
    attrs: {
      name: 'q1',
      target: '192.0.2.1/32',
    },
  });

  // Documented non-check: `command()` takes the wire's own vocabulary, so
  // `attrs` keys are not resolved against any schema. A missing required
  // argument and an unknown key both compile here, and the router is what
  // answers them. The key-checked half of the surface is
  // `declaredSchemaChecksKeys` below; the unchecked half is
  // `undeclaredPathIsUnchecked`.
  await client.command('/queue/simple/add', {
    attrs: { name: 'q2', nope: 'x' },
  });

  // Any path compiles, cataloged or not; uncataloged rows fall back to the
  // lossless record.
  const reboot = await client.command('/system/reboot');
  const rebootRet: string | undefined = reboot.done.ret;

  for await (const event of client.stream('/interface/listen')) {
    // The schema declares this path as a stream, so items are that stream's
    // event type: required fields are promised and unknown fields are rejected.
    const name: string = event.name;
    // @ts-expect-error 'notAField' is not on the interface event
    void event.notAField;
    void name;
  }

  for await (const record of client.stream('/anything/listen')) {
    // A path no schema declares keeps the lossless RosRecord: any key is
    // reachable and reads may be absent.
    const anyKey: string | undefined = record.notAField;
    // @ts-expect-error the record row promises no field is present
    const required: string = record.name;
    void anyKey;
    void required;
  }

  // @ts-expect-error streams do not accept a command timeout
  void client.stream('/x/listen', { timeoutMs: 5 });

  const scriptRun = await client.command('/system/script/run', {
    attrs: { number: '0' },
  });
  const doneRet: string | undefined = scriptRun.done.ret;

  const flag: RosSwitch = 'false';
  void address;
  void idField;
  void interfaceName;
  void ret;
  void rebootRet;
  void doneRet;
  void flag;
}

interface CustomCatalog {
  '/custom/thing/print': PrintCommand<{
    readonly '.id': string;
    readonly value?: string;
  }>;
}

interface CustomSchema extends SchemaShape {
  readonly rosVersion: 'custom';
  readonly commands: CustomCatalog;
  readonly streams: CoreStreams;
}

async function customSchema(): Promise<void> {
  await using client = await RouterOS.connect<CustomSchema>({
    host: '192.168.88.1',
    user: 'admin',
    password: 'secret',
  });

  const custom = await client.command('/custom/thing/print');
  const value: string | undefined = custom.records[0]?.value;

  // A path this schema does not declare still compiles — `command()` is not
  // gated by the catalog — and its rows fall back to the lossless record, so
  // any key is reachable.
  const core = await client.command('/ip/address/print');
  const coreAnyKey: string | undefined = core.records[0]?.whatever;

  void value;
  void coreAnyKey;
}

void typedUsage;
void customSchema;

/** Rows of an interface submenu do not inherit the parent menu's attributes:
 *  live routers on 6.49.13 and 7.20.8 never send `type` there. */
async function submenuRowsDoNotPromiseParentFields(): Promise<void> {
  const client = await RouterOS.connect<CoreSchema>({
    host: 'h',
    user: 'u',
    password: 'p',
  });
  const ethernet = await client.command('/interface/ethernet/print');
  // @ts-expect-error /interface/ethernet/print never sends type (verified 6.49.13, 7.20.8)
  void ethernet.records[0]?.type;
  // @ts-expect-error it sends rx-bytes, not rx-byte
  void ethernet.records[0]?.['rx-byte'];

  const bridge = await client.command('/interface/bridge/print');
  // @ts-expect-error /interface/bridge/print never sends type
  void bridge.records[0]?.type;

  const vlan = await client.command('/interface/vlan/print');
  // @ts-expect-error /interface/vlan/print never sends type
  void vlan.records[0]?.type;
}

void submenuRowsDoNotPromiseParentFields;

/** The default schema types nothing, so a client built with no type argument
 *  promises nothing about any command: rows fall back to the lossless record. */
async function defaultSchemaPromisesNothing(): Promise<void> {
  const client = await RouterOS.connect({
    host: 'h',
    user: 'u',
    password: 'p',
  });
  const r = await client.command('/ip/address/print');
  // @ts-expect-error with no schema declared the row is RosRecord, not IpAddressRecord
  const typed: IpAddressRecord | undefined = r.records[0];
  const loose: string | undefined = r.records[0]?.address;

  // `/interface/listen` is a stream only for a schema that declares it. Under
  // the empty default `RowFor` falls through to the lossless record, so any key
  // is reachable and no key is promised.
  for await (const event of client.stream('/interface/listen')) {
    const anyKey: string | undefined = event.notAField;
    // @ts-expect-error no schema is declared, so nothing about the event is promised
    const promised: string = event.name;
    void anyKey;
    void promised;
  }

  void typed;
  void loose;
}

void defaultSchemaPromisesNothing;

/**
 * The checked half of spec §8.3: a schema that declares a path checks the keys
 * a command asks the router for, on both `query` and `proplist`, for both
 * `command()` and `stream()`.
 *
 * Keys only. The builder's value parameter is the wire's own `string`
 * (`src/client/query.ts:24`, `eq(name: K, value: string)`), so a field typed
 * `RosSwitch` still accepts `'maybe'`. That is a deliberate non-goal, not a
 * gap: the accepted sets differ per RouterOS version, so enum narrowing is
 * deferred to generated per-version schemas (the 2026-10-22 spec §7.2) while
 * the value stays the wire's — the price design spec §4.3 accepts for shipping
 * no catalog. The protocol documents `!trap` `=category=1` as an argument value
 * failure (`RESEARCH-routeros-api.md:95`); whether this exact typo traps or
 * simply matches nothing is not measured in this repository.
 */
async function declaredSchemaChecksKeys(): Promise<void> {
  const client = await RouterOS.connect<CoreSchema>({
    host: 'h',
    user: 'u',
    password: 'p',
  });

  // The positive control: these keys exist on IpAddressRecord, so the
  // rejections below discriminate on the key and not on the option shape.
  void client.command('/ip/address/print', {
    query: (query) => query.eq('interface', 'ether1'),
    proplist: ['address'],
  });

  // @ts-expect-error 'typ' is not a field of IpAddressRecord
  void client.command('/ip/address/print', { proplist: ['typ'] });

  void client.command('/ip/address/print', {
    // @ts-expect-error 'typ' is not a field of IpAddressRecord
    query: (query) => query.eq('typ', 'ether1'),
  });

  // The documented non-check on the value side: `disabled` is a `RosSwitch` in
  // the row, but the builder takes the wire's own string, so a value the router
  // will not accept still compiles. Proven unchecked — an `@ts-expect-error`
  // here is reported as an unused directive by `tsc`.
  void client.command('/ip/address/print', {
    query: (query) => query.eq('disabled', 'maybe'),
  });

  // A declared stream path checks its keys against the stream's item type.
  void client.stream('/interface/listen', { proplist: ['name'] });
  // @ts-expect-error 'typ' is not a field of InterfaceEvent
  void client.stream('/interface/listen', { proplist: ['typ'] });
  void client.stream('/interface/listen', {
    // @ts-expect-error 'typ' is not a field of InterfaceEvent
    query: (query) => query.eq('typ', 'ether1'),
  });
}

void declaredSchemaChecksKeys;

/**
 * The unchecked half of spec §8.3, pinned as a documented consequence: with no
 * schema declared the client has no vocabulary to check against, so a typo key
 * compiles on any path and the router's own reply decides the result. Nobody
 * may "fix" this by reinstating a catalog in the library — this block is the
 * regression test for that, and `test/unit/client/client.test.ts` proves the typo
 * still reaches the wire instead of being dropped or rewritten.
 */
async function undeclaredPathIsUnchecked(): Promise<void> {
  const client = await RouterOS.connect({
    host: 'h',
    user: 'u',
    password: 'p',
  });
  const r = await client.command('/ip/address/print', {
    query: (query) => query.eq('typ', 'ether1'),
    proplist: ['typ'],
  });
  const value: string | undefined = r.records[0]?.typ;
  void value;
}

void undeclaredPathIsUnchecked;

/**
 * Ruling on the catalog conflict Task 2 left open: when one schema declares the
 * same path in `commands` and in `streams`, the stream catalog wins, because
 * `RowFor` tests `StreamPath` first (`src/shared/types.ts`). `command()` resolves
 * through the same `RowFor`, so the print row is shadowed for both verbs. If the
 * precedence is ever inverted these pins fail: the stream field stops
 * resolving, the print field starts resolving, and the directives go unused.
 */
interface DualCommands {
  '/dual/print': PrintCommand<{ readonly onlyPrint: string }>;
}

interface DualStreams {
  '/dual/print': StreamCommand<{ readonly onlyStream: string }>;
}

interface DualSchema extends SchemaShape {
  readonly rosVersion: 'dual';
  readonly commands: DualCommands;
  readonly streams: DualStreams;
}

async function streamCatalogWinsADualDeclaredPath(): Promise<void> {
  const client = await RouterOS.connect<DualSchema>({
    host: 'h',
    user: 'u',
    password: 'p',
  });

  const dual: RowFor<DualSchema, '/dual/print'> = { onlyStream: 'winner' };
  // @ts-expect-error the print row is shadowed, so its field is not on the resolved row
  void dual.onlyPrint;

  const printed = await client.command('/dual/print');
  const streamField: string | undefined = printed.records[0]?.onlyStream;
  // @ts-expect-error command() resolves through the same RowFor, so the print row stays shadowed
  void printed.records[0]?.onlyPrint;
  // @ts-expect-error the checked keys come from the stream item, not the print row
  void client.command('/dual/print', { proplist: ['onlyPrint'] });

  void dual;
  void streamField;
}

void streamCatalogWinsADualDeclaredPath;

function reconnectRequiresOptions(client: RouterOS): void {
  const result: Promise<void> = client.reconnect({
    host: 'router.example.net',
    user: 'admin',
    password: 'secret',
  });
  void result;
  // @ts-expect-error reconnect requires connection options
  void client.reconnect();
}

void reconnectRequiresOptions;
