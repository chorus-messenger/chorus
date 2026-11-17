import { useEffect, useState } from 'react';
import { api, type Chat, type Message, type Poll } from '../api';
import { Icon } from './Icon';
import { T } from '../i18n';

/** Messenger, bei denen Chorus Umfragen senden und abstimmen kann */
export const canPoll = (c: Chat) => c.network === 'demo' || c.network === 'telegram' || c.network === 'whatsapp' || c.network === 'signal';
/** Höchstzahl Antworten: WhatsApp 12, Telegram und Signal 10 */
const maxOpts = (c: Chat) => (c.network === 'whatsapp' ? 12 : 10);

function tally(p: Poll) {
  const counts = p.counts?.length === p.options.length ? p.counts : p.options.map((_, i) => p.votes.filter((v) => v.options.includes(i)).length);
  const voters = p.total ?? p.votes.filter((v) => v.options.length).length;
  return { counts, voters };
}

/** Umfrage in der Blase: Frage, Antworten mit Balken und Stimmen, antippen = abstimmen */
export function PollView({ m }: { m: Message }) {
  const p = m.poll!;
  const server = p.votes.find((v) => v.fromMe)?.options ?? [];
  const [mine, setMine] = useState<number[] | null>(null);
  const [err, setErr] = useState('');
  const [who, setWho] = useState(false);
  useEffect(() => setMine(null), [m.poll]);
  const sel = mine ?? server;
  const { counts, voters } = tally(p);
  const max = Math.max(1, ...counts);
  const closed = !!p.closed;
  const canVote = !closed && m.status !== 'pending' && m.status !== 'failed' && !m.remoteId.startsWith('local-');
  const named = p.votes.some((v) => !v.fromMe && v.options.length);

  const pick = (i: number) => {
    if (!canVote) return;
    const next = p.multi ? (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].sort()) : sel.includes(i) ? [] : [i];
    setMine(next); setErr('');
    api.vote(m.id, next).catch((e: any) => { setMine(null); setErr(e?.message ?? String(e)); });
  };

  return (
    <div className="poll" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="poll-kind"><Icon name="poll" size={13} /> {closed ? T('Umfrage beendet') : p.quiz ? T('Quiz') : p.multi ? T('Umfrage · mehrere Antworten') : T('Umfrage')}</div>
      <div className="poll-q">{p.question}</div>
      <div className="poll-opts">
        {p.options.map((o, i) => {
          const on = sel.includes(i);
          const n = counts[i] + (mine ? (on ? 1 : 0) - (server.includes(i) ? 1 : 0) : 0);
          const names = who ? p.votes.filter((v) => v.options.includes(i)).map((v) => v.fromMe ? T('Du') : v.name || v.id.split('@')[0]) : [];
          return (
            <button key={i} className={`poll-opt ${on ? 'on' : ''}`} disabled={!canVote} onClick={() => pick(i)} aria-pressed={on}>
              <span className={`poll-mark ${p.multi ? 'sq' : ''}`}>{on && <Icon name="check" size={12} />}</span>
              <span className="poll-txt">{o}{names.length > 0 && <small>{names.join(', ')}</small>}</span>
              <span className="poll-n">{n > 0 ? n : ''}</span>
              <span className="poll-bar" style={{ width: `${(Math.max(0, n) / max) * 100}%` }} />
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        {named
          ? <button className="poll-who" onClick={() => setWho((v) => !v)}>{voters === 1 ? T('1 Stimme') : T('{0} Stimmen', String(voters))} · {who ? T('Namen ausblenden') : T('Wer hat wie gestimmt?')}</button>
          : <span>{voters === 1 ? T('1 Stimme') : T('{0} Stimmen', String(voters))}</span>}
      </div>
      {err && <div className="poll-err">{err}</div>}
    </div>
  );
}

/** Neue Umfrage: Frage, Antworten (2 bis 10 bzw. 12), mehrere Antworten erlauben */
export function PollSheet({ chat, onClose, onError }: { chat: Chat; onClose: () => void; onError: (t: string) => void }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = opts.map((o) => o.trim()).filter(Boolean);
  const dup = new Set(filled).size !== filled.length;
  const ok = !!q.trim() && filled.length >= 2 && !dup;
  const setOpt = (i: number, v: string) => setOpts((os) => {
    const n = os.map((o, j) => (j === i ? v : o));
    // Immer ein leeres Feld am Ende anbieten (höchstens 12)
    if (n.every((o) => o.trim()) && n.length < maxOpts(chat)) n.push('');
    return n;
  });
  const send = async () => {
    setBusy(true);
    try { await api.sendPoll(chat.id, { question: q.trim(), options: filled, multi }); onClose(); }
    catch (e: any) { onError(e?.message ?? String(e)); setBusy(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal poll-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={T('Umfrage erstellen')}>
        <header className="modal-head"><h2>{T('Umfrage erstellen')}</h2><button className="icon-btn" onClick={onClose} aria-label={T('Schließen')}><Icon name="close" /></button></header>
        <div className="modal-body">
          <label className="poll-field"><span>{T('Frage')}</span>
            <input autoFocus value={q} maxLength={255} onChange={(e) => setQ(e.target.value)} placeholder={T('Was möchtest du fragen?')} />
          </label>
          <div className="poll-field"><span>{T('Antwortmöglichkeiten')}</span>
            {opts.map((o, i) => (
              <div key={i} className="poll-row">
                <input value={o} maxLength={100} onChange={(e) => setOpt(i, e.target.value)} placeholder={T('Antwort {0}', String(i + 1))} />
                {opts.length > 2 && <button className="icon-btn small" onClick={() => setOpts((os) => os.filter((_, j) => j !== i))} aria-label={T('Antwort entfernen')}><Icon name="close" size={16} /></button>}
              </div>
            ))}
            {dup && <small className="poll-err">{T('Jede Antwort darf nur einmal vorkommen')}</small>}
          </div>
          <label className="toggle poll-multi"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> {T('Mehrere Antworten erlauben')}</label>
          <button className="btn primary wide" disabled={!ok || busy} onClick={send}>{busy ? <span className="spinner" /> : T('Umfrage senden')}</button>
        </div>
      </div>
    </div>
  );
}
