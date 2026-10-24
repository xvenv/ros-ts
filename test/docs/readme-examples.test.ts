import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import { fileURLToPath } from 'node:url';

/** README claims every TypeScript example on the page is a byte-identical copy
 *  of code the compiler checks under `test/types/` (design spec §8.5). That rule
 *  was enforced only by a throwaway script outside the repo, so this file is the
 *  gate: each fenced `ts` block here must appear, line for line and in order, as
 *  one contiguous run inside a `test/types/readme-*.ts` file. */

/** Lines the README and the checked files declare as intentionally different: the
 *  `import` statements (README names the published `ros-ts` specifier, the
 *  checked files name `../src/index.js`), and the marker comments that label a
 *  region for a reader of the checked file. Nothing else may differ, and blank
 *  lines are kept, so the run is byte-identical rather than merely equivalent. */
const NON_COPIED_PATTERNS: readonly RegExp[] = [
  /^import(?: |$)/,
  /^\s*\/\/\s*(?:README §|SCAFFOLDING|BOOKKEEPING)/,
];

const CHECKED_DIR = new URL('../types/', import.meta.url);

function isNonCopied(line: string): boolean {
  return NON_COPIED_PATTERNS.some((pattern) => pattern.test(line));
}

function readmeTsBlocks(markdown: string): string[][] {
  const blocks: string[][] = [];
  let open: string[] | undefined;
  for (const line of markdown.split('\n')) {
    const fence = line.trim();
    if (open === undefined) {
      if (fence === '```ts') open = [];
      continue;
    }
    if (fence === '```') {
      blocks.push(open);
      open = undefined;
      continue;
    }
    open.push(line);
  }
  if (open !== undefined) {
    throw new Error('README ends inside an unterminated TypeScript fence');
  }
  return blocks;
}

function checkedFileNames(): string[] {
  return readdirSync(fileURLToPath(CHECKED_DIR))
    .filter((name) => name.startsWith('readme-') && name.endsWith('.ts'))
    .sort();
}

/** The checked file's copyable lines, with the declared non-copied lines out. */
function copiedLines(name: string): string[] {
  const source = readFileSync(
    fileURLToPath(new URL(`../types/${name}`, import.meta.url)),
    'utf8',
  );
  return source.split('\n').filter((line) => !isNonCopied(line));
}

function containsRun(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length === 0) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((line, offset) => haystack[start + offset] === line)) {
      return true;
    }
  }
  return false;
}

function matchingFile(block: readonly string[]): string | undefined {
  const core = block.filter((line) => !isNonCopied(line));
  return checkedFileNames().find((name) =>
    containsRun(copiedLines(name), core),
  );
}

const readme = readFileSync(
  fileURLToPath(new URL('../../README.md', import.meta.url)),
  'utf8',
);

test('README carries exactly the five TypeScript examples it advertises', () => {
  // Connect, Commands, Author your own types, Streaming, Errors. A sixth block
  // has to be added here with its counterpart under test/types/, so a deleted
  // or extra example cannot pass the parity rule silently.
  assert.equal(readmeTsBlocks(readme).length, 5);
});

test('every README TypeScript block is a contiguous run in a checked file', () => {
  for (const [index, block] of readmeTsBlocks(readme).entries()) {
    const core = block.filter((line) => !isNonCopied(line));
    const name = checkedFileNames().find((file) =>
      containsRun(copiedLines(file), core),
    );
    assert.notEqual(
      name,
      undefined,
      `README TypeScript block ${index + 1} (${core.length} lines) is not a ` +
        `byte-identical run in any test/types/readme-*.ts file`,
    );
  }
});

test('a drifted README block is reported instead of matched', () => {
  // Without this the gate could be satisfied by a matcher that always returns a
  // hit: the same blocks must match untouched and stop matching once one line of
  // them differs from the compiled copy.
  const blocks = readmeTsBlocks(readme);
  for (const [index, block] of blocks.entries()) {
    const core = block.filter((line) => !isNonCopied(line));
    const clean = matchingFile(block);
    assert.notEqual(
      clean,
      undefined,
      `block ${index + 1} does not match even before the mutation, so the ` +
        'negative case proves nothing',
    );
    const first = core[0] ?? '';
    const drifted = [`${first} // drifted`, ...core.slice(1)];
    assert.ok(
      checkedFileNames().every(
        (name) => !containsRun(copiedLines(name), drifted),
      ),
      `block ${index + 1} still matched after its first line was changed`,
    );
  }
});
