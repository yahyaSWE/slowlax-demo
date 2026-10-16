"use client";

import "./course-purchases.css";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { checkoutDestination } from "@/components/shop/cart-data";

export function CoursePurchaseButton({ courseId, courseRevision, settingsRevision, priceLabel, isBundle = false, purificationRevision = null }: {
  courseId: number; courseRevision: string; settingsRevision: string; priceLabel: string;
  isBundle?: boolean; purificationRevision?: string | null;
}) {
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function purchase(event: React.FormEvent) {
    event.preventDefault();
    if (!consent || inFlight.current) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/kurser/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, consent: true, courseRevision, settingsRevision, termsRevision: settingsRevision, purificationRevision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Betalningen kunde inte öppnas.");
      const destination = checkoutDestination(result.url);
      if (!destination) throw new Error("Betalningsadressen kunde inte kontrolleras.");
      window.location.assign(destination);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Anslutningen misslyckades. Försök igen.");
      setPending(false); inFlight.current = false;
    }
  }
  return <form onSubmit={purchase} className="stack course-purchase-checkout" aria-busy={pending}>
    <label className="form-check course-purchase-consent"><input type="checkbox" required checked={consent} disabled={pending} onChange={event => setConsent(event.target.checked)} /><span>Jag godkänner köpvillkoren och begär att få kursåtkomst direkt efter betalningen.</span></label>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <button type="submit" className="button button-primary full-width" disabled={pending || !consent}>
      {pending ? <><LoaderCircle size={17} className="admin-submit-spinner" aria-hidden="true" />Öppnar betalningen…</> : `Köp ${isBundle ? "paketet" : "kursen"} – ${priceLabel}`}
    </button>
    <p className="small muted">Engångsbetalning. {isBundle ? "Kurserna och grupperna" : "Kursen"} visas i din elevportal när betalningen har bekräftats.</p>
  </form>;
}

export function CoursePurchaseCancelButton({ courseId }: { courseId: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false), router = useRouter(), path = usePathname();
  async function cancel() {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/kurser/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Betalningsförsöket kunde inte avbrytas.");
      router.replace(path); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Anslutningen misslyckades. Försök igen."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <div className="stack"><button type="button" className="button button-secondary" disabled={pending} onClick={cancel}>{pending ? "Avbryter…" : "Avbryt påbörjad betalning"}</button>{error && <p className="notice notice-error" role="alert">{error}</p>}</div>;
}

export function CoursePurchaseRefreshButton() {
  const router = useRouter(), [pending, startTransition] = useTransition();
  return <button type="button" className="button button-secondary" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Uppdaterar…" : "Uppdatera betalningsstatus"}</button>;
}
