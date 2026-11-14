import { useEffect, useState, type ReactNode } from 'react';
import { api, organize, type OrganizeSettings } from '../api';
import { storageState, useStorage } from '../storageState';
import { Icon } from './Icon';
import { T } from '../i18n';

export type ConnKind = 'nextcloud' | 'calendar' | 'immich' | 'bring';
export const CONN_TITLES: Record<ConnKind, string> = { nextcloud: 'Nextcloud', calendar: 'iCloud', immich: 'Immich', bring: 'Bring!' };

let orgCache: OrganizeSettings | null = null;
function useOrganize(): [OrganizeSettings | null, (s: OrganizeSettings) => void] {
  const [s, setS] = useState(orgCache);
  useEffect(() => { organize.get().then((x) => { orgCache = x; setS(x); }, () => {}); }, []);
  return [s, (x) => { orgCache = x; setS(x); }];
}
const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

function Tile({ color, icon }: { color: string; icon: string }) {
  return <span className="ios-icon" style={{ background: color }}><Icon name={icon} size={17} /></span>;
}
function Status({ on }: { on: boolean }) {
  return on ? <span className="state connected">{T('Verbunden')}</span> : <span>{T('Aus')}</span>;
}
function Row({ tile, title, sub, value, onClick }: { tile: ReactNode; title: string; sub: string; value: ReactNode; onClick: () => void }) {
  return (
    <button className="ios-row" onClick={onClick}>
      {tile}
      <span className="ios-row-main">
        <span className="ios-row-text"><span className="ios-title">{title}</span><small>{sub}</small></span>
        <span className="ios-value">{value}</span>
        <Icon name="chevron" size={18} />
      </span>
    </button>
  );
}

/** Einstellungen → Verbindungen: Übersicht als Karten mit Status */
export function ConnectionsList({ onOpen }: { onOpen: (k: ConnKind) => void }) {
  const st = useStorage();
  const [o] = useOrganize();
  const ncUses = [T('Dateien'), o?.calendar && !o.calendar.startsWith('http') && T('Kalender'), o?.tasks && !o.tasks.startsWith('http') && T('Aufgaben'), o?.contacts && !o.contacts.startsWith('http') && T('Kontakte')].filter(Boolean).join(' · ');
  return (<>
    <div className="ios-card">
      <Row tile={<Tile color="#0082c9" icon="cloud" />} title="Nextcloud" sub={st?.nextcloud.enabled ? ncUses : T('Dateien, Kalender, Kontakte')} value={<Status on={!!st?.nextcloud.enabled} />} onClick={() => onOpen('nextcloud')} />
      <Row tile={<Tile color="#3e9bf5" icon="cloud" />} title={o?.caldav.enabled && o.caldav.kind === 'other' ? T('Eigener Server') : 'iCloud'} sub={o?.caldav.enabled ? [T('Kalender'), o.contacts.startsWith('http') && T('Kontakte')].filter(Boolean).join(' · ') : T('Kalender und Kontakte')} value={<Status on={!!o?.caldav.enabled} />} onClick={() => onOpen('calendar')} />
      <Row tile={<Tile color="#4250af" icon="photos" />} title="Immich" sub={T('Fotos und Videos')} value={<Status on={!!st?.immich.enabled} />} onClick={() => onOpen('immich')} />
      <Row tile={<Tile color="#e5484d" icon="check" />} title="Bring!" sub={o?.bring.listName || T('Einkaufsliste')} value={<Status on={!!o?.bring.enabled} />} onClick={() => onOpen('bring')} />
    </div>
    <p className="ios-foot">{T('Zugangsdaten liegen verschlüsselt in deinem Tresor.')}</p>
  </>);
}

export function ConnectionPage({ kind }: { kind: ConnKind }) {
  return kind === 'nextcloud' ? <NextcloudPage /> : kind === 'calendar' ? <CaldavPage /> : kind === 'immich' ? <ImmichPage /> : <BringPage />;
}

