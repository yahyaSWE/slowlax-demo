import {z} from 'zod';
import {getCurrentUser} from '@/lib/auth';
import {enforceRequestLimit} from '@/lib/request-rate-limit';
import {assertPurificationPurchaseOrigin,purificationPurchaseRequestJson,purificationPurchaseResponseError,createPurificationPurchaseCheckout,PurificationPurchaseHttpError} from '@/lib/purification-billing';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){try{assertPurificationPurchaseOrigin(request);const u=await getCurrentUser();if(!u)throw new PurificationPurchaseHttpError('Logga in för att köpa reningar.',401);await enforceRequestLimit('rening-checkout',String(u.id),10,request.headers);const v=z.object({offerId:z.number().int().positive(),consent:z.literal(true),offerRevision:z.iso.datetime(),settingsRevision:z.iso.datetime()}).strict().parse(await purificationPurchaseRequestJson(request));return Response.json({url:await createPurificationPurchaseCheckout(u.id,v.offerId,v)},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return purificationPurchaseResponseError(e);}}
