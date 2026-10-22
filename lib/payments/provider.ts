// Payment-provider abstraction. The MVP ships only the manual provider: a cashier records money
// received (cash, UPI to the restaurant's VPA, card on a standalone terminal). Nothing here
// claims a payment was verified — Payment.providerVerified stays false for manual records.
//
// To integrate a gateway later, implement PaymentProvider (create intent + verify webhook),
// register it below, and record payments with providerVerified=true only after verification.

export interface PaymentIntent {
  providerReference: string;
  upiUri?: string;
  redirectUrl?: string;
}

export interface PaymentVerification {
  verified: boolean;
  amountPaise: number;
  providerReference: string;
}

export interface PaymentProvider {
  id: string;
  displayName: string;
  verifiesPayments: boolean;
  createIntent?(input: { orderId: string; amountPaise: number; currency: string }): Promise<PaymentIntent>;
  verify?(providerReference: string): Promise<PaymentVerification>;
}

export const manualProvider: PaymentProvider = {
  id: "manual",
  displayName: "Recorded manually by cashier (not gateway-verified)",
  verifiesPayments: false,
};

const providers: Record<string, PaymentProvider> = { manual: manualProvider };

export function getPaymentProvider(id = "manual"): PaymentProvider {
  return providers[id] ?? manualProvider;
}

/** UPI deep link for display on the bill (pay-to-VPA). Opening it does not confirm payment. */
export function upiPaymentUri(input: { upiId: string; payeeName: string; amountPaise: number; note: string }) {
  const params = new URLSearchParams({
    pa: input.upiId,
    pn: input.payeeName,
    am: (input.amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: input.note.slice(0, 50),
  });
  return `upi://pay?${params.toString()}`;
}
