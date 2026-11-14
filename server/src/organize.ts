import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';
import { Storage, StorageError, baseUrl } from './storage.js';
import { Contacts } from './contacts.js';

/** Ziele für erkannte Termine, Aufgaben und Einkäufe: Nextcloud-Kalender (CalDAV), Nextcloud Tasks (VTODO), Bring! */
export interface OrganizeSettings {
  calendar: string; calendarName: string;
  /** Leer = Chorus-Erinnerung statt Nextcloud Tasks */
  tasks: string; tasksName: string;
  bring: { email: string; pass: string; list: string; listName: string };
  /** Adressbuch: leer = aus, „all“ = alle, sonst Pfad */
  contacts: string; contactsName: string; contactsAt: number;
  /** Zusätzlicher CalDAV-Server (iCloud oder anderer); home = gefundene Kalender-Sammlung (volle URL) */
  caldav: { kind: 'icloud' | 'other'; url: string; user: string; pass: string; home: string };
}
const DEFAULTS: OrganizeSettings = { contacts: '', contactsName: '', contactsAt: 0, caldav: { kind: 'icloud', url: '', user: '', pass: '', home: '' }, calendar: '', calendarName: '', tasks: '', tasksName: '', bring: { email: '', pass: '', list: '', listName: '' } };
export interface OrganizePublic {
  nextcloud: boolean; calendar: string; calendarName: string; tasks: string; tasksName: string;
  contacts: string; contactsName: string; contactsAt: number; contactsCount: number;
  caldav: { kind: 'icloud' | 'other'; url: string; user: string; hasPass: boolean; enabled: boolean };
  bring: { email: string; hasPass: boolean; list: string; listName: string; enabled: boolean };
}
export interface CalEvent { title: string; start: string; end: string; allDay: boolean; location: string; note?: string }
export interface Task { title: string; due: string; note?: string }

const TZ = () => process.env.TZ || 'Europe/Berlin';
const BRING = 'https://api.getbring.com/rest/';
// Öffentlich bekannter Schlüssel der Bring!-Web-/Android-App (die API ist inoffiziell)
const BRING_KEY = 'cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp';

export class Organize {
  constructor(private store: Store) {}
  private storage() { return new Storage(this.store); }

