"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
export function GroupMonthFilter({months,selected}:{months:string[];selected:string}) {
  const router=useRouter(),path=usePathname(),[value,setValue]=useState(selected),[pending,startTransition]=useTransition();
  useEffect(()=>setValue(selected),[selected]);
  return <form method="GET" className="membership-filter" onSubmit={event=>{event.preventDefault();startTransition(()=>router.push(`${path}${value?`?month=${encodeURIComponent(value)}`:""}`,{scroll:false}));}} aria-busy={pending}><div className="field"><label htmlFor="group-month">Visa månad</label><select id="group-month" name="month" value={value} disabled={pending} onChange={event=>setValue(event.target.value)}><option value="">Alla månader</option>{months.map(month=><option key={month} value={month}>{new Intl.DateTimeFormat("sv-SE",{month:"long",year:"numeric",timeZone:"Europe/Stockholm"}).format(new Date(`${month}-01T12:00:00Z`))}</option>)}</select></div><button className="button button-secondary" type="submit" disabled={pending}>{pending?"Visar…":"Visa"}</button></form>;
}
