/**
 * BillScan Auth Utilities — BLAKE3 password hashing
 *
 * Uses @noble/hashes BLAKE3 (audited, zero-dependency).
 */

import { blake3 } from '@noble/hashes/blake3.js';

export function hashPassword(password: string, salt?: string): string {
  const s = salt || Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
  const hash = blake3(new TextEncoder().encode(s + password));
  return `${s}:${Buffer.from(hash).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = blake3(new TextEncoder().encode(salt + password));
  return Buffer.from(check).toString('hex') === hash;
}
