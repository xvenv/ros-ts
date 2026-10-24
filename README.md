# mikrots

Type-safe RouterOS native API client for Node.js 24+.

- Native API only, over TCP 8728 or TLS 8729.
- ESM-only, zero runtime dependencies.
- Strict TypeScript declarations; no `any` in the public surface.
- One command surface — `command()` and `stream()` — usable against any RouterOS
  path, typed by schemas you declare rather than by a catalog we ship.

The client speaks the RouterOS native API protocol directly: tag
multiplexing, `!trap`/`!done` handling, cancellation, and streaming. It does
not wrap REST, SNMP, or the RouterOS CLI, and it ships no command catalog:
which menus mean what is yours to declare, and the client does the checking
once you do.

Every TypeScript example on this page is copied from code the compiler checks
under `types-test/` (`readme-connect.ts`, `readme-commands.ts`,
`readme-schema.ts`). The `import` lines are the one exception: in the README
they name the published `mikrots` specifier and list only what that section
uses, while the checked files import from `../src/index.js`. Every other line
is byte-identical, and that rule is a gate rather than a convention:
`test/docs/readme-examples.test.ts` extracts each fenced block from this page and
requires it to be one contiguous run in a checked file, with a mutated copy that
has to stop matching. The three `bash` blocks and the unlabelled error tree are
this page's only other examples, and nothing compiles them: the tree mirrors the
classes and codes declared in `src/errors.ts`, and the install and run blocks
name the package and the scripts in `package.json`. That is as far as those two
files reach — the tree's `(connection closed by a wire failure)` annotation is a
runtime claim, held instead by `command rejects an add reply that carries no ret`
in `test/client/client.test.ts`, and the `ROS_*` names were read from
`test/integration/router.test.ts`.

## Install

Not yet published to npm (`private: true` until release). Once published:

```bash
npm install mikrots
```

## Connect

```ts
import { RouterOS } from 'mikrots';

await using client = await RouterOS.connect({
  host: 'router.example.net',
  user: 'admin',
  password: process.env.ROS_PASSWORD ?? '',
  // port defaults to 8728, or 8729 when tls is enabled
});
```

`RouterOS.connect()` is the only constructor. The client is `AsyncDisposable`,
so `await using` closes it when the scope exits; `await client.close()` works
too and is idempotent. `connect<S>()` takes the schema you declare; with no
type argument it defaults to `EmptySchema`, which types no command at all.

`client.state` is the connection's lifecycle state (`ClientState`: `idle`,
`connecting`, `logging-in`, `ready`, `closing`, `closed`), and `client.closed`
is a promise that resolves once the socket is fully closed, for any reason.

TLS verifies certificates by default. Pass `tls: { ca }` for a private CA;
turning verification off requires the explicit
`tls: { rejectUnauthorized: false }`. Port 8728 sends the password in
plaintext; use TLS or a trusted management network.

## Commands

`host`, `user`, and `password` are the three from the connection above:

```ts
await using client = await RouterOS.connect({ host, user, password });

const r = await client.command('/ip/address/print', {
  proplist: ['address', 'interface'],
  query: (q) => q.eq('interface', 'ether1'),
});
// r.records[0]?.address is string | undefined: no field is promised.

const added = await client.command('/ip/address/add', {
  attrs: { address: '10.0.0.1/24', interface: 'ether1' },
});
await client.command('/ip/address/remove', {
  attrs: { numbers: added.done.ret },
});
```

Options are named after the wire words they produce:

- `attrs` — `=key=value` words, with the keys written without their leading
  `=`. Values are `string`, `number` (stringified), or `readonly string[]`
  (joined with commas); a bare flag is an empty string, so `attrs: { once: '' }`
  sends `=once=`.
- `proplist` — the `.proplist=` projection.
- `query` — the builder (`eq`, `lt`, `gt`, `exists`, `absent`, `not`, `and`,
  `or`, `raw`) or a list of raw `?` words. The builder compiles to the
  documented postfix words and invents nothing else.
- `signal` and `timeoutMs` on `command()`. `stream()` takes `signal` and
  `highWaterMark` (default 1024 buffered records before the socket is paused)
  and no `timeoutMs`: a stream has no completion time, so only an abort or the
  router ends it.

