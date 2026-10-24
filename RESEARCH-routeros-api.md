# Research: Type-Safe RouterOS Client for Node.js / TypeScript

Status: research complete, no code written yet.
Sources: official MikroTik docs (help.mikrotik.com + manual.mikrotik.com), GitHub CLI
(`gh search repos`, `gh api`), npm registry, Firecrawl/You.com scrapes. All facts below are
marked **Verified** (with source) or **Assumption** / **Unknown**.

---

## 1. Goal

Build a RouterOS API client for Node.js in TypeScript that is genuinely type-safe — not
`any`-casts over a socket. "Rapi" means: small tested core, generated types instead of
hand-typed menus, and no guessed APIs.

---

## 2. RouterOS exposes two programmatic interfaces

| | **Native API** | **REST API** |
|---|---|---|
| Transport | Raw TCP, proprietary binary framing | HTTP/1.1 + JSON |
| Ports | `8728` plain, `8729` TLS (API-SSL) | `443` (www-ssl) / `80` (www, since v7.9) |
| Available | RouterOS 3.x+ | **v7.1beta4+** |
| Auth | `/login` sentence, password in clear text | HTTP Basic |
| Shape | sentences/words, `!re`/`!done`/`!trap` | JSON list/object per HTTP method |
| Concurrency | Yes — `.tag=` multiplexing on one socket | One HTTP request per call |
| Streaming | Yes — `listen` never terminates | No; must use `once` |
| Cost | ~200 LOC codec | stdlib `fetch` |

Verified: help.mikrotik.com/docs/spaces/ROS/pages/47579160/API and .../47579162/REST+API;
manual.mikrotik.com/docs/developer-guides/rest-api/ (v7.26).

**Both are the same engine underneath.** The manual states REST is "a JSON wrapper of the
API: the web server logs in to the API as the authenticated user and runs each request as an
API command" (manual.mikrotik.com/docs/developer-guides/rest-api/, Verified).

### Decision drivers

- Native API is the only path for **`listen`** (live change streams) and for **many
  commands in flight on one connection** via `.tag=`.
- REST is far easier to debug (curl), needs no framing code, and works on any HTTP client,
  but cannot stream and has a documented **60-second** per-command limit.
- Recommended shape: **one protocol core (native API) behind a typed facade**, with REST as
  an optional second transport later. Keeping the codec pure makes this cheap.

---

## 3. Native API wire protocol (Verified — official API page, page-version 28, updated 2025-02-27)

### 3.1 Word length encoding

| Length range | Bytes | First-byte pattern |
|---|---|---|
| `0 <= len <= 0x7F` | 1 | `len` (lowest byte) |
| `0x80 <= len <= 0x3FFF` | 2 | `len \| 0x8000`, two lower bytes |
| `0x4000 <= len <= 0x1FFFFF` | 3 | `len \| 0xC00000`, three lower bytes |
| `0x200000 <= len <= 0xFFFFFFF` | 4 | `len \| 0xE0000000` |
| `len >= 0x10000000` | 5 | `0xF0` then `len` as four bytes |

- Length is a **byte count**, network (big-endian) order.
- Max encodable length is `0x7FFFFFFFFF`; only four-byte length is actually supported.
- **First byte `>= 0xF8` is a reserved control byte.** On receiving an unknown control byte
  the client cannot proceed — it does not know how many bytes follow. Currently unused, but
  a decoder must detect and fail loudly rather than desync.

### 3.2 Sentence and word types

A sentence is a sequence of words terminated by a **zero-length word** (`0x00`). The first
word must be the command. Word kinds are distinguished by their content prefix:

| Prefix | Kind | Example |
|---|---|---|
| `/` | command word | `/ip/address/add` |
| `=` | attribute word | `=address=10.0.0.1`, `=disabled=` (no value) |
| `.` | API attribute word | `.tag=2` (only `tag` today) |
| `?` | query word | `?type=ether` |
| `!` | reply word | `!re`, `!done`, `!trap` |

Notes:
- Attribute order must not be relied on; `.proplist` changes which/many are returned.
- Empty sentences are router-ignored. A sentence is processed only on the zero-length word.
- There is a limit on number/size of sentences a client may send **before** login.

### 3.3 Reply words

| Word | Meaning |
|---|---|
| `!re` | a data record |
| `!done` | **always** the last reply to a given command |
| `!trap` | error; carries `=message=` and often `=category=` |
| `!empty` | command succeeded with no data (introduced **RouterOS 7.18**) |
| `!fatal` | connection is being closed; carries a reason |

