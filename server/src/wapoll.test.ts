import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptPollVote, tryDecryptPollVote, optionIndexes } from './wapoll.js';

test('WhatsApp-Stimme verschlüsseln und wieder lesen', () => {
  const secret = randomBytes(32);
  const opts = ['Pizza', 'Sushi', 'Döner'];
  const enc = encryptPollVote(['Sushi', 'Döner'], { secret, pollMsgId: 'ABC', creator: '49111@s.whatsapp.net', voter: '123@lid' });
  const dec = tryDecryptPollVote(enc, secret, 'ABC', ['111@lid', '49111@s.whatsapp.net'], ['49222@s.whatsapp.net', '123@lid']);
  assert.ok(dec);
  assert.deepEqual(optionIndexes(opts, dec!), [1, 2]);
  assert.equal(tryDecryptPollVote(enc, randomBytes(32), 'ABC', ['49111@s.whatsapp.net'], ['123@lid']), null);
});
