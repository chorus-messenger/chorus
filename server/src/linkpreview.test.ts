import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeta, youtubeId } from './linkpreview.js';

test('Link-Vorschau liest OpenGraph und löst relative Bilder auf', () => {
  const html = `<html><head><title>Fallback</title><meta property="og:title" content="Hallo &amp; Welt">
    <meta name="description" content='Kurz'><meta property="og:image" content="/bild.jpg"><meta property="og:site_name" content="Beispiel"></head></html>`;
  assert.deepEqual(parseMeta(html, 'https://example.org/a/b'), { title: 'Hallo & Welt', description: 'Kurz', image: 'https://example.org/bild.jpg', site: 'Beispiel' });
});
test('Link-Vorschau ohne Meta nimmt den Titel', () => {
  assert.equal(parseMeta('<title>  Nur   Titel </title>', 'https://x.de').title, 'Nur Titel');
  assert.equal(parseMeta('<meta property="og:image" content="javascript:alert(1)">', 'https://x.de').image, null);
});
test('YouTube-Links werden erkannt', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://m.youtube.com/shorts/abcDEF12345'), 'abcDEF12345');
  assert.equal(youtubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/@kanal'), null);
  assert.equal(youtubeId('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), null);
});
test('Link-Vorschau lässt keine privaten Adressen durch, auch nicht als IPv6-Schreibweise', async () => {
  const { privateIp } = await import('./linkpreview.js');
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.178.179', '172.20.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '192.0.0.1',
    '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:c0a8:b2b3', '0:0:0:0:0:ffff:c0a8:0101', '::127.0.0.1', '64:ff9b::c0a8:1',
    'fd00::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '2002:c0a8:101::1', 'unsinn', '1.2.3'])
    assert.equal(privateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '142.250.185.78', '2a00:1450:4001:82b::200e', '::ffff:8.8.8.8', '64:ff9b::808:808'])
    assert.equal(privateIp(ip), false, ip);
});