  get settings(): OrganizeSettings {
    const s = this.store.getSetting<Partial<OrganizeSettings>>('organize', {});
    return { ...DEFAULTS, ...s, bring: { ...DEFAULTS.bring, ...s.bring }, caldav: { ...DEFAULTS.caldav, ...s.caldav } };
  }
  publicSettings(): OrganizePublic {
    const s = this.settings, b = s.bring;
    return {
      nextcloud: this.storage().publicSettings().nextcloud.enabled,
      calendar: s.calendar, calendarName: s.calendarName, tasks: s.tasks, tasksName: s.tasksName,
      caldav: { kind: s.caldav.kind, url: s.caldav.url, user: s.caldav.user, hasPass: !!s.caldav.pass, enabled: !!(s.caldav.home && s.caldav.pass) },
      contacts: s.contacts, contactsName: s.contactsName, contactsAt: s.contactsAt, contactsCount: s.contacts ? this.store.contactCount() : 0,
      bring: { email: b.email, hasPass: !!b.pass, list: b.list, listName: b.listName, enabled: !!(b.email && b.pass && b.list) },
    };
  }
  /** Leeres Passwort = unverändert, null = löschen */
  update(p: Record<string, any>) {
    const cur = this.settings;
    const str = (v: unknown, n = 300) => (v == null ? '' : String(v).trim().slice(0, n));
    for (const k of ['calendar', 'calendarName', 'tasks', 'tasksName'] as const) if (k in p) cur[k] = str(p[k]);
    if ('contactsName' in p) cur.contactsName = str(p.contactsName);
    if ('contacts' in p) {
      cur.contacts = str(p.contacts);
      if (cur.contacts && cur.contacts !== 'all' && !/^\/[^?#]*\/addressbooks\/[^?#]+$/.test(cur.contacts)) throw new StorageError(400, 'Ungültiges Adressbuch');
      if (!cur.contacts) { cur.contactsAt = 0; this.contactsApi().clear(); }
    }
    if ((cur.calendar && !this.okTarget(cur.calendar)) || (cur.tasks && !this.okTarget(cur.tasks))) throw new StorageError(400, 'Ungültiger Kalender');
    if (p.bring) {
      const b = p.bring, c = cur.bring;
      if ('email' in b && str(b.email) !== c.email) { c.email = str(b.email); this.store.setSetting('bringToken', null); }
      if ('pass' in b && b.pass !== '') { c.pass = b.pass == null ? '' : String(b.pass); this.store.setSetting('bringToken', null); }
      if ('list' in b) c.list = str(b.list, 80);
      if ('listName' in b) c.listName = str(b.listName, 80);
      if (!c.email || !c.pass) { c.list = ''; c.listName = ''; }
    }
    this.store.setSetting('organize', cur);
    return this.publicSettings();
  }

  // ---------- Nextcloud CalDAV ----------
  /** CalDAV-Zugang speichern und die Kalender suchen; null = trennen */
  async setCaldav(p: { kind?: unknown; url?: unknown; user?: unknown; pass?: unknown } | null): Promise<OrganizePublic> {
    const cur = this.settings;
    if (!p) {
      const drop = (h: string) => /^https?:\/\//.test(h);
      cur.caldav = { ...DEFAULTS.caldav };
      if (drop(cur.calendar)) { cur.calendar = ''; cur.calendarName = ''; }
      if (drop(cur.tasks)) { cur.tasks = ''; cur.tasksName = ''; }
      this.store.setSetting('organize', cur);
      return this.publicSettings();
    }
    const kind = p.kind === 'other' ? 'other' : 'icloud';
    const url = kind === 'icloud' ? 'https://caldav.icloud.com' : baseUrl(String(p.url ?? ''));
    const user = String(p.user ?? '').trim();
    const pass = p.pass ? String(p.pass).trim().replace(kind === 'icloud' ? /\s+/g : /^$/, '') : cur.caldav.pass;
    if (!/^https:\/\/[^/\s]+/.test(url) || !user || !pass) throw new StorageError(400, 'Adresse, Benutzer und Passwort fehlen');
    const home = await discoverHome(url, 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
    cur.caldav = { kind, url, user, pass, home };
    this.store.setSetting('organize', cur);
    return this.publicSettings();
  }
  private dav() {
    const c = this.settings.caldav;
    if (!c.home || !c.pass) throw new StorageError(400, 'Kein Kalender-Server verbunden (Einstellungen → Verbindungen).');
    return { home: c.home, origin: new URL(c.home).origin, auth: 'Basic ' + Buffer.from(`${c.user}:${c.pass}`).toString('base64'), label: c.kind === 'icloud' ? 'iCloud' : new URL(c.home).host };
  }
  /** Ziel: Nextcloud-Pfad oder volle URL unterhalb der gefundenen CalDAV-Sammlung */
  private okTarget(h: string) {
    if (!/^https?:\/\//.test(h)) return okHref(h);
    const home = this.settings.caldav.home;
    return !!home && h.startsWith(home) && h.length > home.length && !h.includes('..') && !/[?#]/.test(h);
  }
  private contactsApi() { return new Contacts(this.store, () => this.nc()); }
  addressBooks() { return this.contactsApi().books(); }
  /** Adressbuch neu laden (beim Einschalten, per Knopf und alle 6 Stunden) */
  async syncContacts(): Promise<string> {
    const s = this.settings;
    if (!s.contacts) throw new StorageError(400, 'Kontakte sind aus.');
    const n = await this.contactsApi().sync(s.contacts);
    this.store.setSetting('organize', { ...this.settings, contactsAt: Date.now() });
    return `${n} Kontakte geladen`;
  }
  private nc() {
    const st = this.storage();
    if (!st.publicSettings().nextcloud.enabled) throw new StorageError(400, 'Nextcloud ist nicht eingerichtet (Einstellungen → Verbindungen).');
    const n = st.settings.nextcloud;
    return { origin: new URL(n.url).origin, base: n.url, user: n.user, auth: 'Basic ' + Buffer.from(`${n.user}:${n.pass}`).toString('base64') };
  }
  /** Kalender aus Nextcloud und dem CalDAV-Server zusammen; Fehler einer Quelle blenden nur diese aus */
  async calendars(): Promise<{ href: string; name: string; events: boolean; tasks: boolean; source: string }[]> {
    const nc = this.storage().publicSettings().nextcloud.enabled, dav = this.publicSettings().caldav.enabled;
    if (!nc && !dav) throw new StorageError(400, 'Kein Kalender verbunden (Einstellungen → Verbindungen).');
    const [a, b] = await Promise.allSettled([nc ? this.ncCalendars() : Promise.resolve([]), dav ? this.davCalendars() : Promise.resolve([])]);
    if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
    return [
      ...(a.status === 'fulfilled' ? a.value.map((c) => ({ ...c, source: 'Nextcloud' })) : []),
      ...(b.status === 'fulfilled' ? b.value : []),
    ];
  }
  private async davCalendars() {
    const d = this.dav();
    const r = await call(d.home, { method: 'PROPFIND', headers: { Authorization: d.auth, Depth: '1', 'Content-Type': 'application/xml' }, body: CAL_PROPS }, d.label);
    if (r.status === 401) throw new StorageError(400, `${d.label} lehnt Benutzer oder Passwort ab`);
    if (r.status !== 207) throw new StorageError(422, `${d.label} antwortet mit ${r.status}`);
    const homePath = new URL(d.home).pathname;
    return parseCalendars(await r.text(), (h) => h.startsWith(homePath) && h.length > homePath.length && !h.includes('..'))
      .map((c) => ({ ...c, href: d.origin + c.href, source: d.label }));
  }
  private async ncCalendars() {
    const n = this.nc();
    const r = await call(`${n.base}/remote.php/dav/calendars/${encodeURIComponent(n.user)}/`, {
      method: 'PROPFIND', headers: { Authorization: n.auth, Depth: '1', 'Content-Type': 'application/xml' },
      body: CAL_PROPS,
    }, 'Nextcloud');
    if (r.status === 401) throw new StorageError(400, 'Nextcloud lehnt Nutzer oder App-Passwort ab');
    if (r.status !== 207) throw new StorageError(422, `Nextcloud antwortet mit ${r.status}`);
    return parseCalendars(await r.text());
  }
  private async put(href: string, uid: string, ics: string, who: string) {
    if (!href || !this.okTarget(href)) throw new StorageError(400, `Bitte zuerst in den Einstellungen einen ${who} wählen.`);
    const full = /^https?:\/\//.test(href);
    const t = full ? (() => { const d = this.dav(); return { url: href, auth: d.auth, label: d.label }; })() : (() => { const n = this.nc(); return { url: n.origin + href, auth: n.auth, label: 'Nextcloud' }; })();
    const r = await call(`${t.url.endsWith('/') ? t.url : t.url + '/'}${uid}.ics`, {
      method: 'PUT', headers: { Authorization: t.auth, 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: ics,
    }, t.label);
    if (r.status === 401) throw new StorageError(400, `${t.label} lehnt Benutzer oder Passwort ab`);
    if (r.status === 404) throw new StorageError(404, `Der gewählte ${who} existiert nicht mehr. Bitte in den Einstellungen neu wählen.`);
    if (!r.ok) throw new StorageError(422, `${t.label}: Eintrag ließ sich nicht anlegen (${r.status})`);
  }
  async addEvent(e: CalEvent): Promise<string> {
    const s = this.settings;
    const uid = randomUUID();
    await this.put(s.calendar, uid, eventIcs(e, uid), 'Kalender');
    return `Im Kalender „${s.calendarName || 'Kalender'}“ eingetragen`;
  }
  /** true = in Nextcloud Tasks angelegt; false = keine Aufgabenliste gewählt */
  async addTask(t: Task): Promise<string | null> {
    const s = this.settings;
    if (!s.tasks) return null;
    const uid = randomUUID();
    await this.put(s.tasks, uid, todoIcs(t, uid), 'Aufgabenliste');
    return `In „${s.tasksName || 'Aufgaben'}“ angelegt`;
  }

  // ---------- Bring! (inoffizielle API) ----------
  private async bringLogin(force = false): Promise<{ uuid: string; token: string }> {
    const b = this.settings.bring;
    if (!b.email || !b.pass) throw new StorageError(400, 'Bring! ist nicht eingerichtet (Einstellungen → Verbindungen).');
    const cached = this.store.getSetting<{ uuid: string; token: string; exp: number } | null>('bringToken', null);
    if (!force && cached && cached.exp > Date.now() + 60_000) return cached;
    const r = await call(`${BRING}v2/bringauth`, { method: 'POST', headers: { ...bringHead(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: b.email, password: b.pass }).toString() }, 'Bring!');
    if (r.status === 401 || r.status === 400 || r.status === 404) throw new StorageError(400, 'Bring! lehnt E-Mail oder Passwort ab');
    if (!r.ok) throw new StorageError(422, `Bring! antwortet mit ${r.status}`);
    const j = await r.json().catch(() => ({})) as { uuid?: string; access_token?: string; expires_in?: number };
    if (!j.uuid || !j.access_token) throw new StorageError(422, 'Bring!: unerwartete Antwort beim Anmelden');
    const tok = { uuid: j.uuid, token: j.access_token, exp: Date.now() + Math.max(600, Number(j.expires_in) || 3600) * 1000 };
    this.store.setSetting('bringToken', tok);
    return tok;
  }
  private async bring(path: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await this.bringLogin(attempt > 0);
      const r = await call(BRING + path, { ...init, headers: { ...bringHead(), Authorization: `Bearer ${t.token}`, 'X-BRING-USER-UUID': t.uuid, ...(init.headers ?? {}) } }, 'Bring!');
      if (r.status === 401 && attempt === 0) continue;
      if (!r.ok) throw new StorageError(422, `Bring! antwortet mit ${r.status}`);
      return r;
    }
    throw new StorageError(400, 'Bring! lehnt die Anmeldung ab');
  }
  async bringLists(): Promise<{ id: string; name: string }[]> {
    const { uuid } = await this.bringLogin();
    const j = await (await this.bring(`bringusers/${encodeURIComponent(uuid)}/lists`)).json() as { lists?: { listUuid: string; name: string }[] };
    return (j.lists ?? []).map((l) => ({ id: String(l.listUuid), name: String(l.name ?? 'Liste') }));
  }
  async bringAdd(items: { name: string; spec: string }[]): Promise<string> {
    const b = this.settings.bring;
    if (!b.list) throw new StorageError(400, 'Bitte zuerst in den Einstellungen eine Bring!-Liste wählen.');
    const list = items.map((i) => ({ name: String(i.name ?? '').trim().slice(0, 80), spec: String(i.spec ?? '').trim().slice(0, 80) })).filter((i) => i.name).slice(0, 40);
    if (!list.length) throw new StorageError(400, 'Keine Artikel ausgewählt');
    await this.bring(`v2/bringlists/${encodeURIComponent(b.list)}/items`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: list.map((i) => ({ accuracy: '0.0', altitude: '0.0', latitude: '0.0', longitude: '0.0', itemId: i.name, spec: i.spec, uuid: randomUUID(), operation: 'TO_PURCHASE' })), sender: '' }),
    });
    return list.length === 1 ? `„${list[0].name}“ steht auf „${b.listName || 'Bring!'}“` : `${list.length} Artikel auf „${b.listName || 'Bring!'}“ gesetzt`;
  }
}

function bringHead() { return { 'X-BRING-API-KEY': BRING_KEY, 'X-BRING-CLIENT': 'android', 'X-BRING-APPLICATION': 'bring', 'X-BRING-COUNTRY': 'DE', Accept: 'application/json' }; }
const okHref = (h: string) => /^\/[^?#]*\/calendars\/[^?#]+$/.test(h) && !h.includes('..');

async function call(url: string, init: RequestInit, who: string) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }); }
  catch (e: any) { throw new StorageError(422, `${who} nicht erreichbar: ${e?.cause?.code ?? e?.message ?? e}`); }
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const CAL_PROPS = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>';
export function hrefIn(xml: string, prop: string) {
  const inner = xml.match(new RegExp(`<(?:[\\w-]+:)?${prop}(?:\\s[^>]*[^/>])?>([\\s\\S]*?)</(?:[\\w-]+:)?${prop}>`, 'i'))?.[1];
  return inner?.match(/<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i)?.[1]?.trim();
}
/** PROPFIND, Weiterleitungen selbst folgen (fetch würde dabei die Anmeldung verwerfen), nur zu https */
async function propfind(url: string, auth: string, body: string, depth = '0'): Promise<{ status: number; text: string; url: string }> {
  for (let i = 0; i < 5; i++) {
    const r = await call(url, { method: 'PROPFIND', redirect: 'manual', headers: { Authorization: auth, Depth: depth, 'Content-Type': 'application/xml' }, body }, 'Kalender-Server');
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      const next = new URL(loc, url);
      if (next.protocol !== 'https:') throw new StorageError(422, 'Kalender-Server leitet auf eine unsichere Adresse um');
      url = next.toString(); continue;
    }
    return { status: r.status, text: await r.text(), url };
  }
  throw new StorageError(422, 'Kalender-Server: zu viele Weiterleitungen');
}
/** RFC 6764: Adresse → Benutzer (current-user-principal) → Kalender-Sammlung (calendar-home-set) */
export async function discoverHome(base: string, auth: string): Promise<string> {
  const P = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/><c:calendar-home-set/></d:prop></d:propfind>';
  let res: { status: number; text: string; url: string } | null = null;
  for (const u of [base, new URL('/.well-known/caldav', base).toString()]) {
    const r = await propfind(u, auth, P);
    if (r.status === 401) throw new StorageError(400, 'Der Server lehnt Benutzer oder Passwort ab (bei iCloud ein app-spezifisches Passwort nehmen)');
    if (r.status === 207) { res = r; if (hrefIn(r.text, 'calendar-home-set') || hrefIn(r.text, 'current-user-principal')) break; }
  }
  if (!res) throw new StorageError(422, 'Unter dieser Adresse wurde kein Kalender-Server gefunden');
  let home = hrefIn(res.text, 'calendar-home-set');
  if (!home) {
    const principal = hrefIn(res.text, 'current-user-principal');
    if (!principal) throw new StorageError(422, 'Der Server nennt kein Benutzerkonto');
    const r = await propfind(new URL(unxml(principal), res.url).toString(), auth, P);
    if (r.status !== 207) throw new StorageError(422, `Kalender-Server antwortet mit ${r.status}`);
    home = hrefIn(r.text, 'calendar-home-set');
    if (!home) throw new StorageError(422, 'Der Server nennt keine Kalender');
    res = r;
  }
  const u = new URL(unxml(home), res.url);
  if (u.protocol !== 'https:') throw new StorageError(422, 'Kalender-Server nur über https');
  return u.toString().replace(/\/?$/, '/');
}
export function parseCalendars(xml: string, ok: (h: string) => boolean = okHref) {
  const out: { href: string; name: string; events: boolean; tasks: boolean }[] = [];
  for (const m of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
    const body = m[1];
    const rt = body.match(/<(?:[\w-]+:)?resourcetype\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?resourcetype>/i)?.[1] ?? '';
    if (!/<(?:[\w-]+:)?calendar\b/i.test(rt)) continue;
    const href = unxml(body.match(/<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i)?.[1]?.trim() ?? '');
    const name = unxml(body.match(/<(?:[\w-]+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?displayname>/i)?.[1]?.trim() ?? '');
    const comps = [...body.matchAll(/<(?:[\w-]+:)?comp\b[^>]*name="([A-Z]+)"/gi)].map((c) => c[1].toUpperCase());
    // Ohne Angabe: alles erlaubt
    const events = !comps.length || comps.includes('VEVENT'), tasks = !comps.length || comps.includes('VTODO');
    if (!ok(href) || (!events && !tasks)) continue;
    let fallback = href.replace(/\/+$/, '').split('/').pop() ?? '';
    try { fallback = decodeURIComponent(fallback); } catch { /* so lassen */ }
    out.push({ href, name: name || fallback, events, tasks });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// ---------- iCalendar ----------
/** Lokale Zeit „YYYY-MM-DDTHH:MM“ in der Server-Zeitzone → UTC-Zeitstempel */
export function localToUtc(local: string, tz = TZ()): number {
  const [d, t = '00:00'] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const off = (ts: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(ts).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ts;
  };
  let ts = guess - off(guess);
  ts = guess - off(ts);
  return ts;
}
const utc = (ts: number) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (d: string) => d.replace(/-/g, '');
const nextDay = (d: string) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
export const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Zeilen nach RFC 5545 auf 75 Bytes falten */
function fold(line: string) {
  const out: string[] = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function wrap(kind: 'VEVENT' | 'VTODO', lines: string[]) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chorus//DE', 'CALSCALE:GREGORIAN', `BEGIN:${kind}`, ...lines, `END:${kind}`, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
export function eventIcs(e: CalEvent, uid = randomUUID()) {
  const lines = [`UID:${uid}`, `DTSTAMP:${utc(Date.now())}`, `SUMMARY:${icsText(e.title)}`];
  if (e.allDay) {
    const s = e.start.slice(0, 10);
    const end = e.end && e.end.length === 10 && e.end >= s ? nextDay(e.end) : nextDay(s);
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(s)}`, `DTEND;VALUE=DATE:${dateOnly(end)}`);
  } else {
    const s = localToUtc(e.start);
    const end = e.end && e.end.length === 16 ? localToUtc(e.end) : NaN;
    lines.push(`DTSTART:${utc(s)}`, `DTEND:${utc(end > s ? end : s + 3600_000)}`);
  }
  if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
  if (e.note) lines.push(`DESCRIPTION:${icsText(e.note)}`);
  return wrap('VEVENT', lines);
}
export function todoIcs(t: Task, uid = randomUUID()) {
  const lines = [`UID:${uid}`, `DTSTAMP:${utc(Date.now())}`, `CREATED:${utc(Date.now())}`, `SUMMARY:${icsText(t.title)}`, 'STATUS:NEEDS-ACTION'];
  if (t.due) lines.push(t.due.length === 10 ? `DUE;VALUE=DATE:${dateOnly(t.due)}` : `DUE:${utc(localToUtc(t.due))}`);
  if (t.note) lines.push(`DESCRIPTION:${icsText(t.note)}`);
  return wrap('VTODO', lines);
}
