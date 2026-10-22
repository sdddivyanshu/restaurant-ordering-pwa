"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";

export interface CustomerSessionInfo {
  customer: { name: string; phoneMasked: string; verified: boolean; marketingConsent: boolean };
  table: { label: string; name: string };
  expiresAt: string;
  language: "en" | "hi";
  otpMode: "dev" | "disabled" | "provider";
}

export interface PublicConfig {
  name: string;
  currency: string;
  pricesIncludeTax: boolean;
  loyaltyEnabled: boolean;
  otpMode: "dev" | "disabled" | "provider";
  isDemo: boolean;
}

interface SessionValue {
  session: CustomerSessionInfo | null;
  status: "loading" | "ok" | "none" | "error";
  problem: string | null;
  config: PublicConfig | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function CustomerSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<CustomerSessionInfo | null>(null);
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api<CustomerSessionInfo>("/api/v1/customer/session"));
      setStatus("ok");
      setProblem(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setSession(null);
        setStatus("none");
        setProblem(err.code);
      } else setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
    api<PublicConfig>("/api/v1/public/config").then(setConfig).catch(() => {});
  }, [refresh]);

  return <Ctx.Provider value={{ session, status, problem, config, refresh }}>{children}</Ctx.Provider>;
}

export function useCustomerSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCustomerSession must be used inside CustomerSessionProvider");
  return ctx;
}
