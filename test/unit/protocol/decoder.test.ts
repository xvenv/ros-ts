import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { encodeSentence, StreamDecoder } from '../../../src/protocol/index.js';
import { ProtocolError } from '../../../src/shared/index.js';

function decodeInChunks(buffer: Buffer, sizes: readonly number[]): string[][] {
  const decoder = new StreamDecoder();
  const out: string[][] = [];
  let offset = 0;
  for (const size of sizes) {
    out.push(...decoder.feed(buffer.subarray(offset, offset + size)));
    offset += size;
  }
  out.push(...decoder.feed(buffer.subarray(offset)));
  return out;
}

test('decodes one complete sentence', () => {
  const decoder = new StreamDecoder();
  const sentences = decoder.feed(encodeSentence(['/x/print', '=a=b']));
  assert.deepEqual(sentences, [['/x/print', '=a=b']]);
});

test('decodes two sentences from one chunk', () => {
  const decoder = new StreamDecoder();
  const buffer = Buffer.concat([
    encodeSentence(['!re', '=a=1']),
    encodeSentence(['!done']),
  ]);
  assert.deepEqual(decoder.feed(buffer), [['!re', '=a=1'], ['!done']]);
});

test('decodes the same frame at every split position', () => {
  const frame = encodeSentence(['!re', '=interface=ether1', '=.id=*1']);
  for (let split = 0; split <= frame.length; split += 1) {
    assert.deepEqual(
      decodeInChunks(frame, [split, frame.length - split]),
      [['!re', '=interface=ether1', '=.id=*1']],
      `split at ${split}`,
    );
  }
});

test('decodes one byte at a time', () => {
  const frame = encodeSentence(['!re', '=comment=café 日本語']);
  const sizes = Array.from({ length: frame.length }, () => 1);
  assert.deepEqual(decodeInChunks(frame, sizes), [['!re', '=comment=café 日本語']]);
});

test('keeps a partial word buffered', () => {
  const decoder = new StreamDecoder();
  const frame = encodeSentence(['!re', '=a=value']);
  assert.deepEqual(decoder.feed(frame.subarray(0, 6)), []);
  assert.equal(decoder.pendingBytes, 1);
  assert.deepEqual(decoder.feed(frame.subarray(6)), [['!re', '=a=value']]);
  assert.equal(decoder.pendingBytes, 0);
});

test('ignores empty sentences', () => {
  const decoder = new StreamDecoder();
  assert.deepEqual(decoder.feed(Buffer.from([0x00])), []);
});

test('rejects reserved control bytes', () => {
  const decoder = new StreamDecoder();
  assert.throws(() => decoder.feed(Buffer.from([0xf8])), ProtocolError);
});

test('rejects words larger than maxWordBytes', () => {
  const decoder = new StreamDecoder({ maxWordBytes: 2 });
  assert.throws(() => decoder.feed(encodeSentence(['abc'])), ProtocolError);
});

test('latin1 decoding is opt-in', () => {
  const decoder = new StreamDecoder({ encoding: 'latin1' });
  const frame = encodeSentence(['!re', '=a=ü'], 'latin1');
  assert.deepEqual(decoder.feed(frame), [['!re', '=a=ü']]);
});

test('splits a 2-byte length descriptor at every position', () => {
  const word = 'a'.repeat(200);
  const frame = encodeSentence(['!re', word]);
  for (let split = 0; split <= 2; split += 1) {
    assert.deepEqual(
      decodeInChunks(frame, [4 + split, 2 - split, frame.length - 6]),
      [['!re', word]],
      `descriptor split at ${split}`,
    );
  }
});

test('splits a 3-byte length descriptor at every position', () => {
  const word = 'a'.repeat(0x4000);
  const frame = encodeSentence(['!re', word]);
  for (let split = 0; split <= 3; split += 1) {
    assert.deepEqual(
      decodeInChunks(frame, [4 + split, 3 - split, frame.length - 7]),
      [['!re', word]],
      `descriptor split at ${split}`,
    );
  }
});

test('decodes one byte at a time for a multi-byte descriptor word', () => {
  const word = 'a'.repeat(200);
  const frame = encodeSentence(['!re', word]);
  const sizes = Array.from({ length: frame.length }, () => 1);
  assert.deepEqual(decodeInChunks(frame, sizes), [['!re', word]]);
});

test('seeded random splits produce identical sentences', () => {
  const frames = Buffer.concat([
    encodeSentence(['!re', '=interface=ether1', '=comment=café 日本語']),
    encodeSentence(['!done']),
  ]);
  const expected = [['!re', '=interface=ether1', '=comment=café 日本語'], ['!done']];
  let seed = 0x12345678;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };

  for (let run = 0; run < 100; run += 1) {
    const sizes: number[] = [];
    let remaining = frames.length;
    while (remaining > 0) {
      const size = Math.min(remaining, 1 + (random() % 7));
      sizes.push(size);
      remaining -= size;
    }
    assert.deepEqual(decodeInChunks(frames, sizes), expected, `run ${run}`);
  }
});
