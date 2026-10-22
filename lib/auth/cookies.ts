import type { NextResponse } from "next/server";
import { isProduction } from "@/lib/env";

export const COOKIE_STAFF = "rs_staff";
export const COOKIE_CUSTOMER = "rs_cust";
export const COOKIE_DEVICE = "rs_dev";
export const COOKIE_LANG = "rs_lang";

export function setSecureCookie(res: NextResponse, name: string, value: string, maxAgeSeconds: number) {
  res.cookies.set(name, value, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, "", { httpOnly: true, secure: isProduction(), sameSite: "lax", path: "/", maxAge: 0 });
}