/** Anmelde-Karte: verbunden = eine Zeile mit Ändern/Trennen, sonst die Felder */
function Login({ on, who, fields, ready, busy, onSave, onOff, help }: {
  on: boolean; who: string; fields: ReactNode; ready: boolean; busy: boolean; onSave: () => void; onOff: () => void; help: string;
}) {
  const [edit, setEdit] = useState(false);
  if (on && !edit) return (
    <div className="ios-card pad">
      <div className="key-saved">
        <span className="key-ok"><Icon name="check" size={16} /><span className="trunc">{who}</span></span>
        <button className="btn small ghost" onClick={() => setEdit(true)}>{T('Ändern')}</button>
        <button className="btn small ghost danger" disabled={busy} onClick={onOff}>{T('Trennen')}</button>
      </div>
    </div>
  );
  return (<>
    <div className="ios-card pad">
      {fields}
      <div className="row">
        <button className="btn primary" disabled={busy || !ready} onClick={async () => { await onSave(); setEdit(false); }}>{busy ? T('Prüfe …') : T('Verbinden')}</button>
        {edit && <button className="btn ghost" onClick={() => setEdit(false)}>{T('Abbrechen')}</button>}
      </div>
    </div>
    <p className="ios-foot">{help}</p>
  </>);
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg('');
    try { const r = await fn(); if (r) setMsg(r); } catch (e: any) { setMsg(e.message ?? T('Fehler')); } finally { setBusy(false); }
  };
  return { busy, msg, run, note: msg ? <p className="ai-msg" role="status">{msg}</p> : null };
}

function NextcloudPage() {
  const s = useStorage();
  const [o, setO] = useOrganize();
  const [f, setF] = useState({ url: '', user: '', pass: '' });
  const { busy, run, note } = useRun();
  const on = !!s?.nextcloud.enabled;
  useEffect(() => {
    if (!on) return;
  }, [on]);
  if (!s) return <p className="muted">{T('Lade …')}</p>;

  const connect = () => run(async () => {
    storageState.set(await api.setStorage({ nextcloud: { enabled: true, url: f.url || s.nextcloud.url, user: f.user || s.nextcloud.user, pass: f.pass } }));
    setF({ url: '', user: '', pass: '' });
    return (await api.testStorage('nextcloud')).message;
  });
  const off = () => run(async () => { storageState.set(await api.setStorage({ nextcloud: { enabled: false } })); return T('Nextcloud getrennt.'); });

  return (<>
    <Login on={on} busy={busy} who={`${s.nextcloud.user} · ${host(s.nextcloud.url)}`} onSave={connect} onOff={off}
      ready={!!(f.url || s.nextcloud.url) && !!(f.user || s.nextcloud.user) && (!!f.pass || s.nextcloud.hasPass)}
      help={T('App-Passwort anlegen: Nextcloud → Einstellungen → Sicherheit. Eine Anmeldung gilt für Dateien, Kalender und Kontakte.')}
      fields={<>
        <input className="input" type="url" inputMode="url" autoComplete="off" placeholder="https://cloud.example.de" value={f.url || s.nextcloud.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <input className="input" autoComplete="off" autoCapitalize="none" placeholder={T('Benutzername')} value={f.user || s.nextcloud.user} onChange={(e) => setF({ ...f, user: e.target.value })} />
        <input className="input" type="password" autoComplete="off" placeholder={s.nextcloud.hasPass ? T('•••••••• gespeichert') : T('App-Passwort')} value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} />
      </>} />
    {note}

    {on && o && (<>
      <p className="ios-caption">{T('Verwenden für')}</p>
      <div className="ios-card pad">
        <CalendarPicks o={o} setO={setO} busy={busy} run={run} />
        <ContactsPick o={o} setO={setO} busy={busy} run={run} />
        <FolderPick folder={s.nextcloud.folder} busy={busy} onSave={(folder) => run(async () => { storageState.set(await api.setStorage({ nextcloud: { folder } })); })} />
      </div>
      <p className="ios-foot">{T('Kontakte werden alle 6 Stunden neu geladen. Eigene Namen in Chorus gehen vor.')}</p>
    </>)}
  </>);
}

