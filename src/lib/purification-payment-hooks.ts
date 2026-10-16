import { getDb } from "./database";
import { DomainError } from "./db";
import { getPurificationQuotaSettings,snapshotPurificationQuotaForAttempt,getPurificationAttemptQuota,grantPurificationCredits,revokePurificationCreditSource } from "./purification-domain";
type Row=Record<string,unknown>;
export async function bundlePurificationQuota(courseId:number){return await getDb().prepare('SELECT course_id FROM course_bundles WHERE course_id=?').get(courseId)?getPurificationQuotaSettings('course_bundle',courseId):null;}
export async function checkPurificationRevision(kind:'membership'|'bundle',sourceId:number,expected?:string|null){const q=kind==='membership'?await getPurificationQuotaSettings('membership_plan',sourceId):await bundlePurificationQuota(sourceId);if((q?.updatedAt??null)!==(expected??null))throw new DomainError('Antalet reningar i erbjudandet har ändrats. Ladda om sidan och godkänn erbjudandet igen.');}
export async function snapshotBundlePurification(attemptId:string,courseId:number){if(await bundlePurificationQuota(courseId))await snapshotPurificationQuotaForAttempt('bundle',attemptId,courseId);}
export async function applyBundlePurification(a:Row,paidAt:string,revoked:boolean){const key='bundle:'+String(a.id);if(revoked){await revokePurificationCreditSource(key,'payment-revoked');return;}const credits=await getPurificationAttemptQuota('bundle',String(a.id));if(credits)await grantPurificationCredits({userId:Number(a.user_id),sourceKey:key,sourceType:'bundle',sourceName:String(a.course_title),credits,startsAt:paidAt,expiresAt:null});}
export type PurificationInvoice={invoiceId:string;periodStart:string;periodEnd:string;blocked:boolean};
export async function applyMembershipPurification(a:Row,subscriptionId:string,invoices:PurificationInvoice[],blocked:boolean){
 const prefix='membership:'+subscriptionId+':',credits=await getPurificationAttemptQuota('membership',String(a.id));
 if(blocked){const rows=await getDb().prepare("SELECT source_key FROM purification_credit_grants WHERE source_type='membership' AND substr(source_key,1,?)=?").all(prefix.length,prefix);for(const row of rows)await revokePurificationCreditSource(String(row.source_key),'membership-payment-revoked');}
 for(const invoice of invoices){const key=prefix+invoice.invoiceId;if(blocked||invoice.blocked){await revokePurificationCreditSource(key,'membership-payment-revoked');continue;}if(credits)await grantPurificationCredits({userId:Number(a.user_id),sourceKey:key,sourceType:'membership',sourceName:String(a.plan_name),credits,startsAt:invoice.periodStart,expiresAt:invoice.periodEnd});}
}
