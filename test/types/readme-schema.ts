/**
 * README.md §Author your own types copies its block from this file; see
 * `readme-commands.ts` for the rule and for the two intended differences (the
 * module specifier and the `import` lines). The `BOOKKEEPING` lines exist for
 * the compiler and linter only and are not part of any README block.
 */
import type { MutateCommand, PrintCommand, SchemaShape } from '../../src/index.js';
import { RouterOS } from '../../src/index.js';

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

// BOOKKEEPING: `links` is only read by the negative check above.
void links;
