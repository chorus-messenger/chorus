import { createHash } from 'node:crypto';
import type { Store } from './db.js';
import { phoneKey, mailKey } from './db.js';
import { StorageError } from './storage.js';

/** Adressbuch per CardDAV (Nextcloud, gleiche Anmeldung wie für Dateien und Kalender) */
export interface Contact { name: string; phones: string[]; emails: string[]; photo: Buffer | null }

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const tag = (body: string, name: string) => body.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'))?.[1];

/** PROPFIND-Antwort → Adressbücher (ohne die automatisch erzeugten von Nextcloud, z. B. „Kürzlich kontaktiert“) */
export function parseBooks(xml: string) {
  const out: { href: string; name: string }[] = [];
  for (const m of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
    const body = m[1];
    if (!/<(?:[\w-]+:)?addressbook\b/i.test(tag(body, 'resourcetype') ?? '')) continue;
    const href = unxml(tag(body, 'href')?.trim() ?? '');
    if (!okBook(href) || /\/z-(app|server)-generated--/.test(href)) continue;
    let fallback = href.replace(/\/+$/, '').split('/').pop() ?? '';
    try { fallback = decodeURIComponent(fallback); } catch { /* so lassen */ }
    out.push({ href, name: unxml(tag(body, 'displayname')?.trim() ?? '') || fallback });
  }
  return out;
}
export const okBook = (h: string) => /^\/[^?#]*\/addressbooks\/[^?#]+$/.test(h) && !h.includes('..');

/** vCard 3/4 entfalten und die wenigen Felder lesen, die Chorus braucht */
export function parseVcards(text: string): Contact[] {
  const out: Contact[] = [];
  for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
    const lines = card.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const c: Contact = { name: '', phones: [], emails: [], photo: null };
    let n = '', org = '';
    for (const line of lines) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const head = line.slice(0, i), val = line.slice(i + 1);
      const prop = head.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
      const esc = (v: string) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
      if (prop === 'FN') c.name = esc(val);
      else if (prop === 'N') n = val.split(';').slice(0, 2).reverse().map(esc).filter(Boolean).join(' ');
      else if (prop === 'ORG') org = esc(val.split(';')[0]);
      else if (prop === 'TEL') c.phones.push(val.trim());
      else if (prop === 'EMAIL') c.emails.push(val.trim());
      else if (prop === 'PHOTO' && !c.photo) {
        const data = val.match(/^data:image\/[\w+.-]+;base64,(.+)$/i)?.[1] ?? (/ENCODING=(b|BASE64)/i.test(head) ? val : null);
        if (data) { const b = Buffer.from(data.replace(/\s+/g, ''), 'base64'); if (b.length > 100 && b.length < 2_000_000) c.photo = b; }
      }
    }
    c.name ||= n || org;
    if (c.name && (c.phones.length || c.emails.length)) out.push(c);
  }
  return out;
}

export class Contacts {
  constructor(private store: Store, private nc: () => { origin: string; base: string; user: string; auth: string }) {}

  async books() {
    const n = this.nc();
    const r = await call(`${n.base}/remote.php/dav/addressbooks/users/${encodeURIComponent(n.user)}/`, {
      method: 'PROPFIND', headers: { Authorization: n.auth, Depth: '1', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>',
    });
    if (r.status === 401) throw new StorageError(400, 'Nextcloud lehnt Nutzer oder App-Passwort ab');
    if (r.status !== 207) throw new StorageError(422, `Nextcloud antwortet mit ${r.status}`);
    return parseBooks(await r.text());
  }

  /** Alle Karten eines Adressbuchs auf einmal (REPORT addressbook-query ohne Filter) */
  private async cards(href: string): Promise<Contact[]> {
    const n = this.nc();
    const r = await call(`${n.origin}${href.endsWith('/') ? href : href + '/'}`, {
      method: 'REPORT', headers: { Authorization: n.auth, Depth: '1', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><c:address-data/></d:prop></c:addressbook-query>',
    });
    if (r.status === 401) throw new StorageError(400, 'Nextcloud lehnt Nutzer oder App-Passwort ab');
    if (r.status === 404) throw new StorageError(404, 'Das gewählte Adressbuch gibt es nicht mehr. Bitte neu wählen.');
    if (r.status !== 207) throw new StorageError(422, `Nextcloud antwortet mit ${r.status}`);
    const xml = await r.text();
    return [...xml.matchAll(/<(?:[\w-]+:)?address-data\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?address-data>/gi)].flatMap((m) => parseVcards(unxml(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, ''))));
  }

  /** book: Adressbuch-Pfad oder „all“; gibt die Zahl der Kontakte zurück */
  async sync(book: string): Promise<number> {
    const hrefs = book === 'all' ? (await this.books()).map((b) => b.href) : okBook(book) ? [book] : [];
    if (!hrefs.length) throw new StorageError(400, 'Kein Adressbuch gefunden');
    const all: Contact[] = [];
    for (const h of hrefs) all.push(...await this.cards(h));
    this.store.replaceContacts(all.map((c) => ({
      name: c.name.slice(0, 100), photo: c.photo,
      keys: [...new Set([...c.phones.map(phoneKey), ...c.emails.map(mailKey)].filter((k): k is string => !!k))],
    })).filter((c) => c.keys.length), (b) => createHash('sha256').update(b).digest('hex').slice(0, 32));
    return all.length;
  }
  clear() { this.store.replaceContacts([], () => ''); }
}

async function call(url: string, init: RequestInit) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }); }
  catch (e: any) { throw new StorageError(422, `Nextcloud nicht erreichbar: ${e?.cause?.code ?? e?.message ?? e}`); }
}
