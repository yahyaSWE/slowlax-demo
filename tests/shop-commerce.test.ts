import {test,before,beforeEach,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,resolve,basename} from "node:path";
import {spawn} from "node:child_process";
import {createFirstAdmin,createUser,getDb} from "../src/lib/db";
import {hashPassword} from "../src/lib/security";
import {saveShopSettings,getShopSettings,saveShopProduct,getAdminShopProduct,getPublicShopProducts,saveShopQuantityOffer,saveShopCoupon,getAdminShopCoupons,saveShopShippingRule,quoteShopCart,reserveShopOrder,cancelShopOrder,attachShopCheckout,completeShopPayment,refundShopPayment,expireShopOrders,getShopOrderById} from "../src/lib/shop";
import {createShopCheckout} from "../src/lib/shop-checkout";
import {getStripe} from "../src/lib/stripe";
import type {ShopProduct,ShopCoupon,ShopShippingRule} from "../src/lib/shop-types";
for(const key of ["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN","VERCEL","RESEND_API_KEY","EMAIL_FROM","TRUST_PROXY"]) delete process.env[key];
const directory=mkdtempSync(join(tmpdir(),"tibb-commerce-tests-"));
process.env.TIBB_DATABASE_PATH=join(directory,"shop.sqlite");
process.env.STRIPE_SECRET_KEY="sk_test_commerce_isolated";
process.env.SHOP_STRIPE_WEBHOOK_SECRET="whsec_commerce_isolated";
process.env.APP_URL="https://commerce.example.test";
let adminId:number,studentId:number,sequence=0;
before(async()=>{adminId=(await createFirstAdmin({name:"Commerce admin",email:"commerce-admin@example.test",passwordHash:hashPassword("only isolated commerce fixture password")})).id;studentId=(await createUser({name:"Commerce student",email:"commerce-student@example.test",passwordHash:hashPassword("only isolated student fixture password"),role:"student"})).id;});
beforeEach(async()=>{
 await getDb().exec("DELETE FROM shop_coupon_uses; DELETE FROM shop_email_outbox; DELETE FROM shop_orders; DELETE FROM shop_bundle_items; DELETE FROM shop_products; DELETE FROM shop_quantity_offers; DELETE FROM shop_coupons; DELETE FROM shop_shipping_rules; DELETE FROM rate_limits;");
 await getDb().prepare("UPDATE settings SET email='contact@example.test' WHERE id=1").run();
 await saveShopSettings(adminId,{enabled:true,shippingEnabled:true,pickupEnabled:true,shippingPriceOre:4900,freeShippingThresholdOre:null,pickupAddress:"Isolated test address only",pickupInstructions:"Test instructions",terms:"Isolated test purchase terms only; not real sales."});
});
after(async()=>{await getDb().close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith("tibb-commerce-tests-"));await rm(directory,{recursive:true,force:true,maxRetries:15,retryDelay:300});});
async function product(overrides:Partial<ShopProduct>={}) {return saveShopProduct(adminId,null,{name:"Test product",slug:`commerce-${++sequence}`,description:"Fixture only",priceOre:10000,vatPercent:25,stock:10,published:true,imageId:null,weightGrams:200,...overrides});}
async function edit(id:number,overrides:Partial<ShopProduct>) {const p=(await getAdminShopProduct(adminId,id))!;return saveShopProduct(adminId,id,{...p,...overrides,expectedUpdatedAt:p.updatedAt});}
async function coupon(overrides:Partial<Omit<ShopCoupon,"id"|"uses">>={}) {return saveShopCoupon(adminId,null,{code:`TEST${++sequence}`,name:"Test code",type:"percent",value:10,minSubtotalOre:0,active:true,startsAt:null,endsAt:null,maxUses:null,combineWithOffers:true,...overrides});}
async function rule(overrides:Partial<Omit<ShopShippingRule,"id">>={}) {return saveShopShippingRule(adminId,null,{name:"Test shipping",carrier:"Test carrier",service:"Test service",active:true,priority:10,minWeightGrams:0,maxWeightGrams:null,minSubtotalOre:0,maxSubtotalOre:null,postcodePrefixes:[],priceOre:4900,...overrides});}
function input(items:{productId:number;quantity:number}[],extra:Record<string,unknown>={}) {return {items,name:"Fixture Customer",email:"buyer@example.test",phone:"",delivery:"pickup" as const,consent:true as const,...extra};}
async function used() {return (await getAdminShopCoupons(adminId))[0]?.uses??0;}

