"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin,requireUser } from "./auth";
import { DomainError } from "./db";
import { field,money } from "./validation";
import { submitPurificationRequest,cancelPurificationRequest,updateAdminPurificationRequest,savePurificationQuotaSettings,type PurificationQuotaSource } from "./purification-domain";
import { saveReningOffer,saveReningSettings } from "./rening-offers";
export type ReningFormState={error?:string};
const error=(e:unknown):ReningFormState=>({error:e instanceof DomainError?e.message:e instanceof z.ZodError?e.issues[0]?.message:'Åtgärden kunde inte slutföras. Försök igen.'});
const id=(form:FormData,key='id')=>z.coerce.number().int().positive().parse(field(form,key));
function refresh(){revalidatePath('/elevportal','layout');revalidatePath('/admin/rening','layout');revalidatePath('/rening');}
export async function submitReningAction(_s:ReningFormState,f:FormData):Promise<ReningFormState>{const u=await requireUser();let result;try{const raw=field(f,'holdings');if(raw.length>100000)throw new DomainError('Innehavet är för stort.');result=await submitPurificationRequest(u.id,{holdings:JSON.parse(raw),message:field(f,'message'),idempotencyKey:field(f,'idempotencyKey')});}catch(e){return error(e);}refresh();redirect('/elevportal/rening/'+result.id);}
export async function cancelReningAction(_s:ReningFormState,f:FormData):Promise<ReningFormState>{const u=await requireUser();try{await cancelPurificationRequest(u.id,field(f,'id'),{expectedUpdatedAt:field(f,'expectedUpdatedAt')});}catch(e){return error(e);}refresh();redirect('/elevportal/rening/'+field(f,'id'));}
export async function reviewReningAction(_s:ReningFormState,f:FormData):Promise<ReningFormState>{const u=await requireAdmin();try{await updateAdminPurificationRequest(u.id,field(f,'id'),{status:z.enum(['processing','completed','rejected']).parse(field(f,'status')),responseText:field(f,'responseText'),internalNotes:field(f,'internalNotes'),expectedUpdatedAt:field(f,'expectedUpdatedAt')});}catch(e){return error(e);}refresh();redirect('/admin/rening/'+field(f,'id')+'?saved='+Date.now());}
export async function saveReningQuotaAction(_s:ReningFormState,f:FormData):Promise<ReningFormState>{const u=await requireAdmin();try{await savePurificationQuotaSettings(u.id,z.enum(['bas','membership_plan','course_bundle']).parse(field(f,'sourceType')) as PurificationQuotaSource,id(f,'sourceId'),{credits:z.coerce.number().int().min(0).max(10000).parse(field(f,'credits')),expectedUpdatedAt:field(f,'expectedUpdatedAt')||null});}catch(e){return error(e);}refresh();const path=field(f,'returnTo');redirect((/^\/admin\/(medlemskap\/(bas|\d+)|paket\/\d+)$/.test(path)?path:'/admin/rening/installningar')+'?saved='+Date.now()+'#rening-kvot');}
export async function saveReningOfferAction(_s:ReningFormState,f:FormData):Promise<ReningFormState>{const u=await requireAdmin();try{await saveReningOffer(u.id,field(f,'id')?id(f):undefined,{title:field(f,'title'),credits:z.coerce.number().int().parse(field(f,'credits')),priceOre:money(field(f,'price')),vatPercent:Number(field(f,'vatPercent')),published:field(f,'published')==='on',expectedUpdatedAt:field(f,'expectedUpdatedAt')||null});}catch(e){return error(e);}refresh();redirect('/admin/rening/installningar?saved='+Date.now());}
export async function saveReningSettingsAction(_s:ReningFormState,f:FormData):Promise<ReningFormState>{const u=await requireAdmin();try{await saveReningSettings(u.id,{salesEnabled:field(f,'salesEnabled')==='on',terms:field(f,'terms'),expectedUpdatedAt:field(f,'expectedUpdatedAt')});}catch(e){return error(e);}refresh();redirect('/admin/rening/installningar?saved='+Date.now());}
