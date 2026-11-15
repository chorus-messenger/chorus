import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pairings, cleanSettings, matchDevice, newToken, plain, profileOfToken, watchMessage } from './watch.js';

test('Uhr: Schlüssel gehört zum Profil und passt nur zum eigenen Hash', () => {
  const { token, hash } = newToken('pab12cd34ef');
  assert.equal(profileOfToken(token), 'pab12cd34ef');
  assert.equal(profileOfToken('kaputt'), null);
  const list = [{ id: 'a', name: 'x', hash, createdAt: 0, lastUsed: 0 }];
  assert.equal(matchDevice(list, token)?.id, 'a');
  assert.equal(matchDevice(list, newToken('pab12cd34ef').token), null);
});

test('Uhr: Kopplung gibt den Schlüssel genau einmal heraus', () => {
  const p = new Pairings();
  const { pair, code } = p.start();
  assert.match(code, /^\d{6}$/);
  assert.equal(p.poll(pair).state, 'waiting');
  assert.equal(p.approve('000000' === code ? '111111' : '000000', 't'), false);
  assert.equal(p.approve(code.slice(0, 3) + ' ' + code.slice(3), 'geheim'), true);
  assert.equal(p.approve(code, 'nochmal'), false);
  assert.deepEqual(p.poll(pair), { state: 'done', token: 'geheim' });
  assert.equal(p.poll(pair).state, 'gone');
});

test('Uhr: Texte ohne Emojis, Anhänge in Worten, Transkript dabei', () => {
  assert.equal(plain('Hallo 👋🏽 du 🇩🇪!'), 'Hallo du !');
  const m: any = { id: 'm', chatId: 'c', fromMe: false, senderName: 'Anna 🌸', ts: 1000, text: '', deleted: false, transcript: 'Bin gleich da', attachments: [{ kind: 'voice', mime: 'audio/ogg', name: 'a.ogg' }] };
  assert.deepEqual(watchMessage(m, 'de', true), { id: 'm', me: false, from: 'Anna', ts: 1, text: '[Sprachnachricht] „Bin gleich da“', voice: 1, tr: 1 });
  assert.equal(watchMessage({ ...m, deleted: true }, 'en', false).text, '[Message deleted]');
});

test('Uhr: Einstellungen werden bereinigt', () => {
  assert.equal(cleanSettings(undefined, 'de').replies[0], 'Ok');
  const s = cleanSettings({ replies: ['  a  ', '', 'b'], mail: true } as any, 'en');
  assert.deepEqual(s, { replies: ['a', 'b'], mail: true, preview: true });
});
