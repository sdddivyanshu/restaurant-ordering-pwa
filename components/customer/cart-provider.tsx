"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CartLineInput } from "@/lib/validation/schemas";

// The cart is a client-side *draft* only. Prices shown here are estimates; the server re-prices
// everything (POST /api/v1/customer/cart) and is the only source of truth for totals.

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  imageUrl: string | null;
  dietType: "VEG" | "VEGAN" | "EGG" | "NON_VEG";
  quantity: number;
  selections: Record<string, string[]>;
  optionLabels: string[];
  notes?: string;
  estUnitPricePaise: number;
}

interface CartState {
  lines: CartLine[];
  specialInstructions: string;
  rewardId: string | null;
  // Reused for retries of the same cart so a timed-out submission cannot create a duplicate.
  pendingKey: { key: string; fingerprint: string } | null;
}

interface CartValue extends CartState {
  count: number;
  estTotalPaise: number;
  add: (line: Omit<CartLine, "key">) => void;
  update: (key: string, patch: Partial<CartLine>) => void;
  setQuantity: (key: string, q: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  replaceLines: (lines: Omit<CartLine, "key">[]) => void;
  setSpecialInstructions: (s: string) => void;
  setRewardId: (id: string | null) => void;
  setPendingKey: (k: CartState["pendingKey"]) => void;
  apiLines: () => CartLineInput[];
  fingerprint: () => string;
}

const STORAGE_KEY = "rs_cart_draft_v1";
const EMPTY: CartState = { lines: [], specialInstructions: "", rewardId: null, pendingKey: null };
const CartContext = createContext<CartValue | null>(null);

const sameSelections = (a: Record<string, string[]>, b: Record<string, string[]>) => {
  const norm = (s: Record<string, string[]>) => JSON.stringify(Object.keys(s).sort().map((k) => [k, [...s[k]].sort()]).filter(([, v]) => (v as string[]).length));
  return norm(a) === norm(b);
};

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...EMPTY, ...JSON.parse(raw) });
    } catch {
      /* ignore corrupt draft */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or disabled */
    }
  }, [state, hydrated]);

  const add = useCallback((line: Omit<CartLine, "key">) => {
    setState((s) => {
      const existing = s.lines.find((l) => l.menuItemId === line.menuItemId && sameSelections(l.selections, line.selections) && (l.notes ?? "") === (line.notes ?? ""));
      const lines = existing
        ? s.lines.map((l) => (l === existing ? { ...l, quantity: Math.min(20, l.quantity + line.quantity) } : l))
        : [...s.lines, { ...line, key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }];
      return { ...s, lines };
    });
  }, []);

  const value = useMemo<CartValue>(() => {
    const apiLines = () =>
      state.lines.map((l) => ({
        menuItemId: l.menuItemId,
        quantity: l.quantity,
        selections: Object.entries(l.selections).filter(([, v]) => v.length).map(([groupId, optionIds]) => ({ groupId, optionIds })),
        notes: l.notes || undefined,
      }));
    return {
      ...state,
      count: state.lines.reduce((s, l) => s + l.quantity, 0),
      estTotalPaise: state.lines.reduce((s, l) => s + l.estUnitPricePaise * l.quantity, 0),
      add,
      update: (key, patch) => setState((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),
      setQuantity: (key, q) => setState((s) => ({ ...s, lines: q <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, q) } : l)) })),
      remove: (key) => setState((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) })),
      clear: () => setState(EMPTY),
      replaceLines: (lines) => setState({ ...EMPTY, lines: lines.map((l, i) => ({ ...l, key: `${Date.now()}-${i}` })) }),
      setSpecialInstructions: (specialInstructions) => setState((s) => ({ ...s, specialInstructions })),
      setRewardId: (rewardId) => setState((s) => ({ ...s, rewardId })),
      setPendingKey: (pendingKey) => setState((s) => ({ ...s, pendingKey })),
      apiLines,
      fingerprint: () => JSON.stringify([apiLines(), state.specialInstructions.trim(), state.rewardId]),
    };
  }, [state, add]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