`command()` resolves the lossless envelope `{ records, done }` — every `!re` in
arrival order, plus the attributes carried by the final `!done`. An `/add` reply
must carry `ret`; without it the command rejects with `ProtocolError` instead of
handing back a phantom id. Wire values stay strings: numbers are accepted on
input and nothing is coerced on output.

## What the types check

By default the client declares no schema (`EmptySchema`), so it promises nothing
about any path: `records` is `readonly RosRecord[]` and any field you name reads
`string | undefined`. The trade is stated rather than hidden: with no schema
declared, `query` and `proplist` keys are not checked — a typo compiles and the
router decides what it means. Declaring a schema is what buys the checking, and
the checking is of keys only:

- A declared path rejects a `query` or `proplist` key its row does not list, on
  `command()` and `stream()` alike.
- `attrs` keys are never resolved against a schema: `command()` takes the wire's
  own vocabulary.
- Query **values** are never checked. `q.eq('disabled', 'maybe')` compiles,
  because the builder's value parameter is the wire's own `string`
  (`src/client/query.ts:21`). This is a deliberate non-goal, not a gap: the
  accepted sets differ per RouterOS version, so enum narrowing is deferred to
  per-version generated schemas (the 2026-10-22 spec §7.2) and the client keeps
  the wire's vocabulary in the meantime (design spec §4.3).
- `.proplist` is a projection only. The old `call()` returned `Pick<Row, K>`;
  `command()` returns the row your schema declares, so a field you did not
  project is still reachable from it.

Both halves are pinned in `types-test/client.ts` — `declaredSchemaChecksKeys`
and `undeclaredPathIsUnchecked` — so reinstating a shipped catalog silently
would fail the type-check gate instead of passing a review.

## Author your own types

Declaring your own types turns the checking on, for the menus you actually use.
The block below is the whole cost, and nothing in it comes from a catalog:

```ts
import type { MutateCommand, PrintCommand, SchemaShape } from 'mikrots';
import { RouterOS } from 'mikrots';

interface WirelessCatalog {
  '/interface/wireless/print': PrintCommand<{
    readonly '.id': string;
    readonly name: string;
  }>;
  '/interface/wireless/set': MutateCommand<
    { readonly numbers: string; readonly 'channel-frequency'?: string },
    void
  >;
}

interface WirelessSchema extends SchemaShape {
  readonly rosVersion: 'my-7.20';
  readonly commands: WirelessCatalog;
  readonly streams: object;
}

await using wireless = await RouterOS.connect<WirelessSchema>({
  host: 'router.example.net',
  user: 'admin',
  password: process.env.ROS_PASSWORD ?? '',
});
const links = await wireless.command('/interface/wireless/print', {
  proplist: ['name'],
  query: (q) => q.eq('name', 'wlan1'),
});
// Declaring the row buys two things: the type you get back, and a rejection of
// any key the schema does not list, on `proplist`, on `query`, on `command()`
// and `stream()` alike (pinned in `types-test/client.ts`).
// @ts-expect-error 'typ' is not a field of the declared row
void links.records[0]?.typ;
// @ts-expect-error 'typ' is not a field of the declared row
void wireless.command('/interface/wireless/print', { proplist: ['typ'] });
```

`streams: object` says this schema declares no streams; a path you declare with
`StreamCommand<Item>` gives `stream()` that item type. The two
`@ts-expect-error` lines are the point of the whole section: each marks a
rejection the compiler actually reports, so this block is checked in
`types-test/readme-schema.ts` and a key `typ` cannot slip past a schema that
does not list it.

`types-test/schema-example.ts` is the copyable reference for a larger hand-written
schema: 64 commands (17 print, 47 mutate) and 2 streams across the interface,
queue, IP, system, and log menus, with their record and argument types. **It is
an example, not a shipped catalog.** It lives in the type-check directory,
nothing in `mikrots` depends on it, and it is not exported from the package; its
header states which parts were verified and how.

## Streaming

