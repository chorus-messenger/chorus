import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';

/**
 * Link-Vorschau (Titel, Beschreibung, Bild) für Chat-Blasen und die Links-Ansicht der Galerie.
 * Der Server holt die Seite selbst, damit der Browser nicht jede Seite beim bloßen Ansehen der Liste kontaktiert.
 * Nur öffentliche Adressen (kein LAN, kein localhost), wenige Weiterleitungen, kleine Antworten, Zwischenspeicher im Speicher.
 * Links kommen von Fremden: die Adresse wird beim Verbindungsaufbau selbst geprüft (nicht vorher per DNS),
 * damit ein Name nicht erst öffentlich und beim zweiten Nachschlagen auf ein Gerät im Heimnetz zeigen kann (DNS-Rebinding).
 */
export interface LinkPreview { url: string; title: string | null; description: string | null; image: string | null; site: string | null; author?: string | null; video?: boolean }

const cache = new Map<string, { at: number; p: LinkPreview | null }>();
const imgCache = new Map<string, { at: number; mime: string; data: Buffer }>();
const TTL = 6 * 3600_000;
const UA = 'Mozilla/5.0 (compatible; ChorusLinkPreview/1.0)';

/** IPv6 in 8 Zahlen zerlegen (mit „::“ und eingebetteter IPv4 am Ende), null bei Unsinn */
function v6Words(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const b = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16);
  }
  const [l, r] = s.split('::');
  const part = (x: string | undefined) => (x ? x.split(':').map((h) => parseInt(h, 16)) : []);
  const a = part(l), b = part(r);
  const w = r === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill(0), ...b];
  return w.length === 8 && w.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? w : null;
}

