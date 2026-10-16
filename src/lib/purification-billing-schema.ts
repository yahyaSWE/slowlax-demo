/** Standalone Rening payments never share a grant with a course or subscription. */
export const PURIFICATION_BILLING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS rening_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), sales_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sales_enabled IN (0,1)),
    terms TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  );
  INSERT INTO rening_settings(id,updated_at) VALUES(1,'1970-01-01T00:00:00.000Z') ON CONFLICT(id) DO NOTHING;
  CREATE TABLE IF NOT EXISTS rening_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, preset_code TEXT UNIQUE,
    title TEXT NOT NULL, credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 10000),
    price_ore INTEGER NOT NULL CHECK(price_ore BETWEEN 1 AND 10000000),
    vat_percent INTEGER NOT NULL DEFAULT 25 CHECK(vat_percent IN (0,6,12,25)),
    published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  INSERT INTO rening_offers(preset_code,title,credits,price_ore,created_at,updated_at) VALUES('rening-4','Rening – 4 bolag',4,19900,'1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z') ON CONFLICT(preset_code) DO NOTHING;
  INSERT INTO rening_offers(preset_code,title,credits,price_ore,created_at,updated_at) VALUES('rening-9','Rening – 9 bolag',9,29900,'1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z') ON CONFLICT(preset_code) DO NOTHING;
  INSERT INTO rening_offers(preset_code,title,credits,price_ore,created_at,updated_at) VALUES('rening-14','Rening – 14 bolag',14,39900,'1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z') ON CONFLICT(preset_code) DO NOTHING;
  CREATE TABLE IF NOT EXISTS rening_purchase_customers (
    user_id INTEGER PRIMARY KEY REFERENCES users(id), stripe_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rening_purchase_attempts (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), offer_id INTEGER NOT NULL REFERENCES rening_offers(id),
    offer_title TEXT NOT NULL, credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 10000),
    offer_revision TEXT NOT NULL, settings_revision TEXT NOT NULL, terms TEXT NOT NULL,
    price_ore INTEGER NOT NULL CHECK(price_ore BETWEEN 1 AND 10000000), vat_percent INTEGER NOT NULL CHECK(vat_percent IN (0,6,12,25)),
    status TEXT NOT NULL CHECK(status IN ('creating','open','completed','paid','expired','cancelled')),
    session_id TEXT UNIQUE, customer_id TEXT, tax_rate_id TEXT UNIQUE,
    expires_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rening_attempt_owner ON rening_purchase_attempts(user_id,offer_id,status,expires_at);
  CREATE TABLE IF NOT EXISTS rening_purchases (
    id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE REFERENCES rening_purchase_attempts(id),
    user_id INTEGER NOT NULL REFERENCES users(id), offer_id INTEGER NOT NULL REFERENCES rening_offers(id),
    session_id TEXT NOT NULL UNIQUE, payment_intent_id TEXT NOT NULL UNIQUE, charge_id TEXT NOT NULL UNIQUE,
    credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 10000), price_ore INTEGER NOT NULL CHECK(price_ore BETWEEN 1 AND 10000000),
    vat_percent INTEGER NOT NULL CHECK(vat_percent IN (0,6,12,25)), paid_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)), revocation_reason TEXT, updated_at TEXT NOT NULL,
    CHECK(julianday(paid_at) IS NOT NULL),
    CHECK((revoked=0 AND revocation_reason IS NULL) OR (revoked=1 AND length(trim(revocation_reason))>0))
  );
  CREATE TABLE IF NOT EXISTS rening_purchase_events (id TEXT PRIMARY KEY,type TEXT NOT NULL,processed_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS rening_purchase_locks (key TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at TEXT NOT NULL);
  CREATE TRIGGER IF NOT EXISTS rening_customer_reference BEFORE INSERT ON rening_purchase_customers
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
    BEGIN SELECT RAISE(ABORT,'Verified Rening customer required'); END;
  CREATE TRIGGER IF NOT EXISTS rening_customer_immutable BEFORE UPDATE ON rening_purchase_customers
    BEGIN SELECT RAISE(ABORT,'Rening customer binding is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS rening_attempt_reference BEFORE INSERT ON rening_purchase_attempts
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
      OR NOT EXISTS(SELECT 1 FROM rening_offers WHERE id=NEW.offer_id)
    BEGIN SELECT RAISE(ABORT,'Rening checkout reference failed'); END;
  CREATE TRIGGER IF NOT EXISTS rening_attempt_immutable BEFORE UPDATE OF user_id,offer_id,offer_title,credits,offer_revision,settings_revision,terms,price_ore,vat_percent,created_at ON rening_purchase_attempts
    BEGIN SELECT RAISE(ABORT,'Rening checkout contract is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS rening_attempt_tax_immutable BEFORE UPDATE OF tax_rate_id ON rening_purchase_attempts
    WHEN OLD.tax_rate_id IS NOT NULL AND NEW.tax_rate_id IS NOT OLD.tax_rate_id
    BEGIN SELECT RAISE(ABORT,'Rening tax binding is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS rening_attempt_customer_reference BEFORE UPDATE OF customer_id ON rening_purchase_attempts
    WHEN NEW.customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rening_purchase_customers WHERE user_id=NEW.user_id AND stripe_id=NEW.customer_id)
    BEGIN SELECT RAISE(ABORT,'Rening customer binding failed'); END;
  CREATE TRIGGER IF NOT EXISTS rening_purchase_reference BEFORE INSERT ON rening_purchases
    WHEN NOT EXISTS(SELECT 1 FROM rening_purchase_attempts a JOIN rening_purchase_customers c ON c.user_id=a.user_id
      WHERE a.id=NEW.attempt_id AND a.status='paid' AND a.user_id=NEW.user_id AND a.offer_id=NEW.offer_id
      AND a.session_id=NEW.session_id AND a.customer_id=c.stripe_id AND a.credits=NEW.credits AND a.price_ore=NEW.price_ore AND a.vat_percent=NEW.vat_percent)
    BEGIN SELECT RAISE(ABORT,'Rening paid source reference failed'); END;
  CREATE TRIGGER IF NOT EXISTS rening_purchase_immutable BEFORE UPDATE OF id,attempt_id,user_id,offer_id,session_id,payment_intent_id,charge_id,credits,price_ore,vat_percent,paid_at ON rening_purchases
    BEGIN SELECT RAISE(ABORT,'Rening paid source is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS rening_purchase_revocation_monotonic BEFORE UPDATE OF revoked ON rening_purchases
    WHEN OLD.revoked=1 AND NEW.revoked<>1
    BEGIN SELECT RAISE(ABORT,'Revoked Rening payment cannot be restored'); END;
`;
