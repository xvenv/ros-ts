import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeSentence, encodeWord } from '../../../src/protocol/index.js';

test('encodeWord prefixes the byte length, not the string length', () => {
  assert.deepEqual([...encodeWord('abc')], [0x03, 0x61, 0x62, 0x63]);
  assert.deepEqual([...encodeWord('ü')], [0x02, 0xc3, 0xbc]);
  assert.deepEqual([...encodeWord('ü', 'latin1')], [0x01, 0xfc]);
});

test('encodeSentence terminates with a zero-length word', () => {
  const encoded = encodeSentence(['/login', '=name=admin']);
  assert.deepEqual(
    [...encoded],
    [
      0x06, 0x2f, 0x6c, 0x6f, 0x67, 0x69, 0x6e, 0x0b, 0x3d, 0x6e, 0x61, 0x6d,
      0x65, 0x3d, 0x61, 0x64, 0x6d, 0x69, 0x6e, 0x00,
    ],
  );
});

test('encodeSentence forwards a non-default encoding', () => {
  assert.deepEqual([...encodeSentence(['ü'], 'latin1')], [0x01, 0xfc, 0x00]);
});

test('encodeSentence rejects empty word lists and embedded empty words', () => {
  assert.throws(() => encodeSentence([]), TypeError);
  assert.throws(() => encodeSentence(['/x', '']), TypeError);
});

test('encodeSentence encodes a long value through the correct tier', () => {
  const value = 'a'.repeat(0x80);
  const encoded = encodeSentence([value]);
  assert.equal(encoded[0], 0x80);
  assert.equal(encoded[1], 0x80);
  assert.equal(encoded.length, 2 + 0x80 + 1);
});
