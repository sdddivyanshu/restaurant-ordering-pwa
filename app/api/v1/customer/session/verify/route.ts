import { customerRoute } from "@/lib/http/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { otpVerifySchema } from "@/lib/validation/schemas";
import { verifyOtp } from "@/lib/customers/service";

export const POST = customerRoute({ body: otpVerifySchema, rateLimit: RATE_LIMITS.otpVerify }, async ({ customer, body }) => verifyOtp(customer, body.code));