`!trap` `=category=` values: `0` missing item/command, `1` argument value failure,
`2` execution interrupted, `3` scripting failure, `4` general failure, `5` API failure,
`6` TTY failure, `7` value generated with `:return`.

> Design consequence: `!empty` only exists on 7.18+. A client targeting older RouterOS must
> treat "no `!re` before `!done`" as the empty case. This is a real version-dependent
> behavioral fork and belongs in the type layer as a documented union member.

### 3.4 Login (post-v6.43 — current)

```
>>> /login
>>> =name=admin
>>> =password=secret
>>> (zero-length word)
<<< !done
```

Plain text password on the wire. On error the reply carries `=message=`. Pre-v6.43
challenge-response (`=ret=` / `=response=`) is legacy; a clean modern client should target
v6.43+ only and document that floor.

### 3.5 Tags — concurrency on one socket

Including `.tag=<non-empty>` in a command makes every reply for that command carry the same
`.tag`. Empty/absent tag means untagged replies. `/cancel` with `=tag=` stops a running
command (itself reply `category=2`, `message=interrupted`). `/cancel` may carry its own
distinct `.tag`.

### 3.6 `listen` — streaming

Available wherever console `print` is (may not actually work everywhere). Emits `!re` as
items change; a deleted item emits `!re` with `=.dead=yes`. It **never terminates**; must be
stopped with `/cancel`.

### 3.7 Query language (the `?` words)

Evaluated left-to-right against a stack of booleans that starts infinite-`true`; if any
`false` remains at the end, the item is filtered out.

| Query | Effect |
|---|---|
| `?name` | true if property `name` has a value |
| `?-name` | true if property `name` has **no** value |
| `?name=x` / `?=name=x` | true if `name == x` |
| `?<name=x` | true if `name < x` |
| `?>name=x` | true if `name > x` |
| `?#ops` | stack machine over the booleans |

`?#ops` operations, evaluated left to right: digit run = stack index (top is 0); an index
followed by a char pushes a copy; index at end replaces all with that value; `!` negates top;
`&` and `|` pop two and push and/or; `.` after an index is a no-op, after another char copies
the top.

**Regular expressions are not supported** — do not emit `~`.

### 3.8 `.proplist` and `.oid`

`.proplist` is a comma-separated property list; its use is explicitly encouraged for
performance (omitting it can fetch slow fields such as file contents and perf counters).
Properties whose names end in `.oid` return SNMP OIDs when requested via `.proplist`.

---

## 4. REST API specifics worth knowing (Verified)

- HTTP method maps to console verb: `GET`→`print`, `PUT`→`add`, `PATCH`→`set`,
  `DELETE`→`remove`, `POST`→ any console command.
- `PUT` answers `201` + `Location`; `DELETE` answers `204 No Content`.
- **Every reply value is a string**, including numbers and booleans. Requests may send
  strings, numbers, or booleans — `"disabled":"yes"` and `"disabled":true` are equivalent.
- Flags without a value take an empty string: `"once":""`.
- The console's unnamed argument is `numbers`: `{"numbers":"ether2","once":""}`.
- `.proplist` and `.query` are special JSON keys in a `print` body; `.query` is a list of
  query words, e.g. `[".query":["type=ether","type=vlan","#|!"]]`.
- **60-second** limit on long commands; use `count`/`once` to bound them.
- No continuous `monitor` — use `once`.
- IDs start with `*`; the router does **not** decode `%2A`, so send `*` literally. Other
  reserved chars in names must be percent-encoded (`%20`, `%2F`).
- A menu without records (`/system/identity`, `/ip/dns`) returns one object, not a list.
- HTTP REST can be disabled server-side: `/ip/service/webserver/set rest-plain=no`.
- Least-privilege user group: `policy=read,api,rest-api`.
- Quirk: some 7.x versions return `text/plain; charset=utf-8` instead of
  `application/json` — parse the body as JSON regardless of content type.

---

## 5. Ecosystem survey (Verified — `gh search repos`, `gh api`, npm registry, 2026-10-22)

### JavaScript / TypeScript native-API clients

