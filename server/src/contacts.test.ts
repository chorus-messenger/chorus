import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVcards, parseBooks } from './contacts.js';
import { phoneKey, chatKeys } from './db.js';

test('vCard: Name, Nummern, Bild, gefaltete Zeilen', () => {
  const png = Buffer.alloc(200, 7).toString('base64');
  const v = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Anna Beispiel\r\nTEL;TYPE=CELL:0171 234 56\r\n 78\r\nitem1.EMAIL:anna@example.de\r\nPHOTO;ENCODING=b;TYPE=JPEG:${png}\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:4.0\r\nN:Muster;Max;;;\r\nTEL:+31 6 1234 5678\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Ohne Nummer\r\nEND:VCARD\r\n`;
  const c = parseVcards(v);
  assert.equal(c.length, 2);
  assert.equal(c[0].name, 'Anna Beispiel');
  assert.deepEqual(c[0].phones, ['0171 234 5678']);
  assert.equal(c[0].photo?.length, 200);
  assert.equal(c[1].name, 'Max Muster');
});

test('Nummern und Chat-Schlüssel', () => {
  assert.equal(phoneKey('0171 2345678'), '491712345678');
  assert.equal(phoneKey('+49 (171) 234-5678'), '491712345678');
  assert.equal(phoneKey('0049 171 2345678'), '491712345678');
  assert.equal(phoneKey('112'), null);
  assert.deepEqual(chatKeys('491712345678@s.whatsapp.net'), ['491712345678']);
  assert.deepEqual(chatKeys('+491712345678'), ['491712345678']);
  assert.deepEqual(chatKeys('abc-uuid', '+31 6 12345678'), ['31612345678']);
  assert.deepEqual(chatKeys('x@y.de|abc', null, 'X@Y.de'), ['x@y.de']);
});

test('Adressbücher ohne automatisch erzeugte', () => {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
<d:response><d:href>/remote.php/dav/addressbooks/users/w/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/addressbooks/users/w/contacts/</d:href><d:propstat><d:prop><d:displayname>Kontakte</d:displayname><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/addressbooks/users/w/z-app-generated--contactsinteraction--recent/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>`;
  assert.deepEqual(parseBooks(xml), [{ href: '/remote.php/dav/addressbooks/users/w/contacts/', name: 'Kontakte' }]);
});
