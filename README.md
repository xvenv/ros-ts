# @xvenv/ros-ts

Type-safe client for the MikroTik RouterOS **native API** over TCP 8728 or TLS 8729. ESM-only, zero runtime dependencies, Node 24+.

- One surface for every path: `command()` and `stream()`.
- Typed rows, mutation args, and query keys from schemas you declare.
- Tag multiplexing, cancellation, timeouts, backpressure, and manual reconnect.
- Native API only — not REST, SSH, SNMP, or the RouterOS CLI.
- No command catalog is shipped; you model the menus you use.

## Install

Not yet published. Once published:

```bash
npm install @xvenv/ros-ts
```

## Quick start

```ts
import { RouterOS } from '@xvenv/ros-ts';

await using client = await RouterOS.connect({
  host: 'router.example.net',
  user: 'admin',
  password: process.env.ROS_PASSWORD ?? '',
  // port defaults to 8728, or 8729 when tls is enabled
});
```

`RouterOS.connect()` is the only constructor. `await using` closes the client;
`close()` is idempotent. `state` is the lifecycle of the current connection
generation and reports `reconnecting` during `reconnect(options)`. `closed` is
generation-scoped and does not mean final termination.

`reconnect(options)` requires full options, closes the old connection first, and
rejects pending or newly issued work with `ReconnectError`. Streams are not
resubscribed; re-issue them after the reconnect.

TLS verifies certificates by default. Pass `tls: { ca }` for a private CA;
`tls: { rejectUnauthorized: false }` is explicit. Port 8728 sends the password in
plaintext; use TLS or a trusted management network.

## Commands

`host`, `user`, and `password` are the three from above:

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

- `attrs` sends `=key=value` words: strings, numbers, or string arrays; `''` is
  a flag.
- `proplist` sends the `.proplist=` projection.
- `query` is the builder (`eq`, `lt`, `gt`, `exists`, `absent`, `not`, `and`,
  `or`, `raw`) or a list of raw `?` words.
- `command()` takes `signal` and `timeoutMs`; `stream()` takes `signal` and
  `highWaterMark`, and no timeout.

`command()` resolves the lossless `{ records, done }` envelope. An `/add` reply
without `ret` rejects with `ProtocolError`. Wire values stay strings.

## Typed schemas

Declare the paths you use; nothing comes from a catalog:

```ts
import type { MutateCommand, PrintCommand, SchemaShape } from '@xvenv/ros-ts';
import { RouterOS } from '@xvenv/ros-ts';

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
// and `stream()` alike (pinned in `test/types/client.ts`).
// @ts-expect-error 'typ' is not a field of the declared row
void links.records[0]?.typ;
// @ts-expect-error 'typ' is not a field of the declared row
void wireless.command('/interface/wireless/print', { proplist: ['typ'] });
```

`streams: object` says the schema declares no streams; a path declared with
`StreamCommand<Item>` gives `stream()` that item type. `@ts-expect-error` proves
the key checks. Paths you do not declare stay open and return `RosRecord`.

A larger hand-written reference lives in `test/types/schema-example.ts`; it is an
example, not a shipped catalog.

## Good practices

- Prefer `interface` for object shapes; use `type` for unions and aliases.
- Keep fields `readonly` and wire values `string`; use `?` for fields that vary
  by version, never `!`.
- Model only the fields you use; do not extend `RosRecord` for a declared row.
- Keep print rows and mutation args separate.
- Use `RosSwitch`, `RosNumbers`, and `RosFlag` for their documented meanings.
- Keep one schema per RouterOS version or feature; `rosVersion` is a literal.
- `attrs` keys are not checked against the schema. Validate in your own wrapper
  if you need that.
- Pin the rejections you rely on with `@ts-expect-error` in your own type tests.

## What the types check

- Declared paths check `query` and `proplist` keys, on `command()` and
  `stream()`.
- `attrs` keys and query values are not checked; the wire vocabulary stays open.
- `.proplist` is a projection only; the returned row keeps the declared type.

## Streaming

```ts
let seen = 0;
for await (const event of client.stream('/interface/listen')) {
  console.log(event.name, event.dead);
  seen += 1;
  if (seen === 1) break; // sends /cancel and waits for !done
}
```

`stream()` takes the same `attrs`, `proplist`, and `query` options. `break`,
`return()`, or an aborted `signal` sends `/cancel` and waits for `!done`;
backpressure pauses the socket at `highWaterMark`.

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
├─ CancelledError    code 'CANCELLED'   (reason)
└─ ReconnectError    code 'RECONNECT'   (work displaced or attempted during reconnect)
```

```ts
import { TrapError } from '@xvenv/ros-ts';

try {
  await client.command('/ip/address/print');
} catch (error) {
  if (error instanceof TrapError) {
    console.error(error.category, error.trapMessage);
  }
}
```

A `!trap` never resolves a command. Peer, protocol, or fatal failures are sticky;
`ProtocolError` from a command's own reply check leaves the connection `ready`.
`ClosedError` is tied to a user `close()`; `ReconnectError` to a reconnect.

## Versions

- Target: RouterOS 6.43+ and 7.x.
- Live-verified: 6.49.13 and 7.20, read-only and write paths.
- Other versions are unverified; the client is not version-gated.
- Generated per-version schemas are planned for v2.

## Tests

```bash
npm test                  # unit and doc-parity tests (Vitest via Vite+)
npm run check             # format, lint, type-check, and type-tests
npm run build             # emit dist/ via vp pack
npm run pack:check        # npm pack --dry-run
npm run test:integration  # opt-in; needs ROS_HOST and ROS_USER
```

`npm run build` does not clean `dist/`; use `rm -rf dist && npm run build &&
npm run pack:check` before packing.

Integration tests are excluded from the default run unless `ROS_HOST` is set:

```bash
ROS_HOST=router.example.net ROS_USER=admin ROS_PASSWORD=secret \
  npm run test:integration
```

| Variable           | Meaning                                                 |
| ------------------ | ------------------------------------------------------- |
| `ROS_HOST`         | Router address, required to run                         |
| `ROS_PORT`         | API port; default 8728, or 8729 with TLS                |
| `ROS_USER`         | Login user, required to run                             |
| `ROS_PASSWORD`     | Login password; defaults to empty                       |
| `ROS_TLS`          | `1` enables TLS                                         |
| `ROS_TLS_INSECURE` | `1` sets `rejectUnauthorized: false`; test devices only |
| `ROS_TEST_WRITE`   | `1` enables the write subtests; test devices only       |

Start the routers with
`docker compose -f test/integration/docker-compose.yaml up -d`. State lives under
`.routeros-data/`, which is gitignored. The write subtests create a temporary
user, hotspot user, route, and queue, then remove them in `finally` blocks. Run
them only against a test device.

## References and thanks

- [node-routeros](https://github.com/aluisiora/node-routeros) — promise-based
  client; reconnection and stream behavior comparison.
- [mikronode](https://github.com/Trakkasure/mikronode) — channel-based client;
  framing and stream comparison.
- [routeros-client](https://github.com/aluisiora/routeros-client) — menu/model
  wrapper; compared and deliberately not adopted.
- [restraml](https://github.com/tikoci/restraml) — RouterOS 7 `inspect.json`
  captures used to verify schema fields.
- [routeros-api-php](https://github.com/EvilFreelancer/routeros-api-php) — PHP
  native-API implementation used as a protocol reference.
- [MikroTik RouterOS documentation](https://help.mikrotik.com/docs/) — native
  API protocol specification.

## License

MIT
