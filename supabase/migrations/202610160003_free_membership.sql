BEGIN;
SELECT pg_advisory_xact_lock(1397509976,1);
-- Slowlax v3: Bas free membership with live group access.

SET LOCAL search_path=slowlax,pg_catalog;

DO $migration$ BEGIN IF (SELECT value FROM app_meta WHERE key='postgres_schema_version') IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Apply PostgreSQL v2 before v3'; END IF; END; $migration$;

CREATE TABLE free_membership_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    description TEXT NOT NULL DEFAULT 'Nyhetsbrev och communityuppdateringar från Slowlax.',
    updated_at TEXT NOT NULL
  );

CREATE TABLE free_membership_groups (
    group_id INTEGER PRIMARY KEY REFERENCES membership_groups(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
  );

CREATE TABLE free_membership_members (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    joined_at TEXT NOT NULL
  );

INSERT INTO free_membership_settings(id,updated_at) VALUES(1,'1970-01-01T00:00:00.000Z') ON CONFLICT(id) DO NOTHING;

CREATE FUNCTION trigger_free_membership_group_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id AND published=1) THEN
RAISE EXCEPTION 'Published group required for free membership' USING ERRCODE='23514'; 
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER free_membership_group_reference BEFORE INSERT ON free_membership_groups FOR EACH ROW EXECUTE FUNCTION trigger_free_membership_group_reference();

CREATE FUNCTION trigger_free_membership_group_reference_update() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id AND published=1) THEN
RAISE EXCEPTION 'Published group required for free membership' USING ERRCODE='23514'; 
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER free_membership_group_reference_update BEFORE UPDATE OF group_id ON free_membership_groups FOR EACH ROW EXECUTE FUNCTION trigger_free_membership_group_reference_update();

CREATE FUNCTION trigger_free_membership_member_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student') THEN
RAISE EXCEPTION 'Student required for free membership' USING ERRCODE='23514'; 
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER free_membership_member_reference BEFORE INSERT ON free_membership_members FOR EACH ROW EXECUTE FUNCTION trigger_free_membership_member_reference();

CREATE FUNCTION trigger_free_membership_member_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
RAISE EXCEPTION 'Free membership identity is immutable' USING ERRCODE='23514'; 
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER free_membership_member_immutable BEFORE UPDATE ON free_membership_members FOR EACH ROW EXECUTE FUNCTION trigger_free_membership_member_immutable();

CREATE FUNCTION trigger_users_free_membership_cleanup() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
DELETE FROM free_membership_members WHERE user_id=OLD.id;
  
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER users_free_membership_cleanup AFTER DELETE ON users FOR EACH ROW EXECUTE FUNCTION trigger_users_free_membership_cleanup();

CREATE FUNCTION trigger_groups_free_membership_cleanup() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
BEGIN
DELETE FROM free_membership_groups WHERE group_id=OLD.id;
  
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER groups_free_membership_cleanup AFTER DELETE ON membership_groups FOR EACH ROW EXECUTE FUNCTION trigger_groups_free_membership_cleanup();

-- Reserve the free Bas URL without changing a single historical contract.
DO $reserve_bas$
DECLARE legacy_plan RECORD; base_slug TEXT; candidate TEXT; suffix INTEGER; revision TEXT;
BEGIN
  FOR legacy_plan IN SELECT id,updated_at FROM slowlax.membership_plans WHERE slug='bas' LOOP
    base_slug:='bas-betalt-'||legacy_plan.id::TEXT; candidate:=base_slug; suffix:=1;
    WHILE EXISTS(SELECT 1 FROM slowlax.membership_plans WHERE slug=candidate AND id<>legacy_plan.id) LOOP
      suffix:=suffix+1; candidate:=base_slug||'-'||suffix::TEXT;
    END LOOP;
    revision:=CASE WHEN slowlax.julianday(legacy_plan.updated_at)>=slowlax.julianday('now')
      THEN to_char((legacy_plan.updated_at::timestamptz+interval '1 millisecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ELSE slowlax.iso_now() END;
    UPDATE slowlax.membership_plans SET slug=candidate,updated_at=revision WHERE id=legacy_plan.id;
  END LOOP;
END;
$reserve_bas$;

-- Extend the existing v2 guard without changing its historical migration.
CREATE OR REPLACE FUNCTION trigger_course_certificate_issuance_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=slowlax,pg_catalog AS $trigger$
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
      EXISTS(SELECT 1 FROM free_membership_members fm_access
        JOIN free_membership_groups fg_access ON fg_access.group_id=mg_access.id
        WHERE fm_access.user_id=u.id)
      OR
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
  RETURN NEW;
END;
$trigger$;

ALTER TABLE free_membership_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_membership_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_membership_members ENABLE ROW LEVEL SECURITY;
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

UPDATE app_meta SET value='3' WHERE key='postgres_schema_version';
COMMIT;
