"use client";

import { useEffect } from "react";

/** Registers the service worker in production builds (or with ?sw=1 for local testing). */
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" || new URLSearchParams(location.search).has("sw");
    if (!enabled) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* PWA features are progressive; the app works without them */
    });
  }, []);
  return null;
}
