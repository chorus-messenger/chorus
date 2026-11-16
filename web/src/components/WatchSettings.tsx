import { useEffect, useState } from 'react';
import { api, type WatchState } from '../api';
import { Icon } from './Icon';
import { T, locale } from '../i18n';

/** Einstellungen → Garmin-Uhr: Uhr per Code koppeln, Schnellantworten, was die Uhr zeigt */
export function WatchSection() {
  const [st, setSt] = useState<WatchState | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('Venu 3');
  const [replies, setReplies] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = (s: WatchState) => { setSt(s); setReplies(s.settings.replies.join('\n')); };
  useEffect(() => { api.watch().then(apply).catch((e) => setMsg(e.message)); }, []);

  const run = async (f: () => Promise<WatchState>, ok: string) => {
    setBusy(true); setMsg('');
    try { apply(await f()); setMsg(ok); } catch (e: any) { setMsg(e.message ?? String(e)); } finally { setBusy(false); }
  };
  if (!st) return <div className="ios-card pad"><small className="muted">{msg || T('Lädt …')}</small></div>;
  const s = st.settings;
  const save = (patch: Partial<typeof s>, ok: string) => run(() => api.watchSettings({ ...s, ...patch }), ok);
  const when = (t: number) => (t ? new Date(t).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : T('noch nie'));

  return (
    <>
      <p className="ios-caption">{T('Uhr koppeln')}</p>
      <form className="ios-card pad stack" onSubmit={(e) => { e.preventDefault(); void run(() => api.watchLink(code, name), T('Gekoppelt. Die Uhr lädt jetzt deine Chats.')).then(() => setCode('')); }}>
        <small className="muted">{T('Chorus-App auf der Uhr öffnen. Sie zeigt einen sechsstelligen Code, den du hier eingibst.')}</small>
        <input className="input" inputMode="numeric" autoComplete="off" placeholder={T('Code von der Uhr')} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))} />
        <input className="input" placeholder={T('Name der Uhr')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button className="btn" disabled={busy || code.replace(/\D/g, '').length !== 6}>{T('Koppeln')}</button>
        {msg && <small>{msg}</small>}
      </form>

      {st.devices.length > 0 && <>
        <p className="ios-caption">{T('Gekoppelte Uhren')}</p>
        <div className="ios-card">
          {st.devices.map((d) => (
            <div key={d.id} className="ios-row">
              <span className="ios-row-main">
                <span className="ios-row-text"><span className="ios-title">{d.name}</span><small>{T('Zuletzt aktiv: {0}', when(d.lastUsed))}</small></span>
                <button className="icon-btn" disabled={busy} aria-label={T('Entfernen')} onClick={() => void run(() => api.watchRemove(d.id), T('Uhr entfernt. Sie kommt nicht mehr an deine Nachrichten.'))}><Icon name="trash" size={18} /></button>
              </span>
            </div>
          ))}
        </div>
      </>}

      <p className="ios-caption">{T('Auf der Uhr')}</p>
      <div className="ios-card pad">
        <label className="toggle">
          <input type="checkbox" checked={s.preview} disabled={busy} onChange={(e) => void save({ preview: e.target.checked }, '')} />
          <span><b>{T('Vorschau in der Chatliste')}</b><small>{T('Aus: Die Liste zeigt nur Namen und Zahl der ungelesenen Nachrichten. Gut, wenn andere auf deine Uhr schauen können.')}</small></span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={s.mail} disabled={busy} onChange={(e) => void save({ mail: e.target.checked }, '')} />
          <span><b>{T('E-Mails')}</b><small>{T('Postfächer auch auf der Uhr zeigen.')}</small></span>
        </label>
      </div>

      <p className="ios-caption">{T('Schnellantworten')}</p>
      <div className="ios-card pad stack">
        <textarea className="input" rows={6} value={replies} onChange={(e) => setReplies(e.target.value)} />
        <small className="muted">{T('Eine Antwort pro Zeile, höchstens 12. Emojis zeigt die Uhr nicht an. In Chats mit KI-Freigabe stehen darüber drei KI-Vorschläge.')}</small>
        <button className="btn" disabled={busy || replies === s.replies.join('\n')} onClick={() => void save({ replies: replies.split('\n') }, T('Gespeichert.'))}>{T('Speichern')}</button>
      </div>
      <p className="ios-foot">{T('Die Uhr bekommt einen eigenen Schlüssel, der nur Chats lesen und Antworten senden kann. Ist Chorus gesperrt, zeigt die Uhr nichts an.')}</p>
    </>
  );
}
