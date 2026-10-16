/** Private Rening requests and append-only credit accounting. No holdings are public. */
export const PURIFICATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS purification_quota_settings (
  source_type TEXT NOT NULL CHECK(source_type IN ('bas','membership_plan','course_bundle')),
  source_id INTEGER NOT NULL, credits INTEGER NOT NULL CHECK(credits BETWEEN 0 AND 10000), updated_at TEXT NOT NULL,
  PRIMARY KEY(source_type,source_id)
);
CREATE TABLE IF NOT EXISTS purification_attempt_quotas (
  kind TEXT NOT NULL CHECK(kind IN ('membership','bundle')), attempt_id TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK(credits BETWEEN 0 AND 10000), created_at TEXT NOT NULL,
  PRIMARY KEY(kind,attempt_id)
);
CREATE TABLE IF NOT EXISTS purification_credit_grants (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL UNIQUE, source_type TEXT NOT NULL CHECK(source_type IN ('bas','membership','bundle','purchase')),
  source_name TEXT NOT NULL, total_credits INTEGER NOT NULL CHECK(total_credits BETWEEN 1 AND 10000),
  starts_at TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL,
  CHECK(julianday(starts_at) IS NOT NULL),
  CHECK(expires_at IS NULL OR (julianday(expires_at) IS NOT NULL AND julianday(expires_at)>julianday(starts_at)))
);
CREATE TABLE IF NOT EXISTS purification_credit_revocations (
  source_key TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purification_requests (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('submitted','processing','completed','rejected','cancelled')),
  holdings_json TEXT NOT NULL, message TEXT NOT NULL, company_count INTEGER NOT NULL CHECK(company_count BETWEEN 1 AND 50),
  credits_used INTEGER NOT NULL CHECK(credits_used=company_count), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  response_text TEXT NOT NULL DEFAULT '', internal_notes TEXT NOT NULL DEFAULT '', response_published_at TEXT,
  UNIQUE(user_id,idempotency_key),
  CHECK(status<>'completed' OR (length(trim(response_text))>0 AND response_published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS purification_request_owner ON purification_requests(user_id,created_at);
CREATE TABLE IF NOT EXISTS purification_credit_events (
  id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES purification_credit_grants(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES purification_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('reserve','release')), credits INTEGER NOT NULL CHECK(credits>0), created_at TEXT NOT NULL,
  UNIQUE(grant_id,request_id,event_type)
);
CREATE INDEX IF NOT EXISTS purification_event_grant ON purification_credit_events(grant_id);
CREATE TRIGGER IF NOT EXISTS purification_quota_reference BEFORE INSERT ON purification_quota_settings
WHEN NOT ((NEW.source_type='bas' AND NEW.source_id=1 AND EXISTS(SELECT 1 FROM free_membership_settings WHERE id=1))
 OR (NEW.source_type='membership_plan' AND EXISTS(SELECT 1 FROM membership_plans WHERE id=NEW.source_id))
 OR (NEW.source_type='course_bundle' AND EXISTS(SELECT 1 FROM course_bundles WHERE course_id=NEW.source_id)))
BEGIN SELECT RAISE(ABORT,'Rening quota source does not exist'); END;
CREATE TRIGGER IF NOT EXISTS purification_quota_identity BEFORE UPDATE OF source_type,source_id ON purification_quota_settings
BEGIN SELECT RAISE(ABORT,'Rening quota identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_attempt_reference BEFORE INSERT ON purification_attempt_quotas
WHEN NOT ((NEW.kind='membership' AND EXISTS(SELECT 1 FROM membership_checkout_attempts WHERE id=NEW.attempt_id AND status='creating' AND session_id IS NULL))
 OR (NEW.kind='bundle' AND EXISTS(SELECT 1 FROM course_purchase_attempts WHERE id=NEW.attempt_id AND status='creating' AND session_id IS NULL)))
BEGIN SELECT RAISE(ABORT,'Rening quota must be captured before checkout'); END;
CREATE TRIGGER IF NOT EXISTS purification_attempt_immutable BEFORE UPDATE ON purification_attempt_quotas
BEGIN SELECT RAISE(ABORT,'Rening quota snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_attempt_delete BEFORE DELETE ON purification_attempt_quotas
WHEN (OLD.kind='membership' AND EXISTS(SELECT 1 FROM membership_checkout_attempts WHERE id=OLD.attempt_id))
 OR (OLD.kind='bundle' AND EXISTS(SELECT 1 FROM course_purchase_attempts WHERE id=OLD.attempt_id))
BEGIN SELECT RAISE(ABORT,'Rening quota snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_membership_attempt_cleanup AFTER DELETE ON membership_checkout_attempts
BEGIN DELETE FROM purification_attempt_quotas WHERE kind='membership' AND attempt_id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS purification_bundle_attempt_cleanup AFTER DELETE ON course_purchase_attempts
BEGIN DELETE FROM purification_attempt_quotas WHERE kind='bundle' AND attempt_id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS purification_plan_cleanup AFTER DELETE ON membership_plans
BEGIN DELETE FROM purification_quota_settings WHERE source_type='membership_plan' AND source_id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS purification_bundle_cleanup AFTER DELETE ON course_bundles
BEGIN DELETE FROM purification_quota_settings WHERE source_type='course_bundle' AND source_id=OLD.course_id; END;
CREATE TRIGGER IF NOT EXISTS purification_grant_reference BEFORE INSERT ON purification_credit_grants
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Verified student required for Rening credits'); END;
CREATE TRIGGER IF NOT EXISTS purification_grant_immutable BEFORE UPDATE ON purification_credit_grants
BEGIN SELECT RAISE(ABORT,'Rening credit source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_grant_delete BEFORE DELETE ON purification_credit_grants
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'Rening credit source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_revocation_immutable BEFORE UPDATE ON purification_credit_revocations
BEGIN SELECT RAISE(ABORT,'Rening revocation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_revocation_delete BEFORE DELETE ON purification_credit_revocations
BEGIN SELECT RAISE(ABORT,'Rening revocation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_request_reference BEFORE INSERT ON purification_requests
WHEN NEW.status<>'submitted' OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Verified student required for Rening request'); END;
CREATE TRIGGER IF NOT EXISTS purification_request_snapshot BEFORE UPDATE OF id,user_id,idempotency_key,holdings_json,message,company_count,credits_used,created_at ON purification_requests
BEGIN SELECT RAISE(ABORT,'Rening request snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_request_transition BEFORE UPDATE OF status ON purification_requests
WHEN NOT ((OLD.status='submitted' AND NEW.status IN ('submitted','processing','completed','rejected','cancelled'))
 OR (OLD.status='processing' AND NEW.status IN ('processing','completed','rejected')) OR OLD.status=NEW.status)
BEGIN SELECT RAISE(ABORT,'Rening request status cannot be restored'); END;
CREATE TRIGGER IF NOT EXISTS purification_request_delete BEFORE DELETE ON purification_requests
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'Rening request history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_event_immutable BEFORE UPDATE ON purification_credit_events
BEGIN SELECT RAISE(ABORT,'Rening credit event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_event_delete BEFORE DELETE ON purification_credit_events
WHEN EXISTS(SELECT 1 FROM purification_credit_grants g JOIN users u ON u.id=g.user_id WHERE g.id=OLD.grant_id)
BEGIN SELECT RAISE(ABORT,'Rening credit event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS purification_reserve_reference BEFORE INSERT ON purification_credit_events
WHEN NEW.event_type='reserve' AND NOT EXISTS(
 SELECT 1 FROM purification_credit_grants g JOIN purification_requests r ON r.user_id=g.user_id
 WHERE g.id=NEW.grant_id AND r.id=NEW.request_id AND r.status='submitted'
 AND julianday(g.starts_at)<=julianday('now') AND (g.expires_at IS NULL OR julianday(g.expires_at)>julianday('now'))
 AND NOT EXISTS(SELECT 1 FROM purification_credit_revocations v WHERE v.source_key=g.source_key)
 AND NEW.credits<=g.total_credits-COALESCE((SELECT SUM(CASE WHEN e.event_type='reserve' THEN e.credits ELSE -e.credits END) FROM purification_credit_events e WHERE e.grant_id=g.id),0)
 AND NEW.credits<=r.credits_used-COALESCE((SELECT SUM(e.credits) FROM purification_credit_events e WHERE e.request_id=r.id AND e.event_type='reserve'),0))
BEGIN SELECT RAISE(ABORT,'Rening credits are unavailable'); END;
CREATE TRIGGER IF NOT EXISTS purification_release_reference BEFORE INSERT ON purification_credit_events
WHEN NEW.event_type='release' AND NOT EXISTS(
 SELECT 1 FROM purification_credit_events e JOIN purification_requests r ON r.id=e.request_id
 WHERE e.grant_id=NEW.grant_id AND e.request_id=NEW.request_id AND e.event_type='reserve' AND e.credits=NEW.credits
 AND r.status IN ('cancelled','rejected'))
BEGIN SELECT RAISE(ABORT,'Rening release must match its reservation'); END;
CREATE TRIGGER IF NOT EXISTS purification_users_cleanup AFTER DELETE ON users
BEGIN
 DELETE FROM purification_credit_events WHERE grant_id IN (SELECT id FROM purification_credit_grants WHERE user_id=OLD.id);
 DELETE FROM purification_requests WHERE user_id=OLD.id;
 DELETE FROM purification_credit_grants WHERE user_id=OLD.id;
END;
`;
