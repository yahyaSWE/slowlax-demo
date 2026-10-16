import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createFirstAdmin,createUser,getDb,type User} from '../../src/lib/db';
import {PostgresDatabaseAdapter} from '../../src/lib/postgres-database';
import {pglitePostgres} from './pglite-postgres';
import {joinFreeMembership} from '../../src/lib/free-membership-domain';
import * as domain from '../../src/lib/purification-domain';
import {getAdminReningOffers,getPublicReningOffers,getReningSettings,saveReningOffer,saveReningSettings} from '../../src/lib/rening-offers';

export function purificationSuite(provider:'sqlite'|'postgres') {
 for(const key of ['TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','VERCEL','KIT_API_KEY','SUPABASE_AUTH_ENABLED','STRIPE_SECRET_KEY','RENING_STRIPE_WEBHOOK_SECRET'])delete process.env[key];
 process.env.SUPABASE_DATABASE_ENABLED=String(provider==='postgres');process.env.DATABASE_URL='postgres://test:test@localhost/test';
 let directory:string|undefined,admin:User,unverified:User;
 const stamp=()=>new Date().toISOString();
 before(async()=>{if(provider==='postgres'){const adapter=getDb() as PostgresDatabaseAdapter;await pglitePostgres(adapter);await adapter.migrate();}else{directory=await mkdtemp(join(tmpdir(),'slowlax-rening-'));process.env.TIBB_DATABASE_PATH=join(directory,'rening.sqlite');}
  admin=await createFirstAdmin({name:'Rening admin',email:'rening-admin@example.test',passwordHash:'fixture'});
  unverified=await createUser({name:'Unverified',email:'unverified@example.test',role:'student',passwordHash:'fixture'});
 });
 after(async()=>{await getDb().close();if(directory)await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:200});});
 async function student(){const u=await createUser({name:'Synthetic student',email:`${randomUUID()}@example.test`,role:'student',passwordHash:'fixture'});await getDb().prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(stamp(),u.id);return u;}
 async function grant(userId:number,credits=2,extra:Partial<Parameters<typeof domain.grantPurificationCredits>[0]>={}){return domain.grantPurificationCredits({userId,sourceKey:randomUUID(),sourceType:'purchase',sourceName:'Synthetic credits',credits,startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:null,...extra});}
 const holding=(name='Example AB',shares='12,5000'):domain.PurificationHolding=>({companyName:name,ticker:'',exchange:'',shareClass:'',shares});
 const request=(holdings=[holding()])=>({holdings,message:'Synthetic review period 2026',idempotencyKey:randomUUID()});
 test(`${provider}: quotas are admin-only, compare-and-swap; default offers are drafts and sales closed`,async()=>{
  const u=await student(),q=await domain.getPurificationQuotaSettings('bas',1);assert.equal(q.credits,0);assert.equal(q.updatedAt,null);
  await assert.rejects(domain.savePurificationQuotaSettings(u.id,'bas',1,{credits:2,expectedUpdatedAt:null}));
  const outcomes=await Promise.allSettled([2,3].map(credits=>domain.savePurificationQuotaSettings(admin.id,'bas',1,{credits,expectedUpdatedAt:null})));
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  const current=await domain.getPurificationQuotaSettings('bas',1);await domain.savePurificationQuotaSettings(admin.id,'bas',1,{credits:0,expectedUpdatedAt:current.updatedAt});
  const offers=await getAdminReningOffers(admin.id);assert.deepEqual(offers.map(o=>[o.credits,o.priceOre,o.published]),[[4,19900,false],[9,29900,false],[14,39900,false]]);
  assert.deepEqual(await getPublicReningOffers(),[]);assert.equal((await getReningSettings()).salesEnabled,false);
  await assert.rejects(saveReningOffer(u.id,undefined,{title:'Synthetic',credits:2,priceOre:19900,vatPercent:25,published:false,expectedUpdatedAt:null}));
  const settings=await getReningSettings();await assert.rejects(saveReningSettings(admin.id,{salesEnabled:true,terms:'Synthetic purchase terms for Rening.',expectedUpdatedAt:settings.updatedAt}),/Stripe/);
 });
 test(`${provider}: Bas GET never grants; a later nonzero quota reaches an existing member once`,async()=>{
  const u=await student();await joinFreeMembership(u.id);assert.equal((await domain.getPurificationBalance(u.id)).totalAvailableCredits,0);
  await domain.claimBasPurificationCredits(u.id);assert.equal(Number((await getDb().prepare('SELECT COUNT(*) AS total FROM purification_credit_grants WHERE user_id=?').get(u.id))?.total),0);
  let q=await domain.getPurificationQuotaSettings('bas',1);await domain.savePurificationQuotaSettings(admin.id,'bas',1,{credits:3,expectedUpdatedAt:q.updatedAt});
  assert.equal((await domain.getPurificationBalance(u.id)).claimableBasCredits,3);assert.equal(Number((await getDb().prepare('SELECT COUNT(*) AS total FROM purification_credit_grants WHERE user_id=?').get(u.id))?.total),0);
  await Promise.all([domain.claimBasPurificationCredits(u.id),domain.claimBasPurificationCredits(u.id)]);
  q=await domain.getPurificationQuotaSettings('bas',1);await domain.savePurificationQuotaSettings(admin.id,'bas',1,{credits:5,expectedUpdatedAt:q.updatedAt});
  assert.equal((await domain.getPurificationBalance(u.id)).totalAvailableCredits,3);
  q=await domain.getPurificationQuotaSettings('bas',1);await domain.savePurificationQuotaSettings(admin.id,'bas',1,{credits:0,expectedUpdatedAt:q.updatedAt});
 });
 test(`${provider}: verified students only; one company consumes one credit regardless of quantity; exact retry is idempotent`,async()=>{
  await assert.rejects(domain.getPurificationBalance(unverified.id),/Verifiera/);await assert.rejects(domain.getPurificationBalance(admin.id),/elevkonto/);
  await assert.rejects(grant(unverified.id));const u=await student();await grant(u.id,2);
  const input=request([holding('Example AB','00012,5000'),holding('Other AB','999999999999.12345678')]);
  const [a,b]=await Promise.all([domain.submitPurificationRequest(u.id,input),domain.submitPurificationRequest(u.id,input)]);
  assert.equal(a.id,b.id);assert.equal(a.creditsUsed,2);assert.equal(a.holdings[0].shares,'12.5');assert.equal((await domain.getPurificationBalance(u.id)).totalAvailableCredits,0);
  await assert.rejects(domain.submitPurificationRequest(u.id,{...input,message:'Changed payload'}),/annat innehåll/);
  const other=await student();assert.equal(await domain.getUserPurificationRequest(other.id,a.id),null);await assert.rejects(domain.cancelPurificationRequest(other.id,a.id,{expectedUpdatedAt:a.updatedAt}));
 });
 test(`${provider}: invalid or duplicate holdings never reserve; concurrent requests cannot overdraw`,async()=>{
  const u=await student();await grant(u.id,1);
  for(const shares of ['0','-1','NaN','1e6','1.123456789'])await assert.rejects(domain.submitPurificationRequest(u.id,request([holding('Example AB',shares)])));
  await assert.rejects(domain.submitPurificationRequest(u.id,request([holding('Example AB'),holding(' example ab ')])),/varje bolag/);
  const results=await Promise.allSettled([domain.submitPurificationRequest(u.id,request()),domain.submitPurificationRequest(u.id,request())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await domain.getPurificationBalance(u.id)).availableCredits,0);
  assert.equal((await domain.getUserPurificationRequests(u.id)).length,1);
 });
 test(`${provider}: drafts and internal notes stay private, admin CAS, published answer survives credit revocation`,async()=>{
  const u=await student(),source=randomUUID();await grant(u.id,2,{sourceKey:source});const r=await domain.submitPurificationRequest(u.id,request());
  await assert.rejects(domain.updateAdminPurificationRequest(u.id,r.id,{status:'completed',responseText:'Student injection',internalNotes:'',expectedUpdatedAt:r.updatedAt}));
  const draft=await domain.updateAdminPurificationRequest(admin.id,r.id,{status:'processing',responseText:'Private draft',internalNotes:'Admin only note',expectedUpdatedAt:r.updatedAt});
  const visible=(await domain.getUserPurificationRequest(u.id,r.id))!;assert.equal(visible.responseText,null);assert.equal(visible.responsePublishedAt,null);assert.equal(Object.hasOwn(visible,'internalNotes'),false);
  await assert.rejects(domain.cancelPurificationRequest(u.id,r.id,{expectedUpdatedAt:draft.updatedAt}),/handläggs/);
  await assert.rejects(domain.updateAdminPurificationRequest(admin.id,r.id,{status:'completed',responseText:'Stale',internalNotes:'',expectedUpdatedAt:r.updatedAt}),/ändrats/);
  await assert.rejects(domain.updateAdminPurificationRequest(admin.id,r.id,{status:'completed',responseText:' ',internalNotes:'',expectedUpdatedAt:draft.updatedAt}),/Skriv ett svar/);
  const done=await domain.updateAdminPurificationRequest(admin.id,r.id,{status:'completed',responseText:'Published synthetic answer',internalNotes:'Admin only note',expectedUpdatedAt:draft.updatedAt});
  await domain.revokePurificationCreditSource(source,'Synthetic refund');assert.equal((await domain.getPurificationBalance(u.id)).availableCredits,0);
  assert.equal((await domain.getUserPurificationRequest(u.id,r.id))?.responseText,'Published synthetic answer');
  await assert.rejects(domain.updateAdminPurificationRequest(admin.id,r.id,{status:'processing',responseText:'',internalNotes:'',expectedUpdatedAt:done.updatedAt}),/avslutat/);
 });
 test(`${provider}: cancellation and rejection release exact credits once, preserving unrelated sources`,async()=>{
  const u=await student();await grant(u.id,2);let r=await domain.submitPurificationRequest(u.id,request());
  r=await domain.cancelPurificationRequest(u.id,r.id,{expectedUpdatedAt:r.updatedAt});await domain.cancelPurificationRequest(u.id,r.id,{expectedUpdatedAt:r.updatedAt});assert.equal((await domain.getPurificationBalance(u.id)).availableCredits,2);
  const second=await domain.submitPurificationRequest(u.id,request());await domain.updateAdminPurificationRequest(admin.id,second.id,{status:'rejected',responseText:'',internalNotes:'Rejected fixture',expectedUpdatedAt:second.updatedAt});assert.equal((await domain.getPurificationBalance(u.id)).availableCredits,2);
  const key=randomUUID();await domain.revokePurificationCreditSource(key,'Refund before fulfillment');await grant(u.id,7,{sourceKey:key});assert.equal((await domain.getPurificationBalance(u.id)).availableCredits,2);
  await assert.rejects(grant(u.id,8,{sourceKey:key}),/matchar/);
 });
 test(`${provider}: period credits expire, future periods cannot be spent, nearest expiry is used first`,async()=>{
  const u=await student();await grant(u.id,5,{expiresAt:new Date(Date.now()-30000).toISOString()});await grant(u.id,6,{startsAt:new Date(Date.now()+60000).toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()});
  const forever=await grant(u.id,2),period=await grant(u.id,1,{expiresAt:new Date(Date.now()+60000).toISOString()});assert.equal((await domain.getPurificationBalance(u.id)).availableCredits,3);
  const r=await domain.submitPurificationRequest(u.id,request());const event=await getDb().prepare("SELECT grant_id FROM purification_credit_events WHERE request_id=? AND event_type='reserve'").get(r.id);assert.equal(event?.grant_id,period.id);
  assert.equal((await domain.getPurificationBalance(u.id)).grants.find(g=>g.id===forever.id)?.remainingCredits,2);
  await assert.rejects(getDb().prepare('UPDATE purification_credit_grants SET total_credits=100 WHERE id=?').run(period.id),/immutable/);
 });
 test(`${provider}: deleting an owner removes private holdings and credit events`,async()=>{
  const u=await student();await grant(u.id,2);const r=await domain.submitPurificationRequest(u.id,request());
  await getDb().prepare('DELETE FROM users WHERE id=?').run(u.id);
  assert.equal(await getDb().prepare('SELECT id FROM purification_requests WHERE id=?').get(r.id),undefined);
  assert.equal(Number((await getDb().prepare('SELECT COUNT(*) AS total FROM purification_credit_events WHERE request_id=?').get(r.id))?.total),0);
 });
}
