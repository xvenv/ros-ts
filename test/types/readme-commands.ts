/**
 * README.md §Commands, §Streaming, and §Errors copy their blocks from this
 * file so a README example cannot ship broken (design spec §8.5; the sibling
 * files `readme-connect.ts` and `readme-schema.ts` hold the rest). Every line
 * is byte-identical except the `import` lines: README names the published
 * `ros-ts` specifier and lists only what that section uses, while this file
 * merges the imports into one `../src/index.js` statement. Lines marked
 * `SCAFFOLDING` or `BOOKKEEPING` hold the blocks together for the compiler and
 * the linter and are not part of any README block.
 */
import { RouterOS, TrapError } from '../../src/index.js';

// SCAFFOLDING: README §Connect introduces these three with literal values.
const host = 'router.example.net';
const user = 'admin';
const password = process.env.ROS_PASSWORD ?? '';

// README §Commands — the headline example.
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

// README §Streaming.
let seen = 0;
for await (const event of client.stream('/interface/listen')) {
  console.log(event.name, event.dead);
  seen += 1;
  if (seen === 1) break; // sends /cancel and waits for !done
}

// README §Errors.
try {
  await client.command('/ip/address/print');
} catch (error) {
  if (error instanceof TrapError) {
    console.error(error.category, error.trapMessage);
  }
}

// BOOKKEEPING: the README blocks above end mid-expression; the declarations
// they produce have no later consumer inside this file.
void r;
void seen;
