import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ParsedReply, ReplyKind } from '../../../src/protocol/index.js';
import {
  CancelledError,
  FatalError,
  ProtocolError,
  TimeoutError,
  TrapError,
} from '../../../src/shared/index.js';
import { TagMux } from '../../../src/transport/index.js';

function reply(
  kind: ReplyKind,
  tag: string | undefined,
  attributes: Record<string, string> = {},
  fatalReason?: string,
): ParsedReply {
  return {
    kind,
    tag,
    attributes: Object.freeze(attributes),
    apiAttributes: Object.freeze({}),
    plain: [],
    fatalReason,
  };
}

function createMux(overrides: Partial<ConstructorParameters<typeof TagMux>[0]> = {}) {
  const writes: string[][] = [];
  const cancels: string[] = [];
  const errors: ProtocolError[] = [];
  const fatals: FatalError[] = [];
  let paused = false;

  const mux = new TagMux({
    timeoutMs: 1000,
    cancelGraceMs: 20,
    streamHighWaterMark: 2,
    write: async (words) => {
      writes.push([...words]);
    },
    sendCancel: async (tag) => {
      cancels.push(tag);
    },
    setPaused: (value) => {
      paused = value;
    },
    onProtocolError: (error) => {
      errors.push(error);
    },
    onFatal: (error) => {
      fatals.push(error);
    },
    ...overrides,
  });

  return {
    mux,
    writes,
    cancels,
    errors,
    fatals,
    isPaused: () => paused,
  };
}

test('run writes a tagged command and resolves on done', async () => {
  const { mux, writes } = createMux();
  const promise = mux.run(['/ip/address/print']);

  assert.deepEqual(writes, [['/ip/address/print', '.tag=1']]);
  mux.route(reply('re', '1', { address: '10.0.0.1/24' }));
  mux.route(reply('done', '1', { ret: 'x' }));

  assert.deepEqual(await promise, {
    records: [{ address: '10.0.0.1/24' }],
    done: { ret: 'x' },
  });
  assert.equal(mux.pendingCount, 0);
});

test('trap is held until done and rejects with TrapError', async () => {
  const { mux } = createMux();
  const promise = mux.run(['/x/add']);

  mux.route(reply('trap', '1', { category: '1', message: 'bad value' }));
  assert.equal(mux.pendingCount, 1);
  mux.route(reply('done', '1', { ret: '*1' }));

  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TrapError);
    assert.equal(error.category, 1);
    assert.equal(error.trapMessage, 'bad value');
    assert.deepEqual(error.done, { ret: '*1' });
    return true;
  });
});

test('empty is not terminal until done', async () => {
  const { mux } = createMux();
  const promise = mux.run(['/x/print']);

  mux.route(reply('empty', '1'));
  assert.equal(mux.pendingCount, 1);

  mux.route(reply('done', '1'));
  assert.deepEqual(await promise, { records: [], done: {} });
  assert.equal(mux.pendingCount, 0);
});

test('timeout rejects, sends cancel, and zombifies the tag', async () => {
  const { mux, cancels, errors } = createMux({ timeoutMs: 5 });
  const promise = mux.run(['/x/print']);

  await assert.rejects(promise, TimeoutError);
  assert.deepEqual(cancels, ['1']);
  assert.equal(mux.pendingCount, 0);
  assert.equal(mux.zombieCount, 1);

  mux.route(reply('done', '1'));
  assert.equal(errors.length, 0);
});

test('a timeout tolerates the cancel ack and keeps the mux usable', async () => {
  const { mux, errors, cancels } = createMux({
    timeoutMs: 5,
    cancelGraceMs: 200,
  });
  const promise = mux.run(['/x/print']);

  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(cancels, ['1']);

  mux.route(reply('trap', '1', { category: '2', message: 'interrupted' }));
  mux.route(reply('done', undefined));
  mux.route(reply('empty', '1'));
  assert.equal(mux.zombieCount, 1);
  mux.route(reply('done', '1'));

  await assert.rejects(promise, TimeoutError);
  assert.equal(errors.length, 0);
  assert.equal(mux.pendingCount, 0);
  assert.equal(mux.zombieCount, 0);

  const next = mux.run(['/y/print']);
  mux.route(reply('done', '2'));
  assert.deepEqual(await next, { records: [], done: {} });
});

test('abort sends cancel, waits for done, and rejects with CancelledError', async () => {
  const { mux, cancels } = createMux({ cancelGraceMs: 50 });
  const controller = new AbortController();
  const promise = mux.run(['/x/print'], { signal: controller.signal });

  controller.abort(new Error('stop'));
  await Promise.resolve();
  assert.deepEqual(cancels, ['1']);
  mux.route(reply('done', '1'));

  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CancelledError);
    assert.equal(error.reason instanceof Error, true);
    return true;
  });
  assert.equal(mux.zombieCount, 0);
});

test('abort removes the pending entry after the grace period', async () => {
  const { mux } = createMux({ cancelGraceMs: 5 });
  const controller = new AbortController();
  const promise = mux.run(['/x/print'], { signal: controller.signal });

  controller.abort();
  await assert.rejects(promise, CancelledError);
  assert.equal(mux.pendingCount, 0);
});

test('unknown tag triggers a protocol error; zombie tags are ignored', () => {
  const { mux, errors } = createMux();
  mux.route(reply('done', '99'));
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof ProtocolError);
});

