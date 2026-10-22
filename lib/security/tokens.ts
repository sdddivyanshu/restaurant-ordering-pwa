import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { appSecret } from "@/lib/env";

/** URL-safe random token with `bytes` bytes of entropy (default 32 = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string): string {
  return createHmac("sha256", appSecret()).update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I confusion

/** Random, non-sequential human-friendly code, e.g. "K7Q2XM". */
export function randomCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return out;
}

export function randomDigits(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String(randomInt(10));
  return out;
}
