import { randomBytes } from "node:crypto";
import { z } from "zod";
import { assertAdmin } from "./admin";
import { getDb, transaction } from "./database";
import { DomainError } from "./db";

export type PurificationQuotaSource = "bas" | "membership_plan" | "course_bundle";
export type PurificationQuotaSettings = {sourceType:PurificationQuotaSource;sourceId:number;credits:number;updatedAt:string|null};
export type PurificationStatus = "submitted"|"processing"|"completed"|"rejected"|"cancelled";
export type PurificationHolding = {companyName:string;ticker:string;exchange:string;shareClass:string;shares:string};
export type StudentPurificationRequest = {
  id:string;status:PurificationStatus;createdAt:string;updatedAt:string;holdings:PurificationHolding[];message:string;
  companyCount:number;creditsUsed:number;responseText:string|null;responsePublishedAt:string|null;canCancel:boolean;
};
export type AdminPurificationRequest = StudentPurificationRequest & {userId:number;studentName:string;studentEmail:string;internalNotes:string};
export type PurificationGrant = {id:string;sourceName:string;totalCredits:number;remainingCredits:number;expiresAt:string|null;startsAt:string;status:"active"|"upcoming"|"expired"|"revoked"};
export type PurificationBalance = {availableCredits:number;claimableBasCredits:number;totalAvailableCredits:number;grants:PurificationGrant[]};
type Row=Record<string,unknown>;
const newId=()=>randomBytes(16).toString("hex");
const positiveId=z.number().int().positive();
const quotaSource=z.enum(["bas","membership_plan","course_bundle"]);
const attemptKind=z.enum(["membership","bundle"]);
const compact=(input:string)=>input.normalize("NFC").trim().replace(/\s+/gu," ");
const plain=(max:number,min=0)=>z.string().transform(value=>value.normalize("NFC").trim()).pipe(z.string().min(min).max(max));
const revision=z.iso.datetime().nullable();
const monotonic=(previous:string)=>new Date(Math.max(Date.now(),Date.parse(previous)+1)).toISOString();
function fail(message:string):never{throw new DomainError(message);}
async function student(userId:number,verified=true){
  positiveId.parse(userId);
  const user=await getDb().prepare("SELECT id,role,email_verified_at FROM users WHERE id=?").get(userId);
  if(user?.role!=="student") fail("Logga in med ett elevkonto för att använda Rening.");
  if(verified&&!user.email_verified_at) fail("Verifiera din e-postadress för att använda Rening.");
}
async function requireSource(type:PurificationQuotaSource,id:number){
  const sql=type==="bas"?"SELECT id FROM free_membership_settings WHERE id=? AND id=1":type==="membership_plan"?"SELECT id FROM membership_plans WHERE id=?":"SELECT course_id FROM course_bundles WHERE course_id=?";
  if(!await getDb().prepare(sql).get(id)) fail("Erbjudandet finns inte längre. Ladda om sidan.");
}
export async function getPurificationQuotaSettings(sourceType:PurificationQuotaSource,sourceId:number):Promise<PurificationQuotaSettings>{
  quotaSource.parse(sourceType);positiveId.parse(sourceId);await requireSource(sourceType,sourceId);
  const row=await getDb().prepare("SELECT credits,updated_at FROM purification_quota_settings WHERE source_type=? AND source_id=?").get(sourceType,sourceId);
  return {sourceType,sourceId,credits:Number(row?.credits??0),updatedAt:row?String(row.updated_at):null};
}
export async function savePurificationQuotaSettings(actorId:number,sourceType:PurificationQuotaSource,sourceId:number,input:{credits:number;expectedUpdatedAt:string|null}):Promise<PurificationQuotaSettings>{
  const value=z.object({credits:z.number().int().min(0).max(10000),expectedUpdatedAt:revision}).strict().parse(input);
  return transaction(async()=>{
    await assertAdmin(actorId);
    const current=await getPurificationQuotaSettings(sourceType,sourceId);
    if(current.updatedAt!==value.expectedUpdatedAt) fail("Rening-kvoten har ändrats. Ladda om sidan innan du sparar igen.");
    const updatedAt=current.updatedAt?monotonic(current.updatedAt):new Date().toISOString();
    if(current.updatedAt===null) await getDb().prepare("INSERT INTO purification_quota_settings(source_type,source_id,credits,updated_at) VALUES(?,?,?,?)").run(sourceType,sourceId,value.credits,updatedAt);
    else if(!(await getDb().prepare("UPDATE purification_quota_settings SET credits=?,updated_at=? WHERE source_type=? AND source_id=? AND updated_at=?").run(value.credits,updatedAt,sourceType,sourceId,current.updatedAt)).changes) fail("Rening-kvoten har ändrats. Ladda om sidan.");
    return {sourceType,sourceId,credits:value.credits,updatedAt};
  });
}
export async function getPurificationAttemptQuota(kind:"membership"|"bundle",attemptId:string):Promise<number>{
  attemptKind.parse(kind);plain(240,1).parse(attemptId);
  return Number((await getDb().prepare("SELECT credits FROM purification_attempt_quotas WHERE kind=? AND attempt_id=?").get(kind,attemptId))?.credits??0);
}
/** Call while reserving a NEW checkout, before Stripe creates its session. Missing historic snapshots always mean zero. */
export async function snapshotPurificationQuotaForAttempt(kind:"membership"|"bundle",attemptId:string,sourceId:number):Promise<{credits:number}>{
  attemptKind.parse(kind);plain(240,1).parse(attemptId);positiveId.parse(sourceId);
  return transaction(async()=>{
    const existing=await getDb().prepare("SELECT credits FROM purification_attempt_quotas WHERE kind=? AND attempt_id=?").get(kind,attemptId);
    if(existing) return {credits:Number(existing.credits)};
    const parent=await getDb().prepare(kind==="membership"?"SELECT status,session_id,plan_id AS source_id FROM membership_checkout_attempts WHERE id=?":"SELECT status,session_id,course_id AS source_id FROM course_purchase_attempts WHERE id=?").get(attemptId);
    if(!parent||Number(parent.source_id)!==sourceId) fail("Köpet matchar inte Rening-erbjudandet.");
    if(parent.status!=="creating"||parent.session_id!=null) return {credits:0};
    const quota=await getPurificationQuotaSettings(kind==="membership"?"membership_plan":"course_bundle",sourceId);
    await getDb().prepare("INSERT INTO purification_attempt_quotas(kind,attempt_id,credits,created_at) VALUES(?,?,?,?)").run(kind,attemptId,quota.credits,new Date().toISOString());
    return {credits:quota.credits};
  });
}
const grantInput=z.object({userId:positiveId,sourceKey:plain(240,1),sourceType:z.enum(["bas","membership","bundle","purchase"]),sourceName:plain(240,1),credits:z.number().int().min(1).max(10000),startsAt:z.iso.datetime(),expiresAt:z.iso.datetime().nullable()}).strict();
/** Trusted payment/registration hook only. Never expose grant fields to a student action. */
export async function grantPurificationCredits(input:z.input<typeof grantInput>):Promise<PurificationGrant>{
  const value=grantInput.parse(input);
  if(value.expiresAt!==null&&Date.parse(value.expiresAt)<=Date.parse(value.startsAt)) fail("Rening-krediternas giltighetstid är ogiltig.");
  return transaction(async()=>{
    const existing=await getDb().prepare("SELECT * FROM purification_credit_grants WHERE source_key=?").get(value.sourceKey);
    if(existing){
      if(Number(existing.user_id)!==value.userId||existing.source_type!==value.sourceType||existing.source_name!==value.sourceName||Number(existing.total_credits)!==value.credits||existing.starts_at!==value.startsAt||existing.expires_at!==value.expiresAt) fail("Rening-källan matchar inte den tidigare tilldelningen.");
      return mapGrant({...existing,...await grantAccounting(String(existing.id))});
    }
    await student(value.userId);
    const id=newId();
    await getDb().prepare("INSERT INTO purification_credit_grants(id,user_id,source_key,source_type,source_name,total_credits,starts_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id,value.userId,value.sourceKey,value.sourceType,value.sourceName,value.credits,value.startsAt,value.expiresAt,new Date().toISOString());
    return mapGrant((await getDb().prepare("SELECT g.*,v.source_key AS revoked FROM purification_credit_grants g LEFT JOIN purification_credit_revocations v ON v.source_key=g.source_key WHERE g.id=?").get(id))!);
  });
}
export async function revokePurificationCreditSource(sourceKey:string,reason:string):Promise<void>{
  const key=plain(240,1).parse(sourceKey),why=plain(500,1).parse(reason);
  await transaction(async()=>{await getDb().prepare("INSERT INTO purification_credit_revocations(source_key,reason,created_at) VALUES(?,?,?) ON CONFLICT(source_key) DO NOTHING").run(key,why,new Date().toISOString());});
}
async function grantAccounting(id:string){return (await getDb().prepare(`SELECT COALESCE(SUM(CASE WHEN e.event_type='reserve' THEN e.credits ELSE -e.credits END),0) AS consumed,
 (SELECT v.source_key FROM purification_credit_revocations v JOIN purification_credit_grants g ON g.source_key=v.source_key WHERE g.id=?) AS revoked
 FROM purification_credit_events e WHERE e.grant_id=?`).get(id,id))!;}
function mapGrant(row:Row):PurificationGrant{
  const expiresAt=row.expires_at==null?null:String(row.expires_at),startsAt=String(row.starts_at),now=Date.now();
  const status:PurificationGrant["status"]=row.revoked!=null?"revoked":Date.parse(startsAt)>now?"upcoming":expiresAt!==null&&Date.parse(expiresAt)<=now?"expired":"active";
  return {id:String(row.id),sourceName:String(row.source_name),totalCredits:Number(row.total_credits),remainingCredits:Number(row.total_credits)-Number(row.consumed??0),expiresAt,startsAt,status};
}
async function basClaimable(userId:number):Promise<number>{
  const row=await getDb().prepare(`SELECT q.credits FROM free_membership_members m JOIN purification_quota_settings q ON q.source_type='bas' AND q.source_id=1
    WHERE m.user_id=? AND NOT EXISTS(SELECT 1 FROM purification_credit_grants g WHERE g.source_key=?)
    AND NOT EXISTS(SELECT 1 FROM purification_credit_revocations v WHERE v.source_key=?)`).get(userId,`bas:${userId}`,`bas:${userId}`);
  return Number(row?.credits??0);
}
export async function getPurificationBalance(userId:number):Promise<PurificationBalance>{
  return transaction(async()=>{
    await student(userId);
    const rows=await getDb().prepare(`SELECT g.*,v.source_key AS revoked,
      COALESCE((SELECT SUM(CASE WHEN e.event_type='reserve' THEN e.credits ELSE -e.credits END) FROM purification_credit_events e WHERE e.grant_id=g.id),0) AS consumed
      FROM purification_credit_grants g LEFT JOIN purification_credit_revocations v ON v.source_key=g.source_key WHERE g.user_id=? ORDER BY g.created_at,g.id`).all(userId);
    const grants=rows.map(mapGrant),availableCredits=grants.filter(grant=>grant.status==="active").reduce((sum,grant)=>sum+grant.remainingCredits,0),claimableBasCredits=await basClaimable(userId);
    return {availableCredits,claimableBasCredits,totalAvailableCredits:availableCredits+claimableBasCredits,grants};
  });
}
/** POST-only lazy Bas claim: zero is never recorded, so a later configured quota can reach existing Bas members. */
export async function claimBasPurificationCredits(userId:number):Promise<PurificationBalance>{
  return transaction(async()=>{
    await student(userId);
    const credits=await basClaimable(userId);
    if(credits>0) await grantPurificationCredits({userId,sourceKey:`bas:${userId}`,sourceType:"bas",sourceName:"Bas",credits,startsAt:new Date().toISOString(),expiresAt:null});
    return getPurificationBalance(userId);
  });
}
const holdingInput=z.object({companyName:plain(200,2),ticker:plain(40),exchange:plain(40),shareClass:plain(40),shares:plain(40,1)}).strict();
function normalizeHoldings(input:PurificationHolding[]):PurificationHolding[]{
  const values=z.array(holdingInput).min(1).max(50).parse(input),companies=new Set<string>(),instruments=new Set<string>();
  const identity=(text:string)=>compact(text.normalize("NFKC")).toLocaleUpperCase("sv-SE").replace(/[^\p{L}\p{N}]/gu,"");
  return values.map(value=>{
    const holding={...value,companyName:compact(value.companyName),ticker:compact(value.ticker),exchange:compact(value.exchange),shareClass:compact(value.shareClass),shares:value.shares.replace(",",".")};
    if(!/^\d{1,12}(?:\.\d{1,8})?$/.test(holding.shares)||!/[1-9]/.test(holding.shares)) fail("Ange ett positivt antal aktier med högst åtta decimaler.");
    holding.shares=holding.shares.replace(/^0+(?=\d)/,"").replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,"");
    const company=identity(holding.companyName),instrument=holding.ticker?`${identity(holding.exchange)}:${identity(holding.ticker)}:${identity(holding.shareClass)}`:null;
    if(!company||companies.has(company)||(instrument!==null&&instruments.has(instrument))) fail("Ange varje bolag bara en gång i ärendet.");
    companies.add(company);if(instrument!==null)instruments.add(instrument);
    return holding;
  });
}
function studentDto(row:Row):StudentPurificationRequest{
  return {id:String(row.id),status:row.status as PurificationStatus,createdAt:String(row.created_at),updatedAt:String(row.updated_at),holdings:JSON.parse(String(row.holdings_json)) as PurificationHolding[],message:String(row.message),companyCount:Number(row.company_count),creditsUsed:Number(row.credits_used),responseText:row.status==="completed"?String(row.response_text):null,responsePublishedAt:row.status==="completed"?String(row.response_published_at):null,canCancel:row.status==="submitted"};
}
function adminDto(row:Row):AdminPurificationRequest{return {...studentDto(row),responseText:String(row.response_text),responsePublishedAt:row.response_published_at==null?null:String(row.response_published_at),userId:Number(row.user_id),studentName:String(row.student_name),studentEmail:String(row.student_email),internalNotes:String(row.internal_notes)};}
export async function getUserPurificationRequests(userId:number):Promise<StudentPurificationRequest[]>{
  await student(userId,false);
  return (await getDb().prepare("SELECT * FROM purification_requests WHERE user_id=? ORDER BY created_at DESC,id DESC").all(userId)).map(studentDto);
}
export async function getUserPurificationRequest(userId:number,id:string):Promise<StudentPurificationRequest|null>{
  await student(userId,false);plain(64,1).parse(id);
  const row=await getDb().prepare("SELECT * FROM purification_requests WHERE user_id=? AND id=?").get(userId,id);
  return row?studentDto(row):null;
}
export async function submitPurificationRequest(userId:number,input:{holdings:PurificationHolding[];message:string;idempotencyKey:string}):Promise<StudentPurificationRequest>{
  const value=z.object({holdings:z.array(holdingInput).min(1).max(50),message:plain(4000),idempotencyKey:z.uuid()}).strict().parse(input),holdings=normalizeHoldings(value.holdings),json=JSON.stringify(holdings);
  return transaction(async()=>{
    await student(userId);
    const existing=await getDb().prepare("SELECT * FROM purification_requests WHERE user_id=? AND idempotency_key=?").get(userId,value.idempotencyKey);
    if(existing){if(existing.holdings_json!==json||existing.message!==value.message)fail("Formuläret har redan skickats med annat innehåll. Ladda om sidan.");return studentDto(existing);}
    const balance=await claimBasPurificationCredits(userId);
    if(balance.availableCredits<holdings.length) fail("Du har inte tillräckligt många Rening-krediter för dessa bolag.");
    const id=newId(),now=new Date().toISOString();
    await getDb().prepare("INSERT INTO purification_requests(id,user_id,idempotency_key,status,holdings_json,message,company_count,credits_used,created_at,updated_at) VALUES(?,?,?,'submitted',?,?,?,?,?,?)")
      .run(id,userId,value.idempotencyKey,json,value.message,holdings.length,holdings.length,now,now);
    const grants=balance.grants.filter(grant=>grant.status==="active"&&grant.remainingCredits>0).sort((a,b)=>(a.expiresAt??"9999").localeCompare(b.expiresAt??"9999")||a.id.localeCompare(b.id));
    let remaining=holdings.length;
    for(const grant of grants){const credits=Math.min(remaining,grant.remainingCredits);if(credits>0)await getDb().prepare("INSERT INTO purification_credit_events(id,grant_id,request_id,event_type,credits,created_at) VALUES(?,?,?,'reserve',?,?)").run(newId(),grant.id,id,credits,now);remaining-=credits;if(!remaining)break;}
    if(remaining!==0) fail("Rening-saldot har ändrats. Försök igen.");
    return (await getUserPurificationRequest(userId,id))!;
  });
}
async function releaseRequest(id:string){
  const rows=await getDb().prepare("SELECT grant_id,credits FROM purification_credit_events WHERE request_id=? AND event_type='reserve'").all(id);
  for(const row of rows)await getDb().prepare("INSERT INTO purification_credit_events(id,grant_id,request_id,event_type,credits,created_at) VALUES(?,?,?,'release',?,?) ON CONFLICT(grant_id,request_id,event_type) DO NOTHING").run(newId(),String(row.grant_id),id,Number(row.credits),new Date().toISOString());
}
export async function cancelPurificationRequest(userId:number,id:string,input:{expectedUpdatedAt:string}):Promise<StudentPurificationRequest>{
  z.object({expectedUpdatedAt:z.iso.datetime()}).strict().parse(input);
  return transaction(async()=>{
    await student(userId);
    const row=await getDb().prepare("SELECT * FROM purification_requests WHERE id=? AND user_id=?").get(id,userId);
    if(!row)fail("Ärendet kunde inte hittas.");
    if(row.status==="cancelled")return studentDto(row);
    if(row.updated_at!==input.expectedUpdatedAt)fail("Ärendet har ändrats. Ladda om sidan.");
    if(row.status!=="submitted")fail("Ärendet handläggs redan och kan inte avbrytas här.");
    const result=await getDb().prepare("UPDATE purification_requests SET status='cancelled',updated_at=? WHERE id=? AND user_id=? AND updated_at=? AND status='submitted'").run(monotonic(String(row.updated_at)),id,userId,input.expectedUpdatedAt);
    if(!result.changes)fail("Ärendet har ändrats. Ladda om sidan.");
    await releaseRequest(id);return (await getUserPurificationRequest(userId,id))!;
  });
}
const adminSelect="SELECT r.*,u.name AS student_name,u.email AS student_email FROM purification_requests r JOIN users u ON u.id=r.user_id";
export async function getAdminPurificationRequests(actorId:number,filter:{status?:PurificationStatus}={}):Promise<AdminPurificationRequest[]>{
  await assertAdmin(actorId);if(filter.status)z.enum(["submitted","processing","completed","rejected","cancelled"]).parse(filter.status);
  return (await getDb().prepare(adminSelect+(filter.status?" WHERE r.status=?":"")+" ORDER BY r.created_at DESC,r.id DESC").all(...(filter.status?[filter.status]:[]))).map(adminDto);
}
export async function getAdminPurificationRequest(actorId:number,id:string):Promise<AdminPurificationRequest|null>{
  await assertAdmin(actorId);const row=await getDb().prepare(adminSelect+" WHERE r.id=?").get(id);return row?adminDto(row):null;
}
export async function updateAdminPurificationRequest(actorId:number,id:string,input:{status:"processing"|"completed"|"rejected";responseText:string;internalNotes:string;expectedUpdatedAt:string}):Promise<AdminPurificationRequest>{
  const value=z.object({status:z.enum(["processing","completed","rejected"]),responseText:plain(30000),internalNotes:plain(20000),expectedUpdatedAt:z.iso.datetime()}).strict().parse(input);
  return transaction(async()=>{
    await assertAdmin(actorId);const row=await getDb().prepare("SELECT * FROM purification_requests WHERE id=?").get(id);
    if(!row)fail("Ärendet kunde inte hittas.");
    if(row.updated_at!==value.expectedUpdatedAt)fail("Ärendet har ändrats. Ladda om sidan innan du sparar.");
    if(row.status==="cancelled"||row.status==="rejected"||(row.status==="completed"&&value.status!=="completed"))fail("Ett avslutat ärende kan inte öppnas igen.");
    if(value.status==="completed"&&!value.responseText)fail("Skriv ett svar till eleven innan ärendet slutförs.");
    const now=monotonic(String(row.updated_at)),published=value.status==="completed"?(row.response_published_at==null?now:String(row.response_published_at)):null;
    const result=await getDb().prepare("UPDATE purification_requests SET status=?,response_text=?,internal_notes=?,response_published_at=?,updated_at=? WHERE id=? AND updated_at=?")
      .run(value.status,value.responseText,value.internalNotes,published,now,id,value.expectedUpdatedAt);
    if(!result.changes)fail("Ärendet har ändrats. Ladda om sidan.");
    if(value.status==="rejected")await releaseRequest(id);
    return (await getAdminPurificationRequest(actorId,id))!;
  });
}
