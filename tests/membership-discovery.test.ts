import { before,test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
type Snapshot={urls:string[];text:string;private:string[]};
let snapshots:Record<string,Snapshot>;
before(async()=>{
  const env:NodeJS.ProcessEnv={...process.env,TIBB_DATABASE_PATH:":memory:",SITE_URL:"https://tibbnu.vercel.app",NODE_ENV:"production",VERCEL_ENV:"production"};
  for(const key of ["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN","VERCEL","VERCEL_URL","VERCEL_PROJECT_PRODUCTION_URL","APP_URL","STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET","SHOP_STRIPE_WEBHOOK_SECRET","MEMBERSHIP_STRIPE_WEBHOOK_SECRET","MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID","RESEND_API_KEY","EMAIL_FROM"])delete env[key as keyof typeof env];
  const source=`
    const {getDb}=require('./src/lib/db.ts');const sitemap=require('./src/app/sitemap.ts').default;const {GET}=require('./src/app/llms.txt/route.ts');const robots=require('./src/app/robots.ts').default;
    (async()=>{const db=getDb();await db.initialize();try{
      const stamp='2026-10-12T12:00:00.000Z';
      await db.prepare("INSERT INTO membership_groups(name,slug,description,published,created_at,updated_at) VALUES('PRIVATE_GROUP_NAME','group-name','SECRET_GROUP_INFORMATION',1,?,?)").run(stamp,stamp);
      for(const [name,slug,published] of [['Public membership','public-membership',1],['SECRET_DRAFT_PLAN','private-draft-plan',0]])await db.prepare('INSERT INTO membership_plans(group_id,name,slug,description,price_ore,vat_percent,interval,published,created_at,updated_at) VALUES(1,?,?,?,10000,25,?,?,?,?)').run(name,slug,'Public description','month',published,stamp,stamp);
      await db.prepare("INSERT INTO membership_posts(group_id,title,body_json,period,published,created_at,updated_at) VALUES(1,'SECRET_MEAL_PLAN',NULL,'2026-10',1,?,?)").run(stamp,stamp);
      async function snap(){return {urls:(await sitemap()).map(item=>item.url),text:await(await GET()).text(),private:robots().rules[0].disallow};}
      const closed=await snap();await db.prepare('UPDATE membership_settings SET sales_enabled=1').run();const open=await snap();await db.prepare('UPDATE membership_groups SET published=0').run();const draftGroup=await snap();await db.prepare('UPDATE membership_groups SET published=1').run();await db.prepare('UPDATE membership_plans SET published=0').run();const draftPlan=await snap();console.log(JSON.stringify({closed,open,draftGroup,draftPlan}));
    }finally{await db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const {stdout}=await promisify(execFile)(process.execPath,["--conditions=react-server","--import=tsx","--eval",source],{env,timeout:30000,maxBuffer:1000000});snapshots=JSON.parse(stdout.trim());
});
test("only offered memberships in a published group enter public search discovery",()=>{
  assert.ok(snapshots.open.urls.includes("https://tibbnu.vercel.app/medlemskap"));assert.ok(snapshots.open.urls.includes("https://tibbnu.vercel.app/medlemskap/public-membership"));assert.ok(snapshots.open.text.includes("/medlemskap/public-membership"));
  for(const snapshot of [snapshots.closed,snapshots.draftGroup,snapshots.draftPlan]){assert.ok(!snapshot.urls.some(url=>url.includes("/medlemskap")));assert.ok(!snapshot.text.includes("public-membership"));}
});
test("group descriptions, posts, drafts and confirmation pages never enter public discovery",()=>{
  for(const snapshot of Object.values(snapshots)){
    for(const secret of ['SECRET_GROUP_INFORMATION','SECRET_MEAL_PLAN','SECRET_DRAFT_PLAN','private-draft-plan'])assert.ok(!snapshot.text.includes(secret));
    assert.ok(!snapshot.urls.some(url=>/elevportal|grupper|bekraftelse/.test(url)));assert.ok(snapshot.private.includes('/elevportal'));assert.ok(snapshot.private.includes('/medlemskap/bekraftelse'));
  }
});
