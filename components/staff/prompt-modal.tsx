"use client";

import { useState } from "react";
import { Button, ErrorNotice, Sheet } from "@/components/shared/ui";

/** Modal that collects a mandatory reason/note before a sensitive action. */
export function PromptModal({
  title,
  label,
  confirmLabel,
  minLength = 3,
  danger,
  options,
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  confirmLabel: string;
  minLength?: number;
  danger?: boolean;
  options?: string[];
  onConfirm: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "dark"} loading={busy} disabled={text.trim().length < minLength} onClick={go}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {options && (
        <div className="mb-3 flex flex-wrap gap-2">
          {options.map((o) => (
            <button key={o} onClick={() => setText(o)} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-soft hover:bg-slate-50">
              {o}
            </button>
          ))}
        </div>
      )}
      <label className="block text-sm font-semibold">
        {label}
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={300} className="mt-1 w-full rounded-xl border border-slate-300 p-2 font-normal" />
      </label>
      {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
    </Sheet>
  );
}
