BEGIN;
SELECT pg_advisory_xact_lock(1397509976,1);
-- Slowlax v2: optional, immutable course diplomas.

SET LOCAL search_path=slowlax,pg_catalog;

CREATE TABLE course_certificate_settings (
    course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), updated_at TEXT NOT NULL
  );

CREATE TABLE course_certificates (
    id TEXT PRIMARY KEY CHECK(length(id)=32),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
    course_identity TEXT NOT NULL,
    student_name TEXT NOT NULL, course_title TEXT NOT NULL,
    issuer_name TEXT NOT NULL CHECK(issuer_name='Slowlax'),
    completed_at TEXT NOT NULL, issued_at TEXT NOT NULL,
    UNIQUE(user_id,course_identity),
    CHECK(julianday(completed_at) IS NOT NULL AND julianday(issued_at) IS NOT NULL AND julianday(issued_at)>=julianday(completed_at))
  );

CREATE INDEX IF NOT EXISTS course_certificates_owner ON course_certificates(user_id,issued_at,id);

CREATE INDEX IF NOT EXISTS course_certificates_course ON course_certificates(course_id,user_id);

CREATE FUNCTION trigger_course_certificate_settings_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM courses c WHERE c.id=NEW.course_id AND NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=c.id)) THEN
RAISE EXCEPTION 'Individual course required' USING ERRCODE='23514'; 
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER course_certificate_settings_reference BEFORE INSERT ON course_certificate_settings FOR EACH ROW EXECUTE FUNCTION trigger_course_certificate_settings_reference();

CREATE FUNCTION trigger_course_certificate_settings_reference_update() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
  IF NEW.course_id<>OLD.course_id OR NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id) THEN
RAISE EXCEPTION 'Certificate settings course is immutable' USING ERRCODE='23514'; 
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER course_certificate_settings_reference_update BEFORE UPDATE OF course_id ON course_certificate_settings FOR EACH ROW EXECUTE FUNCTION trigger_course_certificate_settings_reference_update();

CREATE FUNCTION trigger_course_certificate_issuance_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
  IF NOT EXISTS(
  SELECT 1 FROM users u JOIN courses c ON c.id=NEW.course_id
  JOIN course_certificate_settings cs ON cs.course_id=c.id AND cs.enabled=1
  WHERE u.id=NEW.user_id AND u.role='student' AND u.email_verified_at IS NOT NULL AND c.published=1
    AND NOT EXISTS(SELECT 1 FROM course_bundles cb WHERE cb.course_id=c.id)
    AND NEW.course_identity=CAST(c.id AS TEXT)||':'||c.created_at
    AND NEW.student_name=u.name AND NEW.course_title=c.title AND NEW.issuer_name='Slowlax'
    AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=u.id AND e.course_id=c.id)
      OR EXISTS(SELECT 1 FROM membership_group_courses mgc_access
    WHERE mgc_access.course_id=c.id
    AND EXISTS(SELECT 1 FROM membership_groups mg_access
    WHERE mg_access.id=mgc_access.group_id AND mg_access.published=1
    AND EXISTS(SELECT 1 FROM users mu_access WHERE mu_access.id=u.id AND mu_access.role='student' AND mu_access.email_verified_at IS NOT NULL)
    AND (
      EXISTS(SELECT 1 FROM membership_assignments ma_access
        WHERE ma_access.group_id=mg_access.id AND ma_access.user_id=u.id
        AND (ma_access.expires_at IS NULL OR julianday(ma_access.expires_at)>julianday('now')))
      OR EXISTS(SELECT 1 FROM membership_subscriptions ms_access
        WHERE (EXISTS(SELECT 1 FROM membership_attempt_groups mag_access WHERE mag_access.attempt_id=ms_access.attempt_id AND mag_access.group_id=mg_access.id)
          OR (ms_access.group_id=mg_access.id AND NOT EXISTS(SELECT 1 FROM membership_attempt_groups mag_legacy WHERE mag_legacy.attempt_id=ms_access.attempt_id))) AND ms_access.user_id=u.id
        AND ms_access.status IN ('active','past_due') AND ms_access.blocked=0
        AND julianday(ms_access.paid_until)>julianday('now'))
      OR EXISTS(SELECT 1 FROM course_purchases cpg_access
    JOIN course_purchase_attempts cpga_access ON cpga_access.id=cpg_access.attempt_id AND cpga_access.status='paid'
    JOIN membership_groups cpgg_access ON cpgg_access.id=mg_access.id AND cpgg_access.published=1
    JOIN users cpgu_access ON cpgu_access.id=cpg_access.user_id AND cpgu_access.role='student' AND cpgu_access.email_verified_at IS NOT NULL
    WHERE cpg_access.user_id=u.id
      AND cpg_access.revoked=0 AND julianday(cpg_access.paid_at)<=julianday('now')
      AND (EXISTS(SELECT 1 FROM course_purchase_attempt_groups cpsg_access WHERE cpsg_access.attempt_id=cpg_access.attempt_id
        AND cpsg_access.group_id=mg_access.id AND (cpsg_access.access_days IS NULL OR julianday(cpg_access.paid_at)+cpsg_access.access_days>julianday('now')))
        OR (NOT EXISTS(SELECT 1 FROM course_purchase_attempt_groups cpsg_legacy WHERE cpsg_legacy.attempt_id=cpg_access.attempt_id)
          AND cpg_access.group_id=mg_access.id AND (cpg_access.group_expires_at IS NULL OR julianday(cpg_access.group_expires_at)>julianday('now')))))
    ))) OR EXISTS(SELECT 1 FROM course_purchases cp_access
    JOIN course_purchase_attempts cpa_access ON cpa_access.id=cp_access.attempt_id AND cpa_access.status='paid'
    JOIN courses cpc_access ON cpc_access.id=c.id AND cpc_access.published=1
    JOIN users cpu_access ON cpu_access.id=cp_access.user_id AND cpu_access.role='student' AND cpu_access.email_verified_at IS NOT NULL
    WHERE cp_access.user_id=u.id AND (cp_access.course_id=c.id OR EXISTS(
      SELECT 1 FROM course_purchase_attempt_courses cps_access WHERE cps_access.attempt_id=cp_access.attempt_id AND cps_access.course_id=c.id))
      AND cp_access.revoked=0 AND julianday(cp_access.paid_at)<=julianday('now')))
    AND EXISTS(SELECT 1 FROM lessons l WHERE l.course_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM lessons l WHERE l.course_id=c.id
      AND NOT EXISTS(SELECT 1 FROM progress p WHERE p.user_id=u.id AND p.lesson_id=l.id))
    AND NOT EXISTS(SELECT 1 FROM course_activities a JOIN lessons l ON l.id=a.lesson_id
      WHERE l.course_id=c.id AND a.active=1 AND a.kind='quiz'
      AND NOT EXISTS(SELECT 1 FROM quiz_attempts q WHERE q.activity_id=a.id AND q.user_id=u.id
        AND q.revision=a.current_revision AND q.passed=1))
    AND NOT EXISTS(SELECT 1 FROM course_activities a JOIN lessons l ON l.id=a.lesson_id
      WHERE l.course_id=c.id AND a.active=1 AND a.kind='assignment'
      AND COALESCE((SELECT s.status FROM assignment_submissions s WHERE s.activity_id=a.id
        AND s.user_id=u.id AND s.revision=a.current_revision AND s.status<>'draft'
        ORDER BY s.id DESC LIMIT 1),'')<>'approved')
) THEN
RAISE EXCEPTION 'Certificate completion and ownership requirements failed' USING ERRCODE='23514'; 
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER course_certificate_issuance_reference BEFORE INSERT ON course_certificates FOR EACH ROW EXECUTE FUNCTION trigger_course_certificate_issuance_reference();

