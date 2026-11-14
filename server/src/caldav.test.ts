import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hrefIn, parseCalendars } from './organize.js';

test('CalDAV-Suche: leere Eigenschaft greift nicht auf fremdes href', () => {
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/</d:href>
<d:propstat><d:prop><d:current-user-principal><d:href>/123456/principal/</d:href></d:current-user-principal></d:prop></d:propstat>
<d:propstat><d:prop><c:calendar-home-set/></d:prop><d:status>HTTP/1.1 404</d:status></d:propstat></d:response></d:multistatus>`;
  assert.equal(hrefIn(xml, 'calendar-home-set'), undefined);
  assert.equal(hrefIn(xml, 'current-user-principal'), '/123456/principal/');
  assert.equal(hrefIn('<x:calendar-home-set xmlns:x="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">https://p63-caldav.icloud.com:443/123456/calendars/</href></x:calendar-home-set>', 'calendar-home-set'), 'https://p63-caldav.icloud.com:443/123456/calendars/');
});

test('iCloud-Kalender: nur Kalender unterhalb der Sammlung', () => {
  const xml = `<multistatus xmlns="DAV:"><response><href>/123456/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response>
<response><href>/123456/calendars/home/</href><propstat><prop><displayname>Privat</displayname><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop></propstat></response>
<response><href>/123456/calendars/inbox/</href><propstat><prop><resourcetype><collection/><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop></propstat></response></multistatus>`;
  const home = '/123456/calendars/';
  assert.deepEqual(parseCalendars(xml, (h) => h.startsWith(home) && h.length > home.length).map((c) => c.name), ['Privat']);
});
