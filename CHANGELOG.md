# Changelog

## [Unreleased]

Breaking changes, documented as such rather than migrated from: the package is
pre-1.0 and `private: true`, never published, so no released surface exists to
alias or deprecate. Each entry below is a break in the type-level contract that
`0.1.0` described.

### Added

- `EmptySchema` enters the package's explicit public export list, so a consumer
  can name the default the client now carries instead of spelling the shape out.
  The entry is pinned by name in `types-test/public-api.ts`: removing it from
  `src/index.ts` fails the type-check gate rather than passing review.

### Changed

- `raw()` is renamed to `command()`. The method keeps `raw()`'s lossless
  `{ records, done }` envelope and its `attrs`, `proplist`, and `query` options,
  works on every path, and is now the only way to send attributes: where
  `call()` spread a command's arguments across the options object, `command()`
  keeps them in `attrs`, named after the `=key=value` words they emit.
- `call()` is removed, not aliased. Its three overloads (print, mutate,
  projection) are replaced by one `command(path, options)` whose options are
  named after the wire words they emit: `attrs`, `proplist`, `query`, plus
  `signal` and `timeoutMs`.
- `streamRaw()` is merged into `stream()`. `stream(path, options)` now accepts
  any path with the same `attrs`, `proplist`, and `query` options, keeps
  `signal` and `highWaterMark`, and still accepts no `timeoutMs` — a stream is
  ended by a cancel or by the router, not by a timer.
- The default schema is now empty. `RouterOS<S extends SchemaShape = EmptySchema>`
  and `connect<S>()` types no command at all, so `records` is
  `readonly RosRecord[]` and every field reads `string | undefined` until the
  consumer declares a schema. `CoreSchema` is no longer a default and no longer
  exists in the package.
- Projection narrowing is lost, deliberately. `call()` returned
  `Pick<Row, K>` for a `.proplist`; `command()` returns the row type the schema
  declares and only checks that each requested key exists, because a projection
  was a promise about what the router sends back.
- `attrs` keys are no longer resolved against a schema. `call()` spread the
  arguments across the options object, typed `Args & CallBase`, so a typo such
  as `nmae: 'x'` on a declared path was a compile error (TS2353, "Object literal
  may only specify known properties"). `command()` takes
  `attrs: Record<string, RosNumbers | number>`, which checks nothing about a key
  even on a path the schema declares: the router answers it, not the compiler.
  Pinned as a documented non-check in `types-test/client.ts`, whose
  `declaredSchemaChecksKeys` and `undeclaredPathIsUnchecked` hold the half that
  is still checked.
- An `/add` reply that carries no `ret` now rejects with `ProtocolError`
  instead of resolving. The old `raw()` returned that reply untouched inside the
  lossless envelope, and `raw()` no longer exists, so nothing bypasses the
  check: a ret-less `add` is a reply whose only promise — the new entry's id —
  the router did not keep. The rejection is the command's own, not a wire
  failure, so the connection stays `ready`; `command rejects an add reply that
  carries no ret` in `test/client/client.test.ts` pins both halves.
- The curated command catalog is no longer shipped or exported. It moves to
  `types-test/schema-example.ts` as a copyable, type-checked example of
  consumer-authored types; nothing in the package depends on it and it is not
  reachable from `mikrots`.
- The package-root type export list is explicit. `export type *` barrels are
  gone, so a new name in `src/types.ts` no longer becomes public by accident;
  the published list is now reviewable and pinned by
  `types-test/public-api.ts`.
- Per-command numeric options are validated at call time, as the connect-time
  ones always were. `command(path, { timeoutMs })` and
  `stream(path, { highWaterMark })` now throw `RangeError` for a value that is
  not positive (and, for `highWaterMark`, not an integer) instead of letting
  `setTimeout` clamp a negative or NaN delay to an immediate fire, or the record
  queue reject from the iterator's first `next()`.

## [0.1.0] - 2026-10-22 — unreleased baseline

Not a release: the package is `private: true`, never published, and no artifact
carrying these names exists to upgrade from. This section records the surface the
design spec described on 2026-10-22, so the entries above have one thing to break
against.

### Added

- Native API client for RouterOS 6.43+ and 7.x: TCP/TLS connection, login,
  per-connection tag multiplexing, and a typed `RouterOS` facade.
- Typed `call()` and `stream()` over the core command catalog, with
  `.proplist` result narrowing.
- Query builder (`eq`, `lt`, `gt`, `exists`, `absent`, `not`, `and`, `or`,
  `raw`) compiled to native `?` words.
- Streaming with bounded buffering and socket backpressure; `break` and aborts
  send `/cancel` and wait for `!done`.
- `raw()` and `streamRaw()` escape hatches that return lossless `{ records,
  done }` envelopes for paths outside the catalog.
- Cancellation via `AbortSignal`, per-command and connect timeouts, and
  graceful `close()` with `AsyncDisposable` support.
- Error hierarchy: `ConnectionError`, `ClosedError`, `ProtocolError`,
  `LoginError`, `TrapError`, `FatalError`, `TimeoutError`, `CancelledError`.
- Native API codec for all five length tiers, incremental decoding across TCP
  chunk boundaries, UTF-8 (default) and latin1 wire encodings, and a
  configurable 32 MiB word cap.
- Opt-in integration suite for a real router; read-only by default, write
  tests gated behind `ROS_TEST_WRITE=1` and cleaned up after each run.
