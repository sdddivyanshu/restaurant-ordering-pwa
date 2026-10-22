// Centralised, typed access to environment configuration. Values are read lazily so that
// `next build` does not require runtime secrets.

export const isProduction = () => process.env.NODE_ENV === "production";

export function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    if (isProduction()) throw new Error("APP_SECRET must be set to at least 32 characters in production");
    return "development-only-insecure-secret-0000000000";
  }
  return secret;
}

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type OtpModeEnv = "dev" | "disabled" | "provider";

export function otpMode(): OtpModeEnv {
  const mode = (process.env.OTP_MODE ?? "dev").toLowerCase();
  if (mode === "provider" || mode === "disabled") return mode;
  // Dev mode (on-screen code) is never allowed in production.
  if (isProduction()) return "disabled";
  return "dev";
}

export function demoAccountsAllowed(): boolean {
  return !isProduction() || process.env.ALLOW_DEMO_ACCOUNTS === "true";
}

export function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? "./uploads";
}

export function trustProxy(): boolean {
  return process.env.TRUST_PROXY === "true";
}