/** Adressbuch für Namen und Bilder, aus allen verbundenen Quellen (Nextcloud, iCloud, anderer Server) */
function ContactsPick({ o, setO, busy, run }: { o: OrganizeSettings; setO: (s: OrganizeSettings) => void; busy: boolean; run: (fn: () => Promise<string | void>) => void }) {
  const [books, setBooks] = useState<{ href: string; name: string; source: string }[] | null>(null);
  useEffect(() => { organize.addressBooks().then(setBooks, () => setBooks([])); }, [o.caldav.contacts]);
  const multi = new Set((books ?? []).map((b) => b.source)).size > 1;
  const pick = (href: string) => run(async () => {
    setO(await organize.set({ contacts: href, contactsName: href === 'all' ? '' : books?.find((b) => b.href === href)?.name ?? '' }));
    if (!href) return T('Kontakte aus.');
    const r = await organize.syncContacts(); setO(r.settings); return T('{0} Kontakte geladen', r.settings.contactsCount);
  });
  const syncNow = () => run(async () => { const r = await organize.syncContacts(); setO(r.settings); return T('{0} Kontakte geladen', r.settings.contactsCount); });
  return (
    <Pick icon="users" color="#34c759" label={T('Kontakte')} value={o.contacts} busy={busy || !books}
      hint={o.contacts ? T('{0} Kontakte', o.contactsCount) : T('Namen und Bilder')}
      options={[['', books ? T('Aus') : T('Lade …')], ['all', T('Alle')], ...(books ?? []).map((b) => [b.href, multi ? `${b.name} · ${b.source}` : b.name] as [string, string])]} onChange={pick}
      extra={o.contacts ? <button className="icon-btn" title={T('Jetzt abgleichen')} disabled={busy} onClick={syncNow}><Icon name="refresh" size={18} /></button> : null} />
  );
}

type Cal = { href: string; name: string; events: boolean; tasks: boolean; source: string };
/** Ziel für Termine und Aufgaben, aus allen verbundenen Kalendern (Nextcloud, iCloud, anderer Server) */
function CalendarPicks({ o, setO, busy, run }: { o: OrganizeSettings; setO: (s: OrganizeSettings) => void; busy: boolean; run: (fn: () => Promise<string | void>) => void }) {
  const [cals, setCals] = useState<Cal[] | null>(null);
  useEffect(() => { organize.calendars().then(setCals, () => setCals([])); }, [o.caldav.enabled]);
  const multi = new Set((cals ?? []).map((c) => c.source)).size > 1;
  const opt = (c: Cal) => [c.href, multi ? `${c.name} · ${c.source}` : c.name] as [string, string];
  const pick = (kind: 'calendar' | 'tasks', href: string) => run(async () => {
    setO(await organize.set({ [kind]: href, [kind + 'Name']: cals?.find((c) => c.href === href)?.name ?? '' }));
  });
  return (<>
    <Pick icon="clock" color="#ff3b30" label={T('Termine')} hint={T('Für erkannte Termine')} value={o.calendar} busy={busy || !cals}
      options={[['', cals ? T('Aus') : T('Lade …')], ...(cals ?? []).filter((c) => c.events).map(opt)]} onChange={(v) => pick('calendar', v)} />
    <Pick icon="check" color="#ff9500" label={T('Aufgaben')} hint={T('Für erkannte Aufgaben')} value={o.tasks} busy={busy || !cals}
      options={[['', T('Erinnerung')], ...(cals ?? []).filter((c) => c.tasks).map(opt)]} onChange={(v) => pick('tasks', v)} />
  </>);
}