| Repo / npm | Stars | Language | Last push | Types? | Note |
|---|---|---|---|---|---|
| `aluisiora/node-routeros` (npm `routeros` 1.6.12) | 112 | JS | 2021-01-18 | `types: ./dist/index` | **ARCHIVED**. Most-starred JS client. |
| `aluisiora/routeros-client` | 78 | JS | 2021-01-18 | — | **ARCHIVED**. Abstraction over node-routeros. |
| `renomureza/routeros-node` | 17 | TS | 2022-07-29 | — | Stale. |
| `sparrow-code/ros-client` (npm `ros-client` 1.1.2) | 9 | TS | 2026-10-06 | **no `types` field** | Active-ish; 8728 + 8729. |
| `go-routeros/routeros` | 275 | Go | 2025-02-16 | n/a | **Linked from MikroTik's own docs** as a reference impl. MIT. |

npm registry, exact versions: `routeros` 1.6.12 (2025-03-07), `node-routeros` 1.6.9
(2021-01-18), `routeros-client` 1.1.2 (2021-01-18), `ros-client` 1.1.2 (2025-06-13),
`mikrotik-api` 0.3.0 (2026-09-08), `routeros-api` 1.0.2 (2025-08-14). **None** of these
except `routeros` declares a `types` field.

### Tooling that matters for the type layer

| Repo | Stars | What it gives us |
|---|---|---|
| `tikoci/restraml` | 73 | **Auto-generated schemas per RouterOS version**, built by GitHub Actions from live `/console/inspect`. Publishes `inspect.json` (1.0 MB), `deep-inspect.json` (5.2 MB), `openapi.json` (14 MB), `schema.raml` (7 MB). Versions 7.10.2 → 7.24.5. |
| `tikoci/rosetta` | 50 | RouterOS commands/docs/changelogs in SQLite-as-RAG, sourced from MikroTik. |
| `tikoci/centrs` | 5 | Bun/TS multi-protocol client. Explicitly a "friendly conduit, **not** a high-level configuration abstraction" — "you still speak RouterOS". |
| `AliKarami/MikroMCP` | 79 | MCP server for RouterOS + SwOS. |

### The gap

There is **no actively maintained, genuinely type-safe TypeScript RouterOS client**. The two
most-starred JS clients are archived (2021). The one active TS client (`ros-client`) ships no
`types` field. Everyone either hand-writes `any`-ish helpers or drops to raw `send([...])`.
Verified by the table above.

---

## 6. Key finding: where typed schemas can come from

`tikoci/restraml/docs/<version>/inspect.json` is raw `/console/inspect` output, fetched from
a real router by CI. Structure (Verified — downloaded 7.24.5, 1,052,699 bytes):

- Top level: a `dict` of **78** command roots. Includes real menus (`ip`, `ipv6`,
  `interface`, `queue`, `routing`, `system`, `user`, `tool`, `ppp`, `mpls`, `snmp`,
  `certificate`, `file`, `log`, `port`, `radius`, `execute`, `export`, `password`, ...) and
  scripting builtins (`if`, `for`, `foreach`, `while`, `do`, `len`, `put`, `tostr`, ...).
- Each node carries `"_type"` ∈ `cmd` | `path` | `dir` | `arg`.
- Leaf args may carry a `"desc"` string that documents the expected type, e.g.
  `"A.B.C.D    (IP address)"`, `"string value"`, `"time interval"`.

Verified sample — `/ip/address/add`:

```json
{ "_type": "cmd",
  "address":   { "_type": "arg", "desc": "A.B.C.D    (IP address)" },
  "broadcast": { "_type": "arg", "desc": "A.B.C.D    (IP address)" },
  "comment":   { "_type": "arg", "desc": "string value" },
  "copy-from": { "_type": "arg" },
  "disabled":  { "_type": "arg" },
  "interface": { "_type": "arg" },
  "netmask":   { "_type": "arg", "desc": "A.B.C.D    (IP address)" },
  "network":   { "_type": "arg", "desc": "A.B.C.D    (IP address)" } }
```

**This is the type-generation source.** It removes the entire class of "hand-typed 900
RouterOS menus and silently drifted" work, and it is versioned per RouterOS release, so a
client can pin types to the firmware it targets.

The `desc` strings give a coarse value-type hint (`A.B.C.D`, `string value`, `time
interval`, ...) but are **not a formal type system** — they are free text. Mapping them to
TS types is heuristic, so the generated types must stay permissive (see §7).

