/**
 * README.md §Connect copies its block from this file; see `readme-commands.ts`
 * for the rule and for the two intended differences (the module specifier and
 * the `import` lines). The `BOOKKEEPING` line exists for the linter only and is
 * not part of any README block.
 */
import { RouterOS } from '../../src/index.js';

await using client = await RouterOS.connect({
  host: 'router.example.net',
  user: 'admin',
  password: process.env.ROS_PASSWORD ?? '',
  // port defaults to 8728, or 8729 when tls is enabled
});

// BOOKKEEPING: the README block ends with the connection; nothing here uses it.
void client;
