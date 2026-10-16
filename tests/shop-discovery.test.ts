import { before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type Snapshot = { urls: string[]; text: string; private: string[] };
let snapshots: { closed: Snapshot; open: Snapshot; unpublished: Snapshot; reclosed: Snapshot };
before(async () => {
  const env = { ...process.env };
  for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "APP_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SHOP_STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "EMAIL_FROM", "EMAIL_NOTIFICATION_TO"]) delete env[key];
  env.TIBB_DATABASE_PATH = ":memory:";
  env.SITE_URL = "https://slowlax.se";
  env.NODE_ENV = "production";
  env.VERCEL_ENV = "production";
  const source = `
    const {getDb}=require('./src/lib/db.ts');
    const sitemap=require('./src/app/sitemap.ts').default;
    const {GET}=require('./src/app/llms.txt/route.ts');
    const robots=require('./src/app/robots.ts').default;
    (async()=>{
      const db=getDb(); await db.initialize();
      try {
        await db.prepare("INSERT INTO users(email,name,password_hash,role,created_at) VALUES('seo-admin@example.test','Admin','fakehash','admin',?)").run(new Date().toISOString());
        for (const [name,slug,published] of [['Public [product]','visible-product',1],['SECRET_DRAFT_PRODUCT','secret-draft-product',0],['Invalid path','../admin?secret=1',1]])
          await db.prepare('INSERT INTO shop_products(name,slug,price_ore,stock,published,created_at,updated_at) VALUES(?,?,10000,2,?,?,?)').run(name,slug,published,'2026-10-09T10:00:00.000Z','2026-10-09T10:00:00.000Z');
        async function snapshot(){ return {urls:(await sitemap()).map(item=>item.url),text:await (await GET()).text(),private:robots().rules[0].disallow}; }
        const closed=await snapshot();
        await db.prepare('UPDATE shop_settings SET enabled=1').run();
        const open=await snapshot();
        await db.prepare("UPDATE shop_products SET published=0 WHERE slug='visible-product'").run();
        const unpublished=await snapshot();
        await db.prepare('UPDATE shop_settings SET enabled=0').run();
        const reclosed=await snapshot();
        console.log(JSON.stringify({closed,open,unpublished,reclosed}));
      } finally { await db.close(); }
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import=tsx", "--eval", source], { env, timeout: 30000, maxBuffer: 1000000 });
  snapshots = JSON.parse(stdout.trim());
});
test("closed stores are absent from both search discovery files even if products were published", () => {
  for (const snapshot of [snapshots.closed, snapshots.reclosed]) {
    assert.ok(!snapshot.urls.some(url => url.includes("/butik")));
    assert.ok(!snapshot.text.includes("/butik"));
    assert.ok(!snapshot.text.includes("visible-product"));
  }
});
test("legacy shop settings cannot expose products in Slowlax search discovery", () => {
  for (const snapshot of Object.values(snapshots)) {
    assert.ok(!snapshot.urls.some(url => url.includes("/butik")));
    assert.ok(!snapshot.text.includes("/butik"));
    assert.ok(!snapshot.text.includes("visible-product"));
    assert.ok(!snapshot.urls.some(url => /secret-draft|secret=/.test(url)));
    assert.ok(!snapshot.text.includes("SECRET_DRAFT_PRODUCT"));
    assert.ok(!snapshot.text.includes("secret=1"));
  }
  assert.ok(!snapshots.unpublished.urls.some(url => url.includes("visible-product")));
  assert.ok(!snapshots.unpublished.text.includes("visible-product"));
});
test("order links, cart and checkout are excluded from every public crawling surface", () => {
  for (const path of ["/bestallning", "/butik/kassa", "/butik/varukorg"]) assert.ok(snapshots.open.private.includes(path));
  assert.ok(!snapshots.open.urls.some(url => /bestallning|varukorg|kassa/.test(url)));
});
