import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
  CancelledError,
  ClosedError,
  ConnectionError,
  FatalError,
  LoginError,
  ProtocolError,
  RouterOSError,
  TimeoutError,
  TrapError,
} from '../../../src/shared/index.js';

test('ConnectionError carries code, name, syscall, errno, and cause', () => {
  const cause = new Error('ECONNREFUSED');
  const error = new ConnectionError('connect failed', {
    syscall: 'connect',
    errno: -111,
    cause,
  });

  assert.ok(error instanceof RouterOSError);
  assert.ok(error instanceof ConnectionError);
  assert.equal(error.code, 'CONNECTION');
  assert.equal(error.name, 'ConnectionError');
  assert.equal(error.syscall, 'connect');
  assert.equal(error.errno, -111);
  assert.equal(error.cause, cause);
});

test('TrapError preserves category, message, and done attributes', () => {
  const done = Object.freeze({ ret: '*1' });
  const error = new TrapError(1, 'invalid value', done);

  assert.equal(error.code, 'TRAP');
  assert.equal(error.category, 1);
  assert.equal(error.trapMessage, 'invalid value');
  assert.equal(error.done, done);
  assert.match(error.message, /category 1/);
});

test('each error exposes its documented code', () => {
  assert.equal(new ClosedError('closed').code, 'CLOSED');
  assert.equal(new ProtocolError('desync').code, 'PROTOCOL');
  assert.equal(new LoginError('bad login').code, 'LOGIN');
  assert.equal(new FatalError('fatal').code, 'FATAL');
  assert.equal(new TimeoutError('late', 'command', 1000).code, 'TIMEOUT');
  assert.equal(new CancelledError('stop').code, 'CANCELLED');
});

test('TimeoutError and CancelledError keep their details', () => {
  const timeout = new TimeoutError('late', 'connect', 250);
  assert.equal(timeout.phase, 'connect');
  assert.equal(timeout.timeoutMs, 250);

  const reason = new Error('user navigated away');
  const cancelled = new CancelledError('stop', reason);
  assert.equal(cancelled.reason, reason);
});
