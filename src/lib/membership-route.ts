import { notFound } from "next/navigation";
export function membershipRouteId(value:string):number {
  if(!/^[1-9]\d*$/.test(value)) notFound();
  const id=Number(value);
  if(!Number.isSafeInteger(id))notFound();
  return id;
}