function CaldavPage() {
  const [o, setO] = useOrganize();
  const [kind, setKind] = useState<'icloud' | 'other' | null>(null);
  const [f, setF] = useState({ url: '', user: '', pass: '' });
  const { busy, run, note } = useRun();
  if (!o) return <p className="muted">{T('Lade …')}</p>;
  const k = kind ?? o.caldav.kind;
  const icloud = k === 'icloud';
  const connect = () => run(async () => {
    setO(await organize.setCaldav({ kind: k, url: f.url || o.caldav.url, user: f.user || o.caldav.user, pass: f.pass }));
    setF({ url: '', user: '', pass: '' });
    return T('Verbunden. Jetzt unten den Kalender wählen.');
  });
  const off = () => run(async () => { setO(await organize.setCaldav({ off: true })); return T('Kalender getrennt.'); });
  let who = o.caldav.user;
  try { if (o.caldav.kind === 'other') who += ' · ' + new URL(o.caldav.url).host; } catch { /* ohne Host */ }
  return (<>
    <Login on={o.caldav.enabled} busy={busy} who={o.caldav.kind === 'icloud' ? `iCloud · ${who}` : who} onSave={connect} onOff={off}
      ready={(icloud || !!(f.url || o.caldav.url)) && !!(f.user || o.caldav.user) && (!!f.pass || o.caldav.hasPass)}
      help={icloud ? T('Mit deiner Apple-ID und einem app-spezifischen Passwort (account.apple.com → Anmelden und Sicherheit → App-spezifische Passwörter), nicht dem normalen Passwort.') : T('Adresse des CalDAV-Servers, Chorus sucht die Kalender selbst.')}
      fields={<>
        <div className="seg">
          <button className={icloud ? 'on' : ''} onClick={() => setKind('icloud')}>iCloud</button>
          <button className={!icloud ? 'on' : ''} onClick={() => setKind('other')}>{T('Anderer Server')}</button>
        </div>
        {!icloud && <input className="input" type="url" inputMode="url" autoComplete="off" placeholder="https://dav.example.de" value={f.url || o.caldav.url} onChange={(e) => setF({ ...f, url: e.target.value })} />}
        <input className="input" type={icloud ? 'email' : 'text'} autoComplete="off" autoCapitalize="none" placeholder={icloud ? T('Apple-ID (E-Mail)') : T('Benutzername')} value={f.user || o.caldav.user} onChange={(e) => setF({ ...f, user: e.target.value })} />
        <input className="input" type="password" autoComplete="off" placeholder={o.caldav.hasPass ? T('•••••••• gespeichert') : icloud ? T('App-spezifisches Passwort') : T('Passwort')} value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} />
      </>} />
    {note}
    {o.caldav.enabled && (<>
      <p className="ios-caption">{T('Verwenden für')}</p>
      <div className="ios-card pad">
        <CalendarPicks o={o} setO={setO} busy={busy} run={run} />
        <ContactsPick o={o} setO={setO} busy={busy} run={run} />
      </div>
    </>)}
  </>);
}

function Pick({ icon, color, label, hint, value, options, onChange, busy, extra }: {
  icon: string; color: string; label: string; hint: string; value: string; options: [string, string][]; onChange: (v: string) => void; busy: boolean; extra?: ReactNode;
}) {
  return (
    <div className="conn-pick">
      <span className="ios-icon sm" style={{ background: color }}><Icon name={icon} size={15} /></span>
      <span className="conn-pick-text"><b>{label}</b><small>{hint}</small></span>
      {extra}
      <select className="input" value={value} disabled={busy} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
      </select>
    </div>
  );
}

function FolderPick({ folder, busy, onSave }: { folder: string; busy: boolean; onSave: (f: string) => void }) {
  const [v, setV] = useState(folder);
  return (
    <div className="conn-pick">
      <span className="ios-icon sm" style={{ background: '#0082c9' }}><Icon name="folder" size={15} /></span>
      <span className="conn-pick-text"><b>{T('Dateien')}</b><small>{T('Startordner')}</small></span>
      <input className="input" autoComplete="off" autoCapitalize="none" placeholder={T('Oberster Ordner')} value={v} disabled={busy}
        onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== folder && onSave(v.trim())} />
    </div>
  );
}

