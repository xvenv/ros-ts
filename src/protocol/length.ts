import { ProtocolError } from '../shared/index.js';

export const MAX_WIRE_LENGTH = 0xffffffff;

export function encodeLength(length: number): Buffer {
  if (!Number.isInteger(length) || length < 0 || length > MAX_WIRE_LENGTH) {
    throw new RangeError(`Invalid word length: ${length}`);
  }
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  if (length < 0x4000) {
    return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  }
  if (length < 0x200000) {
    return Buffer.from([
      (length >> 16) | 0xc0,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
  }
  if (length < 0x10000000) {
    return Buffer.from([
      (length >>> 24) | 0xe0,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    ]);
  }
  const out = Buffer.alloc(5);
  out[0] = 0xf0;
  out.writeUInt32BE(length, 1);
  return out;
}

export interface DecodedLength {
  readonly length: number;
  readonly bytes: number;
}

export function decodeLength(buffer: Buffer, offset = 0): DecodedLength | null {
  const first = buffer[offset];
  if (first === undefined) return null;

  if (first < 0x80) {
    return { length: first, bytes: 1 };
  }
  if ((first & 0xc0) === 0x80) {
    const second = buffer[offset + 1];
    if (second === undefined) return null;
    return { length: ((first & 0x3f) << 8) | second, bytes: 2 };
  }
  if ((first & 0xe0) === 0xc0) {
    const second = buffer[offset + 1];
    const third = buffer[offset + 2];
    if (second === undefined || third === undefined) return null;
    return {
      length: ((first & 0x1f) << 16) | (second << 8) | third,
      bytes: 3,
    };
  }
  if ((first & 0xf0) === 0xe0) {
    const second = buffer[offset + 1];
    const third = buffer[offset + 2];
    const fourth = buffer[offset + 3];
    if (second === undefined || third === undefined || fourth === undefined) {
      return null;
    }
    return {
      length:
        (((first & 0x0f) << 24) | (second << 16) | (third << 8) | fourth) >>> 0,
      bytes: 4,
    };
  }
  if (first === 0xf0) {
    if (offset + 4 >= buffer.length) return null;
    return { length: buffer.readUInt32BE(offset + 1), bytes: 5 };
  }
  throw new ProtocolError(
    `Reserved control byte 0x${first.toString(16).padStart(2, '0')}`,
  );
}
