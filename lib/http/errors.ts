// Consistent API error format: { error: { code, message, details? } }

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Authentication required", code = "UNAUTHENTICATED") =>
  new ApiError(401, code, message);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new ApiError(422, code, message, details);
export const tooManyRequests = (message = "Too many requests. Please wait a moment and try again.") =>
  new ApiError(429, "RATE_LIMITED", message);
