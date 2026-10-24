import type * as root from '../src/index.js';
import type {
  CommandAt,
  EmptySchema,
  ItemOf,
  MutatePath,
  PrintPath,
  RosSwitch,
  RowOf,
  SchemaShape,
  StreamPath,
} from '../src/index.js';
import type {
  CoreCommands,
  CoreSchema,
  CoreStreams,
  InterfaceEvent,
} from './schema-example.js';

type CheckSchema = CoreSchema extends SchemaShape ? true : false;
const schemaCheck: CheckSchema = true;

// The catalog lives in the example module only. If a wildcard re-export ever
// comes back to the package root, the line below compiles, its directive goes
// unused, and the gate fails: the negative half of spec §8.4.
// @ts-expect-error the package root does not export the catalog
type UnreachableCatalog = root.CoreSchema;
const unreachableCatalog = null as unknown as UnreachableCatalog;

// The other half of spec §8.4 names an internal, not an example: a declared
// member of `src/transport/`, `src/protocol/`, or `src/client/` that the root
// does not re-export must stay unresolvable from it. Each line below has to
// compile the moment its name is published, or a different error would keep the
// directive "used" and the pin would prove nothing: `QueryBuilderImpl` is generic
// so it is spelled with its argument, and `compileQuery` is a value so it is
// named through `typeof`.
// @ts-expect-error the package root does not export the connection class
type UnreachableConnection = root.NativeConnection;
// @ts-expect-error the package root does not export the incremental decoder
type UnreachableDecoder = root.StreamDecoder;
// @ts-expect-error the package root does not export the builder implementation
type UnreachableBuilder = root.QueryBuilderImpl<string>;
// @ts-expect-error the package root does not export the query word compiler
type UnreachableCompiler = typeof root.compileQuery;
const unreachableInternals = null as unknown as [
  UnreachableConnection,
  UnreachableDecoder,
  UnreachableBuilder,
  UnreachableCompiler,
];

// `EmptySchema` is shipped so consumers can name the default; dropping it from
// `src/index.ts` breaks these two lines.
type CheckEmptySchema = EmptySchema extends SchemaShape ? true : false;
const emptySchemaCheck: CheckEmptySchema = true;

const printPath: PrintPath<CoreSchema> = '/ip/address/print';
const mutatePath: MutatePath<CoreSchema> = '/queue/simple/add';
const streamPath: StreamPath<CoreSchema> = '/interface/listen';

// @ts-expect-error '/system/reboot' is not in the core catalog
const unknownPath: PrintPath<CoreSchema> = '/system/reboot';

// `CommandAt` resolves a path to its descriptor, and must agree with the
// catalog member the schema declares in both directions.
const viaCommandAt: CommandAt<CoreSchema, '/ip/address/print'> =
  null as unknown as CoreCommands['/ip/address/print'];
const viaCatalogMember: CoreCommands['/ip/address/print'] = viaCommandAt;

type AddressRow = RowOf<CoreCommands['/ip/address/print']>;
const address = null as unknown as AddressRow;
const addressValue: string = address.address;

type ListenItem = ItemOf<CoreStreams['/interface/listen']>;
const event: ListenItem = { '.id': '*1', name: 'ether1', type: 'ether' };
const eventName: string = event.name;
const deadFlag: InterfaceEvent['dead'] = 'yes';

const switchValue: RosSwitch = 'true';
const switchValue2: RosSwitch = 'no';
// @ts-expect-error boolean-like fields are strings, not booleans
const badSwitch: RosSwitch = '1';

void schemaCheck;
void unreachableCatalog;
void unreachableInternals;
void emptySchemaCheck;
void printPath;
void mutatePath;
void streamPath;
void unknownPath;
void viaCommandAt;
void viaCatalogMember;
void addressValue;
void eventName;
void deadFlag;
void switchValue;
void switchValue2;
void badSwitch;
