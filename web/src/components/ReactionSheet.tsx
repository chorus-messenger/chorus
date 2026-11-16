import { useEffect, useState } from 'react';
import type { Message, Reaction } from '../api';
import { T } from '../i18n';
import { Icon } from './Icon';
import { Avatar } from './Rail';

/** Lesbarer Name, wenn der Messenger keinen liefert (Nummer statt WhatsApp-JID) */
function label(r: Reaction, peer: string) {
  if (r.senderName) return r.senderName;
  const n = r.senderId.split('@')[0];
  if (/^\+?\d{6,}$/.test(n)) return n.startsWith('+') ? n : '+' + n;
  return n || peer || T('Unbekannt');
}

/**
 * Reaktionsübersicht (Reaktion unter einer Blase antippen): wer mit welchem Emoji reagiert hat.
 * Oben Reiter je Emoji (plus „Alle“), die eigene Reaktion lässt sich hier entfernen.
 */
export function ReactionSheet({ msgs, group, peer, peerAvatar, avatars, onReact, onClose }: {
  msgs: Message[]; group: boolean; peer: string; peerAvatar: string | null; avatars: Record<string, string | null>;
  onReact: (m: Message, emoji: string | null) => void; onClose: () => void;
}) {
  const all = msgs.flatMap((m) => m.reactions.map((r) => ({ r, m })));
  const emojis = [...new Map(all.map(({ r }) => [r.emoji, all.filter((x) => x.r.emoji === r.emoji).length])).entries()].sort((a, b) => b[1] - a[1]);
  const [tab, setTab] = useState<string | null>(null);
  const shown = all.filter(({ r }) => !tab || r.emoji === tab).sort((a, b) => Number(b.r.fromMe) - Number(a.r.fromMe));
  // Alles weg (z. B. letzte eigene Reaktion entfernt): Sheet schließen
  useEffect(() => { if (!all.length) onClose(); }, [all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!all.length) return null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal msg-info react-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={T('Reaktionen')}>
        <header className="modal-head"><h2>{T('Reaktionen')}</h2><button className="icon-btn" onClick={onClose} aria-label={T('Schließen')}><Icon name="close" /></button></header>
        <div className="modal-body">
          {emojis.length > 1 && (
            <div className="rs-tabs" role="tablist">
              <button role="tab" aria-selected={!tab} className={!tab ? 'on' : ''} onClick={() => setTab(null)}>{T('Alle')} <span>{all.length}</span></button>
              {emojis.map(([e, n]) => (
                <button key={e} role="tab" aria-selected={tab === e} className={tab === e ? 'on' : ''} onClick={() => setTab(e)}>{e} <span>{n}</span></button>
              ))}
            </div>
          )}
          <ul className="mi-list">
            {shown.map(({ r, m }, i) => {
              const name = r.fromMe ? T('Du') : label(r, group ? '' : peer);
              const src = r.fromMe ? null : (avatars[r.senderId] ?? (group ? null : peerAvatar));
              const body = <>
                <Avatar name={name} size={32} src={src} />
                <span className="mi-label">{name}{r.fromMe && <small>{T('Tippen zum Entfernen')}</small>}</span>
                <span className="rs-emoji">{r.emoji}</span>
              </>;
              return (
                <li key={`${m.id}-${r.senderId}-${r.emoji}-${i}`} className="mi-row">
                  {r.fromMe
                    ? <button className="rs-mine" onClick={() => onReact(m, null)} aria-label={T('Reaktion entfernen')}>{body}</button>
                    : body}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
