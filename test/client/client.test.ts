import assert from 'node:assert/strict';
import test from 'node:test';

import { ProtocolError } from '../../src/errors.js';
import { RouterOS } from '../../src/index.js';
import { FakeRouter } from '../helpers/fake-router.js';

async function connect(router: FakeRouter): Promise<RouterOS> {
  const promise = RouterOS.connect({
    host: '127.0.0.1',
    port: router.port,
    user: 'admin',
    password: 'secret',
    connectTimeoutMs: 1000,
    timeoutMs: 1000,
  });
  const login = await router.nextCommand();
  assert.deepEqual(login.words, ['/login', '=name=admin', '=password=secret']);
  router.send(['!done']);
  return promise;
}

test('command builds proplist and typed query words', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  const promise = client.command('/ip/address/print', {
    proplist: ['address', 'interface'],
    query: (query) => query.eq('interface', 'ether1'),
  });

  const command = await router.nextCommand();
  assert.deepEqual(command.words, [
    '/ip/address/print',
    '.proplist=address,interface',
    '?interface=ether1',
    '.tag=1',
  ]);
  assert.ok(command.tag);
  router.send([
    '!re',
    '=address=10.0.0.1/24',
    '=interface=ether1',
    `.tag=${command.tag}`,
  ]);
  router.send(['!done', `.tag=${command.tag}`]);

  // Reply records keep a null prototype so attributes such as __proto__ stay
  // inert; deepEqual compares prototypes, so copy them into plain objects.
  assert.deepEqual(
    (await promise).records.map((record) => ({ ...record })),
    [{ address: '10.0.0.1/24', interface: 'ether1' }],
  );

  await client.close();
  await router.close();
});

test('command and stream reject a non-string proplist entry', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  // The row type rules a non-string entry out; the cast is what a JavaScript
  // caller effectively sends, and the words must never reach the socket.
  const numericEntry = 1 as unknown as 'address';
  const options = { proplist: ['address', numericEntry] as const };
  assert.throws(
    () => client.command('/ip/address/print', options),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === 'proplist must be an array of strings',
  );
  assert.throws(
    () => client.stream('/ip/address/print', options),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === 'proplist must be an array of strings',
  );

  await client.close();
  await router.close();
});

test('command and stream reject a proplist that is not an array', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  // `attrs` accepts a bare string, so an untyped JavaScript caller can pass one
  // here too. The message must stay the declared one, not whatever a property
  // access on a non-array happens to throw.
  const bareString = 'address' as unknown as readonly ['address'];
  const options = { proplist: bareString };
  assert.throws(
    () => client.command('/ip/address/print', options),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === 'proplist must be an array of strings',
  );
  assert.throws(
    () => client.stream('/ip/address/print', options),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === 'proplist must be an array of strings',
  );

  await client.close();
  await router.close();
});

test('stream builds proplist and query words as projection words', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  const iterable = client.stream('/interface/listen', {
    proplist: ['name'],
    query: (query) => query.eq('type', 'ether'),
    highWaterMark: 7,
  });
  const iterator = iterable[Symbol.asyncIterator]();
  const next = iterator.next();

  const command = await router.nextCommand();
  assert.deepEqual(command.words, [
    '/interface/listen',
    '.proplist=name',
    '?type=ether',
    '.tag=1',
  ]);
  assert.ok(command.tag);

  router.send(['!re', '=name=ether1', `.tag=${command.tag}`]);
  const first = await next;
  assert.deepEqual(
    { value: { ...first.value }, done: first.done },
    { value: { name: 'ether1' }, done: false },
  );

  const stopped = iterator.return?.();
  const cancel = await router.nextCommand();
  assert.deepEqual(cancel.words, ['/cancel', `=tag=${command.tag}`]);
  router.send(['!done', `.tag=${command.tag}`]);
  await stopped;

  await client.close();
  await router.close();
});

test('add returns done attributes and set returns the empty envelope', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  const addPromise = client.command('/queue/simple/add', {
    attrs: {
      name: 'q1',
      target: '192.0.2.1/32',
      'max-limit': '1M/1M',
      disabled: 'no',
    },
  });
  const add = await router.nextCommand();
  assert.deepEqual(add.words, [
    '/queue/simple/add',
    '=name=q1',
    '=target=192.0.2.1/32',
    '=max-limit=1M/1M',
    '=disabled=no',
    '.tag=1',
  ]);
  assert.ok(add.tag);
  router.send(['!done', '=ret=*1', `.tag=${add.tag}`]);
  assert.deepEqual({ ...(await addPromise).done }, { ret: '*1' });

  const setPromise = client.command('/queue/simple/set', {
    attrs: {
      numbers: ['*1', '*2'],
      'max-limit': '2M/2M',
    },
  });
  const set = await router.nextCommand();
  assert.deepEqual(set.words, [
    '/queue/simple/set',
    '=numbers=*1,*2',
    '=max-limit=2M/2M',
    '.tag=2',
  ]);
  assert.ok(set.tag);
  router.send(['!done', `.tag=${set.tag}`]);
  const setResult = await setPromise;
  assert.deepEqual(setResult.records, []);
  assert.deepEqual({ ...setResult.done }, {});

  await client.close();
  await router.close();
});

