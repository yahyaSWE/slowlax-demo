"use client";
import { useRef, useState, useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { usePathname,useRouter } from "next/navigation";
import { checkoutDestination } from "@/components/shop/cart-data";

function portalDestination(value:unknown) {
  if(typeof value!=="string")return null;
  try {const url=new URL(value);return url.protocol==="https:"&&url.hostname==="billing.stripe.com"&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function MembershipCheckoutButton({planId,planRevision,termsRevision,purificationRevision=null}:{planId:number;planRevision:string;termsRevision:string;purificationRevision?:string|null}) {
  const [pending,setPending]=useState(false),[consent,setConsent]=useState(false),[error,setError]=useState(""),inFlight=useRef(false);
  async function start(event:React.FormEvent) {
    event.preventDefault();if(inFlight.current||!consent)return;inFlight.current=true;setPending(true);setError("");
    try {const response=await fetch("/api/medlemskap/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({planId,planRevision,termsRevision,purificationRevision,consent:true})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Betalningen kunde inte öppnas.");const destination=checkoutDestination(result.url);if(!destination)throw new Error("Betalningsadressen kunde inte kontrolleras. Försök igen.");window.location.assign(destination);}
    catch(failure){setError(failure instanceof Error?failure.message:"Anslutningen misslyckades. Försök igen.");setPending(false);inFlight.current=false;}
  }
  return <form className="membership-checkout" onSubmit={start} aria-busy={pending}><label className="form-check"><input type="checkbox" required checked={consent} disabled={pending} onChange={event=>setConsent(event.target.checked)}/><span>Jag godkänner abonnemangsvillkoren och att betalningen återkommer enligt det valda intervallet.</span></label>{error&&<p className="notice notice-error" role="alert">{error}</p>}<button className="button button-primary" type="submit" disabled={pending||!consent}>{pending?<><LoaderCircle className="admin-submit-spinner" size={18} aria-hidden="true"/>Öppnar betalningen…</>:"Teckna abonnemang"}</button></form>;
}
export function MembershipPortalButton() {
  const [pending,setPending]=useState(false),[error,setError]=useState(""),inFlight=useRef(false);
  async function open() {if(inFlight.current)return;inFlight.current=true;setPending(true);setError("");try {const response=await fetch("/api/medlemskap/portal",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Betalningsportalen kunde inte öppnas.");const destination=portalDestination(result.url);if(!destination)throw new Error("Betalningsportalen kunde inte kontrolleras.");window.location.assign(destination);}catch(failure){setError(failure instanceof Error?failure.message:"Anslutningen misslyckades. Försök igen.");setPending(false);inFlight.current=false;}}
  return <div className="stack"><button type="button" className="button button-secondary" disabled={pending} onClick={open}>{pending?<><LoaderCircle size={18} className="admin-submit-spinner" aria-hidden="true"/>Öppnar…</>:"Hantera betalningar och uppsägning"}</button>{error&&<p className="notice notice-error" role="alert">{error}</p>}</div>;
}
export function MembershipCheckoutCancelButton({planId}:{planId:number}) {
  const [pending,setPending]=useState(false),[error,setError]=useState(""),router=useRouter(),path=usePathname(),inFlight=useRef(false);
  async function cancel(){if(inFlight.current)return;inFlight.current=true;setPending(true);setError("");try{const response=await fetch("/api/medlemskap/cancel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({planId})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Betalningsförsöket kunde inte avbrytas.");router.replace(path);router.refresh();}catch(failure){setError(failure instanceof Error?failure.message:"Anslutningen misslyckades. Försök igen.");}finally{setPending(false);inFlight.current=false;}}
  return <div className="stack"><p>Avbryt den påbörjade betalningen om du vill välja ett annat medlemskap eller betalningsintervall.</p><button type="button" className="button button-secondary" disabled={pending} onClick={cancel}>{pending?"Avbryter…":"Avbryt påbörjad betalning"}</button>{error&&<p className="notice notice-error" role="alert">{error}</p>}</div>;
}
export function MembershipStatusRefreshButton(){const router=useRouter(),[pending,startTransition]=useTransition();return <button type="button" className="button button-secondary" disabled={pending} onClick={()=>startTransition(()=>router.refresh())}>{pending?"Uppdaterar…":"Uppdatera status"}</button>;}
