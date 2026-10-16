import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { POSTGRES_INITIAL_SCHEMA_SQL } from "../src/lib/postgres-purification-schema";
import { importPostgresSnapshot, snapshotFingerprint, type DatabaseSnapshot } from "../src/lib/postgres-import";
import type { PostgresConnection } from "../src/lib/postgres-database";

const now = "2026-10-15T12:00:00.000Z";
function fixture(): DatabaseSnapshot {
  return {
    settings: [{ id: 1, site_name: "Slowlax", email: "info@example.test" }],
    users: [{ id: 7, name: "Imported student", email: "imported@example.test", password_hash: "legacy-fixture", role: "student", created_at: now, email_verified_at: now }],
    articles: [{ id: 18, title: "Imported article", slug: "imported-article", body: "Preserved content", published: 1, created_at: now, updated_at: now }],
    courses: [10, 11, 12].map(id => ({ id, title: `Current course ${id}`, slug: `current-${id}`, price_ore: 79900, published: id === 12 ? 0 : 1, created_at: now, updated_at: now })),
    course_bundles: [{ course_id: 12 }],
    course_bundle_courses: [{ bundle_course_id: 12, course_id: 10 }, { bundle_course_id: 12, course_id: 11 }],
    membership_groups: [9, 10].map(id => ({ id, name: `Current group ${id}`, slug: `group-${id}`, published: 1, created_at: now, updated_at: now })),
    free_membership_settings: [{ id: 1, description: "Imported Bas membership", updated_at: now }],
    free_membership_groups: [{ group_id: 9 }],
    free_membership_members: [{ user_id: 7, joined_at: now }],
    purification_quota_settings: [{source_type:'bas',source_id:1,credits:3,updated_at:now}],
    purification_credit_grants: [{id:'import-grant',user_id:7,source_key:'bas:7',source_type:'bas',source_name:'Bas',total_credits:3,starts_at:now,expires_at:null,created_at:now}],
    purification_requests: [{id:'import-request',user_id:7,idempotency_key:'import-nonce',status:'completed',holdings_json:'[{"companyName":"Synthetic AB","shares":"12.5"}]',message:'Imported review',company_count:1,credits_used:1,created_at:now,updated_at:now,response_text:'Synthetic published answer',internal_notes:'Private imported notes',response_published_at:now}],
    purification_credit_events: [{id:'import-reservation',grant_id:'import-grant',request_id:'import-request',event_type:'reserve',credits:1,created_at:now}],
    rening_offers: [{id:44,title:'Imported offer',credits:8,price_ore:49900,vat_percent:25,published:1,created_at:now,updated_at:now}],
    membership_plans: [
      { id: 31, group_id: 9, name: "Legacy paid Bas", slug: "bas", price_ore: 19900, vat_percent: 25, interval: "month", published: 1, created_at: now, updated_at: now },
      { id: 32, group_id: 9, name: "Existing paid offer", slug: "bas-betalt-31", price_ore: 9900, vat_percent: 25, interval: "month", published: 1, created_at: now, updated_at: now },
    ],
    course_sales_settings: [{ course_id: 12, enabled: 0, group_id: null, group_access_days: null, vat_percent: 25, terms: "Changed future offer", updated_at: now }],
    course_purchase_customers: [{ user_id: 7, stripe_id: "cus_import", created_at: now }],
    course_purchase_attempts: [{ id: "attempt", user_id: 7, course_id: 12, course_title: "Historic Bas-kit", course_slug: "historic-kit", course_revision: now, settings_revision: now, terms: "Historic terms", price_ore: 79900, vat_percent: 25, group_id: 9, group_name: "Historic group", group_access_days: null, status: "paid", session_id: "cs_import", customer_id: "cus_import", expires_at: now, created_at: now, updated_at: now }],
    course_purchases: [{ id: "purchase", attempt_id: "attempt", user_id: 7, course_id: 12, group_id: 9, session_id: "cs_import", payment_intent_id: "pi_import", charge_id: "ch_import", price_ore: 79900, vat_percent: 25, paid_at: now, updated_at: now }],
    course_purchase_attempt_courses: [10, 11].map(id => ({ attempt_id: "attempt", course_id: id, title: `Historic course ${id}`, slug: `historic-${id}` })),
    course_purchase_attempt_groups: [9, 10].map(id => ({ attempt_id: "attempt", group_id: id, group_name: `Historic group ${id}`, access_days: null })),
    enrollments: [{ id: 21, user_id: 7, course_id: 10, created_at: now }],
    app_meta: [{ key: "business_settings", value: '{"legalName":"Test entity"}' }, { key: "seeded", value: "1" }],
    sessions: [{ token_hash: "old-session", user_id: 7, expires_at: now }],
    auth_tokens: [{ token_hash: "old-reset-token", user_id: 7, kind: "reset-password", expires_at: now, created_at: now }],
  };
}
function connection(engine: PGlite): PostgresConnection {
  return { release() {}, query: async (sql, args) => {
    const result = args === undefined ? (await engine.exec(sql)).at(-1) : await engine.query<Record<string, unknown>>(sql, args);
    return { rows: (result?.rows ?? []) as Record<string, unknown>[], rowCount: result?.affectedRows ?? 0 };
  } };
}