test('command joins a list attribute into one comma-separated word', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  const promise = client.command('/queue/simple/set', {
    attrs: { numbers: ['*1', '*2'] },
  });
  const command = await router.nextCommand();
  assert.deepEqual(command.words, [
    '/queue/simple/set',
    '=numbers=*1,*2',
    '.tag=1',
  ]);
  assert.ok(command.tag);
  router.send(['!done', `.tag=${command.tag}`]);
  const result = await promise;
  assert.deepEqual(result.records, []);
  assert.deepEqual({ ...result.done }, {});

  await client.close();
  await router.close();
});

test('command returns the lossless envelope', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  const promise = client.command('/system/script/run', {
    attrs: { number: 0 },
    query: ['?comment=test'],
  });
  const command = await router.nextCommand();
  assert.deepEqual(command.words, [
    '/system/script/run',
    '=number=0',
    '?comment=test',
    '.tag=1',
  ]);
  assert.ok(command.tag);
  router.send(['!re', '=a=1', `.tag=${command.tag}`]);
  router.send(['!done', '=ret=x', `.tag=${command.tag}`]);

  const result = await promise;
  assert.deepEqual(
    {
      records: result.records.map((record) => ({ ...record })),
      done: { ...result.done },
    },
    {
      records: [{ a: '1' }],
      done: { ret: 'x' },
    },
  );

  await client.close();
  await router.close();
});

test('rejects invalid connection options before opening a socket', async () => {
  await assert.rejects(
    RouterOS.connect({ host: '', user: 'admin', password: 'x' }),
    TypeError,
  );
  await assert.rejects(
    RouterOS.connect({
      host: '127.0.0.1',
      port: 0,
      user: 'admin',
      password: 'x',
    }),
    RangeError,
  );
  await assert.rejects(
    RouterOS.connect({
      host: '127.0.0.1',
      user: 'admin',
      password: 'x',
      timeoutMs: -1,
    }),
    RangeError,
  );
  await assert.rejects(
    RouterOS.connect({
      host: '127.0.0.1',
      user: 'admin',
      password: 'x',
      encoding: 'gbk' as 'utf8',
    }),
    TypeError,
  );
});

test('close is idempotent and awaits the closed promise', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  await client.close();
  await client.close();
  await client.closed;
  assert.equal(client.state, 'closed');

  await router.close();
});

test('command sends attribute words and returns the done envelope', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  const promise = client.command('/ip/address/add', {
    attrs: { address: '10.0.0.1/24', interface: 'ether1', disabled: 'yes' },
  });
  const command = await router.nextCommand();
  assert.deepEqual(command.words, [
    '/ip/address/add',
    '=address=10.0.0.1/24',
    '=interface=ether1',
    '=disabled=yes',
    '.tag=1',
  ]);
  router.send(['!done', `=ret=*7`, `.tag=${command.tag}`]);

  const result = await promise;
  assert.deepEqual({ ...result.done }, { ret: '*7' });
  assert.deepEqual(result.records, []);
});

test('command builds proplist and query words for an uncataloged path', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  const promise = client.command('/interface/printer/print', {
    proplist: ['name', 'port'],
    query: (query) =>
      query.and(query.eq('name', 'laser'), query.absent('comment')),
  });
  const command = await router.nextCommand();
  assert.deepEqual(command.words, [
    '/interface/printer/print',
    '.proplist=name,port',
    '?name=laser',
    '?-comment',
    '?#&',
    '.tag=1',
  ]);
  router.send(['!re', '=name=laser', '=port=1', `.tag=${command.tag}`]);
  router.send(['!done', `.tag=${command.tag}`]);

  const result = await promise;
  assert.deepEqual({ ...result.records[0] }, { name: 'laser', port: '1' });
});

test('command rejects an add reply that carries no ret', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  const promise = client.command('/queue/simple/add', { attrs: { name: 'x' } });
  const command = await router.nextCommand();
  router.send(['!done', `.tag=${command.tag}`]);

  await assert.rejects(() => promise, ProtocolError);

  // This rejection is the command's own reply check, not a wire failure, so the
  // socket stays up: README §Errors and the 2026-10-22 spec §5.4 claim the
  // connection survives it. Without this assertion the two can drift apart
  // again, because a `fail()` on this path would not change the rejection.
  assert.equal(client.state, 'ready');
});

