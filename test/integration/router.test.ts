import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, it } from 'vite-plus/test';

import { RouterOS } from '../../src/index.js';
import {
  CancelledError,
  TimeoutError,
  TrapError,
} from '../../src/shared/index.js';

const hostValue = process.env.ROS_HOST;
const userValue = process.env.ROS_USER;
const password = process.env.ROS_PASSWORD ?? '';
const port =
  process.env.ROS_PORT === undefined ? undefined : Number(process.env.ROS_PORT);
const useTls = process.env.ROS_TLS === '1';
const insecureTls = process.env.ROS_TLS_INSECURE === '1';
const writeEnabled = process.env.ROS_TEST_WRITE === '1';
const skip = hostValue === undefined || userValue === undefined;

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

describe.skipIf(skip)('RouterOS integration', () => {
  let client: RouterOS;

  beforeAll(async () => {
    client = await RouterOS.connect({
      host: required(hostValue, 'ROS_HOST'),
      ...(port === undefined ? {} : { port }),
      user: required(userValue, 'ROS_USER'),
      password,
      tls: useTls ? (insecureTls ? { rejectUnauthorized: false } : true) : false,
      connectTimeoutMs: 10_000,
      timeoutMs: 10_000,
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('reads identity and resource', async () => {
    const identity = await client.command('/system/identity/print', {
      proplist: ['name'],
    });
    assert.ok(identity.records.length >= 1);

    const resource = await client.command('/system/resource/print', {
      proplist: ['version'],
    });
    assert.match(resource.records[0]?.version ?? '', /^\d+\.\d+/);
  });

  it('prints interfaces with proplist and query', async () => {
    const interfaces = await client.command('/interface/print', {
      proplist: ['name', 'type', 'running'],
    });
    assert.ok(interfaces.records.length >= 1);

    if (interfaces.records.length > 0) {
      const name = interfaces.records[0]?.name;
      assert.ok(name);
      const filtered = await client.command('/interface/print', {
        proplist: ['name'],
        query: (query) => query.eq('name', name),
      });
      assert.deepEqual(
        filtered.records.map((row) => row.name),
        [name],
      );
    }
  });

  it('reports a trap for an invalid command', async () => {
    await assert.rejects(
      client.command('/definitely/not/a/command'),
      TrapError,
    );
  });

  it('times out a slow command and stays connected', async () => {
    await assert.rejects(
      client.command('/ping', {
        attrs: { address: '127.0.0.1', count: '5' },
        timeoutMs: 50,
      }),
      TimeoutError,
    );
    const identity = await client.command('/system/identity/print', {
      proplist: ['name'],
    });
    assert.ok(identity.records.length >= 1);
  });

  it('streams listen and cancels on abort', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    try {
      for await (const _event of client.stream('/interface/listen', {
        signal: controller.signal,
      })) {
        break;
      }
    } catch (error) {
      assert.ok(error instanceof CancelledError);
    } finally {
      clearTimeout(timer);
    }
  });

  it.skipIf(!writeEnabled)(
    'creates, updates, and removes a queue with UTF-8 comment',
    async () => {
      const name = `ros-ts-test-${randomUUID()}`;
      let ret: string | undefined;

      try {
        const added = await client.command('/queue/simple/add', {
          attrs: {
            name,
            target: '192.0.2.1/32',
            'max-limit': '1M/1M',
            comment: 'café 日本語',
          },
        });
        ret = added.done.ret;

        const found = await client.command('/queue/simple/print', {
          proplist: ['name', 'comment', 'max-limit'],
          query: (query) => query.eq('name', name),
        });
        assert.equal(found.records.length, 1);
        assert.equal(found.records[0]?.comment, 'café 日本語');

        await client.command('/queue/simple/set', {
          attrs: {
            numbers: ret,
            'max-limit': '2M/2M',
          },
        });

        const updated = await client.command('/queue/simple/print', {
          proplist: ['max-limit'],
          query: (query) => query.eq('name', name),
        });
        const limit = updated.records[0]?.['max-limit'] ?? '';
        assert.ok(
          limit === '2M/2M' || limit === '2000000/2000000',
          `unexpected max-limit: ${limit}`,
        );
      } finally {
        if (ret !== undefined) {
          await client
            .command('/queue/simple/remove', { attrs: { numbers: ret } })
            .catch(() => undefined);
        }
      }
    },
  );
});
