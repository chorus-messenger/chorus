import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Chat, Message } from './types.js';

/**
 * Garmin-Uhr (Connect IQ): schlanke Schnittstelle für die Uhr-App.
 *
 * Anmeldung ohne Tippen auf der Uhr: Die Uhr holt sich einen 6-stelligen Code, den man in Chorus
 * (Einstellungen → Garmin-Uhr) eingibt. Danach bekommt die Uhr einen eigenen Geräte-Schlüssel,
 * der nur für die Uhr-Routen gilt (keine Einstellungen, keine Anhänge, kein Export) und sich
 * jederzeit einzeln widerrufen lässt. Der Server speichert nur den SHA-256 des Schlüssels,
 * verschlüsselt im Tresor des Profils. Ist der Tresor gesperrt, bekommt die Uhr nichts.
 */

export interface WatchDevice { id: string; name: string; hash: string; createdAt: number; lastUsed: number }
export interface WatchSettings {
  /** Feste Schnellantworten (auf der Uhr unter den KI-Vorschlägen) */
  replies: string[];
  /** E-Mail-Postfächer auf der Uhr zeigen */
  mail: boolean;
  /** Nachrichtentext in der Chatliste der Uhr zeigen (aus = nur Name und Zahl) */
  preview: boolean;
}
export const WATCH_DEFAULTS: Record<'de' | 'en', WatchSettings> = {
  de: { replies: ['Ok', 'Ja', 'Nein', 'Danke!', 'Bin unterwegs, melde mich später.', 'Ruf dich gleich an.'], mail: false, preview: true },
  en: { replies: ['Ok', 'Yes', 'No', 'Thanks!', 'On the go, will get back to you later.', 'Will call you shortly.'], mail: false, preview: true },
};