```ts
let seen = 0;
for await (const event of client.stream('/interface/listen')) {
  console.log(event.name, event.dead);
  seen += 1;
  if (seen === 1) break; // sends /cancel and waits for !done
}
```

`stream()` is `command()` for a path that keeps replying: the same `attrs`,
`proplist`, and `query` options, any path, and the item type your schema declares
for it (`RosRecord` while nothing declares it). `break`, `return()`, and an
aborted `signal` cancel the command; `!done` ends the iterator normally.

## Errors

```
RouterOSError
├─ ConnectionError   code 'CONNECTION'
├─ ClosedError       code 'CLOSED'
├─ ProtocolError     code 'PROTOCOL'    (connection closed by a wire failure)
├─ LoginError        code 'LOGIN'
├─ TrapError         code 'TRAP'        (category, trapMessage, done)
├─ FatalError        code 'FATAL'       (reason)
├─ TimeoutError      code 'TIMEOUT'     (phase: connect | command)
└─ CancelledError    code 'CANCELLED'   (reason)
```

```ts
import { TrapError } from 'mikrots';

try {
  await client.command('/ip/address/print');
} catch (error) {
  if (error instanceof TrapError) {
    console.error(error.category, error.trapMessage);
  }
}
```

A `!trap` reply never resolves a command. After a peer, protocol, or fatal
failure, later commands on the same client reject with the recorded terminal
error instead of reconnecting. `ClosedError` is tied to a user `close()`:
pending commands reject with it, and so do commands made afterwards.

That closure is the wire path only. `ProtocolError` raised while decoding a
sentence or routing a reply closes the connection; `ProtocolError` raised by a
command's own reply check — the ret-less `/add` above — rejects that command and
leaves the connection `ready`, so unrelated in-flight commands are unaffected.
The state is pinned after the rejection in
`command rejects an add reply that carries no ret`
(`test/client/client.test.ts`).

## Supported versions

The package ships no catalog, so there is no curated record type that could be
wrong on some version: what is verified is the protocol behaviour the client
depends on.

- Target: RouterOS 6.43+ and 7.x (6.43 is where the current login handshake
  starts).
- RouterOS 6.49.13: **verified live**, read-only and write paths.
- RouterOS 7.20.8: **verified live**, read-only and write paths, including the
  cancelled-listen `!empty`/`!done` reply order.
- Any other version is unverified: nothing in the client is version-gated, so it
  speaks the documented protocol everywhere.
- Generated per-version schemas are planned for v2 and are not part of this
  release.
- Paths a schema does not declare stay open: their row is the lossless
  `RosRecord`, so any key you name reads `string | undefined`. Inside a path you
  *did* declare, a field its row omits is not reachable — declare the field, or
  leave that path out of the schema.

## Tests

```bash
npm test             # unit and contract tests
npm run typecheck    # source, tests, and compile-time type tests
npm run lint         # Biome formatting, import order, and lint rules
npm run check        # typecheck + lint + test
npm run build        # emit dist/; never cleans it
npm run pack:check   # npm pack --dry-run; review the file list
```

`npm run build` does not clean `dist/`, so the pack gate is honest only as
`rm -rf dist && npm run build && npm run pack:check` — otherwise a file some
later task deleted can still sit in the packed list.

Integration tests are opt-in and skip when `ROS_HOST` and `ROS_USER` are
absent:

```bash
ROS_HOST=router.example.net ROS_USER=admin ROS_PASSWORD=secret \
  npm run test:integration
```

| Variable | Meaning |
|---|---|
| `ROS_HOST` | Router address, required to run |
| `ROS_PORT` | API port; default 8728, or 8729 with TLS |
| `ROS_USER` | Login user, required to run |
| `ROS_PASSWORD` | Login password; defaults to empty |
| `ROS_TLS` | `1` enables TLS |
| `ROS_TLS_INSECURE` | `1` sets `rejectUnauthorized: false`; test devices only |
| `ROS_TEST_WRITE` | `1` enables the write subtest; dedicated test devices only |

The default run is read-only. The write subtest creates a
`mikrots-test-<uuid>` simple queue, checks a UTF-8 comment and rate update,
and removes the queue in a `finally` block. Run it only against a test
device, never production.

## License

MIT
