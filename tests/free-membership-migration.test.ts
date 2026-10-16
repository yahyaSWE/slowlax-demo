import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client/node";
import { getDb } from "../src/lib/database";
import { SCHEMA,COURSE_ACTIVITY_SCHEMA,ACCOUNT_EMAIL_SCHEMA,SCHEMA_VERSION } from "../src/lib/schema";
import { MEMBERSHIP_SCHEMA } from "../src/lib/membership-schema";
import { MEMBERSHIP_UPLOAD_SCHEMA } from "../src/lib/membership-upload-schema";
import { MEMBERSHIP_BILLING_SCHEMA } from "../src/lib/membership-billing-schema";
import { COURSE_PURCHASE_SCHEMA } from "../src/lib/course-purchase-schema";
import { COURSE_BUNDLES_SCHEMA } from "../src/lib/course-bundles-schema";
import { COURSE_CERTIFICATES_SCHEMA } from "../src/lib/course-certificates-schema";
import { POSTGRES_INITIAL_SCHEMA_SQL as V2_SQL } from "../src/lib/postgres-certificate-schema";
import { PostgresDatabaseAdapter } from "../src/lib/postgres-database";
import { pglitePostgres } from "./helpers/pglite-postgres";
import { getFreeMembershipSettings,joinFreeMembership,saveFreeMembershipSettings } from "../src/lib/free-membership-domain";
import { issueCourseCertificate,saveCourseCertificateSettings } from "../src/lib/course-certificates";

for(const key of ["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN","VERCEL","SUPABASE_AUTH_ENABLED","KIT_API_KEY"])delete process.env[key];
process.env.SUPABASE_DATABASE_ENABLED="false";
const stamp="2026-01-01T00:00:00.000Z";
const fixtureSql=`
  INSERT INTO users(id,email,name,password_hash,role,created_at,email_verified_at) VALUES
    (7,'old-bas@example.test','Legacy student','fixture','student','${stamp}','${stamp}'),
    (8,'old-admin@example.test','Legacy teacher','fixture','admin','${stamp}','${stamp}');
  INSERT INTO membership_groups(id,name,slug,published,created_at,updated_at) VALUES(9,'Legacy public group','legacy-group',1,'${stamp}','${stamp}');
  INSERT INTO membership_plans(id,group_id,name,slug,price_ore,vat_percent,interval,published,created_at,updated_at) VALUES
    (41,9,'Legacy paid Bas','bas',9900,25,'month',1,'${stamp}','${stamp}'),
    (42,9,'Colliding plan','bas-betalt-41',9900,25,'month',1,'${stamp}','${stamp}');
  INSERT INTO membership_checkout_attempts(id,user_id,plan_id,group_id,terms,price_ore,vat_percent,interval,plan_name,plan_slug,plan_revision,settings_revision,status,expires_at,created_at,updated_at)
    VALUES('historical-bas',7,41,9,'Original paid terms',9900,25,'month','Legacy paid Bas','bas','${stamp}','${stamp}','creating','2090-01-01T00:00:00.000Z','${stamp}','${stamp}');
  INSERT INTO courses(id,title,slug,published,created_at,updated_at) VALUES(31,'Legacy course','legacy-course',1,'${stamp}','${stamp}');
  INSERT INTO lessons(id,course_id,title) VALUES(32,31,'Legacy lesson');
  INSERT INTO membership_group_courses(group_id,course_id) VALUES(9,31);
  INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(7,32,'2026-01-02T00:00:00.000Z');
  INSERT INTO app_meta(key,value) VALUES('seeded','1'),('preserve-marker','original');
`;
async function assertMigrationResult() {
  const plan=await getDb().prepare("SELECT * FROM membership_plans WHERE id=41").get();
  assert.equal(plan?.slug,"bas-betalt-41-2");assert.equal(plan?.name,"Legacy paid Bas");assert.equal(plan?.price_ore,9900);assert.ok(String(plan?.updated_at)>stamp);
  assert.equal((await getDb().prepare("SELECT slug FROM membership_plans WHERE id=42").get())?.slug,"bas-betalt-41");
  const historical=await getDb().prepare("SELECT * FROM membership_checkout_attempts WHERE id='historical-bas'").get();
  assert.equal(historical?.plan_slug,"bas");assert.equal(historical?.plan_name,"Legacy paid Bas");assert.equal(historical?.plan_revision,stamp);
  assert.equal(historical?.price_ore,9900);assert.equal(historical?.terms,"Original paid terms");
  assert.equal((await getDb().prepare("SELECT value FROM app_meta WHERE key='preserve-marker'").get())?.value,"original");
  assert.equal((await getDb().prepare("SELECT COUNT(*) AS total FROM free_membership_members").get())?.total,0);
  const settings=await getFreeMembershipSettings(8);await saveFreeMembershipSettings(8,{description:settings.description,groupIds:[9],expectedUpdatedAt:settings.updatedAt});
  await joinFreeMembership(7);
  await saveCourseCertificateSettings(8,31,{enabled:true,expectedUpdatedAt:null});
  const certificate=await issueCourseCertificate(7,31);
  assert.equal(certificate.studentName,"Legacy student");assert.equal(certificate.courseTitle,"Legacy course");
}

