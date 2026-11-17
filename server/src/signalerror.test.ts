import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalError } from './adapters/signal.js';

test('Signal-Rate-Limit verständlich', () => {
  assert.equal(signalError({ message: 'Untrusted' }), 'Untrusted');
  assert.match(signalError({ message: 'Failed to send message due to rate limiting', data: { response: { results: [{ type: 'RATE_LIMIT_FAILURE', retryAfterSeconds: 300 }] } } }), /etwa 5 Minuten/);
  assert.match(signalError({ message: 'Failed due to rate limiting' }), /ein paar Minuten/);
  assert.match(signalError({ message: 'rate limit', data: { results: [{ type: 'PROOF_REQUIRED_FAILURE', token: 'x' }] } }), /Bestätigung/);
});