function ImmichPage() {
  const s = useStorage();
  const [f, setF] = useState({ url: '', key: '' });
  const { busy, run, note } = useRun();
  if (!s) return <p className="muted">{T('Lade …')}</p>;
  const connect = () => run(async () => {
    storageState.set(await api.setStorage({ immich: { enabled: true, url: f.url || s.immich.url, key: f.key } }));
    setF({ url: '', key: '' });
    return (await api.testStorage('immich')).message;
  });
  const off = () => run(async () => { storageState.set(await api.setStorage({ immich: { enabled: false } })); return T('Immich getrennt.'); });
  return (<>
    <Login on={s.immich.enabled} busy={busy} who={host(s.immich.url)} onSave={connect} onOff={off}
      ready={!!(f.url || s.immich.url) && (!!f.key || s.immich.hasKey)}
      help={T('API-Schlüssel: Immich → Kontoeinstellungen → API-Schlüssel. Rechte: asset.upload, asset.read, asset.view, asset.download, album.read.')}
      fields={<>
        <input className="input" type="url" inputMode="url" autoComplete="off" placeholder="https://fotos.example.de" value={f.url || s.immich.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <input className="input" type="password" autoComplete="off" placeholder={s.immich.hasKey ? T('•••••••• gespeichert') : T('API-Schlüssel')} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
      </>} />
    {note}
    {s.immich.enabled && <p className="ios-foot" style={{ marginTop: 0 }}>{T('Fotos und Videos speicherst du mit einem Tipp nach Immich und hängst sie von dort an.')}</p>}
  </>);
}

function BringPage() {
  const [o, setO] = useOrganize();
  const [f, setF] = useState({ email: '', pass: '' });
  const [lists, setLists] = useState<{ id: string; name: string }[] | null>(null);
  const { busy, run, note } = useRun();
  const has = !!(o?.bring.email && o.bring.hasPass);
  useEffect(() => { if (has) organize.bringLists().then(setLists, () => setLists([])); }, [has]);
  if (!o) return <p className="muted">{T('Lade …')}</p>;
  const connect = () => run(async () => {
    setO(await organize.set({ bring: { email: f.email || o.bring.email, pass: f.pass } }));
    setF({ email: '', pass: '' }); setLists(null);
    const l = await organize.bringLists(); setLists(l);
    return l.length ? T('Verbunden. Jetzt eine Liste wählen.') : T('Verbunden, aber keine Listen gefunden.');
  });
  const off = () => run(async () => { setLists(null); setO(await organize.set({ bring: { email: '', pass: null } })); return T('Bring! getrennt.'); });
  return (<>
    <Login on={has} busy={busy} who={o.bring.email} onSave={connect} onOff={off}
      ready={!!(f.email || o.bring.email) && (!!f.pass || o.bring.hasPass)}
      help={T('Bring! hat keine offizielle Schnittstelle, Chorus meldet sich wie die App an. Bei Google- oder Apple-Anmeldung vorher in Bring! ein Passwort setzen.')}
      fields={<>
        <input className="input" type="email" autoComplete="off" autoCapitalize="none" placeholder={T('E-Mail')} value={f.email || o.bring.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="input" type="password" autoComplete="off" placeholder={o.bring.hasPass ? T('•••••••• gespeichert') : T('Passwort')} value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} />
      </>} />
    {note}
    {has && (
      <div className="ios-card pad">
        <Pick icon="check" color="#e5484d" label={T('Liste')} hint={T('Für erkannte Einkäufe')} value={o.bring.list} busy={busy || !lists}
          options={[['', lists ? T('Bitte wählen') : T('Lade …')], ...(lists ?? []).map((l) => [l.id, l.name] as [string, string])]}
          onChange={(v) => run(async () => { setO(await organize.set({ bring: { list: v, listName: lists?.find((l) => l.id === v)?.name ?? '' } })); })} />
      </div>
    )}
  </>);
}