**Assumption:** `desc` coverage and vocabulary are consistent enough across versions to
derive a small set of value kinds (ip, ip-cidr, string, number, time, bool, list). Needs a
frequency count over `inspect.json` before committing to a mapping.

---

## 7. Proposed design

Four layers, each independently testable. Layer 1 has **zero dependencies** and needs no
router to test.

### Layer 1 — codec (pure functions)

`encodeWord(string) -> Buffer`, `decodeWords(Buffer) -> string[]`, `encodeSentence`,
`decodeSentence`. Handles the five length tiers, the `0xF8+` reserved-control-byte failure,
and the zero-length terminator. Unit-tested against byte-exact fixtures, including the
official examples above. This is the part that must never be `any`.

### Layer 2 — connection

`net.Socket` / `tls.connect`. Responsibilities:
- login handshake (v6.43+ plaintext), with the pre-6.43 path deliberately unsupported.
- sentence framing off a growing buffer (TCP has no message boundaries).
- `.tag=` multiplexing: `Map<tag, Pending>`; a reply routes by tag.
- `AsyncIterable` over `listen` streams; `/cancel` on break/unsubscribe.
- backpressure and idle-socket policy.

### Layer 3 — generated types

A codegen script reads `inspect.json` for a pinned RouterOS version and emits typed path
tables. Because `desc` is free text, generated attribute types must be **permissive**:
unknown or unmapped args fall back to `string`, never to `never`/`unknown` that blocks use.
Users pin a version, so types track the firmware they actually run.

### Layer 4 — typed facade

- Paths as template-literal types so `client.cmd('/ip/address/print')` type-checks the verb
  set for that menu.
- Replies as a **discriminated union on the reply word** — `{ kind: 're' } | { kind: 'done' }
  | { kind: 'trap', category, message } | { kind: 'empty' }` — so error handling is
  exhaustive-checked, not `if (err)`.
- Query builder typed to known attribute names, with the `?#ops` stack machine exposed but
  deliberately low-level (no regex, ever).
- `.proplist` accepted as a typed subset of the record's own keys, so narrowing the request
  narrows the response type.

### Non-goals (v1)

- Pre-v6.43 challenge-response login.
- High-level config abstractions (`createVlanOnBridge()`) — `centrs` deliberately rejects
  this shape, and it fights the "you still speak RouterOS" principle.
- REST transport (layer it in later; the pure codec makes this cheap).
- SNMP / RoMON / WinBox / MAC-Telnet.

---

## 8. Open questions before implementation

1. **Target RouterOS floor.** v6.43+ for plaintext login, v7.18+ for `!empty`. Which floor?
   This decides whether the reply union needs the "no `!re` before `!done`" fallback.
2. **Protocol priority.** Native API first (enables `listen` + tag multiplexing), or REST
   first (less code, curl-debuggable)? Recommendation is native API, REST later.
3. **Schema pinning strategy.** Ship generated types for one pinned version, or vendor
   `inspect.json` for several and let the consumer pick?
4. **`desc` → TS type mapping.** Needs a frequency count over `inspect.json` first
   (Assumption in §6).
5. **Escaping rules for attribute values.** How a value containing `=` or a newline is
   escaped on the wire is **not** covered in the official API page scraped here. The blog
   notes length-prefixing makes embedded `=` unambiguous, but the RouterOS backslash-escape
   convention needs separate verification. **Unknown — must verify before writing the
   codec.**
6. **Testing target.** A real router, or MikroTik CHR (free x86 VM)? `tikoci/quickchr`
   exists specifically to spin up a CHR for testing.

---

## 9. Sources

- Native API protocol — https://help.mikrotik.com/docs/spaces/ROS/pages/47579160/API
  (page version 28, updated 2025-02-27). Note: this site is frozen; new docs live at
  manual.mikrotik.com.
- REST API — https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST+API and
  https://manual.mikrotik.com/docs/developer-guides/rest-api/ (v7.26).
- Binary protocol walkthrough — Joe Karlsson, "Implementing MikroTik's Binary API Protocol
  in Python from Scratch" (2026-03-05). Independent confirmation of the length-encoding
  table.
- Schema source — https://github.com/tikoci/restraml, `docs/7.24.5/inspect.json`.
- Reference implementation linked by MikroTik's own docs —
  https://github.com/go-routeros/routeros (MIT, 275★).
- Ecosystem — `gh search repos`, `gh api repos/*/readme`, npm registry metadata, all
  queried 2026-10-22.
