"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print mt-4 w-full rounded-lg bg-black py-2 font-sans font-semibold text-white">
      Print receipt
    </button>
  );
}
