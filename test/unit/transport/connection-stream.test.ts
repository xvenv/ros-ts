import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { NativeConnection } from '../../../src/transport/index.js';
import { FakeRouter } from '../../helpers/fake-router.js';

function options(port: number) {
  return {
    host: '127.0.0.1',
    port,
    tls: false as const,
    user: 'admin',
    password: 'secret',
    encoding: 'utf8' as const,
    timeoutMs: 1000,
    connectTimeoutMs: 1000,
    keepAlive: false,
    maxWordBytes: 32 * 1024 * 1024,
    streamHighWaterMark: 2,
    cancelGraceMs: 50,
  };
}

async function connect(router: FakeRouter): Promise<NativeConnection> {
  const promise = NativeConnection.connect(options(router.port));
  await router.nextCommand();
  router.send(['!done']);
  return promise;
}

test('streams records and cancels on consumer break', {
  timeout: 5000,
}, async () => {
  const router = await FakeRouter.start();
  const connection = await connect(router);

  const iterator = connection
    .stream(['/interface/listen'])
    [Symbol.asyncIterator]();

  // The generator body, which writes the tagged command, only runs once
  // next() is called; awaiting nextCommand() first would hang.
  const pendingFirst = iterator.next();
  const command = await router.nextCommand();
  assert.ok(command.tag);
  router.send(['!re', '=name=ether1', `.tag=${command.tag}`]);

  const first = await pendingFirst;
  if (first.done !== false) assert.fail('stream ended before the first record');
  // Reply records keep a null prototype; deepEqual compares prototypes, so
  // copy the record into a plain object.
  assert.deepEqual({ ...first.value }, { name: 'ether1' });

  const stopped = iterator.return?.();
  const cancel = await router.nextCommand();
  assert.deepEqual(cancel.words, ['/cancel', `=tag=${command.tag}`]);
  router.send(['!done', `.tag=${command.tag}`]);
  await stopped;

  await connection.close();
  await router.close();
});

test('a stream ends normally on !done', { timeout: 5000 }, async () => {
  const router = await FakeRouter.start();
  const connection = await connect(router);

  const collected: Array<Record<string, string>> = [];
  const command = connection.stream(['/interface/listen']);
  const iteration = (async () => {
    for await (const record of command) collected.push(record);
  })();

  const wire = await router.nextCommand();
  assert.ok(wire.tag);
  router.send(['!re', '=name=ether1', `.tag=${wire.tag}`]);
  router.send(['!done', `.tag=${wire.tag}`]);
  await iteration;

  assert.deepEqual(
    collected.map((record) => ({ ...record })),
    [{ name: 'ether1' }],
  );
  await connection.close();
  await router.close();
});

test('partial frames across TCP chunks are decoded', {
  timeout: 5000,
}, async () => {
  const router = await FakeRouter.start();
  const promise = NativeConnection.connect(options(router.port));

  const login = await router.nextCommand();
  assert.equal(login.words[0], '/login');

  const frame = Buffer.concat([
    Buffer.from([0x05]),
    Buffer.from('!done', 'utf8'),
    Buffer.from([0x00]),
  ]);
  router.sendChunks(frame, [1, 2, 3]);

  const connection = await promise;
  assert.equal(connection.state, 'ready');
  await connection.close();
  await router.close();
});
