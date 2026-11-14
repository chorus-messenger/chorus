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
