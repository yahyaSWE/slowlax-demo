// No credentials are stored in the database. Both tables are server-only data.
export const KIT_NEWSLETTER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS kit_newsletter_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    form_id TEXT NOT NULL DEFAULT '9288768', tag_id TEXT,
    double_opt_in_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(double_opt_in_confirmed IN (0,1)),
    updated_at TEXT NOT NULL
  );
  INSERT INTO kit_newsletter_settings(id,updated_at) VALUES(1,'1970-01-01T00:00:00.000Z') ON CONFLICT(id) DO NOTHING;
  CREATE TABLE IF NOT EXISTS kit_newsletter_outbox (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL, name TEXT NOT NULL, form_id TEXT NOT NULL, tag_id TEXT,
    status TEXT NOT NULL DEFAULT 'waiting_verification' CHECK(status IN ('waiting_verification','pending','sending','sent','failed','skipped')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
    created_at TEXT NOT NULL, next_attempt_at TEXT NOT NULL,
    lease_until TEXT, lease_token TEXT, sent_at TEXT, subscriber_id TEXT, last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS kit_newsletter_due ON kit_newsletter_outbox(status,next_attempt_at);
  CREATE TRIGGER IF NOT EXISTS kit_newsletter_user_reference BEFORE INSERT ON kit_newsletter_outbox
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS users_kit_newsletter_cleanup BEFORE DELETE ON users BEGIN
    DELETE FROM kit_newsletter_outbox WHERE user_id=OLD.id;
  END;
`;
