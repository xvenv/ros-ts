import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { AsyncQueue } from '../../../src/shared/index.js';

test('yields buffered values in order', async () => {
  const queue = new AsyncQueue<number>();
  queue.push(1);
  queue.push(2);
  queue.close();

  const values: number[] = [];
  for await (const value of queue) values.push(value);
  assert.deepEqual(values, [1, 2]);
});

test('a waiter receives the next pushed value', async () => {
  const queue = new AsyncQueue<string>();
  const iterator = queue[Symbol.asyncIterator]();
  const next = iterator.next();

  queue.push('a');
  assert.deepEqual(await next, { value: 'a', done: false });
  queue.close();
  assert.deepEqual(await iterator.next(), { value: undefined, done: true });
});

test('close wakes pending waiters', async () => {
  const queue = new AsyncQueue<number>();
  const iterator = queue[Symbol.asyncIterator]();
  const next = iterator.next();
  queue.close();
  assert.deepEqual(await next, { value: undefined, done: true });
});

test('fail rejects pending and future reads', async () => {
  const queue = new AsyncQueue<number>();
  const iterator = queue[Symbol.asyncIterator]();
  const next = iterator.next();
  const error = new Error('boom');

  queue.fail(error);

  await assert.rejects(next, error);
  await assert.rejects(iterator.next(), error);
});

test('fail discards buffered values', async () => {
  const queue = new AsyncQueue<number>();
  queue.push(1);
  const error = new Error('boom');
  queue.fail(error);
  await assert.rejects(queue[Symbol.asyncIterator]().next(), error);
});

test('high-water callbacks fire once per full/drain cycle', async () => {
  let full = 0;
  let drain = 0;
  const queue = new AsyncQueue<number>({
    highWaterMark: 2,
    onFull: () => {
      full += 1;
    },
    onDrain: () => {
      drain += 1;
    },
  });

  queue.push(1);
  queue.push(2);
  assert.equal(full, 1);
  assert.equal(drain, 0);

  const iterator = queue[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  assert.equal(drain, 1);

  queue.push(3);
  queue.push(4);
  assert.equal(full, 2);
  queue.close();
});

test('fail releases a full high-water latch', async () => {
  let full = 0;
  let drain = 0;
  const queue = new AsyncQueue<number>({
    highWaterMark: 2,
    onFull: () => {
      full += 1;
    },
    onDrain: () => {
      drain += 1;
    },
  });

  queue.push(1);
  queue.push(2);
  assert.equal(full, 1);
  assert.equal(drain, 0);

  const error = new Error('boom');
  queue.fail(error);

  assert.equal(queue.size, 0);
  assert.equal(drain, 1);
  await assert.rejects(queue[Symbol.asyncIterator]().next(), error);
});

test('close releases a full high-water latch', async () => {
  let full = 0;
  let drain = 0;
  const queue = new AsyncQueue<number>({
    highWaterMark: 2,
    onFull: () => {
      full += 1;
    },
    onDrain: () => {
      drain += 1;
    },
  });

  queue.push(1);
  queue.push(2);
  assert.equal(full, 1);
  assert.equal(drain, 0);

  queue.close();
  assert.equal(drain, 1);
  assert.equal(queue.size, 2);

  const iterator = queue[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: 1, done: false });
  assert.deepEqual(await iterator.next(), { value: 2, done: false });
  assert.deepEqual(await iterator.next(), { value: undefined, done: true });
  assert.equal(drain, 1);
});

test('rejects an invalid high-water mark', () => {
  assert.throws(() => new AsyncQueue({ highWaterMark: 0 }), RangeError);
});
