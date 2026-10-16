import { membershipCourseAccessSql } from "./membership-access";
import { coursePurchaseAccessSql } from "./course-purchase-access";

// The insert guard repeats every entitlement/completion rule. A programmer
// cannot accidentally issue a diploma using a stale, client supplied status.
export const COURSE_CERTIFICATE_INSERT_GUARD = `EXISTS(
  SELECT 1 FROM users u JOIN courses c ON c.id=NEW.course_id
  JOIN course_certificate_settings cs ON cs.course_id=c.id AND cs.enabled=1
  WHERE u.id=NEW.user_id AND u.role='student' AND u.email_verified_at IS NOT NULL AND c.published=1
    AND NOT EXISTS(SELECT 1 FROM course_bundles cb WHERE cb.course_id=c.id)
    AND NEW.course_identity=CAST(c.id AS TEXT)||':'||c.created_at
    AND NEW.student_name=u.name AND NEW.course_title=c.title AND NEW.issuer_name='Slowlax'
    AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=u.id AND e.course_id=c.id)
      OR ${membershipCourseAccessSql()} OR ${coursePurchaseAccessSql()})
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
)`;

export const COURSE_CERTIFICATES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS course_certificate_settings (
    course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS course_certificates (
    id TEXT PRIMARY KEY CHECK(length(id)=32),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    course_identity TEXT NOT NULL,
    student_name TEXT NOT NULL, course_title TEXT NOT NULL,
    issuer_name TEXT NOT NULL CHECK(issuer_name='Slowlax'),
    completed_at TEXT NOT NULL, issued_at TEXT NOT NULL,
    UNIQUE(user_id,course_identity),
    CHECK(julianday(completed_at) IS NOT NULL AND julianday(issued_at) IS NOT NULL AND julianday(issued_at)>=julianday(completed_at))
  );
  CREATE INDEX IF NOT EXISTS course_certificates_owner ON course_certificates(user_id,issued_at,id);
  CREATE INDEX IF NOT EXISTS course_certificates_course ON course_certificates(course_id,user_id);
  CREATE TRIGGER IF NOT EXISTS course_certificate_settings_reference BEFORE INSERT ON course_certificate_settings
    WHEN NOT EXISTS(SELECT 1 FROM courses c WHERE c.id=NEW.course_id AND NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=c.id))
    BEGIN SELECT RAISE(ABORT,'Individual course required'); END;
  CREATE TRIGGER IF NOT EXISTS course_certificate_settings_reference_update BEFORE UPDATE OF course_id ON course_certificate_settings
    WHEN NEW.course_id<>OLD.course_id OR NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id)
    BEGIN SELECT RAISE(ABORT,'Certificate settings course is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS course_certificate_issuance_reference BEFORE INSERT ON course_certificates
    WHEN NOT ${COURSE_CERTIFICATE_INSERT_GUARD}
    BEGIN SELECT RAISE(ABORT,'Certificate completion and ownership requirements failed'); END;
  CREATE TRIGGER IF NOT EXISTS course_certificates_snapshot_immutable
    BEFORE UPDATE OF id,user_id,course_identity,student_name,course_title,issuer_name,completed_at,issued_at ON course_certificates
    BEGIN SELECT RAISE(ABORT,'Issued certificate is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS course_certificates_course_detach BEFORE UPDATE OF course_id ON course_certificates
    WHEN NOT (OLD.course_id IS NOT NULL AND NEW.course_id IS NULL AND NOT EXISTS(SELECT 1 FROM courses WHERE id=OLD.course_id))
    BEGIN SELECT RAISE(ABORT,'Issued certificate course is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS course_certificates_preserve_history BEFORE DELETE ON course_certificates
    WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
    BEGIN SELECT RAISE(ABORT,'Issued certificate is immutable'); END;
  -- HTTP SQLite connections also need explicit privacy/history cleanup when
  -- foreign_keys is scoped to another connection. AFTER lets guards see that
  -- the parent truly disappeared, matching PostgreSQL's FK actions.
  CREATE TRIGGER IF NOT EXISTS courses_certificates_cleanup AFTER DELETE ON courses BEGIN
    UPDATE course_certificates SET course_id=NULL WHERE course_id=OLD.id;
    DELETE FROM course_certificate_settings WHERE course_id=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS users_certificates_cleanup AFTER DELETE ON users BEGIN
    DELETE FROM course_certificates WHERE user_id=OLD.id;
  END;
`;
