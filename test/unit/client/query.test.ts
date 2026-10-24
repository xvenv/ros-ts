import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
  compileQuery,
  compileQuerySpec,
  QueryBuilderImpl,
  type QueryExpr,
} from '../../../src/client/query.js';

type Key = 'interface' | 'disabled' | 'comment' | 'type';

function build(builder: QueryBuilderImpl<Key>): readonly string[] {
  return compileQuery(
    builder.and(
      builder.eq('type', 'vlan'),
      builder.or(builder.eq('interface', 'ether1'), builder.absent('comment')),
      builder.not(builder.exists('disabled')),
    ),
  );
}

test('compiles a nested expression to query words', () => {
  assert.deepEqual(build(new QueryBuilderImpl<Key>()), [
    '?type=vlan',
    '?interface=ether1',
    '?-comment',
    '?#|',
    '?disabled',
    '?#!',
    '?#&',
    '?#&',
  ]);
});

test('compiles comparison operators', () => {
  const builder = new QueryBuilderImpl<Key>();
  assert.deepEqual(compileQuery(builder.eq('type', 'vlan')), ['?type=vlan']);
  assert.deepEqual(compileQuery(builder.lt('type', 'vlan')), ['?<type=vlan']);
  assert.deepEqual(compileQuery(builder.gt('type', 'vlan')), ['?>type=vlan']);
  assert.deepEqual(compileQuery(builder.exists('type')), ['?type']);
  assert.deepEqual(compileQuery(builder.absent('type')), ['?-type']);
});

test('an and/or group with one child returns the child', () => {
  const builder = new QueryBuilderImpl<Key>();
  const child = builder.eq('type', 'vlan');
  assert.deepEqual(compileQuery(builder.and(child)), ['?type=vlan']);
  assert.deepEqual(compileQuery(builder.or(child)), ['?type=vlan']);
});

test('empty groups throw and raw words are validated', () => {
  const builder = new QueryBuilderImpl<Key>();
  assert.throws(() => builder.and(), TypeError);
  assert.throws(() => builder.or(), TypeError);
  assert.deepEqual(compileQuery(builder.raw(['?type=vlan'])), ['?type=vlan']);
  assert.throws(() => builder.raw(['type=vlan']), TypeError);
  assert.throws(() => builder.raw([]), TypeError);
});

test('never emits a regex operator', () => {
  const builder = new QueryBuilderImpl<Key>();
  const words = build(builder);
  assert.equal(
    words.some((word) => word.includes('~')),
    false,
  );
});

type Tree =
  | { readonly kind: 'eq'; readonly name: Key; readonly value: string }
  | { readonly kind: 'exists'; readonly name: Key }
  | { readonly kind: 'absent'; readonly name: Key }
  | { readonly kind: 'not'; readonly child: Tree }
  | { readonly kind: 'and'; readonly children: readonly Tree[] }
  | { readonly kind: 'or'; readonly children: readonly Tree[] };

function buildTree(builder: QueryBuilderImpl<Key>, tree: Tree): QueryExpr {
  switch (tree.kind) {
    case 'eq':
      return builder.eq(tree.name, tree.value);
    case 'exists':
      return builder.exists(tree.name);
    case 'absent':
      return builder.absent(tree.name);
    case 'not':
      return builder.not(buildTree(builder, tree.child));
    case 'and':
      return builder.and(
        ...tree.children.map((child) => buildTree(builder, child)),
      );
    case 'or':
      return builder.or(
        ...tree.children.map((child) => buildTree(builder, child)),
      );
    default:
      throw new Error('unknown tree');
  }
}

type SampleRecord = Readonly<Partial<Record<Key, string>>>;

function evaluateTree(tree: Tree, record: SampleRecord): boolean {
  switch (tree.kind) {
    case 'eq':
      return record[tree.name] === tree.value;
    case 'exists':
      return record[tree.name] !== undefined;
    case 'absent':
      return record[tree.name] === undefined;
    case 'not':
      return !evaluateTree(tree.child, record);
    case 'and':
      return tree.children.every((child) => evaluateTree(child, record));
    case 'or':
      return tree.children.some((child) => evaluateTree(child, record));
    default:
      throw new Error('unknown tree');
  }
}

function evaluateWords(
  words: readonly string[],
  record: SampleRecord,
): boolean {
  const stack: boolean[] = [];

  for (const word of words) {
    if (word === '?#!') {
      const value = stack.pop();
      if (value === undefined) throw new Error('empty stack');
      stack.push(!value);
      continue;
    }
    if (word === '?#&' || word === '?#|') {
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) {
        throw new Error('empty stack');
      }
      stack.push(word === '?#&' ? left && right : left || right);
      continue;
    }
    if (word.startsWith('?-')) {
      stack.push(record[word.slice(2) as Key] === undefined);
      continue;
    }
    if (word.startsWith('?')) {
      const body = word.slice(1);
      const separator = body.indexOf('=');
      if (separator < 0) {
        stack.push(record[body as Key] !== undefined);
      } else {
        const name = body.slice(0, separator) as Key;
        stack.push(record[name] === body.slice(separator + 1));
      }
      continue;
    }
    throw new Error(`Unexpected query word: ${word}`);
  }

  if (stack.length !== 1) throw new Error(`Unexpected stack: ${stack.length}`);
  return stack[0] === true;
}

function randomTree(random: () => number, depth: number): Tree {
  const keys: readonly Key[] = ['type', 'interface', 'comment'];
  const values: readonly string[] = ['vlan', 'ether1', 'x'];
  const leafKinds = ['eq', 'exists', 'absent'] as const;

  if (depth === 0) {
    const kind = leafKinds[random() % leafKinds.length] ?? 'eq';
    const name = keys[random() % keys.length] ?? 'type';
    if (kind === 'eq') {
      return {
        kind,
        name,
        value: values[random() % values.length] ?? 'vlan',
      };
    }
    return { kind, name };
  }

  const branch = random() % 3;
  if (branch === 0) {
    return { kind: 'not', child: randomTree(random, depth - 1) };
  }
  const children = Array.from({ length: 2 + (random() % 2) }, () =>
    randomTree(random, depth - 1),
  );
  return { kind: branch === 1 ? 'and' : 'or', children };
}

test('random trees compile to equivalent stack programs', () => {
  const records: readonly SampleRecord[] = [
    { type: 'vlan', interface: 'ether1', comment: 'x' },
    { type: 'vlan', interface: 'ether1' },
    { type: 'ether', interface: 'ether2', comment: 'y' },
    {},
  ];
  let seed = 0x0badf00d;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };

  for (let run = 0; run < 100; run += 1) {
    const tree = randomTree(random, 3);
    const words = compileQuery(buildTree(new QueryBuilderImpl<Key>(), tree));
    for (const record of records) {
      assert.equal(
        evaluateWords(words, record),
        evaluateTree(tree, record),
        `run ${run}`,
      );
    }
  }
});

test('compileQuerySpec accepts a callback, raw words, or undefined', () => {
  assert.deepEqual(compileQuerySpec(undefined), []);
  assert.deepEqual(
    compileQuerySpec<Key>((builder) => builder.eq('type', 'vlan')),
    ['?type=vlan'],
  );
  assert.deepEqual(compileQuerySpec<Key>(['?type=vlan']), ['?type=vlan']);
  assert.throws(() => compileQuerySpec(['nope']), TypeError);
});
