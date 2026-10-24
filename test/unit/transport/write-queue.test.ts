import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type WritableSocket,
  WriteQueue,
} from '../../../src/transport/index.js';

class FakeSocket implements WritableSocket {
  readonly writes: string[] = [];
  private drain: (() => void) | undefined;
  result: boolean;

  constructor(result = true) {
    this.result = result;
  }

  write(chunk: Buffer): boolean {
    this.writes.push(chunk.toString('utf8'));
    return this.result;
  }

  once(_event: 'drain', listener: () => void): unknown {
    this.drain = listener;
    return this;
  }

  off(_event: 'drain', listener: () => void): unknown {
    if (this.drain === listener) this.drain = undefined;
    return this;
  }

  emitDrain(): void {
    const listener = this.drain;
    this.drain = undefined;
    listener?.();
  }
}

test('writes in order when the socket accepts immediately', async () => {
  const socket = new FakeSocket(true);
  const queue = new WriteQueue(socket);

  await Promise.all([
    queue.write(Buffer.from('a')),
    queue.write(Buffer.from('b')),
    queue.write(Buffer.from('c')),
  ]);

  assert.deepEqual(socket.writes, ['a', 'b', 'c']);
});

test('waits for drain before the next write', async () => {
  const socket = new FakeSocket(false);
  const queue = new WriteQueue(socket);
  let secondDone = false;

  const first = queue.write(Buffer.from('a'));
  const second = queue.write(Buffer.from('b')).then(() => {
    secondDone = true;
  });

  await Promise.resolve();
  assert.deepEqual(socket.writes, ['a']);
  assert.equal(secondDone, false);

  socket.result = true;
  socket.emitDrain();
  await first;
  await second;
  assert.deepEqual(socket.writes, ['a', 'b']);
});

test('fail rejects pending writes and later writes', async () => {
  const socket = new FakeSocket(false);
  const queue = new WriteQueue(socket);
  const error = new Error('socket closed');

  const pending = queue.write(Buffer.from('a'));
  queue.fail(error);

  await assert.rejects(pending, error);
  await assert.rejects(queue.write(Buffer.from('b')), error);
});

test('waits for a drain after every rejected write', async () => {
  const socket = new FakeSocket(false);
  const queue = new WriteQueue(socket);
  let secondDone = false;
  let thirdDone = false;

  const first = queue.write(Buffer.from('a'));
  const second = queue.write(Buffer.from('b')).then(() => {
    secondDone = true;
  });
  const third = queue.write(Buffer.from('c')).then(() => {
    thirdDone = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(socket.writes, ['a']);
  assert.equal(secondDone, false);

  socket.emitDrain();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(socket.writes, ['a', 'b']);
  assert.equal(secondDone, false);
  assert.equal(thirdDone, false);

  socket.result = true;
  socket.emitDrain();
  await Promise.all([first, second, third]);
  assert.deepEqual(socket.writes, ['a', 'b', 'c']);
});

test('fail rejects a write already waiting for drain', async () => {
  const socket = new FakeSocket(false);
  const queue = new WriteQueue(socket);
  const error = new Error('socket closed');

  const pending = queue.write(Buffer.from('a'));
  await Promise.resolve();
  assert.deepEqual(socket.writes, ['a']);

  queue.fail(error);

  const outcome = await Promise.race([
    pending.then(
      () => 'resolved',
      (reason: unknown) =>
        reason instanceof Error ? reason.message : 'rejected',
    ),
    new Promise<string>((resolve) => {
      setImmediate(() => resolve('still pending'));
    }),
  ]);
  assert.equal(outcome, 'socket closed');
  assert.deepEqual(socket.writes, ['a']);
});
