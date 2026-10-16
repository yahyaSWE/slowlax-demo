/** Offers extend the existing verified payment source; old contracts retain their legacy columns. */
export const COURSE_BUNDLES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS course_bundles (
    course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS course_bundle_courses (
    bundle_course_id INTEGER NOT NULL REFERENCES course_bundles(course_id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id),
    PRIMARY KEY(bundle_course_id,course_id), CHECK(bundle_course_id<>course_id)
  );
  CREATE TABLE IF NOT EXISTS course_sales_groups (
    course_id INTEGER NOT NULL REFERENCES course_sales_settings(course_id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES membership_groups(id),
    PRIMARY KEY(course_id,group_id)
  );
  CREATE TABLE IF NOT EXISTS course_purchase_attempt_courses (
    attempt_id TEXT NOT NULL REFERENCES course_purchase_attempts(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id), title TEXT NOT NULL, slug TEXT NOT NULL,
    PRIMARY KEY(attempt_id,course_id)
  );
  CREATE TABLE IF NOT EXISTS course_purchase_attempt_groups (
    attempt_id TEXT NOT NULL REFERENCES course_purchase_attempts(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES membership_groups(id), group_name TEXT NOT NULL,
    access_days INTEGER CHECK(access_days BETWEEN 1 AND 3650),
    PRIMARY KEY(attempt_id,group_id)
  );
  CREATE TABLE IF NOT EXISTS membership_plan_groups (
    plan_id INTEGER NOT NULL REFERENCES membership_plans(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES membership_groups(id),
    PRIMARY KEY(plan_id,group_id)
  );
  CREATE TABLE IF NOT EXISTS membership_attempt_groups (
    attempt_id TEXT NOT NULL REFERENCES membership_checkout_attempts(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES membership_groups(id), group_name TEXT NOT NULL,
    PRIMARY KEY(attempt_id,group_id)
  );
  CREATE TRIGGER IF NOT EXISTS purchase_courses_snapshot_immutable BEFORE UPDATE ON course_purchase_attempt_courses
    BEGIN SELECT RAISE(ABORT,'Purchased course snapshot is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS purchase_groups_snapshot_immutable BEFORE UPDATE ON course_purchase_attempt_groups
    BEGIN SELECT RAISE(ABORT,'Purchased group snapshot is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS membership_groups_snapshot_immutable BEFORE UPDATE ON membership_attempt_groups
    BEGIN SELECT RAISE(ABORT,'Membership group snapshot is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS purchase_courses_snapshot_reference BEFORE INSERT ON course_purchase_attempt_courses
    WHEN NOT EXISTS(SELECT 1 FROM course_purchase_attempts a JOIN courses c ON c.id=NEW.course_id
      WHERE a.id=NEW.attempt_id AND a.status='creating' AND a.session_id IS NULL AND c.title=NEW.title AND c.slug=NEW.slug
        AND (a.course_id=c.id OR EXISTS(SELECT 1 FROM course_bundle_courses b WHERE b.bundle_course_id=a.course_id AND b.course_id=c.id)))
    BEGIN SELECT RAISE(ABORT,'Purchased course snapshot reference failed'); END;
  CREATE TRIGGER IF NOT EXISTS purchase_groups_snapshot_reference BEFORE INSERT ON course_purchase_attempt_groups
    WHEN NOT EXISTS(SELECT 1 FROM course_purchase_attempts a JOIN course_sales_settings s ON s.course_id=a.course_id JOIN membership_groups g ON g.id=NEW.group_id
      WHERE a.id=NEW.attempt_id AND a.status='creating' AND a.session_id IS NULL AND g.name=NEW.group_name AND s.group_access_days IS NEW.access_days
        AND (s.group_id=g.id OR EXISTS(SELECT 1 FROM course_sales_groups sg WHERE sg.course_id=a.course_id AND sg.group_id=g.id)))
    BEGIN SELECT RAISE(ABORT,'Purchased group snapshot reference failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_groups_snapshot_reference BEFORE INSERT ON membership_attempt_groups
    WHEN NOT EXISTS(SELECT 1 FROM membership_checkout_attempts a JOIN membership_groups g ON g.id=NEW.group_id
      WHERE a.id=NEW.attempt_id AND a.status='creating' AND a.session_id IS NULL AND g.name=NEW.group_name
        AND (a.group_id=g.id OR EXISTS(SELECT 1 FROM membership_plan_groups pg WHERE pg.plan_id=a.plan_id AND pg.group_id=g.id)))
    BEGIN SELECT RAISE(ABORT,'Membership group snapshot reference failed'); END;
  CREATE TRIGGER IF NOT EXISTS purchase_courses_snapshot_delete BEFORE DELETE ON course_purchase_attempt_courses
    WHEN EXISTS(SELECT 1 FROM course_purchase_attempts WHERE id=OLD.attempt_id)
    BEGIN SELECT RAISE(ABORT,'Purchased course snapshot is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS purchase_groups_snapshot_delete BEFORE DELETE ON course_purchase_attempt_groups
    WHEN EXISTS(SELECT 1 FROM course_purchase_attempts WHERE id=OLD.attempt_id)
    BEGIN SELECT RAISE(ABORT,'Purchased group snapshot is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS membership_groups_snapshot_delete BEFORE DELETE ON membership_attempt_groups
    WHEN EXISTS(SELECT 1 FROM membership_checkout_attempts WHERE id=OLD.attempt_id)
    BEGIN SELECT RAISE(ABORT,'Membership group snapshot is immutable'); END;
`;
