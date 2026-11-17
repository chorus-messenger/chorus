import { randomBytes } from 'node:crypto';
import { aesEncryptGCM, decryptPollVote, hmacSign, proto, sha256 } from '@whiskeysockets/baileys';

/**
 * WhatsApp-Umfragen: Stimmen sind verschlüsselt (AES-GCM mit einem Schlüssel aus dem messageSecret der Umfrage,
 * der ID der Umfrage, dem Ersteller und dem Abstimmenden). Gewählt wird per SHA-256 des Antworttexts.
 */
export function encryptPollVote(selected: string[], ctx: { secret: Buffer; pollMsgId: string; creator: string; voter: string }) {
  const sign = Buffer.concat([Buffer.from(ctx.pollMsgId), Buffer.from(ctx.creator), Buffer.from(ctx.voter), Buffer.from('Poll Vote'), Buffer.from([1])]);
  const key0 = hmacSign(ctx.secret, new Uint8Array(32) as Buffer, 'sha256');
  const key = hmacSign(sign, key0, 'sha256');
  const iv = randomBytes(12);
  const plain = proto.Message.PollVoteMessage.encode({ selectedOptions: selected.map((o) => sha256(Buffer.from(o))) }).finish();
  return { encPayload: aesEncryptGCM(Buffer.from(plain), key, iv, Buffer.from(`${ctx.pollMsgId}\u0000${ctx.voter}`)), encIv: iv };
}

/** Stimme entschlüsseln; Ersteller und Abstimmender sind je nach Gruppe als Telefonnummer oder LID verschlüsselt, daher alle Paare probieren */
export function tryDecryptPollVote(vote: { encPayload?: Uint8Array | null; encIv?: Uint8Array | null }, secret: Buffer, pollMsgId: string, creators: string[], voters: string[]): Buffer[] | null {
  if (!vote.encPayload || !vote.encIv) return null;
  for (const c of [...new Set(creators.filter(Boolean))]) for (const v of [...new Set(voters.filter(Boolean))]) {
    try {
      const r = decryptPollVote({ encPayload: vote.encPayload, encIv: vote.encIv } as any, { pollCreatorJid: c, pollMsgId, pollEncKey: secret, voterJid: v });
      return (r.selectedOptions ?? []).map((x) => Buffer.from(x));
    } catch { /* nächstes Paar */ }
  }
  return null;
}

/** Gewählte Hashes → Indizes der Antworten */
export function optionIndexes(options: string[], hashes: Uint8Array[]): number[] {
  const hs = options.map((o) => sha256(Buffer.from(o)));
  return hashes.flatMap((h) => { const i = hs.findIndex((x) => x.equals(Buffer.from(h))); return i < 0 ? [] : [i]; });
}
