import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReply } from '../../../src/protocol/index.js';
import { ProtocolError } from '../../../src/shared/index.js';

test('parses a data reply with attributes and a tag', () => {
  const reply = parseReply([
    '!re',
    '=interface=ether1',
    '=comment=a=b',
    '=disabled=',
    '=.id=*1',
    '.tag=7',
  ]);

  assert.equal(reply.kind, 're');
  assert.equal(reply.tag, '7');
  assert.equal(Object.getPrototypeOf(reply.attributes), null);
  assert.deepEqual(
    { ...reply.attributes },
    {
      interface: 'ether1',
      comment: 'a=b',
      disabled: '',
      '.id': '*1',
    },
  );
  assert.deepEqual({ ...reply.apiAttributes }, { tag: '7' });
  assert.deepEqual(reply.plain, []);
  assert.equal(reply.fatalReason, undefined);
});

test('last duplicate attribute wins', () => {
  const reply = parseReply(['!re', '=a=1', '=a=2']);
  assert.deepEqual({ ...reply.attributes }, { a: '2' });
});

test('parses trap attributes', () => {
  const reply = parseReply([
    '!trap',
    '=message=invalid value',
    '=category=1',
    '.tag=2',
  ]);
  assert.equal(reply.kind, 'trap');
  assert.equal(reply.tag, '2');
  assert.deepEqual(
    { ...reply.attributes },
    {
      message: 'invalid value',
      category: '1',
    },
  );
});

test('parses empty and done replies', () => {
  assert.equal(parseReply(['!empty']).kind, 'empty');
  assert.equal(parseReply(['!done', '=ret=*1']).kind, 'done');
});

test('parses a fatal reason from plain words', () => {
  const reply = parseReply(['!fatal', 'not logged in']);
  assert.equal(reply.kind, 'fatal');
  assert.equal(reply.fatalReason, 'not logged in');
});

test('an empty tag means untagged', () => {
  assert.equal(parseReply(['!re', '.tag=']).tag, undefined);
});

test('rejects unknown reply words and non-reply sentences', () => {
  assert.throws(() => parseReply(['!wat']), ProtocolError);
  assert.throws(() => parseReply(['/x/print']), ProtocolError);
  assert.throws(() => parseReply(['constructor']), ProtocolError);
  assert.throws(() => parseReply([]), ProtocolError);
});

test('rejects an attribute with an empty key', () => {
  assert.throws(() => parseReply(['!re', '=']), ProtocolError);
});
