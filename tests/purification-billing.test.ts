import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFirstAdmin,createUser,getDb} from '../src/lib/db';
import {getStripe} from '../src/lib/stripe';
import {getReningOffer,getReningSettings,saveReningOffer,saveReningSettings} from '../src/lib/rening-offers';
import {createPurificationPurchaseCheckout,cancelPurificationPurchaseCheckout,reconcilePurificationPurchaseEvent,getUserReningPayments} from '../src/lib/purification-billing';
import {getPurificationBalance} from '../src/lib/purification-domain';
import {assertPurificationPurchaseOrigin,readPurificationPurchaseBody} from '../src/lib/purification-billing';
import {POST as webhook} from '../src/app/api/rening/webhook/route';
import {POST as checkoutRoute} from '../src/app/api/rening/checkout/route';
import {POST as cancelRoute} from '../src/app/api/rening/cancel/route';
import {PostgresDatabaseAdapter} from '../src/lib/postgres-database';
import {pglitePostgres} from './helpers/pglite-postgres';
const postgres=process.env.PURIFICATION_TEST_POSTGRES==='true';
for(const key of ['SUPABASE_DATABASE_ENABLED','SUPABASE_AUTH_ENABLED','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','VERCEL'])delete process.env[key];
process.env.SUPABASE_DATABASE_ENABLED=String(postgres);process.env.DATABASE_URL='postgres://test:test@localhost/test';
process.env.STRIPE_SECRET_KEY='sk_test_synthetic';process.env.RENING_STRIPE_WEBHOOK_SECRET='whsec_synthetic';process.env.APP_URL='https://rening.example.test';
type ObjectMap=Record<string,any>;
const customers=new Map<string,ObjectMap>(),sessions=new Map<string,ObjectMap>(),rates=new Map<string,ObjectMap>(),intents=new Map<string,ObjectMap>(),charges=new Map<string,ObjectMap>();
const restores:(()=>void)[]=[];let directory:string|undefined,admin:number,student:number,other:number,unverified:number,offerId:number,sequence=0,uncertain=false;
function patch(resource:unknown,method:string,handler:(...args:any[])=>Promise<any>){const p=Object.getPrototypeOf(resource),previous=p[method];p[method]=handler;restores.push(()=>p[method]=previous);}
function read(map:Map<string,ObjectMap>,id:string){const o=map.get(id);if(!o)throw new Error(`Unmocked object ${id}`);return structuredClone(o);}
before(async()=>{
 if(postgres){const adapter=getDb() as PostgresDatabaseAdapter;await pglitePostgres(adapter);await adapter.migrate();}
 else{directory=await mkdtemp(join(tmpdir(),'slowlax-rening-billing-'));process.env.TIBB_DATABASE_PATH=join(directory,'billing.sqlite');}
 admin=(await createFirstAdmin({name:'Synthetic admin',email:'admin@example.test',passwordHash:'fixture'})).id;
 const make=async(name:string)=>(await createUser({name,email:`${name}@example.test`,role:'student',passwordHash:'fixture'})).id;
 student=await make('student');other=await make('other');unverified=await make('unverified');await getDb().prepare('UPDATE users SET email_verified_at=? WHERE id IN (?,?)').run(new Date().toISOString(),student,other);
 await getDb().prepare("UPDATE settings SET email='contact@example.test' WHERE id=1").run();
 offerId=(await saveReningOffer(admin,undefined,{title:'Synthetic four companies',credits:4,priceOre:19900,vatPercent:25,published:true,expectedUpdatedAt:null}))!;
 const settings=await getReningSettings();await saveReningSettings(admin,{salesEnabled:true,terms:'Synthetic Rening purchase terms. Credits have no time limit.',expectedUpdatedAt:settings.updatedAt});
 const stripe=getStripe();
 patch(stripe.customers,'create',async p=>{const v={id:`cus_${p.metadata.user_id}`,metadata:p.metadata,tax_exempt:'none'};customers.set(v.id,v);return structuredClone(v);});patch(stripe.customers,'retrieve',async id=>read(customers,id));
 patch(stripe.taxRates,'create',async p=>{const v={...p,id:`txr_${p.metadata.rening_purchase_attempt_id}`,active:true};rates.set(v.id,v);return structuredClone(v);});patch(stripe.taxRates,'retrieve',async id=>read(rates,id));
 patch(stripe.checkout.sessions,'create',async p=>{
  const existing=[...sessions.values()].find(s=>s.client_reference_id===p.client_reference_id);if(existing)return structuredClone(existing);
  const price={id:`price_${p.client_reference_id}`,...p.line_items[0].price_data,recurring:null},rate=read(rates,p.line_items[0].tax_rates[0]),tax=Math.round(price.unit_amount*rate.percentage/(100+rate.percentage));
  const v={id:`cs_${p.client_reference_id}`,client_reference_id:p.client_reference_id,mode:'payment',status:'open',currency:'sek',customer:p.customer,metadata:p.metadata,expires_at:p.expires_at,amount_total:price.unit_amount,automatic_tax:{enabled:false},allow_promotion_codes:false,payment_intent:null,payment_status:'unpaid',total_details:{amount_tax:tax,amount_discount:0,amount_shipping:0},url:'https://checkout.stripe.com/pay/synthetic',line_items:{has_more:false,data:[{quantity:1,amount_total:price.unit_amount,amount_discount:0,amount_tax:tax,price,taxes:[{amount:tax,rate,taxability_reason:'standard_rated'}]}]}};
  sessions.set(v.id,v);if(uncertain){uncertain=false;throw new Error('Synthetic timeout after provider creation');}return structuredClone(v);
 });
 patch(stripe.checkout.sessions,'retrieve',async id=>read(sessions,id));patch(stripe.checkout.sessions,'expire',async id=>{const s=sessions.get(id)!;if(s.status==='complete')throw new Error('Already paid');s.status='expired';return structuredClone(s);});
 patch(stripe.checkout.sessions,'list',async p=>({has_more:false,data:[...sessions.values()].filter(s=>p.payment_intent?s.payment_intent===p.payment_intent:s.customer===p.customer)}));
 patch(stripe.paymentIntents,'retrieve',async id=>read(intents,id));patch(stripe.charges,'retrieve',async id=>read(charges,id));
});
after(async()=>{for(const r of restores.reverse())r();await getDb().close();if(directory)await rm(directory,{recursive:true,force:true,maxRetries:15,retryDelay:200});});
async function consent(){return {consent:true as const,offerRevision:(await getReningOffer(offerId))!.updatedAt,settingsRevision:(await getReningSettings()).updatedAt};}
async function checkout(userId=student){await createPurificationPurchaseCheckout(userId,offerId,await consent());return [...sessions.values()].at(-1)!;}
function pay(s:ObjectMap){const pi=`pi_${s.client_reference_id}`,ch=`ch_${s.client_reference_id}`;s.status='complete';s.payment_status='paid';s.payment_intent=pi;
 intents.set(pi,{id:pi,status:'succeeded',currency:'sek',amount:s.amount_total,amount_received:s.amount_total,customer:s.customer,metadata:structuredClone(s.metadata),latest_charge:ch});
 const charge={id:ch,status:'succeeded',paid:true,captured:true,currency:'sek',amount:s.amount_total,amount_captured:s.amount_total,customer:s.customer,payment_intent:pi,metadata:structuredClone(s.metadata),created:Math.floor(Date.now()/1000)-1,refunded:false,amount_refunded:0,disputed:false};charges.set(ch,charge);return charge;
}
async function event(object:ObjectMap,type='checkout.session.completed',id=`evt_${++sequence}`){return reconcilePurificationPurchaseEvent({id,type,data:{object}} as any);}
test('Rening checkout snapshots credits, price and consent; no credits before verified payment; duplicates grant once',async()=>{
 const s=await checkout();assert.equal(s.amount_total,19900);assert.equal(s.metadata.credits,'4');assert.equal((await getPurificationBalance(student)).availableCredits,0);
 await checkout();assert.equal(sessions.size,1);await event(s);assert.equal((await getPurificationBalance(student)).availableCredits,0);
 const charge=pay(s);await event(s);await event(s);assert.equal((await getPurificationBalance(student)).availableCredits,4);
 charge.refunded=true;charge.amount_refunded=charge.amount;await event(charge,'charge.refunded');assert.equal((await getPurificationBalance(student)).availableCredits,0);await event(s);assert.equal((await getPurificationBalance(student)).availableCredits,0);
 assert.equal((await getUserReningPayments(student))[0].revoked,1);
});
test('Rening supports repeated purchases; accepted snapshot survives offer changes and refund before fulfillment stays blocked',async()=>{
 const s=await checkout(),o=(await getReningOffer(offerId))!;await saveReningOffer(admin,offerId,{title:'Changed current offer',credits:9,priceOre:29900,vatPercent:o.vatPercent,published:true,expectedUpdatedAt:o.updatedAt});
 pay(s);await event(s);assert.equal((await getPurificationBalance(student)).availableCredits,4);
 const next=await checkout();assert.equal(next.metadata.credits,'9');const ch=pay(next);ch.refunded=true;ch.amount_refunded=ch.amount;await event(ch,'charge.refunded');await event(next);assert.equal((await getPurificationBalance(student)).availableCredits,4);
});
test('Rening uncertain checkout retries same attempt; only owner can cancel; verified student required',async()=>{
 await assert.rejects(checkout(unverified));await assert.rejects(checkout(admin));uncertain=true;await assert.rejects(checkout(other),/timeout/);
 const count=sessions.size,s=await checkout(other);assert.equal(sessions.size,count);
 await cancelPurificationPurchaseCheckout(student,offerId);assert.equal(s.status,'open');await cancelPurificationPurchaseCheckout(other,offerId);assert.equal(s.status,'expired');assert.equal((await getPurificationBalance(other)).availableCredits,0);
 await assert.rejects(getUserReningPayments(unverified));
});
test('Rening mismatched paid metadata fails closed without changing independently purchased credits',async()=>{
 const before=(await getPurificationBalance(student)).availableCredits,s=await checkout();pay(s);s.metadata.credits='999';await assert.rejects(event(s),/metadata|binding|contract/i);assert.equal((await getPurificationBalance(student)).availableCredits,before);
});
test('Rening HTTP rejects cross-site mutations, oversized payloads and unsigned webhooks; foreign signed events grant nothing',async()=>{
 assert.throws(()=>assertPurificationPurchaseOrigin(new Request('https://rening.example.test',{headers:{origin:'https://evil.example.test'}})),/hemsidan/);
 await assert.rejects(readPurificationPurchaseBody(new Request('https://rening.example.test',{method:'POST',body:'x'.repeat(5000)})),/stor/);
 for(const route of [checkoutRoute,cancelRoute])assert.equal((await route(new Request('https://rening.example.test',{method:'POST',headers:{origin:'https://evil.example.test','content-type':'application/json'},body:'{}'}))).status,403);
 assert.equal((await webhook(new Request('https://rening.example.test',{method:'POST',headers:{'stripe-signature':'invalid'},body:'{}'}))).status,400);
 assert.equal((await webhook(new Request('https://rening.example.test',{method:'POST',headers:{'stripe-signature':'invalid'},body:'x'.repeat(1024*1024+1)}))).status,413);
 const payload=JSON.stringify({id:'evt_foreign',type:'checkout.session.completed',data:{object:{id:'cs_foreign',metadata:{application:'other-app'}}}}),signature=getStripe().webhooks.generateTestHeaderString({payload,secret:process.env.RENING_STRIPE_WEBHOOK_SECRET!});
 assert.equal((await webhook(new Request('https://rening.example.test',{method:'POST',headers:{'stripe-signature':signature},body:payload}))).status,200);
});
