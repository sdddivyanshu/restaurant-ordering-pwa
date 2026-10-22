// Phone handling with configurable default country code (India "91" initially).
// Pure functions — safe to import from client components.

export interface PhoneResult {
  ok: boolean;
  e164?: string;
  error?: string;
}

export function normalizePhone(input: string, defaultCountryCode = "91"): PhoneResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Mobile number is required" };
  if (/[^\d\s()+-]/.test(raw)) return { ok: false, error: "Mobile number may contain digits only" };
  let digits = raw.replace(/[\s()-]/g, "");
  let e164: string;
  if (digits.startsWith("+")) {
    e164 = "+" + digits.slice(1).replace(/\D/g, "");
  } else {
    digits = digits.replace(/\D/g, "");
    if (digits.startsWith("00")) e164 = "+" + digits.slice(2);
    else if (defaultCountryCode === "91" && digits.length === 12 && digits.startsWith("91")) e164 = "+" + digits;
    else e164 = "+" + defaultCountryCode + digits.replace(/^0+/, "");
  }
  if (e164.startsWith("+91")) {
    if (!/^\+91[6-9]\d{9}$/.test(e164)) return { ok: false, error: "Enter a valid 10-digit Indian mobile number" };
  } else if (!/^\+[1-9]\d{7,14}$/.test(e164)) {
    return { ok: false, error: "Enter a valid mobile number with country code" };
  }
  return { ok: true, e164 };
}

/** Masked for display to anyone who should not see the full number: "+91 ••••••3210". */
export function maskPhone(e164: string): string {
  if (!e164) return "";
  const last = e164.slice(-4);
  const cc = e164.startsWith("+91") ? "+91" : e164.slice(0, Math.min(4, e164.length - 4));
  return `${cc} ••••••${last}`;
}