export function cleanSettings(raw: Partial<WatchSettings> | undefined, lang: 'de' | 'en'): WatchSettings {
  const d = WATCH_DEFAULTS[lang];
  const replies = Array.isArray(raw?.replies)
    ? raw!.replies.map((r) => String(r ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 12)
    : d.replies;
  return { replies, mail: typeof raw?.mail === 'boolean' ? raw.mail : d.mail, preview: typeof raw?.preview === 'boolean' ? raw.preview : d.preview };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Schlüssel = „Profil-ID.Zufall“, damit der Server das Profil findet, ohne alle Tresore zu durchsuchen */
export function newToken(profileId: string): { token: string; hash: string } {
  const token = `${profileId}.${randomBytes(32).toString('base64url')}`;
  return { token, hash: sha(token) };
}
export function profileOfToken(token: string): string | null {
  const m = /^([A-Za-z0-9_-]{1,40})\.[A-Za-z0-9_-]{40,60}$/.exec(token);
  return m ? m[1] : null;
}
export function matchDevice(list: WatchDevice[], token: string): WatchDevice | null {
  const h = Buffer.from(sha(token), 'hex');
  return list.find((d) => { const x = Buffer.from(d.hash, 'hex'); return x.length === h.length && timingSafeEqual(x, h); }) ?? null;
}

/** Signatur für Profilbild-Adressen der Uhr: Connect IQ kann bei Bildern keinen Authorization-Kopf
 *  mitschicken, deshalb steht pro Chat eine Signatur in der Adresse statt des Geräte-Schlüssels.
 *  Sie öffnet nur dieses eine Profilbild und wird mit dem Widerruf der Uhr ungültig. */
export function avatarSig(deviceHash: string, chatId: string): string {
  return createHmac('sha256', deviceHash).update('avatar:' + chatId).digest('base64url').slice(0, 24);
}
/** Dasselbe für Fotos/Videos einer Nachricht (Anhang Nr. i) */
export function mediaSig(deviceHash: string, msgId: string, i: number): string {
  return createHmac('sha256', deviceHash).update(`media:${msgId}:${i}`).digest('base64url').slice(0, 24);
}
export function checkMediaSig(deviceHash: string, msgId: string, i: number, sig: string): boolean {
  const a = Buffer.from(mediaSig(deviceHash, msgId, i)); const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function checkAvatarSig(deviceHash: string, chatId: string, sig: string): boolean {
  const a = Buffer.from(avatarSig(deviceHash, chatId)); const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Kopplung ----------
interface Pairing { secret: string; code: string; expires: number; token?: string; tries: number }
const PAIR_TTL = 10 * 60_000;

/** Offene Kopplungen nur im Speicher: nach einem Neustart holt sich die Uhr einfach einen neuen Code */
export class Pairings {
  private byCode = new Map<string, Pairing>();
  private sweep() { const now = Date.now(); for (const [k, p] of this.byCode) if (p.expires < now) this.byCode.delete(k); }
  start(): { pair: string; code: string; expiresIn: number } {
    this.sweep();
    if (this.byCode.size > 500) throw Object.assign(new Error('Zu viele offene Kopplungen'), { statusCode: 429 });
    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, '0'); while (this.byCode.has(code));
    const p: Pairing = { secret: randomBytes(24).toString('base64url'), code, expires: Date.now() + PAIR_TTL, tries: 0 };
    this.byCode.set(code, p);
    return { pair: p.secret, code, expiresIn: Math.round(PAIR_TTL / 1000) };
  }
  /** In Chorus eingegebener Code → Schlüssel für die wartende Uhr hinterlegen */
  approve(code: string, token: string): boolean {
    this.sweep();
    const p = this.byCode.get(code.replace(/\D/g, ''));
    if (!p || p.token) return false;
    p.token = token;
    p.expires = Math.min(p.expires, Date.now() + 2 * 60_000);
    return true;
  }
  /** Uhr fragt nach: Schlüssel genau einmal herausgeben */
  poll(secret: string): { state: 'waiting' | 'done' | 'gone'; token?: string } {
    this.sweep();
    for (const [k, p] of this.byCode) {
      if (p.secret.length !== secret.length || !timingSafeEqual(Buffer.from(p.secret), Buffer.from(secret))) continue;
      if (!p.token) return { state: 'waiting' };
      this.byCode.delete(k);
      return { state: 'done', token: p.token };
    }
    return { state: 'gone' };
  }
}

// ---------- Texte für die Uhr ----------
// Die Systemschriften der Uhr kennen keine Emojis (sie erscheinen als Kästchen): weg damit, Anhänge in Worten.
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}‍️⃣])+/gu;
/** Häufige Emojis als Text-Smileys: Die Schriften der Uhr haben keine Emojis, ohne Ersatz fehlte sonst die halbe Aussage */
const SMILEYS: [string, string][] = [
  ['😂', ":'D"], ['🤣', ":'D"], ['😹', ":'D"], ['😀', ':D'], ['😃', ':D'], ['😄', ':D'], ['😁', ':D'], ['😆', 'xD'], ['😅', '^^\''],
  ['🙂', ':)'], ['😊', ':)'], ['☺', ':)'], ['😉', ';)'], ['😜', ';P'], ['😛', ':P'], ['😝', 'xP'], ['😋', ':P'],
  ['😍', '*_*'], ['🥰', '<3'], ['😘', ':*'], ['😗', ':*'], ['😚', ':*'], ['😙', ':*'],
  ['😢', ":'("], ['😭', ":'("], ['😞', ':('], ['😔', ':('], ['🙁', ':('], ['☹', ':('], ['😟', ':('], ['🥺', ':('],
  ['😮', ':O'], ['😯', ':O'], ['😲', ':O'], ['😱', ':O'], ['😳', 'O_O'], ['🤯', ':O'],
  ['😐', ':|'], ['😑', '-_-'], ['🙄', '-_-'], ['😒', ':/'], ['😕', ':/'], ['🤔', 'hmm'], ['😬', ':S'],
  ['😠', '>:('], ['😡', '>:('], ['🤬', '>:('], ['😎', 'B)'], ['😇', 'O:)'], ['🤗', '(Umarmung)'], ['😴', 'zzz'], ['🥳', '\\o/'], ['🙈', '(Affe)'],
  ['❤', '<3'], ['♥', '<3'], ['💕', '<3'], ['💖', '<3'], ['💗', '<3'], ['💙', '<3'], ['💚', '<3'], ['💛', '<3'], ['🧡', '<3'], ['💜', '<3'], ['🖤', '<3'], ['🤍', '<3'], ['😻', '<3'], ['💔', '</3'],
  ['👍', '(y)'], ['👎', '(n)'], ['👌', '(ok)'], ['👏', '(Applaus)'], ['🙏', '(danke)'], ['💪', '(stark)'], ['✌', '(peace)'], ['👋', '(winkt)'], ['🤞', '(Daumen drücken)'],
  ['🎉', '(Party)'], ['🥂', '(Prost)'], ['🍻', '(Prost)'], ['🎂', '(Torte)'], ['🎁', '(Geschenk)'], ['🔥', '(Feuer)'], ['⭐', '*'], ['✨', '*'], ['💯', '(100)'],
  ['✅', '(ok)'], ['✔', '(ok)'], ['❌', '(x)'], ['❗', '!'], ['❓', '?'],
];
const SKIN_ZWJ = /[\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu;
function smileys(s: string): string {
  if (s.search(EMOJI) < 0) return s;
  let out = s;
  for (const [e, t] of SMILEYS) if (out.includes(e)) out = out.split(e).join(` ${t} `);
  return out.replace(SKIN_ZWJ, (m) => (m === '\u200D' ? ' ' : ''));
}

export function plain(s: string): string {
  return smileys(s).replace(EMOJI, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const WORDS = {
  de: { image: 'Foto', video: 'Video', audio: 'Audio', voice: 'Sprachnachricht', file: 'Datei', sticker: 'Sticker', gif: 'GIF', deleted: 'Nachricht gelöscht', once: 'Einmalansicht', me: 'Ich' },
  en: { image: 'Photo', video: 'Video', audio: 'Audio', voice: 'Voice message', file: 'File', sticker: 'Sticker', gif: 'GIF', deleted: 'Message deleted', once: 'View once', me: 'Me' },
};

export interface WatchMsg { id: string; me: boolean; from: string; ts: number; text: string; voice?: 1; tr?: 1; /** Foto/Video zum Ansehen: Anhang-Nr. und ob Video */ img?: number; vid?: 1 }
/** Erster Anhang, den die Uhr als Bild zeigen kann (Fotos, Video-Standbild; keine Sticker/GIFs) */
export function viewableIndex(m: Message): { i: number; video: boolean } | null {
  if (m.deleted || m.viewOnce) return null;
  const i = m.attachments.findIndex((a) => !a.gif && a.kind !== 'sticker' && (a.kind === 'video' || /^video\//i.test(a.mime) || (a.kind === 'image' && /^image\/(jpe?g|png|webp|heic|heif|avif|bmp)/i.test(a.mime))));
  if (i < 0) return null;
  const a = m.attachments[i];
  return { i, video: a.kind === 'video' || /^video\//i.test(a.mime) };
}
export function watchMessage(m: Message, lang: 'de' | 'en', group: boolean): WatchMsg {
  const w = WORDS[lang];
  const a = m.attachments[0];
  const isVoice = !!a && (a.kind === 'voice' || a.kind === 'audio');
  let text: string;
  if (m.deleted) text = `[${w.deleted}]`;
  else {
    const body = plain(m.translation && !m.fromMe && m.translationFrom ? m.translation : m.text);
    const label = a ? `[${a.gif || /^image\/gif/i.test(a.mime) ? w.gif : a.kind === 'file' ? `${w.file}: ${a.name}` : w[a.kind]}${m.viewOnce ? `, ${w.once}` : ''}]` : m.viewOnce ? `[${w.once}]` : '';
    const tr = isVoice && m.transcript ? plain(m.transcript) : '';
    text = [label, body, tr && `„${tr}“`].filter(Boolean).join(' ');
  }
  const out: WatchMsg = { id: m.id, me: m.fromMe, from: m.fromMe ? w.me : group ? cut(plain(m.senderName || ''), 24) : '', ts: Math.round(m.ts / 1000), text: cut(text, 600) };
  if (isVoice && !m.deleted) { out.voice = 1; if (m.transcript) out.tr = 1; }
  const v = viewableIndex(m);
  if (v) { out.img = v.i; if (v.video) out.vid = 1; }
  return out;
}

export interface WatchChat { id: string; t: string; n: string; u: number; ts: number; p?: string; mine?: 1; /** Profilbild-Adresse (relativ) */ a?: string }
export function watchChat(c: Chat, preview: boolean): WatchChat {
  const out: WatchChat = { id: c.id, t: cut(plain(c.title) || '?', 32), n: c.network, u: c.unread, ts: Math.round(c.lastTs / 1000) };
  if (preview) out.p = cut(plain(c.draft ? '' : c.lastText), 80);
  if (c.lastMine) out.mine = 1;
  return out;
}

/** Chatliste der Uhr: nicht archiviert, ohne Postfächer (außer eingeschaltet), Ungelesene zuerst nur über die Sortierung des Servers (angepinnt, neueste) */
export function watchChats(all: Chat[], s: WatchSettings, limit = 25): WatchChat[] {
  return all.filter((c) => !c.archived && (s.mail || c.network !== 'email') && c.lastTs > 0).slice(0, limit).map((c) => watchChat(c, s.preview));
}
