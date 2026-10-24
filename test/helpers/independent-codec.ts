export function encodeWordIndep(value: string): Buffer {
  const payload = Buffer.from(value, 'utf8');
  const length = payload.length;
  let prefix: Buffer;
  if (length < 0x80) {
    prefix = Buffer.from([length]);
  } else if (length < 0x4000) {
    prefix = Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  } else if (length < 0x200000) {
    prefix = Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  } else if (length < 0x10000000) {
    prefix = Buffer.from([
      (length >>> 24) | 0xe0,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    ]);
  } else {
    prefix = Buffer.alloc(5);
    prefix[0] = 0xf0;
    prefix.writeUInt32BE(length, 1);
  }
  return Buffer.concat([prefix, payload]);
}

export function encodeSentenceIndep(words: readonly string[]): Buffer {
  return Buffer.concat([
    ...words.map((word) => encodeWordIndep(word)),
    Buffer.from([0x00]),
  ]);
}

export function decodeSentencesIndep(buffer: Buffer): {
  sentences: string[][];
  rest: Buffer;
} {
  const sentences: string[][] = [];
  let offset = 0;
  let words: string[] = [];

  while (offset < buffer.length) {
    const first = buffer[offset];
    if (first === undefined) break;

    let length = 0;
    let prefix = 0;
    if (first < 0x80) {
      length = first;
      prefix = 1;
    } else if ((first & 0xc0) === 0x80) {
      if (offset + 1 >= buffer.length) break;
      length = ((first & 0x3f) << 8) | (buffer[offset + 1] ?? 0);
      prefix = 2;
    } else if ((first & 0xe0) === 0xc0) {
      if (offset + 2 >= buffer.length) break;
      length =
        ((first & 0x1f) << 16) |
        ((buffer[offset + 1] ?? 0) << 8) |
        (buffer[offset + 2] ?? 0);
      prefix = 3;
    } else if ((first & 0xf0) === 0xe0) {
      if (offset + 3 >= buffer.length) break;
      length =
        (((first & 0x0f) << 24) |
          ((buffer[offset + 1] ?? 0) << 16) |
          ((buffer[offset + 2] ?? 0) << 8) |
          (buffer[offset + 3] ?? 0)) >>>
        0;
      prefix = 4;
    } else if (first === 0xf0) {
      if (offset + 4 >= buffer.length) break;
      length = buffer.readUInt32BE(offset + 1);
      prefix = 5;
    } else {
      throw new Error(`Reserved byte ${first}`);
    }

    if (offset + prefix + length > buffer.length) break;
    const payload = buffer.subarray(offset + prefix, offset + prefix + length);
    offset += prefix + length;

    if (length === 0) {
      if (words.length > 0) {
        sentences.push(words);
        words = [];
      }
    } else {
      words.push(payload.toString('utf8'));
    }
  }

  return { sentences, rest: buffer.subarray(offset) };
}
