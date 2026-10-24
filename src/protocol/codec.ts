import { encodeLength } from './length.js';

export type WireEncoding = 'utf8' | 'latin1';

export function encodeWord(
  value: string,
  encoding: WireEncoding = 'utf8',
): Buffer {
  const payload = Buffer.from(value, encoding);
  return Buffer.concat([encodeLength(payload.length), payload]);
}

export function encodeSentence(
  words: readonly string[],
  encoding: WireEncoding = 'utf8',
): Buffer {
  if (words.length === 0) {
    throw new TypeError('A sentence needs at least one word');
  }
  const parts: Buffer[] = [];
  for (const word of words) {
    if (word === '') {
      throw new TypeError(
        'Empty words terminate a sentence and are not allowed',
      );
    }
    parts.push(encodeWord(word, encoding));
  }
  parts.push(Buffer.from([0x00]));
  return Buffer.concat(parts);
}