test("PostgreSQL import preserves IDs, historical paid snapshots and settings while discarding old auth tokens", async () => {
  const engine = new PGlite();
  try {
    await engine.exec("BEGIN"); await engine.exec(POSTGRES_INITIAL_SCHEMA_SQL);
    const snapshot = fixture(), result = await importPostgresSnapshot(connection(engine), snapshot);
    await engine.exec("COMMIT");
    assert.equal(result.counts.users, 1);
    assert.equal((await engine.query<Record<string,unknown>>("SELECT response_text,internal_notes FROM slowlax.purification_requests")).rows[0].internal_notes,'Private imported notes');
    assert.equal((await engine.query<Record<string,unknown>>("SELECT credits FROM slowlax.purification_credit_events")).rows[0].credits,1);
    const nextOffer=await engine.query<Record<string,unknown>>("INSERT INTO slowlax.rening_offers(title,credits,price_ore,created_at,updated_at) VALUES('Next offer',1,9900,$1,$1) RETURNING id",[now]);assert.equal(nextOffer.rows[0].id,45);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT id FROM slowlax.users")).rows[0].id, 7);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT course_title FROM slowlax.course_purchase_attempts")).rows[0].course_title, "Historic Bas-kit");
    assert.equal((await engine.query<Record<string, unknown>>("SELECT count(*)::int AS total FROM slowlax.course_purchase_attempt_courses")).rows[0].total, 2);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT count(*)::int AS total FROM slowlax.course_purchase_attempt_groups")).rows[0].total, 2);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT count(*)::int AS total FROM slowlax.sessions")).rows[0].total, 0);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT count(*)::int AS total FROM slowlax.auth_tokens")).rows[0].total, 0);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT description FROM slowlax.free_membership_settings WHERE id=1")).rows[0].description, "Imported Bas membership");
    assert.equal((await engine.query<Record<string, unknown>>("SELECT user_id FROM slowlax.free_membership_members")).rows[0].user_id, 7);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT group_id FROM slowlax.free_membership_groups")).rows[0].group_id, 9);
    const importedBas = (await engine.query<Record<string, unknown>>("SELECT id,name,slug,price_ore,updated_at FROM slowlax.membership_plans WHERE id=31")).rows[0];
    assert.equal(importedBas.slug, "bas-betalt-31-2");
    assert.equal(importedBas.name, "Legacy paid Bas"); assert.equal(importedBas.price_ore, 19900);
    assert.ok(String(importedBas.updated_at) > now);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT value FROM slowlax.app_meta WHERE key='postgres_import_sha256'")).rows[0].value, result.fingerprint);
    await assert.rejects(engine.exec("UPDATE slowlax.course_purchase_attempt_courses SET title='Tampered'"), /immutable/);
    await assert.rejects(engine.exec("DELETE FROM slowlax.course_purchase_attempt_groups"), /immutable/);
    const created = await engine.query<Record<string, unknown>>("INSERT INTO slowlax.courses(title,slug,created_at,updated_at) VALUES('Next','next',$1,$1) RETURNING id", [now]);
    assert.equal(created.rows[0].id, 13);
  } finally { await engine.close(); }
});

test("an invalid imported relationship rolls back the complete fresh schema", async () => {
  const engine = new PGlite();
  try {
    await engine.exec("BEGIN"); await engine.exec(POSTGRES_INITIAL_SCHEMA_SQL);
    const invalid = fixture(); invalid.enrollments[0].course_id = 999;
    await assert.rejects(importPostgresSnapshot(connection(engine), invalid), /foreign key/i);
    await engine.exec("ROLLBACK");
    assert.equal((await engine.query<Record<string, unknown>>("SELECT to_regnamespace('slowlax') AS schema")).rows[0].schema, null);
  } finally { await engine.close(); }
});

test("import refuses an occupied target and fingerprints ignore row and column ordering", async () => {
  const engine = new PGlite();
  try {
    await engine.exec("BEGIN"); await engine.exec(POSTGRES_INITIAL_SCHEMA_SQL);
    await engine.exec("UPDATE slowlax.rening_offers SET title='Owner edited offer' WHERE preset_code='rening-4'");
    await assert.rejects(importPostgresSnapshot(connection(engine),fixture()),/redan innehåll/);
    await engine.exec("UPDATE slowlax.rening_offers SET title='Rening – 4 bolag' WHERE preset_code='rening-4'");
    await engine.query<Record<string, unknown>>("INSERT INTO slowlax.courses(title,slug,created_at,updated_at) VALUES('Existing','existing',$1,$1)", [now]);
    await assert.rejects(importPostgresSnapshot(connection(engine), fixture()), /redan innehåll/);
    assert.equal((await engine.query<Record<string, unknown>>("SELECT title FROM slowlax.courses")).rows[0].title, "Existing");
    await engine.exec("ROLLBACK");
    const a = fixture(), b = Object.fromEntries(Object.entries(a).reverse().map(([table, rows]) => [table, rows.map(row => Object.fromEntries(Object.entries(row).reverse())).reverse()]));
    assert.equal(snapshotFingerprint(a), snapshotFingerprint(b));
  } finally { await engine.close(); }
});
