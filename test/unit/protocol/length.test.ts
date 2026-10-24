import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  decodeLength,
  encodeLength,
  MAX_WIRE_LENGTH,
} from '../../../src/protocol/index.js';
import { ProtocolError } from '../../../src/shared/index.js';

const cases: ReadonlyArray<readonly [number, readonly number[]]> = [
  [0, [0x00]],
  [0x01, [0x01]],
  [0x7f, [0x7f]],
  [0x80, [0x80, 0x80]],
  [0x3fff, [0xbf, 0xff]],
  [0x4000, [0xc0, 0x40, 0x00]],
  [0x1fffff, [0xdf, 0xff, 0xff]],
  [0x200000, [0xe0, 0x20, 0x00, 0x00]],
  [0x0fffffff, [0xef, 0xff, 0xff, 0xff]],
  [0x10000000, [0xf0, 0x10, 0x00, 0x00, 0x00]],
  [0xffffffff, [0xf0, 0xff, 0xff, 0xff, 0xff]],
];

test('encodeLength matches every documented tier', () => {
  for (const [value, expected] of cases) {
    assert.deepEqual([...encodeLength(value)], expected, `length ${value}`);
  }
});

test('decodeLength round-trips every tier and reports the prefix size', () => {
  for (const [value, expected] of cases) {
    const decoded = decodeLength(Buffer.from(expected));
    assert.deepEqual(decoded, { length: value, bytes: expected.length });
  }
});

test('decodeLength reads from an offset', () => {
  const buffer = Buffer.concat([Buffer.from([0xaa]), encodeLength(0x4000)]);
  assert.deepEqual(decodeLength(buffer, 1), { length: 0x4000, bytes: 3 });
});

test('decodeLength returns null for an incomplete prefix', () => {
  assert.equal(decodeLength(Buffer.alloc(0)), null);
  assert.equal(decodeLength(Buffer.from([0x80])), null);
  assert.equal(decodeLength(Buffer.from([0xc0, 0x40])), null);
  assert.equal(decodeLength(Buffer.from([0xe0, 0x20, 0x00])), null);
  assert.equal(decodeLength(Buffer.from([0xf0, 0x10, 0x00, 0x00])), null);
});

test('reserved control bytes fail loudly', () => {
  assert.throws(() => decodeLength(Buffer.from([0xf1])), ProtocolError);
  assert.throws(() => decodeLength(Buffer.from([0xf7])), ProtocolError);
  assert.throws(() => decodeLength(Buffer.from([0xf8])), ProtocolError);
  assert.throws(() => decodeLength(Buffer.from([0xff])), ProtocolError);
});

test('encodeLength rejects invalid values', () => {
  assert.throws(() => encodeLength(-1), RangeError);
  assert.throws(() => encodeLength(1.5), RangeError);
  assert.throws(() => encodeLength(Number.NaN), RangeError);
  assert.throws(() => encodeLength(MAX_WIRE_LENGTH + 1), RangeError);
});