test("bundles derive component stock, aggregate individual items and release the purchased composition once",async()=>{
 const a=await product({stock:5}),b=await product({stock:3});
 const pack=await product({kind:"bundle",stock:0,priceOre:25000,bundleItems:[{productId:a,quantity:2},{productId:b,quantity:1}]});
 assert.equal((await getAdminShopProduct(adminId,pack))!.stock,2);
 await assert.rejects(reserveShopOrder(input([{productId:pack,quantity:2},{productId:a,quantity:2}])),/lager/);
 assert.equal((await getAdminShopProduct(adminId,a))!.stock,5);
 const order=await reserveShopOrder(input([{productId:pack,quantity:1},{productId:a,quantity:1}]));
 assert.equal((await getAdminShopProduct(adminId,a))!.stock,2);
 assert.equal((await getAdminShopProduct(adminId,b))!.stock,2);
 await edit(pack,{bundleItems:[{productId:b,quantity:2}]});
 await Promise.all([cancelShopOrder(order.reference),cancelShopOrder(order.reference)]);
 assert.equal((await getAdminShopProduct(adminId,a))!.stock,5);
 assert.equal((await getAdminShopProduct(adminId,b))!.stock,3);
 assert.equal((await getShopOrderById(order.id))!.items.find(i=>i.productId===pack)!.bundleParts![0].quantity,2);
});
test("invalid, nested and mixed VAT bundles fail atomically and a draft component hides an existing bundle",async()=>{
 const a=await product(),b=await product({vatPercent:12});
 await assert.rejects(product({kind:"bundle",bundleItems:[]}),/minst en/);
 await assert.rejects(product({kind:"bundle",bundleItems:[{productId:a,quantity:1},{productId:a,quantity:1}]}),/en gång/);
 await assert.rejects(product({kind:"bundle",bundleItems:[{productId:b,quantity:1}]}),/momssats/);
 const pack=await product({kind:"bundle",bundleItems:[{productId:a,quantity:1}]});
 await assert.rejects(product({kind:"bundle",bundleItems:[{productId:pack,quantity:1}]}),/vanliga/);
 await assert.rejects(edit(a,{kind:"bundle",bundleItems:[{productId:b,quantity:1}],vatPercent:12}),/Produkttypen/);
 await edit(a,{published:false});
 assert.equal((await getPublicShopProducts()).some(p=>p.id===pack),false);
 await assert.rejects(reserveShopOrder(input([{productId:pack,quantity:1}])),/tillgänglig/);
});
test("best volume tiers count same or mixed eligible products without stacking or discounting bundles",async()=>{
 const a=await product(),b=await product();
 await saveShopQuantityOffer(adminId,null,{name:"Two same",scope:"per_product",productIds:[a],minQuantity:2,percent:10,active:true});
 await saveShopQuantityOffer(adminId,null,{name:"Three mixed",scope:"mixed",productIds:[a,b],minQuantity:3,percent:20,active:true});
 const quote=await quoteShopCart({items:[{productId:a,quantity:2},{productId:b,quantity:1}],delivery:"pickup"});
 assert.equal(quote.subtotalOre,24000);assert.equal(quote.discountOre,6000);
 const pack=await product({kind:"bundle",priceOre:15000,bundleItems:[{productId:a,quantity:1},{productId:b,quantity:1}]});
 const bundleQuote=await quoteShopCart({items:[{productId:pack,quantity:3}],delivery:"pickup"});
 assert.equal(bundleQuote.subtotalOre,45000);assert.equal(bundleQuote.discounts[0].kind,"bundle");assert.equal(bundleQuote.discounts.length,1);
});
test("coupon eligibility, combination and min value are enforced on current discounted merchandise",async()=>{
 const a=await product();
 await saveShopQuantityOffer(adminId,null,{name:"Volume",scope:"per_product",productIds:[],minQuantity:2,percent:50,active:true});
 await coupon({code:"COMBINE",minSubtotalOre:15000});
 await assert.rejects(quoteShopCart({items:[{productId:a,quantity:2}],delivery:"pickup",couponCode:" combine "}),/lågt/);
 await coupon({code:"REPLACE",combineWithOffers:false});
 const quote=await quoteShopCart({items:[{productId:a,quantity:2}],delivery:"pickup",couponCode:"replace"});assert.equal(quote.subtotalOre,18000);assert.equal(quote.discounts.length,1);
 const pack=await product({kind:"bundle",bundleItems:[{productId:a,quantity:1}]});
 await assert.rejects(quoteShopCart({items:[{productId:pack,quantity:1}],delivery:"pickup",couponCode:"REPLACE"}),/paket/);
 for(const extras of [{active:false},{startsAt:"2999-01-01T00:00:00.000Z"},{endsAt:"2000-01-01T00:00:00.000Z"}]) {const id=await coupon(extras);const code=(await getAdminShopCoupons(adminId)).find(c=>c.id===id)!.code;await assert.rejects(quoteShopCart({items:[{productId:a,quantity:1}],delivery:"pickup",couponCode:code}),/kan inte/);}
});
test("coupon capacity includes reservations, quotes use nothing, cancel releases once and paid refunds never restore uses",async()=>{
 const a=await product();await coupon({code:"ONEUSE",maxUses:1});
 const quote=await quoteShopCart({items:[{productId:a,quantity:1}],delivery:"pickup",couponCode:"ONEUSE"});assert.equal(await used(),0);
 const results=await Promise.allSettled([reserveShopOrder(input([{productId:a,quantity:1}],{couponCode:"ONEUSE",expectedQuote:quote.fingerprint})),reserveShopOrder(input([{productId:a,quantity:1}],{couponCode:"ONEUSE"}))]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(await used(),1);
 const order=(results.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof reserveShopOrder>>>).value;
 await cancelShopOrder(order.reference);await cancelShopOrder(order.reference);assert.equal(await used(),0);
 const paid=await reserveShopOrder(input([{productId:a,quantity:1}],{couponCode:"ONEUSE"}));await attachShopCheckout(paid.reference,"cs_coupon_paid",Math.ceil(Date.now()/1000)+1800);await completeShopPayment("cs_coupon_paid",paid.totalOre,"sek");await refundShopPayment("cs_coupon_paid");assert.equal(await used(),1);
 await assert.rejects(reserveShopOrder(input([{productId:a,quantity:1}],{couponCode:"ONEUSE"})),/Rabattkoden/);
});
test("expiry and uncertain payment refund release the original component and code reservations once",async()=>{
 const a=await product({stock:1});await coupon({code:"EXPIRE",maxUses:1});const order=await reserveShopOrder(input([{productId:a,quantity:1}],{couponCode:"EXPIRE"}));
 await getDb().prepare("UPDATE shop_orders SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(order.id);await expireShopOrders();assert.equal(await used(),0);
 const replacement=await reserveShopOrder(input([{productId:a,quantity:1}],{couponCode:"EXPIRE"}));assert.equal(await used(),1);
 assert.equal(await completeShopPayment("cs_late_coupon",order.totalOre,"sek",order.reference),"needs-refund");await refundShopPayment("cs_late_coupon");assert.equal(await used(),1);assert.equal((await getAdminShopProduct(adminId,a))!.stock,0);assert.equal((await getShopOrderById(replacement.id))!.status,"pending");
});
test("shipping chooses weight, discounted value, postcode, priority and cheapest tie including packaging",async()=>{
 const a=await product({weightGrams:400});await saveShopSettings(adminId,{...await getShopSettings(),shippingRuleMode:true,packingWeightGrams:100});
 await rule({name:"Light",maxWeightGrams:499,priceOre:3900});await rule({name:"Heavy",minWeightGrams:500,priceOre:7900});await rule({name:"Local",priority:1,postcodePrefixes:["55"],priceOre:2900});await rule({name:"Local cheapest",priority:1,postcodePrefixes:["55"],priceOre:1900});
 const basic={items:[{productId:a,quantity:1}],delivery:"shipping" as const};
 const local=await quoteShopCart({...basic,postcode:"553 16"});assert.equal(local.weightGrams,500);assert.equal(local.shippingOre,1900);assert.match(local.shippingLabel,/Local cheapest/);
 const other=await quoteShopCart({...basic,postcode:"12345"});assert.equal(other.shippingOre,7900);
 await saveShopSettings(adminId,{...await getShopSettings(),freeShippingThresholdOre:10000});await coupon({code:"NETVALUE"});const discounted=await quoteShopCart({...basic,postcode:"12345",couponCode:"NETVALUE"});assert.equal(discounted.shippingOre,7900);const free=await quoteShopCart({...basic,postcode:"12345"});assert.equal(free.shippingOre,0);
});
test("unknown weights and unmatched shipping fail closed while pickup remains available",async()=>{
 const a=await product({weightGrams:0});await saveShopSettings(adminId,{...await getShopSettings(),shippingRuleMode:true});await rule({postcodePrefixes:["55"],maxWeightGrams:100});
 await assert.rejects(quoteShopCart({items:[{productId:a,quantity:1}],delivery:"shipping",postcode:"55316"}),/saknar vikt/);
 await edit(a,{weightGrams:200});await assert.rejects(quoteShopCart({items:[{productId:a,quantity:1}],delivery:"shipping",postcode:"55316"}),/Ingen fraktregel/);
 assert.equal((await quoteShopCart({items:[{productId:a,quantity:1}],delivery:"pickup"})).shippingOre,0);
});
test("a changed quote cannot create an order, consume a code or deduct stock",async()=>{
 const a=await product();await coupon({code:"FRESH"});const q=await quoteShopCart({items:[{productId:a,quantity:1}],delivery:"pickup",couponCode:"FRESH"});await edit(a,{priceOre:11000});
 await assert.rejects(reserveShopOrder(input([{productId:a,quantity:1}],{couponCode:"FRESH",expectedQuote:q.fingerprint})),/ändrats/);assert.equal(await used(),0);assert.equal((await getAdminShopProduct(adminId,a))!.stock,10);assert.equal((await getDb().prepare("SELECT COUNT(*) n FROM shop_orders").get())!.n,0);
});
test("coupon öre are allocated exactly at high amounts and Stripe receives only net totals",async()=>{
 const a=await product({priceOre:7777777,stock:100}),b=await product({priceOre:2222222,stock:100});await coupon({code:"HIGH",value:99});
 const q=await quoteShopCart({items:[{productId:a,quantity:10},{productId:b,quantity:10}],delivery:"pickup",couponCode:"HIGH"});assert.equal(q.subtotalOre,1000000);assert.deepEqual(q.items.map(i=>i.lineTotalOre),[777778,222222]);
 const order=await reserveShopOrder(input([{productId:a,quantity:10},{productId:b,quantity:10}],{couponCode:"HIGH",expectedQuote:q.fingerprint}));
 const sessions=Object.getPrototypeOf(getStripe().checkout.sessions);const previous=sessions.create;let lines:{quantity:number;price_data:{unit_amount:number}}[]=[];
 sessions.create=async (params:{line_items:typeof lines})=>{lines=params.line_items;return {id:"cs_net_fixture",url:"https://checkout.stripe.com/pay/fixture",expires_at:Math.ceil(Date.now()/1000)+1800};};
 try {await createShopCheckout(order);} finally {sessions.create=previous;}
 assert.equal(lines.reduce((sum,line)=>sum+line.quantity*line.price_data.unit_amount,0),order.totalOre);
 await coupon({code:"TOOMUCH",type:"fixed",value:10000000});const cheap=await product({priceOre:301});await assert.rejects(quoteShopCart({items:[{productId:cheap,quantity:1}],delivery:"pickup",couponCode:"TOOMUCH"}),/kostnadsfria/);
 await coupon({code:"TOOSMALL",type:"fixed",value:2});await assert.rejects(quoteShopCart({items:[{productId:cheap,quantity:1}],delivery:"pickup",couponCode:"TOOSMALL"}),/minst 3 kr/);
});
test("independent processes cannot consume the same last coupon use",async()=>{
 const a=await product();await coupon({code:"LASTUSE",maxUses:1});
 const worker=()=>new Promise<string>((yes,no)=>{const child=spawn(process.execPath,["--import","tsx","tests/shop-commerce-worker.ts",process.env.TIBB_DATABASE_PATH!,String(a)],{cwd:process.cwd(),env:process.env,windowsHide:true});let output="",errors="";child.stdout.on("data",b=>output+=b);child.stderr.on("data",b=>errors+=b);child.on("error",no);child.on("exit",code=>code===0?yes(output.trim()):no(new Error(errors)));});
 assert.deepEqual((await Promise.all([worker(),worker()])).sort(),["ok","unavailable"]);assert.equal(await used(),1);assert.equal((await getAdminShopProduct(adminId,a))!.stock,9);
});
