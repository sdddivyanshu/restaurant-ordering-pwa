import { customerRoute } from "@/lib/http/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { requestOtp } from "@/lib/customers/service";

/** POST — request a verification code. In OTP_MODE=dev the code is returned and labelled as such. */
export const POST = customerRoute({ rateLimit: RATE_LIMITS.otpRequest }, async ({ customer }) => requestOtp(customer));
