import { prisma, withTx } from "@/lib/db/prisma";
import { ApiError, badRequest, tooManyRequests } from "@/lib/http/errors";
import { normalizePhone, maskPhone } from "@/lib/security/phone";
import { hmac, randomDigits, randomToken, safeEqualHex, sha256 } from "@/lib/security/tokens";
import { getRestaurantConfig } from "@/lib/settings";
import { openTableVisit } from "@/lib/tables/service";
import { otpMode } from "@/lib/env";
import { audit } from "@/lib/audit";
import type { CustomerContext } from "@/lib/auth/customer-session";

export const DEVICE_COOKIE_DAYS = 365;
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

export async function registerCustomer(
  input: { qrToken: string; name: string; phone: string; marketingConsent: boolean; language: "en" | "hi" },
  existingDeviceToken?: string,
) {
  const { settings } = await getRestaurantConfig();
  const phone = normalizePhone(input.phone, settings.phoneCountryCode);
  if (!phone.ok) throw badRequest(phone.error ?? "Invalid mobile number", [{ path: "phone", message: phone.error }]);
  // Re-validate the QR token server-side; the client never tells us which table it is at.
  const visit = await openTableVisit(input.qrToken);

  return withTx(async (tx) => {
    const now = new Date();
    let deviceToken = existingDeviceToken;
    let device = deviceToken ? await tx.customerDevice.findUnique({ where: { tokenHash: sha256(deviceToken) } }) : null;
    if (!device) {
      deviceToken = randomToken();
      device = await tx.customerDevice.create({ data: { tokenHash: sha256(deviceToken) } });
    } else {
      await tx.customerDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });
    }

    const customer = await tx.customer.upsert({
      where: { phoneE164: phone.e164! },
      create: {
        phoneE164: phone.e164!,
        name: input.name,
        privacyConsentAt: now,
        privacyConsentVersion: settings.privacyNoticeVersion,
        marketingConsent: input.marketingConsent,
        marketingConsentAt: input.marketingConsent ? now : null,
      },
      update: {
        name: input.name,
        privacyConsentAt: now,
        privacyConsentVersion: settings.privacyNoticeVersion,
        marketingConsent: input.marketingConsent,
        marketingConsentAt: input.marketingConsent ? now : null,
        anonymizedAt: null,
      },
    });
    await tx.notificationPreference.upsert({
      where: { customerId: customer.id },
      create: { customerId: customer.id, marketingSms: input.marketingConsent },
      update: { marketingSms: input.marketingConsent },
    });

    // Consent-aware recognition: a number verified earlier *on this same device* stays verified.
    const verifiedBefore = await tx.customerSession.findFirst({
      where: { customerId: customer.id, deviceId: device.id, verifiedAt: { not: null } },
      select: { id: true },
    });

    const token = randomToken();
    const expiresAt = new Date(Math.min(visit.visit.expiresAt.getTime(), now.getTime() + settings.customerSessionHours * 3600_000));
    const session = await tx.customerSession.create({
      data: {
        tokenHash: sha256(token),
        customerId: customer.id,
        tableSessionId: visit.visit.id,
        deviceId: device.id,
        language: input.language,
        expiresAt,
        verifiedAt: verifiedBefore ? now : null,
      },
    });
    await audit(tx, {
      actor: { type: "CUSTOMER", id: customer.id },
      action: "customer.session_started",
      entityType: "CustomerSession",
      entityId: session.id,
      meta: { table: visit.table.label, marketingConsent: input.marketingConsent },
    });
    return {
      sessionToken: token,
      deviceToken: deviceToken!,
      expiresAt,
      customer: { name: customer.name, phoneMasked: maskPhone(customer.phoneE164), verified: Boolean(verifiedBefore) },
      table: visit.table,
    };
  });
}

export async function getSessionInfo(ctx: CustomerContext) {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: ctx.customerId } });
  return {
    customer: { name: customer.name, phoneMasked: maskPhone(customer.phoneE164), verified: ctx.verified, marketingConsent: customer.marketingConsent },
    table: { label: ctx.tableLabel, name: ctx.tableName },
    expiresAt: ctx.expiresAt,
    language: ctx.language,
    otpMode: otpMode(),
  };
}

export async function requestOtp(ctx: CustomerContext) {
  const mode = otpMode();
  if (mode === "disabled") throw new ApiError(400, "OTP_DISABLED", "Mobile verification is not enabled at this restaurant.");
  if (mode === "provider") {
    // Integration point for an SMS provider (see docs/deployment.md). Not configured in this build.
    throw new ApiError(501, "OTP_PROVIDER_NOT_CONFIGURED", "SMS verification is not configured yet. Please ask staff for help.");
  }
  const session = await prisma.customerSession.findUniqueOrThrow({ where: { id: ctx.sessionId } });
  if (session.otpExpiresAt && session.otpExpiresAt.getTime() - OTP_TTL_MS + 30_000 > Date.now()) {
    throw tooManyRequests("Please wait 30 seconds before requesting another code.");
  }
  const code = randomDigits(6);
  await prisma.customerSession.update({
    where: { id: ctx.sessionId },
    data: { otpHash: hmac(`${ctx.sessionId}:${code}`), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), otpAttempts: 0 },
  });
  // Development mode: the code is returned to the UI and clearly labelled — no SMS is sent.
  return { mode: "dev" as const, devCode: code, expiresInSeconds: OTP_TTL_MS / 1000 };
}

export async function verifyOtp(ctx: CustomerContext, code: string) {
  const session = await prisma.customerSession.findUniqueOrThrow({ where: { id: ctx.sessionId } });
  if (!session.otpHash || !session.otpExpiresAt || session.otpExpiresAt < new Date()) {
    throw new ApiError(400, "OTP_EXPIRED", "The code has expired. Request a new one.");
  }
  if (session.otpAttempts >= OTP_MAX_ATTEMPTS) throw new ApiError(429, "OTP_LOCKED", "Too many attempts. Request a new code.");
  await prisma.customerSession.update({ where: { id: session.id }, data: { otpAttempts: { increment: 1 } } });
  if (!safeEqualHex(session.otpHash, hmac(`${ctx.sessionId}:${code}`))) {
    throw new ApiError(400, "OTP_INVALID", "That code is not correct.");
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.customerSession.update({ where: { id: session.id }, data: { verifiedAt: now, otpHash: null, otpExpiresAt: null } }),
    prisma.customer.update({ where: { id: ctx.customerId }, data: { verifiedAt: now } }),
  ]);
  return { verified: true };
}

/**
 * Data-deletion request handling: anonymise personal data while keeping financial records
 * (orders, payments) that may be legally required. Admin-only.
 */
export async function anonymizeCustomer(customerId: string, actorId: string) {
  return withTx(async (tx) => {
    const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    const now = new Date();
    await tx.customer.update({
      where: { id: customerId },
      data: { name: "Deleted customer", phoneE164: `deleted:${c.id}`, marketingConsent: false, marketingConsentAt: null, verifiedAt: null, anonymizedAt: now },
    });
    await tx.order.updateMany({ where: { customerId }, data: { customerName: "Deleted customer" } });
    await tx.customerSession.updateMany({ where: { customerId, revokedAt: null }, data: { revokedAt: now } });
    await tx.feedback.updateMany({ where: { customerId }, data: { comment: null } });
    await audit(tx, { actor: { type: "STAFF", id: actorId }, action: "customer.anonymized", entityType: "Customer", entityId: customerId });
  });
}