export function privateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const w = v6Words(ip);
    if (!w) return true;
    // IPv4 eingebettet (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d): wie IPv4 prüfen
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return privateIp(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
    if (w[0] === 0x64 && w[1] === 0xff9b) return privateIp(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`);
    return w.every((x) => x === 0) || (w.slice(0, 7).every((x) => x === 0) && w[7] === 1)
      || (w[0] & 0xfe00) === 0xfc00 /* fc00::/7 */ || (w[0] & 0xffc0) === 0xfe80 /* Link-lokal */ || (w[0] & 0xffc0) === 0xfec0 /* site-lokal */
      || (w[0] & 0xff00) === 0xff00 /* Multicast */ || w[0] === 0x2002 /* 6to4 */ || (w[0] === 0x2001 && w[1] === 0) /* Teredo */ || (w[0] === 0x2001 && w[1] === 0xdb8);
  }
  const b = ip.split('.').map(Number);
  if (b.length !== 4 || b.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, c] = b;
  return a === 0 || a === 10 || a === 127 || (a === 100 && c >= 64 && c <= 127) || (a === 169 && c === 254) || (a === 172 && c >= 16 && c <= 31)
    || (a === 192 && c === 168) || (a === 192 && c === 0 && (b[2] === 0 || b[2] === 2)) || (a === 198 && (c === 18 || c === 19))
    || (a === 198 && c === 51 && b[2] === 100) || (a === 203 && c === 0 && b[2] === 113) || a >= 224;
}

/** DNS-Auflösung für die Verbindung selbst: jede Adresse muss öffentlich sein */
function safeLookup(host: string, opts: any, cb: (...a: any[]) => void) {
  dnsLookup(host, { ...opts, all: true }, (err, list: LookupAddress[]) => {
    if (err) return cb(err);
    if (!list.length || list.some((x) => privateIp(x.address))) return cb(Object.assign(new Error('Private Adresse'), { code: 'EPRIVATE' }));
    if (opts?.all) cb(null, list); else cb(null, list[0].address, list[0].family);
  });
}

function checkUrl(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Nur http(s)');
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new Error('Port nicht erlaubt');
  if (u.username || u.password) throw new Error('Keine Zugangsdaten in Links');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home$|\.home\.arpa$|\.fritz\.box$/i.test(host)) throw new Error('Private Adresse');
  if (isIP(host) && privateIp(host)) throw new Error('Private Adresse');
}

function request(u: URL, accept: string, deadline: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, {
      headers: { 'user-agent': UA, accept, 'accept-language': 'de,en;q=0.8', 'accept-encoding': 'gzip, deflate, br' },
      lookup: safeLookup as any, signal: deadline,
    }, resolve);
    req.on('error', reject);
  });
}

function decoded(res: http.IncomingMessage): Readable {
  const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

/** Holt eine öffentliche URL mit Größenlimit; folgt bis zu 3 Weiterleitungen (jede geprüft) */
async function safeFetch(raw: string, accept: string, maxBytes: number): Promise<{ url: string; mime: string; data: Buffer }> {
  let url = new URL(raw);
  const deadline = AbortSignal.timeout(8000);
  for (let hop = 0; hop < 4; hop++) {
    checkUrl(url);
    const res = await request(url, accept, deadline);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) { res.resume(); url = new URL(res.headers.location, url); continue; }
    if (status < 200 || status >= 300) { res.resume(); throw new Error(`HTTP ${status}`); }
    const mime = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const body = decoded(res);
    const chunks: Buffer[] = []; let n = 0;
    try {
      for await (const chunk of body) {
        chunks.push(chunk as Buffer); n += (chunk as Buffer).length;
        if (n >= maxBytes) break;
      }
    } finally { res.destroy(); }
    return { url: url.toString(), mime, data: Buffer.concat(chunks) };
  }
  throw new Error('Zu viele Weiterleitungen');
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
const clean = (s: string | undefined | null, max: number) => { const t = s ? decode(s).replace(/\s+/g, ' ').trim() : ''; return t ? t.slice(0, max) : null; };

export function parseMeta(html: string, base: string): Omit<LinkPreview, 'url'> {
  const head = html.slice(0, 200_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (n: string) => tag.match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((x) => x != null);
    const k = (attr('property') ?? attr('name') ?? '').toLowerCase();
    const v = attr('content');
    if (k && v != null && !meta.has(k)) meta.set(k, v);
  }
  const title = meta.get('og:title') ?? meta.get('twitter:title') ?? head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const desc = meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description');
  let image = meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? meta.get('twitter:image:src') ?? null;
  try { image = image ? new URL(decode(image), base).toString() : null; } catch { image = null; }
  if (image && !/^https?:/i.test(image)) image = null;
  return { title: clean(title, 200), description: clean(desc, 300), image, site: clean(meta.get('og:site_name'), 80) };
}

/** YouTube-Video-ID aus watch-, youtu.be-, shorts-, live- und embed-Links */
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

/** YouTube liefert ohne Cookie-Zustimmung kein brauchbares HTML, oEmbed dagegen Titel und Kanal */
async function youtubePreview(raw: string, id: string): Promise<LinkPreview> {
  const base: LinkPreview = { url: raw, title: null, description: null, image: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, site: 'YouTube', author: null, video: true };
  try {
    const r = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, 'application/json', 100_000);
    const j = JSON.parse(r.data.toString('utf8')) as { title?: string; author_name?: string };
    return { ...base, title: clean(j.title, 200), author: clean(j.author_name, 100) };
  } catch { return base; }
}

export async function linkPreview(raw: string): Promise<LinkPreview | null> {
  const hit = cache.get(raw);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  let p: LinkPreview | null = null;
  const yt = youtubeId(raw);
  if (yt) p = await youtubePreview(raw, yt);
  else try {
    const r = await safeFetch(raw, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 400_000);
    if (r.mime.startsWith('image/')) p = { url: r.url, title: null, description: null, image: r.url, site: null };
    else if (!r.mime || r.mime.includes('html')) p = { url: r.url, ...parseMeta(r.data.toString('utf8'), r.url) };
  } catch { p = null; }
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  cache.set(raw, { at: Date.now(), p });
  return p;
}

/** Vorschaubild über den Server laden (Privatsphäre: Fremdseite sieht nur den Server) */
export async function previewImage(raw: string): Promise<{ mime: string; data: Buffer } | null> {
  const hit = imgCache.get(raw);
  if (hit && Date.now() - hit.at < TTL) return hit;
  try {
    const r = await safeFetch(raw, 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', 3_000_000);
    if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(r.mime) || r.data.length >= 3_000_000) return null;
    const v = { at: Date.now(), mime: r.mime, data: r.data };
    let total = 0; for (const x of imgCache.values()) total += x.data.length;
    while (total > 60_000_000 && imgCache.size) { const k = imgCache.keys().next().value!; total -= imgCache.get(k)!.data.length; imgCache.delete(k); }
    imgCache.set(raw, v);
    return v;
  } catch { return null; }
}
