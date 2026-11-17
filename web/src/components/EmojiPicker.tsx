import { useMemo, useState } from 'react';
import { EMOJI_GROUPS, splitEmoji } from '../util';

const RECENT_KEY = 'inbox:recent-emoji';

/** Ohne Variation Selector vergleichen (Telegram schickt „❤“, wir zeigen „❤️“) */
export const sameEmoji = (a: string, b: string) => a.replace(/\uFE0F/g, '') === b.replace(/\uFE0F/g, '');
/** Einzelne Zeichen aus dem BMP (z. B. „❤“) als Emoji darstellen */
export const showEmoji = (e: string) => /^[\u2000-\u3300]$/.test(e) ? e + '\uFE0F' : e;

/** only: nur diese Emojis anbieten (z. B. erlaubte Telegram-Reaktionen) */
export function EmojiPicker({ onPick, only }: { onPick: (e: string) => void; only?: string[] }) {
  const [tab, setTab] = useState(0);
  const recent: string[] = useMemo(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } }, []);
  const groups = useMemo(() => {
    const g = EMOJI_GROUPS.map(([n, s]) => [n, splitEmoji(s)] as [string, string[]]);
    if (only) return [['In diesem Chat möglich', only.map(showEmoji)] as [string, string[]]];
    return recent.length ? [['Zuletzt', recent] as [string, string[]], ...g] : g;
  }, [recent, only]);
  const pick = (e: string) => {
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    onPick(e);
  };
  return (
    <div className="emoji-picker" onMouseDown={(e) => e.preventDefault()}>
      {groups.length > 1 && <div className="emoji-tabs">
        {groups.map(([n, list], i) => (
          <button key={n} className={i === tab ? 'on' : ''} onClick={() => setTab(i)} title={n}>{list[0]}</button>
        ))}
      </div>}
      <div className="emoji-title">{groups[tab][0]}</div>
      <div className="emoji-grid">
        {groups[tab][1].map((e, i) => <button key={i} onClick={() => pick(e)}>{e}</button>)}
      </div>
    </div>
  );
}
