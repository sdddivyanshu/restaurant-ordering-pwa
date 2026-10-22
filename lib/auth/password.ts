import { hash, verify } from "@node-rs/argon2";

// Argon2id with OWASP-recommended baseline parameters.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used to keep login timing similar for unknown emails.
let dummyHash: Promise<string> | null = null;
export function dummyVerify(password: string) {
  dummyHash ??= hashPassword("not-a-real-password-for-timing");
  return dummyHash.then((h) => verifyPassword(h, password));
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return "Password must be at least 12 characters";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password must contain letters and numbers";
  return null;
}
