import { ProtocolError } from '../errors.js';
import type { WireEncoding } from './codec.js';
import { decodeLength } from './length.js';

export interface DecoderOptions {
  readonly maxWordBytes?: number;
  readonly encoding?: WireEncoding;
}

export class StreamDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private offset = 0;
  private expectedLength: number | null = null;
  private words: string[] = [];
  private readonly maxWordBytes: number;
  private readonly encoding: WireEncoding;

  constructor(options: DecoderOptions = {}) {
    this.maxWordBytes = options.maxWordBytes ?? 32 * 1024 * 1024;
    this.encoding = options.encoding ?? 'utf8';
  }

  get pendingBytes(): number {
    return this.buffer.length - this.offset;
  }

  feed(chunk: Buffer): string[][] {
    if (chunk.length > 0) {
      this.buffer =
        this.offset === 0
          ? Buffer.concat([this.buffer, chunk])
          : Buffer.concat([this.buffer.subarray(this.offset), chunk]);
      this.offset = 0;
    }

    const sentences: string[][] = [];

    while (true) {
      if (this.expectedLength === null) {
        const decoded = decodeLength(this.buffer, this.offset);
        if (decoded === null) break;
        this.offset += decoded.bytes;

        if (decoded.length > this.maxWordBytes) {
          throw new ProtocolError(
            `Word length ${decoded.length} exceeds limit ${this.maxWordBytes}`,
          );
        }

        if (decoded.length === 0) {
          if (this.words.length > 0) {
            sentences.push(this.words);
            this.words = [];
          }
          continue;
        }

        this.expectedLength = decoded.length;
      }

      const available = this.buffer.length - this.offset;
      if (available < this.expectedLength) break;

      const payload = this.buffer.subarray(
        this.offset,
        this.offset + this.expectedLength,
      );
      this.offset += this.expectedLength;
      this.words.push(payload.toString(this.encoding));
      this.expectedLength = null;
    }

    if (this.offset > 0) {
      this.buffer = this.buffer.subarray(this.offset);
      this.offset = 0;
    }

    return sentences;
  }
}
