import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, forbidden, tooManyRequests, unauthorized } from "@/lib/http/errors";
import { COOKIE_CUSTOMER, COOKIE_STAFF } from "@/lib/auth/cookies";
import { resolveStaffSession, type StaffContext } from "@/lib/auth/staff-session";
import { resolveCustomerSession, type CustomerContext } from "@/lib/auth/customer-session";
import { hasPermission, type Permission } from "@/lib/authorization/permissions";
import { checkRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";
import { appBaseUrl, isProduction, trustProxy } from "@/lib/env";
import { isUniqueViolation } from "@/lib/db/prisma";

type Schema = z.ZodType | undefined;
type Infer<S> = S extends z.ZodType ? z.infer<S> : undefined;

export interface BaseContext<B extends Schema, Q extends Schema> {
  req: NextRequest;
  params: Record<string, string>;
  body: Infer<B>;
  query: Infer<Q>;
  ip: string;
}

interface BaseOptions<B extends Schema, Q extends Schema> {
  body?: B;
  query?: Q;
  rateLimit?: RateLimitRule;
}

type RouteContext = { params: Promise<Record<string, string | string[]>> };
type Handler = (req: NextRequest, ctx: RouteContext) => Promise<Response>;

export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    // Behind a trusted proxy the left-most entry is the client; otherwise only trust the hop
    // closest to us so a client cannot spoof its rate-limit identity.
    return (trustProxy() ? parts[0] : parts[parts.length - 1]) ?? "unknown";
  }
  return req.headers.get("x-real-ip") ?? "local";
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** CSRF defence: mutating requests from browsers must come from our own origin. */
function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new Set([new URL(req.url).origin, new URL(appBaseUrl()).origin]);
    const host = req.headers.get("host");
    if (host) {
      allowed.add(`http://${host}`);
      allowed.add(`https://${host}`);
    }
    if (!allowed.has(origin)) throw new ApiError(403, "CSRF_REJECTED", "Cross-origin request rejected");
    return;
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "CSRF_REJECTED", "Cross-origin request rejected");
  }
}

async function parseBody(req: NextRequest, schema: z.ZodType) {
  const type = req.headers.get("content-type") ?? "";
  // Requiring JSON blocks "simple" cross-site form posts as a second CSRF layer.
  if (!type.includes("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
  return schema.parse(raw);
}

function parseQuery(req: NextRequest, schema: z.ZodType) {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (obj[k] = v));
  return schema.parse(obj);
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) } },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Some fields are invalid",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  if (isUniqueViolation(err)) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "This action conflicts with existing data. Refresh and try again." } },
      { status: 409 },
    );
  }
  // Never leak stack traces or internals in production.
  console.error("[api] unhandled error", err instanceof Error ? err.message : err);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
        ...(!isProduction() && err instanceof Error && { details: err.message }),
      },
    },
    { status: 500 },
  );
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  return NextResponse.json(result ?? { ok: true });
}

async function resolveParams(ctx: RouteContext | undefined) {
  const raw = ctx?.params ? await ctx.params : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Array.isArray(v) ? v.join("/") : v;
  return out;
}

async function base<B extends Schema, Q extends Schema>(
  req: NextRequest,
  ctx: RouteContext,
  opts: BaseOptions<B, Q>,
  subjectForRateLimit?: () => string,
): Promise<BaseContext<B, Q>> {
  assertSameOrigin(req);
  const ip = clientIp(req);
  if (opts.rateLimit) {
    const subject = subjectForRateLimit?.() ?? ip;
    if (!checkRateLimit(opts.rateLimit, subject).allowed) throw tooManyRequests();
  }
  const params = await resolveParams(ctx);
  const body = (opts.body ? await parseBody(req, opts.body) : undefined) as Infer<B>;
  const query = (opts.query ? parseQuery(req, opts.query) : undefined) as Infer<Q>;
  return { req, params, body, query, ip };
}

export function publicRoute<B extends Schema = undefined, Q extends Schema = undefined>(
  opts: BaseOptions<B, Q>,
  fn: (c: BaseContext<B, Q>) => Promise<unknown>,
): Handler {
  return async (req, ctx) => {
    try {
      return toResponse(await fn(await base(req, ctx, opts)));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function staffRoute<B extends Schema = undefined, Q extends Schema = undefined>(
  opts: BaseOptions<B, Q> & { permission: Permission | Permission[] | "any-staff" },
  fn: (c: BaseContext<B, Q> & { staff: StaffContext }) => Promise<unknown>,
): Handler {
  return async (req, ctx) => {
    try {
      const staff = await resolveStaffSession(req.cookies.get(COOKIE_STAFF)?.value);
      if (!staff) throw unauthorized("Your staff session has expired. Please sign in again.", "SESSION_EXPIRED");
      if (opts.permission !== "any-staff") {
        const needed = Array.isArray(opts.permission) ? opts.permission : [opts.permission];
        if (!needed.some((p) => hasPermission(staff.permissions, p))) throw forbidden();
      }
      const c = await base(req, ctx, opts, () => staff.userId);
      return toResponse(await fn({ ...c, staff }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function customerRoute<B extends Schema = undefined, Q extends Schema = undefined>(
  opts: BaseOptions<B, Q>,
  fn: (c: BaseContext<B, Q> & { customer: CustomerContext }) => Promise<unknown>,
): Handler {
  return async (req, ctx) => {
    try {
      const result = await resolveCustomerSession(req.cookies.get(COOKIE_CUSTOMER)?.value);
      if (!result.ok) {
        const messages = {
          NO_SESSION: "Please scan the QR code on your table to start.",
          SESSION_EXPIRED: "Your session has expired. Please scan the table QR code again.",
          TABLE_CLOSED: "This table visit has ended. Please scan the table QR code again.",
        } as const;
        throw new ApiError(401, result.problem, messages[result.problem]);
      }
      const c = await base(req, ctx, opts, () => result.ctx.sessionId);
      return toResponse(await fn({ ...c, customer: result.ctx }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}
