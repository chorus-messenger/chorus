import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalError, challengeToken } from './adapters/signal.js';

test('Signal-Rate-Limit verständlich', () => {
  assert.equal(signalError({ message: 'Untrusted' }), 'Untrusted');
  assert.match(signalError({ message: 'Failed to send message due to rate limiting', data: { response: { results: [{ type: 'RATE_LIMIT_FAILURE', retryAfterSeconds: 300 }] } } }), /etwa 5 Minuten/);
  assert.match(signalError({ message: 'Failed due to rate limiting' }), /ein paar Minuten/);
  assert.match(signalError({ message: 'rate limit', data: { results: [{ type: 'PROOF_REQUIRED_FAILURE', token: 'x' }] } }), /Spam-Bestätigung/);
});

test('Challenge-Token finden', () => {
  assert.equal(challengeToken({ message: 'x', data: { response: { results: [{ type: 'PROOF_REQUIRED_FAILURE', token: 'abc-123', retryAfterSeconds: 86400 }] } } }), 'abc-123');
  assert.equal(challengeToken({ message: 'CAPTCHA proof required for sending to "x", available options "[CAPTCHA]" with challenge token "tok-9", or wait "60" seconds.' }), 'tok-9');
  assert.equal(challengeToken({ message: 'Failed to send message due to rate limiting' }), null);
});
