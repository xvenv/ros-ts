import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { PauseCounter } from '../../../src/transport/index.js';

test('pauses once while any stream is over its high-water mark', () => {
  const events: string[] = [];
  const counter = new PauseCounter(
    () => events.push('pause'),
    () => events.push('resume'),
  );

  assert.equal(counter.paused, false);

  counter.update(true);
  counter.update(true);
  assert.equal(counter.paused, true);
  assert.deepEqual(events, ['pause']);

  counter.update(false);
  assert.equal(counter.paused, true);
  assert.deepEqual(events, ['pause']);

  counter.update(false);
  assert.equal(counter.paused, false);
  assert.deepEqual(events, ['pause', 'resume']);

  counter.update(false);
  assert.equal(counter.paused, false);
  assert.deepEqual(events, ['pause', 'resume']);

  counter.update(true);
  assert.equal(counter.paused, true);
  assert.deepEqual(events, ['pause', 'resume', 'pause']);
});
