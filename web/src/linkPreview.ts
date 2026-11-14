import { api, type LinkPreview } from './api';

/** Link-Vorschauen: einmal je Link über den Server geladen (der Server holt Seite und Bild, das Gerät kontaktiert die Fremdseite nicht), höchstens vier gleichzeitig */
const previews = new Map<string, Promise<LinkPreview | null>>();
const done = new Map<string, LinkPreview | null>();
let running = 0; const waiting: (() => void)[] = [];
export function loadPreview(u: string): Promise<LinkPreview | null> {
  let p = previews.get(u);
  if (!p) {
    p = new Promise<void>((go) => { if (running < 4) { running++; go(); } else waiting.push(() => { running++; go(); }); })
      .then(() => api.linkPreview(u)).catch(() => null)
      .finally(() => { running--; waiting.shift()?.(); });
    void p.then((r) => done.set(u, r));
    previews.set(u, p);
  }
  return p;
}
/** Schon geladene Vorschau (undefined = noch nicht da), damit beim erneuten Öffnen eines Chats nichts nachblinkt */
export const cachedPreview = (u: string) => done.get(u);

const KEY = 'inbox:linkPreviews';
export const linkPreviewsOn = () => localStorage.getItem(KEY) !== '0';
export const setLinkPreviews = (on: boolean) => localStorage.setItem(KEY, on ? '1' : '0');

/** YouTube-Video-ID (wie server/src/linkpreview.ts) */
export function youtubeId(raw: string): string | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  const h = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}
