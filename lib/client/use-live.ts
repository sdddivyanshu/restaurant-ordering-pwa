"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";

export type LiveState = "connecting" | "live" | "polling" | "offline";

/**
 * Fetch data and keep it fresh. Primary channel: Server-Sent Events (events are hints that
 * trigger a refetch). Fallbacks: polling while SSE is down, refetch on reconnect/focus, and a
 * slow safety-net poll. Duplicate events are ignored by id. The server stays the source of truth.
 */
export function useLiveData<T>(url: string | null, opts: { sseUrl?: string; pollMs?: number; fallbackPollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<LiveState>("connecting");
  const seen = useRef(new Set<string>());
  const inflight = useRef<AbortController | null>(null);
  const pollMs = opts.pollMs ?? 30_000;
  const fallbackPollMs = opts.fallbackPollMs ?? 5_000;

  const refresh = useCallback(async () => {
    if (!url) return;
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const d = await api<T>(url, { signal: ctrl.signal });
      setData(d);
      setError(null);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError(err instanceof ApiClientError ? err : new ApiClientError(0, "UNKNOWN", String(err)));
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    void refresh();
    let es: EventSource | null = null;
    let fallback: ReturnType<typeof setInterval> | null = null;
    const startFallback = () => {
      if (!fallback) fallback = setInterval(() => void refresh(), fallbackPollMs);
    };
    const stopFallback = () => {
      if (fallback) clearInterval(fallback);
      fallback = null;
    };
    if (opts.sseUrl && typeof EventSource !== "undefined") {
      es = new EventSource(opts.sseUrl, { withCredentials: true });
      es.addEventListener("ready", () => {
        setState("live");
        stopFallback();
        void refresh(); // catch anything missed while disconnected
      });
      es.addEventListener("message", (ev) => {
        const id = (ev as MessageEvent).lastEventId;
        if (id && seen.current.has(id)) return;
        if (id) {
          seen.current.add(id);
          if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200));
        }
        void refresh();
      });
      es.onerror = () => {
        setState(navigator.onLine ? "polling" : "offline");
        startFallback(); // EventSource auto-reconnects; poll meanwhile
      };
    } else {
      setState("polling");
    }
    const safety = setInterval(() => void refresh(), pollMs);
    const onOnline = () => {
      setState("connecting");
      void refresh();
    };
    const onOffline = () => setState("offline");
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      es?.close();
      stopFallback();
      clearInterval(safety);
      inflight.current?.abort();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, opts.sseUrl, refresh, pollMs, fallbackPollMs]);

  return { data, error, loading, state, refresh, setData };
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
