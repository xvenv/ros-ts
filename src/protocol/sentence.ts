import { ProtocolError } from '../shared/index.js';

export type ReplyKind = 're' | 'done' | 'trap' | 'empty' | 'fatal';

export interface ParsedReply {
  readonly kind: ReplyKind;
  readonly tag: string | undefined;
  readonly attributes: Readonly<Record<string, string>>;
  readonly apiAttributes: Readonly<Record<string, string>>;
  readonly plain: readonly string[];
  readonly fatalReason: string | undefined;
}

const REPLY_WORDS: Readonly<Record<string, ReplyKind>> = {
  '!re': 're',
  '!done': 'done',
  '!trap': 'trap',
  '!empty': 'empty',
  '!fatal': 'fatal',
};

export function parseReply(words: readonly string[]): ParsedReply {
  const first = words[0];
  if (first === undefined) {
    throw new ProtocolError('Empty reply sentence');
  }
  // Own keys only: inherited names such as 'constructor' are not reply words.
  const kind = Object.hasOwn(REPLY_WORDS, first) ? REPLY_WORDS[first] : undefined;
  if (kind === undefined) {
    throw new ProtocolError(`Unknown reply word ${first}`);
  }

  // Null-prototype records so an attribute named __proto__ stays a plain
  // entry instead of hitting the Object.prototype setter.
  const attributes: Record<string, string> = Object.create(null);
  const apiAttributes: Record<string, string> = Object.create(null);
  const plain: string[] = [];
  let tag: string | undefined;

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === undefined) continue;

    if (word.startsWith('=')) {
      const body = word.slice(1);
      const separator = body.indexOf('=');
      if (separator < 0) {
        if (body === '') throw new ProtocolError('Attribute with an empty key');
        attributes[body] = '';
      } else {
        const key = body.slice(0, separator);
        if (key === '') throw new ProtocolError('Attribute with an empty key');
        attributes[key] = body.slice(separator + 1);
      }
      continue;
    }

    if (word.startsWith('.')) {
      const body = word.slice(1);
      const separator = body.indexOf('=');
      const key = separator < 0 ? body : body.slice(0, separator);
      const value = separator < 0 ? '' : body.slice(separator + 1);
      if (key === '') throw new ProtocolError('API attribute with an empty key');
      apiAttributes[key] = value;
      if (key === 'tag') {
        tag = value === '' ? undefined : value;
      }
      continue;
    }

    plain.push(word);
  }

  return {
    kind,
    tag,
    attributes: Object.freeze(attributes),
    apiAttributes: Object.freeze(apiAttributes),
    plain,
    fatalReason: kind === 'fatal' ? plain.join(' ') || undefined : undefined,
  };
}
