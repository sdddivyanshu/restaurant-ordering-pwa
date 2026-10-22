import { NextResponse } from "next/server";
import { customerRoute } from "@/lib/http/route";
import { serviceRequestSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { createServiceRequest, listCustomerRequests } from "@/lib/service-requests/service";

export const GET = customerRoute({}, async ({ customer }) => ({ requests: await listCustomerRequests(customer) }));

/** POST — repeated taps inside the suppression window return the existing request (duplicate: true). */
export const POST = customerRoute({ body: serviceRequestSchema, rateLimit: RATE_LIMITS.serviceRequest }, async ({ customer, body }) => {
  const { request, duplicate } = await createServiceRequest(customer, body);
  return NextResponse.json({ request: { id: request.id, type: request.type, status: request.status, createdAt: request.createdAt }, duplicate }, { status: duplicate ? 200 : 201 });
});
