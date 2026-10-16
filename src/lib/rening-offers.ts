import { z } from "zod";
import { assertAdmin } from "./admin";
import { getDb,transaction } from "./database";
import { DomainError } from "./db";
import { appUrl } from "./stripe";
export type ReningOffer={id:number;title:string;credits:number;priceOre:number;vatPercent:0|6|12|25;published:boolean;updatedAt:string};
export type ReningSettings={salesEnabled:boolean;terms:string;updatedAt:string};
const map=(r:Record<string,unknown>):ReningOffer=>({id:Number(r.id),title:String(r.title),credits:Number(r.credits),priceOre:Number(r.price_ore),vatPercent:Number(r.vat_percent) as ReningOffer['vatPercent'],published:!!r.published,updatedAt:String(r.updated_at)});
export function reningBillingReady(){try{return !!process.env.STRIPE_SECRET_KEY&&!!process.env.RENING_STRIPE_WEBHOOK_SECRET&&!!appUrl();}catch{return false;}}
export async function getReningSettings():Promise<ReningSettings>{const r=(await getDb().prepare('SELECT * FROM rening_settings WHERE id=1').get())!;return {salesEnabled:!!r.sales_enabled,terms:String(r.terms),updatedAt:String(r.updated_at)};}
export async function getPublicReningOffers(){return (await getDb().prepare('SELECT * FROM rening_offers WHERE published=1 ORDER BY credits,id').all()).map(map);}
export async function getAdminReningOffers(actorId:number){await assertAdmin(actorId);return (await getDb().prepare('SELECT * FROM rening_offers ORDER BY credits,id').all()).map(map);}
export async function getReningOffer(id:number){const r=await getDb().prepare('SELECT * FROM rening_offers WHERE id=?').get(id);return r?map(r):null;}
export async function saveReningOffer(actorId:number,id:number|undefined,input:{title:string;credits:number;priceOre:number;vatPercent:number;published:boolean;expectedUpdatedAt:string|null}){
 const v=z.object({title:z.string().trim().min(2).max(150),credits:z.number().int().min(1).max(10000),priceOre:z.number().int().min(1).max(10000000),vatPercent:z.union([z.literal(0),z.literal(6),z.literal(12),z.literal(25)]),published:z.boolean(),expectedUpdatedAt:z.iso.datetime().nullable()}).strict().parse(input);
 return transaction(async()=>{await assertAdmin(actorId);const current=id?await getReningOffer(id):null;if(id&&!current)throw new DomainError('Erbjudandet finns inte.');if((current?.updatedAt??null)!==v.expectedUpdatedAt)throw new DomainError('Erbjudandet har ändrats. Ladda om sidan.');const stamp=new Date(Math.max(Date.now(),current?Date.parse(current.updatedAt)+1:0)).toISOString();
 if(id)await getDb().prepare('UPDATE rening_offers SET title=?,credits=?,price_ore=?,vat_percent=?,published=?,updated_at=? WHERE id=? AND updated_at=?').run(v.title,v.credits,v.priceOre,v.vatPercent,Number(v.published),stamp,id,v.expectedUpdatedAt);
 else id=Number((await getDb().prepare('INSERT INTO rening_offers(title,credits,price_ore,vat_percent,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(v.title,v.credits,v.priceOre,v.vatPercent,Number(v.published),stamp,stamp)).lastInsertRowid);return id;});
}
export async function saveReningSettings(actorId:number,input:{salesEnabled:boolean;terms:string;expectedUpdatedAt:string}){
 const v=z.object({salesEnabled:z.boolean(),terms:z.string().trim().max(20000),expectedUpdatedAt:z.iso.datetime()}).strict().parse(input);
 return transaction(async()=>{await assertAdmin(actorId);const current=await getReningSettings();if(current.updatedAt!==v.expectedUpdatedAt)throw new DomainError('Inställningarna har ändrats. Ladda om sidan.');
 if(v.salesEnabled){if(!reningBillingReady())throw new DomainError('Ange Stripe och RENING_STRIPE_WEBHOOK_SECRET före aktivering.');if(v.terms.length<20)throw new DomainError('Skriv tydliga köpvillkor innan försäljningen öppnas.');if(!(await getPublicReningOffers()).length)throw new DomainError('Publicera minst ett erbjudande.');const contact=await getDb().prepare('SELECT email FROM settings WHERE id=1').get();if(!z.email().safeParse(contact?.email).success)throw new DomainError('Ange verksamhetens kontaktadress i inställningarna.');}
 const stamp=new Date(Math.max(Date.now(),Date.parse(current.updatedAt)+1)).toISOString();await getDb().prepare('UPDATE rening_settings SET sales_enabled=?,terms=?,updated_at=? WHERE id=1 AND updated_at=?').run(Number(v.salesEnabled),v.terms,stamp,v.expectedUpdatedAt);});
}