test('fatal fails all pending and calls onFatal', async () => {
  const { mux, fatals } = createMux();
  const first = mux.run(['/a/print']);
  const second = mux.run(['/b/print']);

  mux.route(reply('fatal', undefined, {}, 'shutting down'));

  await assert.rejects(first, FatalError);
  await assert.rejects(second, FatalError);
  assert.equal(fatals.length, 1);
  assert.equal(fatals[0]?.reason, 'shutting down');
});

test('stream yields records, ends on done, and cancels on break', async () => {
  const { mux, cancels } = createMux();
  const iterator = mux.stream(['/interface/listen'])[Symbol.asyncIterator]();

  const first = iterator.next();
  await Promise.resolve();
  mux.route(reply('re', '1', { name: 'ether1' }));
  assert.deepEqual(await first, { value: { name: 'ether1' }, done: false });

  const stopped = iterator.return?.();
  await Promise.resolve();
  assert.deepEqual(cancels, ['1']);
  mux.route(reply('done', '1'));
  await stopped;
  assert.equal(mux.pendingCount, 0);
  assert.equal(mux.zombieCount, 0);
});

test('a cancelled stream tolerates trap, empty, and done in that order', async () => {
  const { mux, cancels, errors } = createMux({ cancelGraceMs: 200 });
  const controller = new AbortController();
  const stream = mux.stream(['/interface/listen'], {
    signal: controller.signal,
  });
  const iterator = stream[Symbol.asyncIterator]();
  const next = iterator.next();
  await Promise.resolve();

  controller.abort();
  await Promise.resolve();
  assert.deepEqual(cancels, ['1']);

  mux.route(reply('trap', '1', { category: '2', message: 'interrupted' }));
  mux.route(reply('done', undefined));
  mux.route(reply('empty', '1'));
  assert.equal(mux.pendingCount, 1);
  assert.equal(mux.zombieCount, 1);

  mux.route(reply('done', '1'));

  await assert.rejects(next, CancelledError);
  assert.equal(errors.length, 0);
  assert.equal(mux.pendingCount, 0);
  assert.equal(mux.zombieCount, 0);
});

test('stream backpressure pauses and resumes the socket', async () => {
  const { mux, isPaused } = createMux({ streamHighWaterMark: 1 });
  const iterator = mux.stream(['/interface/listen'])[Symbol.asyncIterator]();

  const first = iterator.next();
  await Promise.resolve();
  mux.route(reply('re', '1', { n: '1' }));
  assert.deepEqual(await first, { value: { n: '1' }, done: false });

  mux.route(reply('re', '1', { n: '2' }));
  assert.equal(isPaused(), true);

  assert.deepEqual(await iterator.next(), { value: { n: '2' }, done: false });
  assert.equal(isPaused(), false);

  mux.route(reply('done', '1'));
  await iterator.next();
});

test('failAll rejects every pending command', async () => {
  const { mux } = createMux();
  const first = mux.run(['/a/print']);
  const second = mux.run(['/b/print']);
  const error = new Error('closed');

  mux.failAll(error);

  await assert.rejects(first, error);
  await assert.rejects(second, error);
  assert.equal(mux.pendingCount, 0);
  await assert.rejects(mux.run(['/c/print']), error);
});

test('does not leave an unhandled rejection when failAll races a write', async () => {
  let release: (() => void) | undefined;
  const { mux } = createMux({
    write: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const promise = mux.run(['/x/print']);
  const error = new Error('closed');

  mux.failAll(error);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  release?.();

  await assert.rejects(promise, error);
});

test('tolerates an untagged reply during cancellation', async () => {
  const { mux, errors } = createMux({ cancelGraceMs: 5 });
  const controller = new AbortController();
  const promise = mux.run(['/x/print'], { signal: controller.signal });

  controller.abort();
  await Promise.resolve();
  mux.route(reply('done', undefined));

  assert.equal(errors.length, 0);
  await assert.rejects(promise, CancelledError);
  assert.equal(mux.pendingCount, 0);
});

test('keeps a zombie until its done, even after the grace period', async () => {
  const { mux, errors } = createMux({ cancelGraceMs: 5 });
  const controller = new AbortController();
  const promise = mux.run(['/x/print'], { signal: controller.signal });

  controller.abort();
  await assert.rejects(promise, CancelledError);
  assert.equal(mux.zombieCount, 1);

  mux.route(reply('done', '1'));
  assert.equal(errors.length, 0);
  assert.equal(mux.zombieCount, 0);
});

test('ignores a late zombie reply after a timeout', async () => {
  const { mux, errors } = createMux({ timeoutMs: 5 });
  const promise = mux.run(['/x/print']);

  await assert.rejects(promise, TimeoutError);
  assert.equal(mux.zombieCount, 1);

  mux.route(reply('done', '1'));
  assert.equal(errors.length, 0);
  assert.equal(mux.zombieCount, 0);
});

test('a zombie keeps its tag across empty and clears on done', async () => {
  const { mux, errors } = createMux({ timeoutMs: 5, cancelGraceMs: 5 });
  const promise = mux.run(['/x/print']);

  await assert.rejects(promise, TimeoutError);
  assert.equal(mux.zombieCount, 1);

  mux.route(reply('empty', '1'));
  assert.equal(errors.length, 0);
  assert.equal(mux.zombieCount, 1);

  mux.route(reply('done', '1'));
  assert.equal(errors.length, 0);
  assert.equal(mux.zombieCount, 0);
});