test('stream sends attrs plus projection words', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  // One bag covering every word kind `buildWords` emits for a stream: a bare
  // flag attribute, a valued attribute, a projection, and a built query.
  const iterable = client.stream('/interface/listen', {
    attrs: { once: '', a: '1' },
    proplist: ['name'],
    query: (query) => query.eq('type', 'ether'),
    highWaterMark: 4,
  });
  const iterator = iterable[Symbol.asyncIterator]();
  const first = iterator.next();
  const command = await router.nextCommand();
  assert.deepEqual(command.words, [
    '/interface/listen',
    '=once=',
    '=a=1',
    '.proplist=name',
    '?type=ether',
    '.tag=1',
  ]);
  assert.ok(command.tag);

  router.send(['!re', '=name=ether1', '.added=yes', `.tag=${command.tag}`]);
  // Dot-prefixed reply words are API attributes, not row fields: the row
  // carries `name` only, so `.added` must not leak into it.
  assert.deepEqual({ ...(await first).value }, { name: 'ether1' });
  const stopped = iterator.return?.();
  const cancel = await router.nextCommand();
  assert.deepEqual(cancel.words, ['/cancel', `=tag=${command.tag}`]);
  router.send(['!done', `.tag=${command.tag}`]);
  await stopped;
});

test('command rejects an invalid timeoutMs before it reaches the timer', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  // `connect()` validates its `timeoutMs`; the per-command one used to fall
  // through to `setTimeout`, which clamps a negative or NaN delay to an
  // immediate fire, so the command timed out before the router saw it.
  for (const timeoutMs of [-1, 0, Number.NaN]) {
    assert.throws(
      () => client.command('/ip/address/print', { timeoutMs }),
      (error: unknown) =>
        error instanceof RangeError &&
        error.message === 'timeoutMs must be a finite number > 0',
    );
  }

  // A rejected call must have written nothing at all: the next sentence the
  // router sees is this command's, and it still carries the first tag.
  const promise = client.command('/ip/address/print', { timeoutMs: 1000 });
  const command = await router.nextCommand();
  assert.deepEqual(command.words, ['/ip/address/print', '.tag=1']);
  assert.ok(command.tag);
  router.send(['!done', `.tag=${command.tag}`]);
  await promise;
});

test('stream rejects an invalid highWaterMark at call time', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  // The queue that bounds buffering is built inside the generator, so without
  // this check the failure surfaced as a rejection from `next()`; a synchronous
  // throw at the call site is the declared behaviour.
  for (const highWaterMark of [0, -1, Number.NaN, 1.5]) {
    assert.throws(
      () => client.stream('/interface/listen', { highWaterMark }),
      (error: unknown) =>
        error instanceof RangeError &&
        error.message === 'highWaterMark must be an integer > 0',
    );
  }

  const iterable = client.stream('/interface/listen', { highWaterMark: 2 });
  const iterator = iterable[Symbol.asyncIterator]();
  const first = iterator.next();
  const command = await router.nextCommand();
  assert.deepEqual(command.words, ['/interface/listen', '.tag=1']);
  assert.ok(command.tag);
  router.send(['!re', '=name=ether1', `.tag=${command.tag}`]);
  assert.deepEqual({ ...(await first).value }, { name: 'ether1' });
  const stopped = iterator.return?.();
  const cancel = await router.nextCommand();
  assert.deepEqual(cancel.words, ['/cancel', `=tag=${command.tag}`]);
  router.send(['!done', `.tag=${command.tag}`]);
  await stopped;
});

test('an unchecked query key is forwarded verbatim to the router', async (t) => {
  const router = await FakeRouter.start();
  t.after(async () => {
    await router.close().catch(() => undefined);
  });
  const client = await connect(router);
  t.after(async () => {
    await client.close().catch(() => undefined);
  });

  // No schema is declared, so nothing checks the key: the client must send the
  // typo untouched and let the router's own reply decide the outcome.
  const promise = client.command('/ip/address/print', {
    query: (query) => query.eq('typ', 'ether1'),
  });
  const command = await router.nextCommand();
  assert.deepEqual(command.words, [
    '/ip/address/print',
    '?typ=ether1',
    '.tag=1',
  ]);
  assert.ok(command.tag);
  router.send(['!re', '=address=10.0.0.1/24', `.tag=${command.tag}`]);
  router.send(['!done', `.tag=${command.tag}`]);

  const result = await promise;
  assert.deepEqual(
    result.records.map((record) => ({ ...record })),
    [{ address: '10.0.0.1/24' }],
  );
});