CREATE FUNCTION trigger_course_certificates_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
RAISE EXCEPTION 'Issued certificate is immutable' USING ERRCODE='23514'; 
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER course_certificates_snapshot_immutable BEFORE UPDATE OF id,user_id,course_identity,student_name,course_title,issuer_name,completed_at,issued_at ON course_certificates FOR EACH ROW EXECUTE FUNCTION trigger_course_certificates_snapshot_immutable();

CREATE FUNCTION trigger_course_certificates_course_detach() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
  IF NOT (OLD.course_id IS NOT NULL AND NEW.course_id IS NULL AND NOT EXISTS(SELECT 1 FROM courses WHERE id=OLD.course_id)) THEN
RAISE EXCEPTION 'Issued certificate course is immutable' USING ERRCODE='23514'; 
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER course_certificates_course_detach BEFORE UPDATE OF course_id ON course_certificates FOR EACH ROW EXECUTE FUNCTION trigger_course_certificates_course_detach();

CREATE FUNCTION trigger_course_certificates_preserve_history() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
  IF EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) THEN
RAISE EXCEPTION 'Issued certificate is immutable' USING ERRCODE='23514'; 
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER course_certificates_preserve_history BEFORE DELETE ON course_certificates FOR EACH ROW EXECUTE FUNCTION trigger_course_certificates_preserve_history();

CREATE FUNCTION trigger_courses_certificates_cleanup() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
UPDATE course_certificates SET course_id=NULL WHERE course_id=OLD.id;
    DELETE FROM course_certificate_settings WHERE course_id=OLD.id;
  
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER courses_certificates_cleanup AFTER DELETE ON courses FOR EACH ROW EXECUTE FUNCTION trigger_courses_certificates_cleanup();

CREATE FUNCTION trigger_users_certificates_cleanup() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
DELETE FROM course_certificates WHERE user_id=OLD.id;
  
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER users_certificates_cleanup AFTER DELETE ON users FOR EACH ROW EXECUTE FUNCTION trigger_users_certificates_cleanup();

ALTER TABLE course_certificate_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_certificates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA slowlax FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA slowlax FROM PUBLIC;
DO $security$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA slowlax FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA slowlax FROM %I',role_name);
    END IF;
  END LOOP;
END; $security$;

UPDATE app_meta SET value='2' WHERE key='postgres_schema_version';
COMMIT;
