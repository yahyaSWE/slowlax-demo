// Purchase grants keep their payment provenance separate from manual course
// enrollments, group assignments and recurring membership subscriptions.
export const COURSE_PURCHASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS course_sales_settings (
    course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    group_id INTEGER REFERENCES membership_groups(id),
    group_access_days INTEGER CHECK(group_access_days BETWEEN 1 AND 3650),
    vat_percent INTEGER NOT NULL DEFAULT 25 CHECK(vat_percent IN (0,6,12,25)),
    terms TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    CHECK(group_id IS NOT NULL OR group_access_days IS NULL)
  );
  CREATE TABLE IF NOT EXISTS course_purchase_customers (
    user_id INTEGER PRIMARY KEY REFERENCES users(id), stripe_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS course_purchase_attempts (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    course_id INTEGER NOT NULL REFERENCES courses(id),
    course_title TEXT NOT NULL, course_slug TEXT NOT NULL,
    course_revision TEXT NOT NULL, settings_revision TEXT NOT NULL,
    terms TEXT NOT NULL, price_ore INTEGER NOT NULL CHECK(price_ore BETWEEN 1 AND 10000000),
    vat_percent INTEGER NOT NULL CHECK(vat_percent IN (0,6,12,25)),
    group_id INTEGER REFERENCES membership_groups(id), group_name TEXT,
    group_access_days INTEGER CHECK(group_access_days BETWEEN 1 AND 3650),
    status TEXT NOT NULL CHECK(status IN ('creating','open','completed','paid','expired','cancelled')),
    session_id TEXT UNIQUE, customer_id TEXT, tax_rate_id TEXT UNIQUE,
    expires_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK((group_id IS NULL AND group_name IS NULL AND group_access_days IS NULL) OR (group_id IS NOT NULL AND group_name IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS course_purchase_attempt_owner ON course_purchase_attempts(user_id,course_id,status,expires_at);
  CREATE TABLE IF NOT EXISTS course_purchases (
    id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE REFERENCES course_purchase_attempts(id),
    user_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER NOT NULL REFERENCES courses(id),
    group_id INTEGER REFERENCES membership_groups(id), group_expires_at TEXT,
    session_id TEXT NOT NULL UNIQUE, payment_intent_id TEXT NOT NULL UNIQUE, charge_id TEXT NOT NULL UNIQUE,
    price_ore INTEGER NOT NULL CHECK(price_ore BETWEEN 1 AND 10000000),
    vat_percent INTEGER NOT NULL CHECK(vat_percent IN (0,6,12,25)),
    paid_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
    revocation_reason TEXT, updated_at TEXT NOT NULL,
    CHECK(group_id IS NOT NULL OR group_expires_at IS NULL),
    CHECK(julianday(paid_at) IS NOT NULL),
    CHECK(group_expires_at IS NULL OR julianday(group_expires_at)>julianday(paid_at)),
    CHECK((revoked=0 AND revocation_reason IS NULL) OR (revoked=1 AND length(trim(revocation_reason))>0))
  );
  CREATE INDEX IF NOT EXISTS course_purchase_course_access ON course_purchases(user_id,course_id,revoked);
  CREATE INDEX IF NOT EXISTS course_purchase_group_access ON course_purchases(user_id,group_id,revoked,group_expires_at);
  CREATE TABLE IF NOT EXISTS course_purchase_events (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, processed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS course_purchase_locks (
    key TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS course_sales_reference BEFORE INSERT ON course_sales_settings
    WHEN NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id)
      OR (NEW.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id))
    BEGIN SELECT RAISE(ABORT,'Course sales reference constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS course_sales_reference_update BEFORE UPDATE OF course_id,group_id ON course_sales_settings
    WHEN NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id)
      OR (NEW.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id))
    BEGIN SELECT RAISE(ABORT,'Course sales reference constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_customer_reference BEFORE INSERT ON course_purchase_customers
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
    BEGIN SELECT RAISE(ABORT,'Verified course customer required'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_customer_immutable BEFORE UPDATE ON course_purchase_customers
    BEGIN SELECT RAISE(ABORT,'Course customer binding is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_attempt_reference BEFORE INSERT ON course_purchase_attempts
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
      OR NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id)
      OR (NEW.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id))
    BEGIN SELECT RAISE(ABORT,'Course purchase reference constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_attempt_contract_immutable
    BEFORE UPDATE OF user_id,course_id,course_title,course_slug,course_revision,settings_revision,terms,price_ore,vat_percent,group_id,group_name,group_access_days,created_at ON course_purchase_attempts
    BEGIN SELECT RAISE(ABORT,'Course purchase contract is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_attempt_tax_immutable BEFORE UPDATE OF tax_rate_id ON course_purchase_attempts
    WHEN OLD.tax_rate_id IS NOT NULL AND NEW.tax_rate_id IS NOT OLD.tax_rate_id
    BEGIN SELECT RAISE(ABORT,'Course purchase tax binding is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_attempt_customer_reference BEFORE UPDATE OF customer_id ON course_purchase_attempts
    WHEN NEW.customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM course_purchase_customers WHERE user_id=NEW.user_id AND stripe_id=NEW.customer_id)
    BEGIN SELECT RAISE(ABORT,'Course purchase customer binding failed'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_grant_reference BEFORE INSERT ON course_purchases
    WHEN NOT EXISTS(SELECT 1 FROM course_purchase_attempts a JOIN course_purchase_customers c ON c.user_id=a.user_id
      WHERE a.id=NEW.attempt_id AND a.status='paid' AND a.user_id=NEW.user_id AND a.course_id=NEW.course_id
        AND a.group_id IS NEW.group_id AND a.session_id=NEW.session_id AND a.customer_id=c.stripe_id
        AND a.price_ore=NEW.price_ore AND a.vat_percent=NEW.vat_percent
        AND ((a.group_access_days IS NULL AND NEW.group_expires_at IS NULL)
          OR (a.group_access_days IS NOT NULL AND abs(julianday(NEW.group_expires_at)-julianday(NEW.paid_at)-a.group_access_days)<0.000011574)))
    BEGIN SELECT RAISE(ABORT,'Course purchase grant constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_grant_contract_immutable
    BEFORE UPDATE OF id,attempt_id,user_id,course_id,group_id,group_expires_at,session_id,payment_intent_id,charge_id,price_ore,vat_percent,paid_at ON course_purchases
    BEGIN SELECT RAISE(ABORT,'Course purchase grant is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_revocation_monotonic BEFORE UPDATE OF revoked ON course_purchases
    WHEN OLD.revoked=1 AND NEW.revoked<>1
    BEGIN SELECT RAISE(ABORT,'Revoked course purchase cannot be restored'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_course_history BEFORE DELETE ON courses
    WHEN EXISTS(SELECT 1 FROM course_purchase_attempts WHERE course_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Course has purchase history'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_user_history BEFORE DELETE ON users
    WHEN EXISTS(SELECT 1 FROM course_purchase_customers WHERE user_id=OLD.id)
      OR EXISTS(SELECT 1 FROM course_purchase_attempts WHERE user_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Student has course purchase history'); END;
  CREATE TRIGGER IF NOT EXISTS course_purchase_group_history BEFORE DELETE ON membership_groups
    WHEN EXISTS(SELECT 1 FROM course_sales_settings WHERE group_id=OLD.id)
      OR EXISTS(SELECT 1 FROM course_purchase_attempts WHERE group_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Group is linked to course sales'); END;
  CREATE TRIGGER IF NOT EXISTS course_sales_cleanup BEFORE DELETE ON courses BEGIN
    DELETE FROM course_sales_settings WHERE course_id=OLD.id;
  END;
`;
