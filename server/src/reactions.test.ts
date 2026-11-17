import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchReaction } from './adapters/telegram.js';

test('Herz mit Variation Selector wird auf Telegram-Form abgebildet', () => {
  assert.equal(matchReaction('❤️', ['👍', '❤', '😂']), '❤');
  assert.equal(matchReaction('😂', ['👍', '❤', '😂']), '😂');
  assert.equal(matchReaction('🦄', ['👍', '❤']), null);
  assert.equal(matchReaction('👍', undefined), null);
});
