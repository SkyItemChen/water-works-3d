/**
 * Share codes: human-friendly 8-10 char codes that wrap a replay payload.
 *
 * Format: WW3-<checksum><payload>
 *   payload  = base64url of the compressed replay op stream
 *   checksum = 2 base32 chars over the payload, so typos are caught early.
 *
 * The code is fully local: decoding requires only the bundled level data.
 */

import { decodeOps, encodeOps, levelIdForIndex } from './replay';
import { levelById } from './level';
import type { ReplayPayload } from './types';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function base32Checksum(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  return ALPHABET[h & 31] + ALPHABET[(h >>> 5) & 31];
}

export function encodeShareCode(payload: ReplayPayload): string {
  const body = encodeOps(payload);
  const check = base32Checksum(body);
  return `WW3-${check}${body}`;
}

export interface DecodedShareCode {
  ok: boolean;
  error?: string;
  payload?: ReplayPayload;
  levelName?: string;
}

export function decodeShareCode(code: string): DecodedShareCode {
  const cleaned = code.trim().replace(/\s+/g, '');
  const m = /^WW3-([A-Z0-9]{2})([A-Za-z0-9_-]+)$/i.exec(cleaned);
  if (!m) {
    return { ok: false, error: '短码格式不正确，应以 WW3- 开头' };
  }
  const body = m[2];
  const expected = base32Checksum(body);
  if (expected !== m[1].toUpperCase()) {
    return { ok: false, error: '校验位不匹配，短码可能被截断或抄错' };
  }
  let payload: ReplayPayload;
  try {
    const idx = decodeLevelIndex(body);
    const resolved = levelIdForIndex(idx);
    payload = decodeOps(body, resolved);
    if (!resolved) {
      return { ok: false, error: '短码中的关卡标识无效' };
    }
  } catch {
    return { ok: false, error: '短码内容损坏，无法解码' };
  }
  if (payload.l !== 'daily' && payload.l !== 'endless' && !levelById(payload.l)) {
    return { ok: false, error: `未知关卡：${payload.l}` };
  }
  const name =
    payload.l === 'daily' ? '每日挑战' : payload.l === 'endless' ? '无尽水厂' : levelById(payload.l)?.name;
  return { ok: true, payload, levelName: name };
}

function decodeLevelIndex(body: string): number {
  // First byte after version is the level index in the encoded layout.
  const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  } catch {
    return 0;
  }
  return bin.length > 1 ? bin.charCodeAt(1) : 0;
}

/** Copy helper with a graceful fallback for older browsers / file URLs. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
