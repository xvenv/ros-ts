import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { CommandResult } from '../../../src/shared/index.js';
import {
  ClosedError,
  ConnectionError,
  FatalError,
  LoginError,
  ProtocolError,
  ReconnectError,
  TimeoutError,
} from '../../../src/shared/index.js';
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
    streamHighWaterMark: 16,
    cancelGraceMs: 50,
  };
}

// Reply records keep a null prototype so attributes such as __proto__ stay
// inert; deepEqual compares prototypes, so copy them into plain objects.
function plainResult(result: CommandResult): CommandResult {
  return {
    records: result.records.map((record) => ({ ...record })),
    done: { ...result.done },
  };
}

async function connect(router: FakeRouter): Promise<NativeConnection> {
  const promise = NativeConnection.connect(options(router.port));
  await router.nextCommand();
  router.send(['!done']);
  return promise;
}

test('connects, logs in, and runs a tagged command', async () => {
  const router = await FakeRouter.start();
  const connectionPromise = NativeConnection.connect(options(router.port));

  const login = await router.nextCommand();
  assert.deepEqual(login.words, ['/login', '=name=admin', '=password=secret']);
  router.send(['!done']);

  const connection = await connectionPromise;
  assert.equal(connection.state, 'ready');

  const commandPromise = connection.run(['/system/identity/print']);
  const command = await router.nextCommand();
  assert.deepEqual(command.words, ['/system/identity/print', '.tag=1']);

  router.send(['!re', '=name=Router', '.tag=1']);
  router.send(['!done', '.tag=1']);

  assert.deepEqual(plainResult(await commandPromise), {
    records: [{ name: 'Router' }],
    done: {},
  });

  await connection.close();
  await router.close();
});

test('routes interleaved replies by tag', async () => {
  const router = await FakeRouter.start();
  const connectionPromise = NativeConnection.connect(options(router.port));

  await router.nextCommand();
  router.send(['!done']);
  const connection = await connectionPromise;

  const first = connection.run(['/a/print']);
  const second = connection.run(['/b/print']);

  const a = await router.nextCommand();
  const b = await router.nextCommand();
  const tagA = a.tag;
  const tagB = b.tag;
  assert.ok(tagA);
  assert.ok(tagB);

  router.send(['!re', '=which=a', `.tag=${tagA}`]);
  router.send(['!re', '=which=b', `.tag=${tagB}`]);
  router.send(['!done', `.tag=${tagB}`]);
  router.send(['!done', `.tag=${tagA}`]);

  assert.deepEqual(plainResult(await first), {
    records: [{ which: 'a' }],
    done: {},
  });
  assert.deepEqual(plainResult(await second), {
    records: [{ which: 'b' }],
    done: {},
  });

  await connection.close();
  await router.close();
});

test(
  'rejects with ConnectionError when the port is closed',
  {
    timeout: 5000,
  },
  async () => {
    const router = await FakeRouter.start();
    const port = router.port;
    await router.close();

    await assert.rejects(NativeConnection.connect(options(port)), ConnectionError);
  },
);

test(
  'rejects when login done and a protocol error arrive together',
  {
    timeout: 5000,
  },
  async () => {
    const router = await FakeRouter.start();
    const promise = NativeConnection.connect(options(router.port));

    await router.nextCommand();
    router.sendMany([['!done'], ['!re']]);

    await assert.rejects(promise, ProtocolError);
    await router.close();
  },
);

test(
  'later calls after a peer disconnect reject with ConnectionError',
  {
    timeout: 5000,
  },
  async () => {
    const router = await FakeRouter.start();
    const connection = await connect(router);

    router.destroyClient();
    await connection.closed;

    await assert.rejects(connection.run(['/a/print']), ConnectionError);
    await router.close();
  },
);

test(
  'later calls after a user close reject with ClosedError',
  {
    timeout: 5000,
  },
  async () => {
    const router = await FakeRouter.start();
    const connection = await connect(router);

    await connection.close();
    await assert.rejects(connection.run(['/a/print']), ClosedError);
    await router.close();
  },
);

test(
  'rejects LoginError when the router traps the login',
  {
    timeout: 5000,
  },
  async () => {
    const router = await FakeRouter.start();
    const connectionPromise = NativeConnection.connect(options(router.port));

    await router.nextCommand();
    router.send(['!trap', '=message=invalid user name or password (6)']);

    await assert.rejects(connectionPromise, LoginError);
    await router.close();
  },
);

test(
  'rejects pending commands with FatalError on !fatal',
  {
    timeout: 5000,
  },
  async () => {
    const router = await FakeRouter.start();
    const connection = await connect(router);

    const pending = connection.run(['/a/print']);
    await router.nextCommand();
    router.send(['!fatal', 'shutting down']);

    await assert.rejects(pending, FatalError);
    await connection.closed;
    await router.close();
  },
);

test(
  'closes the connection on a reply for an unknown tag',
  {
    timeout: 5000,
  },
  async () => {
    const router = await FakeRouter.start();
    const connection = await connect(router);

    router.send(['!re', '=a=1', '.tag=99']);

    await connection.closed;
    assert.equal(connection.state, 'closed');
    await router.close();
  },
);

test('times out a command and sends /cancel', { timeout: 5000 }, async () => {
  const router = await FakeRouter.start();
  const connection = await connect(router);

  const pending = connection.run(['/a/print'], { timeoutMs: 10 });
  // Attach the expectation before the timer can fire; otherwise the rejection
  // is unhandled until nextCommand() resolves.
  const rejected = assert.rejects(pending, TimeoutError);
  const command = await router.nextCommand();
  assert.ok(command.tag);

  await rejected;
  const cancel = await router.nextCommand();
  assert.deepEqual(cancel.words, ['/cancel', `=tag=${command.tag}`]);

  await connection.close();
  await router.close();
});

test(
  'close rejects pending commands with ClosedError',
  {
    timeout: 5000,
  },
  async () => {
    const router = await FakeRouter.start();
    const connection = await connect(router);

    const pending = connection.run(['/a/print']);
    await router.nextCommand();
    // Observe the rejection before close() settles it; a handler attached after
    // the close would see an unhandled-rejection error first.
    const rejected = assert.rejects(pending, ClosedError);
    await connection.close();

    await rejected;
    await router.close();
  },
);

test('close fails pending commands with the supplied error', async () => {
  const router = await FakeRouter.start();
  const connection = await connect(router);

  const pending = connection.run(['/system/identity/print']);
  const command = await router.nextCommand();
  assert.ok(command.tag);

  const rejected = assert.rejects(pending, ReconnectError);
  await connection.close(new ReconnectError('Connection replaced by reconnect'));
  await rejected;

  await router.close();
});

test('connect rejects an already-aborted signal without a socket', async () => {
  const router = await FakeRouter.start();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    NativeConnection.connect(options(router.port), controller.signal),
    ClosedError,
  );
  assert.equal(router.connectionCount, 0);

  await router.close();
});

test('aborting during login rejects with ClosedError', async () => {
  const router = await FakeRouter.start();
  const controller = new AbortController();
  const connecting = NativeConnection.connect(options(router.port), controller.signal);

  const login = await router.nextCommand();
  assert.deepEqual(login.words, ['/login', '=name=admin', '=password=secret']);
  controller.abort();

  await assert.rejects(connecting, ClosedError);
  await router.waitForConnectionCount(0);

  await router.close();
});
