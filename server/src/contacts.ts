import { createHash } from 'node:crypto';
import type { Store } from './db.js';
import { phoneKey, mailKey } from './db.js';
import { StorageError } from './storage.js';

/** Adressbuch per CardDAV (Nextcloud, gleiche Anmeldung wie für Dateien und Kalender) */
export interface Contact { name: string; phones: string[]; emails: string[]; photo: Buffer | null }

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const tag = (body: string, name: string) => body.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'))?.[1];

/** PROPFIND-Antwort → Adressbücher (ohne die automatisch erzeugten von Nextcloud, z. B. „Kürzlich kontaktiert“) */
export function parseBooks(xml: string, ok: (h: string) => boolean = okBook) {
  const out: { href: string; name: string }[] = [];
  for (const m of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
    const body = m[1];
    if (!/<(?:[\w-]+:)?addressbook\b/i.test(tag(body, 'resourcetype') ?? '')) continue;
    const href = unxml(tag(body, 'href')?.trim() ?? '');
    if (!ok(href) || /\/z-(app|server)-generated--/.test(href)) continue;
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

/** Wo Adressbücher liegen: full = Bücher als volle URL speichern (fremder Server), sonst als Pfad (Nextcloud, wie bisher) */
export interface BookSource { label: string; auth: string; home: string; full: boolean }

export class Contacts {
  constructor(private store: Store, private sources: BookSource[]) {}

  /** Gehört der Pfad bzw. die URL zu einer verbundenen Quelle? Liefert Quelle und volle URL */
  private resolve(book: string): { src: BookSource; url: string } | null {
    if (book.includes('..') || /[?#]/.test(book)) return null;
    for (const src of this.sources) {
      const home = new URL(src.home);
      const url = src.full ? book : book.startsWith('/') ? home.origin + book : '';
      if (!url) continue;
      if (src.full ? url.startsWith(src.home) && url.length > src.home.length : okBook(book) && url.startsWith(home.origin + '/')) return { src, url };
    }
    return null;
  }
  okBook(book: string) { return !!this.resolve(book); }

  async books(): Promise<{ href: string; name: string; source: string }[]> {
    if (!this.sources.length) throw new StorageError(400, 'Keine Kontakte verbunden (Einstellungen → Verbindungen).');
    const res = await Promise.allSettled(this.sources.map(async (src) => {
      const r = await call(src.home, {
        method: 'PROPFIND', headers: { Authorization: src.auth, Depth: '1', 'Content-Type': 'application/xml' },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>',
      }, src.label);
      if (r.status === 401) throw new StorageError(400, `${src.label} lehnt Benutzer oder Passwort ab`);
      if (r.status !== 207) throw new StorageError(422, `${src.label} antwortet mit ${r.status}`);
      const homePath = new URL(src.home).pathname, origin = new URL(src.home).origin;
      return parseBooks(await r.text(), src.full ? (h) => h.startsWith(homePath) && h.length > homePath.length : okBook)
        .map((b) => ({ ...b, href: src.full ? origin + b.href : b.href, source: src.label }));
    }));
    const ok = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (!ok.length && res.some((r) => r.status === 'rejected')) throw (res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    return ok;
  }

  /** Alle Karten eines Adressbuchs: REPORT addressbook-query, sonst Liste + multiget in Paketen */
  private async cards(book: string): Promise<Contact[]> {
    const t = this.resolve(book);
    if (!t) throw new StorageError(400, 'Ungültiges Adressbuch');
    const url = t.url.endsWith('/') ? t.url : t.url + '/';
    const report = (body: string) => call(url, { method: 'REPORT', headers: { Authorization: t.src.auth, Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body }, t.src.label);
    const check = (r: Response) => {
      if (r.status === 401) throw new StorageError(400, `${t.src.label} lehnt Benutzer oder Passwort ab`);
      if (r.status === 404) throw new StorageError(404, 'Das gewählte Adressbuch gibt es nicht mehr. Bitte neu wählen.');
    };
    const q = await report('<?xml version="1.0"?><c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><c:address-data/></d:prop></c:addressbook-query>');
    check(q);
    if (q.status === 207) {
      const xml = await q.text();
      if (/address-data/i.test(xml)) return cardsOf(xml);
    }
    // Rückfall: Karten auflisten und in Paketen holen
    const list = await call(url, { method: 'PROPFIND', headers: { Authorization: t.src.auth, Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' }, t.src.label);
    check(list);
    if (list.status !== 207) throw new StorageError(422, `${t.src.label} antwortet mit ${list.status}`);
    const path = new URL(url).pathname;
    const hrefs = [...(await list.text()).matchAll(/<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/gi)].map((m) => unxml(m[1].trim())).filter((h) => h !== path && h.startsWith(path));
    const out: Contact[] = [];
    for (let i = 0; i < hrefs.length; i += 200) {
      const esc = (h: string) => h.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const r = await report(`<?xml version="1.0"?><c:addressbook-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><c:address-data/></d:prop>${hrefs.slice(i, i + 200).map((h) => `<d:href>${esc(h)}</d:href>`).join('')}</c:addressbook-multiget>`);
      check(r);
      if (r.status !== 207) throw new StorageError(422, `${t.src.label} antwortet mit ${r.status}`);
      out.push(...cardsOf(await r.text()));
    }
    return out;
  }

  /** book: Adressbuch (Pfad/URL) oder „all“; gibt die Zahl der Kontakte zurück */
  async sync(book: string): Promise<number> {
    const hrefs = book === 'all' ? (await this.books()).map((b) => b.href) : this.okBook(book) ? [book] : [];
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

const cardsOf = (xml: string) => [...xml.matchAll(/<(?:[\w-]+:)?address-data\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?address-data>/gi)].flatMap((m) => parseVcards(unxml(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ''))));

async function call(url: string, init: RequestInit, who: string) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }); }
  catch (e: any) { throw new StorageError(422, `${who} nicht erreichbar: ${e?.cause?.code ?? e?.message ?? e}`); }
}
