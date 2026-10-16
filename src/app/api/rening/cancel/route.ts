import {z} from 'zod';
import {getCurrentUser} from '@/lib/auth';
import {enforceRequestLimit} from '@/lib/request-rate-limit';
import {assertPurificationPurchaseOrigin,purificationPurchaseRequestJson,purificationPurchaseResponseError,cancelPurificationPurchaseCheckout,PurificationPurchaseHttpError} from '@/lib/purification-billing';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){try{assertPurificationPurchaseOrigin(request);const u=await getCurrentUser();if(!u)throw new PurificationPurchaseHttpError('Logga in.',401);await enforceRequestLimit('rening-cancel',String(u.id),10,request.headers);const v=z.object({offerId:z.number().int().positive()}).strict().parse(await purificationPurchaseRequestJson(request));await cancelPurificationPurchaseCheckout(u.id,v.offerId);return Response.json({ok:true},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return purificationPurchaseResponseError(e);}}
