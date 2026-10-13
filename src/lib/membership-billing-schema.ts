// Billing records preserve the contract accepted at checkout. Editing a plan
// never changes a customer's existing recurring price or paid access period.
export const MEMBERSHIP_BILLING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS membership_customers (
    user_id INTEGER PRIMARY KEY REFERENCES users(id), stripe_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS membership_checkout_attempts (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    plan_id INTEGER NOT NULL REFERENCES membership_plans(id),
    group_id INTEGER NOT NULL REFERENCES membership_groups(id),
    terms TEXT NOT NULL, price_ore INTEGER NOT NULL CHECK(price_ore>0),
    vat_percent INTEGER NOT NULL, interval TEXT NOT NULL CHECK(interval IN ('month','year')),
    plan_name TEXT NOT NULL, plan_slug TEXT NOT NULL,
    plan_revision TEXT NOT NULL, settings_revision TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('creating','open','completed','subscribed','expired','cancelled')),
    session_id TEXT UNIQUE, customer_id TEXT, expires_at TEXT NOT NULL,
    lease_token TEXT, lease_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS membership_attempts_owner ON membership_checkout_attempts(user_id,group_id,status,expires_at);
  CREATE TABLE IF NOT EXISTS membership_checkout_tax_rates (
    attempt_id TEXT PRIMARY KEY REFERENCES membership_checkout_attempts(id),
    stripe_id TEXT NOT NULL UNIQUE, vat_percent INTEGER NOT NULL CHECK(vat_percent IN (0,6,12,25)),
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS membership_checkout_tax_reference BEFORE INSERT ON membership_checkout_tax_rates
    WHEN NOT EXISTS(SELECT 1 FROM membership_checkout_attempts WHERE id=NEW.attempt_id AND vat_percent=NEW.vat_percent)
    BEGIN SELECT RAISE(ABORT,'Membership tax rate constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_checkout_tax_immutable BEFORE UPDATE ON membership_checkout_tax_rates
    BEGIN SELECT RAISE(ABORT,'Membership tax rate binding is immutable'); END;
  CREATE TABLE IF NOT EXISTS membership_subscriptions (
    stripe_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    plan_id INTEGER NOT NULL REFERENCES membership_plans(id),
    group_id INTEGER NOT NULL REFERENCES membership_groups(id),
    attempt_id TEXT NOT NULL UNIQUE REFERENCES membership_checkout_attempts(id),
    status TEXT NOT NULL, paid_until TEXT,
    blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1)),
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0,1)),
    customer_id TEXT NOT NULL, price_id TEXT NOT NULL,
    price_ore INTEGER NOT NULL, vat_percent INTEGER NOT NULL,
    interval TEXT NOT NULL CHECK(interval IN ('month','year')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS membership_subscription_access ON membership_subscriptions(user_id,group_id,status,paid_until);
  CREATE TABLE IF NOT EXISTS membership_paid_invoices (
    invoice_id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES membership_subscriptions(stripe_id),
    payment_intent_id TEXT NOT NULL, charge_id TEXT NOT NULL,
    period_start TEXT NOT NULL, period_end TEXT NOT NULL, amount_ore INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS membership_invoice_payment ON membership_paid_invoices(payment_intent_id);
  CREATE INDEX IF NOT EXISTS membership_invoice_charge ON membership_paid_invoices(charge_id);
  CREATE TABLE IF NOT EXISTS membership_billing_revocations (
    subscription_id TEXT PRIMARY KEY REFERENCES membership_subscriptions(stripe_id),
    reason TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS membership_billing_events (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, processed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS membership_billing_locks (
    key TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS membership_customer_reference BEFORE INSERT ON membership_customers
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND email_verified_at IS NOT NULL)
    BEGIN SELECT RAISE(ABORT,'Verified customer required'); END;
  CREATE TRIGGER IF NOT EXISTS membership_attempt_reference BEFORE INSERT ON membership_checkout_attempts
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
      OR NOT EXISTS(SELECT 1 FROM membership_plans WHERE id=NEW.plan_id AND group_id=NEW.group_id)
    BEGIN SELECT RAISE(ABORT,'Membership reference constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_attempt_contract_immutable BEFORE UPDATE OF user_id,plan_id,group_id,terms,price_ore,vat_percent,interval,plan_name,plan_slug,plan_revision,settings_revision,created_at ON membership_checkout_attempts
    BEGIN SELECT RAISE(ABORT,'Membership checkout contract is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS membership_subscription_reference BEFORE INSERT ON membership_subscriptions
    WHEN NOT EXISTS(SELECT 1 FROM membership_checkout_attempts a JOIN membership_customers c ON c.user_id=a.user_id
      WHERE a.id=NEW.attempt_id AND a.user_id=NEW.user_id AND a.plan_id=NEW.plan_id AND a.group_id=NEW.group_id
      AND a.price_ore=NEW.price_ore AND a.vat_percent=NEW.vat_percent AND a.interval=NEW.interval
      AND c.stripe_id=NEW.customer_id AND a.customer_id=NEW.customer_id)
    BEGIN SELECT RAISE(ABORT,'Membership subscription constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_subscription_contract_immutable BEFORE UPDATE OF user_id,plan_id,group_id,attempt_id,customer_id,price_id,price_ore,vat_percent,interval,created_at ON membership_subscriptions
    BEGIN SELECT RAISE(ABORT,'Membership subscription contract is immutable'); END;
`;