test("SQLite v15 safely reserves the free Bas URL and refreshes the v14 diploma access guard",async()=>{
  const client=createClient({url:"file::memory:",intMode:"number",concurrency:1});
  const adapter=getDb();Object.assign(adapter,{clientPromise:Promise.resolve(client),readyPromise:undefined});
  try {
    await client.executeMultiple(SCHEMA);
    await client.execute("ALTER TABLE users ADD COLUMN email_verified_at TEXT");await client.execute("ALTER TABLE users ADD COLUMN supabase_id TEXT");
    for(const sql of [COURSE_ACTIVITY_SCHEMA,ACCOUNT_EMAIL_SCHEMA,MEMBERSHIP_SCHEMA,MEMBERSHIP_UPLOAD_SCHEMA,MEMBERSHIP_BILLING_SCHEMA,COURSE_PURCHASE_SCHEMA,COURSE_BUNDLES_SCHEMA,COURSE_CERTIFICATES_SCHEMA]) await client.executeMultiple(sql);
    await client.executeMultiple(fixtureSql);
    await client.executeMultiple(`DROP TRIGGER course_certificate_issuance_reference;
      CREATE TRIGGER course_certificate_issuance_reference BEFORE INSERT ON course_certificates BEGIN SELECT RAISE(ABORT,'Old v14 guard'); END;
      INSERT INTO app_meta(key,value) VALUES('schema_version','14');PRAGMA user_version=14;`);
    await adapter.initialize();
    assert.equal((await client.execute("PRAGMA user_version")).rows[0].user_version,SCHEMA_VERSION);
    await assertMigrationResult();
    const guard=(await client.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='course_certificate_issuance_reference'")).rows[0].sql;
    assert.match(String(guard),/free_membership_members/);
  }finally{await adapter.close();}
});

test("PostgreSQL v2 to v3 reserves only the live paid plan slug and lets Bas members issue diplomas",async()=>{
  process.env.SUPABASE_DATABASE_ENABLED="true";process.env.DATABASE_URL="postgres://test:test@localhost/test";
  const adapter=getDb() as PostgresDatabaseAdapter;const{engine}=await pglitePostgres(adapter);
  try {
    await engine.exec("BEGIN");await engine.exec(V2_SQL);await engine.exec(fixtureSql);await engine.exec("COMMIT");
    await assert.rejects(adapter.initialize(),/uppgraderas/);
    assert.equal((await engine.query<{name:string|null}>("SELECT to_regclass('slowlax.free_membership_members') AS name")).rows[0].name,null);
    await adapter.migrate();await adapter.migrate();
    assert.equal((await adapter.prepare("SELECT value FROM app_meta WHERE key='postgres_schema_version'").get())?.value,"4");
    await assertMigrationResult();
  }finally{await adapter.close();}
});
