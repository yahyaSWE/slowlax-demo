// Increase this version whenever schema definitions or migrations change.
// It is recorded in app_meta (and local SQLite's user_version) only when the
// complete migration and initial seed commit successfully.
export const SCHEMA_VERSION = 16;
export const SCHEMA_VERSION_KEY = "schema_version";

export const ACCOUNT_EMAIL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('verify-email','reset-password')),
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id,kind,expires_at);
  CREATE TRIGGER IF NOT EXISTS auth_tokens_reference BEFORE INSERT ON auth_tokens
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS users_auth_tokens_cleanup BEFORE DELETE ON users BEGIN
    DELETE FROM auth_tokens WHERE user_id=OLD.id;
  END;
  CREATE TABLE IF NOT EXISTS booking_email_outbox (
    id TEXT PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id),
    audience TEXT NOT NULL CHECK(audience IN ('customer','admin')),
    recipient TEXT NOT NULL, sender TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','skipped')),
    attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, first_attempt_at TEXT,
    next_attempt_at TEXT NOT NULL, lease_until TEXT, lease_token TEXT, sent_at TEXT, provider_id TEXT,
    UNIQUE(booking_id,audience)
  );
  CREATE INDEX IF NOT EXISTS booking_email_due ON booking_email_outbox(status,next_attempt_at);
  CREATE TRIGGER IF NOT EXISTS booking_email_reference BEFORE INSERT ON booking_email_outbox
    WHEN NOT EXISTS(SELECT 1 FROM bookings WHERE id=NEW.booking_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS bookings_email_cleanup BEFORE DELETE ON bookings BEGIN
    DELETE FROM booking_email_outbox WHERE booking_id=OLD.id;
  END;
`;

// Activity revisions are immutable. Attempts and submissions keep referencing
// the revision used by the student when an administrator changes the activity.
export const COURSE_ACTIVITY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS course_activities (
    id INTEGER PRIMARY KEY, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('quiz','assignment')),
    position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10000),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    current_revision INTEGER NOT NULL CHECK(current_revision>=1),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS course_activities_lesson ON course_activities(lesson_id,position,id);
  CREATE TABLE IF NOT EXISTS activity_revisions (
    activity_id INTEGER NOT NULL REFERENCES course_activities(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK(revision>=1), data_json TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(activity_id,revision)
  );
  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY, activity_id INTEGER NOT NULL, revision INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK(attempt_number>=1),
    answers_json TEXT NOT NULL, correct_count INTEGER NOT NULL CHECK(correct_count>=0),
    question_count INTEGER NOT NULL CHECK(question_count BETWEEN 1 AND 30),
    score_percent INTEGER NOT NULL CHECK(score_percent BETWEEN 0 AND 100),
    pass_percent INTEGER NOT NULL CHECK(pass_percent BETWEEN 1 AND 100),
    passed INTEGER NOT NULL CHECK(passed IN (0,1)), submitted_at TEXT NOT NULL,
    FOREIGN KEY(activity_id,revision) REFERENCES activity_revisions(activity_id,revision) ON DELETE CASCADE,
    UNIQUE(activity_id,user_id,attempt_number), CHECK(correct_count<=question_count)
  );
  CREATE INDEX IF NOT EXISTS quiz_attempts_user ON quiz_attempts(user_id,activity_id,id);
  CREATE TABLE IF NOT EXISTS assignment_submissions (
    id INTEGER PRIMARY KEY, activity_id INTEGER NOT NULL, revision INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','submitted','approved','needs_revision')),
    feedback TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    submitted_at TEXT, reviewed_at TEXT, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(activity_id,revision) REFERENCES activity_revisions(activity_id,revision) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS assignment_one_draft ON assignment_submissions(activity_id,revision,user_id) WHERE status='draft';
  CREATE INDEX IF NOT EXISTS assignment_submissions_user ON assignment_submissions(user_id,activity_id,id);
  CREATE TRIGGER IF NOT EXISTS activities_lesson_reference BEFORE INSERT ON course_activities
    WHEN NOT EXISTS(SELECT 1 FROM lessons WHERE id=NEW.lesson_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS activities_lesson_update BEFORE UPDATE OF lesson_id ON course_activities
    WHEN NOT EXISTS(SELECT 1 FROM lessons WHERE id=NEW.lesson_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS activity_revision_reference BEFORE INSERT ON activity_revisions
    WHEN NOT EXISTS(SELECT 1 FROM course_activities WHERE id=NEW.activity_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS quiz_attempt_reference BEFORE INSERT ON quiz_attempts
    WHEN NOT EXISTS(SELECT 1 FROM activity_revisions r JOIN course_activities a ON a.id=r.activity_id WHERE r.activity_id=NEW.activity_id AND r.revision=NEW.revision AND a.kind='quiz')
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS assignment_submission_reference BEFORE INSERT ON assignment_submissions
    WHEN NOT EXISTS(SELECT 1 FROM activity_revisions r JOIN course_activities a ON a.id=r.activity_id WHERE r.activity_id=NEW.activity_id AND r.revision=NEW.revision AND a.kind='assignment')
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS assignment_reviewer_reference BEFORE UPDATE OF reviewed_by ON assignment_submissions
    WHEN NEW.reviewed_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.reviewed_by AND role='admin')
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS lessons_activity_cleanup BEFORE DELETE ON lessons BEGIN
    DELETE FROM course_activities WHERE lesson_id=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS course_activity_cleanup BEFORE DELETE ON course_activities BEGIN
    DELETE FROM quiz_attempts WHERE activity_id=OLD.id;
    DELETE FROM assignment_submissions WHERE activity_id=OLD.id;
    DELETE FROM activity_revisions WHERE activity_id=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS users_activity_cleanup BEFORE DELETE ON users BEGIN
    DELETE FROM quiz_attempts WHERE user_id=OLD.id;
    DELETE FROM assignment_submissions WHERE user_id=OLD.id;
    UPDATE assignment_submissions SET reviewed_by=NULL WHERE reviewed_by=OLD.id;
  END;
`;

export const SCHEMA = `    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','student')), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), site_name TEXT NOT NULL DEFAULT 'Tibb.nu', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT 'Besök på plats', pay_on_site INTEGER NOT NULL DEFAULT 1, stripe_enabled INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS treatments (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 5 AND 480), price_ore INTEGER NOT NULL CHECK(price_ore BETWEEN 0 AND 10000000), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('practitioner-photo','lesson-material')), filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0 AND ((kind='practitioner-photo' AND size<=2097152) OR (kind='lesson-material' AND size<=20971520))), storage_path TEXT NOT NULL, storage_provider TEXT NOT NULL CHECK(storage_provider IN ('local','blob')), uploader_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, created_at TEXT NOT NULL, CHECK((kind='practitioner-photo' AND course_id IS NULL) OR (kind='lesson-material' AND course_id IS NOT NULL)));
    CREATE TABLE IF NOT EXISTS upload_requests (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('practitioner-photo','lesson-material')), filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0 AND ((kind='practitioner-photo' AND size<=2097152) OR (kind='lesson-material' AND size<=20971520))), storage_path TEXT NOT NULL, storage_provider TEXT NOT NULL CHECK(storage_provider IN ('local','blob')), uploader_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, created_at TEXT NOT NULL, completing INTEGER NOT NULL DEFAULT 0 CHECK(completing IN (0,1)), CHECK((kind='practitioner-photo' AND course_id IS NULL) OR (kind='lesson-material' AND course_id IS NOT NULL)));
    CREATE INDEX IF NOT EXISTS uploads_course ON uploads(course_id,kind);
    CREATE INDEX IF NOT EXISTS upload_requests_created ON upload_requests(created_at);
    CREATE TABLE IF NOT EXISTS practitioners (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), photo_upload_id TEXT REFERENCES uploads(id));
    INSERT OR IGNORE INTO practitioners(id,name,description,active) VALUES(1,'Tibb.nu','',1);
    CREATE TABLE IF NOT EXISTS availability_schedules (id INTEGER PRIMARY KEY, treatment_id INTEGER NOT NULL REFERENCES treatments(id), practitioner_id INTEGER NOT NULL DEFAULT 1 REFERENCES practitioners(id), start_date TEXT NOT NULL, end_date TEXT NOT NULL, weekdays TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, breaks TEXT NOT NULL DEFAULT '[]', created_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS availability_blocks (id INTEGER PRIMARY KEY, practitioner_id INTEGER REFERENCES practitioners(id), start TEXT NOT NULL, end TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0,1)), reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, CHECK(end>start));
    CREATE INDEX IF NOT EXISTS availability_blocks_dates ON availability_blocks(start,end);
    CREATE TABLE IF NOT EXISTS slots (id INTEGER PRIMARY KEY, treatment_id INTEGER NOT NULL REFERENCES treatments(id), practitioner_id INTEGER NOT NULL DEFAULT 1 REFERENCES practitioners(id), start TEXT NOT NULL, end TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, schedule_id INTEGER REFERENCES availability_schedules(id), CHECK(end>start));
    CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, treatment_id INTEGER NOT NULL REFERENCES treatments(id), practitioner_id INTEGER NOT NULL DEFAULT 1 REFERENCES practitioners(id), practitioner_name TEXT NOT NULL DEFAULT 'Tibb.nu', slot_id INTEGER NOT NULL REFERENCES slots(id), treatment_name TEXT NOT NULL, duration_minutes INTEGER NOT NULL, price_ore INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled','completed')), payment_method TEXT NOT NULL CHECK(payment_method IN ('onsite','stripe')), payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','refunded')), checkout_session_id TEXT UNIQUE, expires_at TEXT, created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot ON bookings(slot_id) WHERE status IN ('pending','confirmed','completed');
    CREATE INDEX IF NOT EXISTS bookings_dates ON bookings(start,end,status);
    CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, excerpt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', price_ore INTEGER NOT NULL DEFAULT 0 CHECK(price_ore BETWEEN 0 AND 10000000), published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', video_url TEXT NOT NULL DEFAULT '', material_url TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS lessons_course_position ON lessons(course_id,position,id);
    CREATE TABLE IF NOT EXISTS lesson_materials (lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE, PRIMARY KEY(lesson_id,upload_id));
    CREATE INDEX IF NOT EXISTS lesson_materials_upload ON lesson_materials(upload_id);
    CREATE TABLE IF NOT EXISTS enrollments (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(user_id,course_id));
    CREATE TABLE IF NOT EXISTS progress (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, completed_at TEXT NOT NULL, PRIMARY KEY(user_id,lesson_id));
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- Keep relationships correct on HTTP connections whose foreign-key pragma
    -- is scoped to a stream. These also work alongside local FK enforcement.
    CREATE TRIGGER IF NOT EXISTS courses_cleanup BEFORE DELETE ON courses BEGIN
      DELETE FROM progress WHERE lesson_id IN (SELECT id FROM lessons WHERE course_id=OLD.id);
      DELETE FROM lessons WHERE course_id=OLD.id;
      DELETE FROM enrollments WHERE course_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS lessons_cleanup BEFORE DELETE ON lessons BEGIN
      DELETE FROM progress WHERE lesson_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS users_cleanup BEFORE DELETE ON users BEGIN
      DELETE FROM sessions WHERE user_id=OLD.id;
      DELETE FROM enrollments WHERE user_id=OLD.id;
      DELETE FROM progress WHERE user_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS sessions_reference_insert BEFORE INSERT ON sessions
      WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS sessions_reference_update BEFORE UPDATE OF user_id ON sessions
      WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS lessons_reference_insert BEFORE INSERT ON lessons
      WHEN NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS lessons_reference_update BEFORE UPDATE OF course_id ON lessons
      WHEN NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS enrollments_reference_insert BEFORE INSERT ON enrollments
      WHEN NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS enrollments_reference_update BEFORE UPDATE OF course_id,user_id ON enrollments
      WHEN NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS progress_reference_insert BEFORE INSERT ON progress
      WHEN NOT EXISTS(SELECT 1 FROM lessons WHERE id=NEW.lesson_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS progress_reference_update BEFORE UPDATE OF lesson_id,user_id ON progress
      WHEN NOT EXISTS(SELECT 1 FROM lessons WHERE id=NEW.lesson_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS slots_reference_insert BEFORE INSERT ON slots
      WHEN NOT EXISTS(SELECT 1 FROM treatments WHERE id=NEW.treatment_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS slots_reference_update BEFORE UPDATE OF treatment_id ON slots
      WHEN NOT EXISTS(SELECT 1 FROM treatments WHERE id=NEW.treatment_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS bookings_reference_insert BEFORE INSERT ON bookings
      WHEN NOT EXISTS(SELECT 1 FROM slots WHERE id=NEW.slot_id AND treatment_id=NEW.treatment_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS bookings_reference_update BEFORE UPDATE OF slot_id,treatment_id ON bookings
      WHEN NOT EXISTS(SELECT 1 FROM slots WHERE id=NEW.slot_id AND treatment_id=NEW.treatment_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS slots_preserve_bookings BEFORE DELETE ON slots
      WHEN EXISTS(SELECT 1 FROM bookings WHERE slot_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Slot has booking history'); END;
    CREATE TRIGGER IF NOT EXISTS treatments_preserve_history BEFORE DELETE ON treatments
      WHEN EXISTS(SELECT 1 FROM slots WHERE treatment_id=OLD.id) OR EXISTS(SELECT 1 FROM bookings WHERE treatment_id=OLD.id) OR EXISTS(SELECT 1 FROM availability_schedules WHERE treatment_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Treatment has booking history'); END;
    CREATE TRIGGER IF NOT EXISTS availability_schedules_reference_insert BEFORE INSERT ON availability_schedules
      WHEN NOT EXISTS(SELECT 1 FROM treatments WHERE id=NEW.treatment_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS availability_schedules_reference_update BEFORE UPDATE OF treatment_id ON availability_schedules
      WHEN NOT EXISTS(SELECT 1 FROM treatments WHERE id=NEW.treatment_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS treatments_preserve_schedules BEFORE DELETE ON treatments
      WHEN EXISTS(SELECT 1 FROM availability_schedules WHERE treatment_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Treatment has schedule history'); END;
    CREATE TRIGGER IF NOT EXISTS uploads_reference_insert BEFORE INSERT ON uploads
      WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.uploader_id AND role='admin')
        OR (NEW.course_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id))
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS uploads_reference_update BEFORE UPDATE OF uploader_id,course_id ON uploads
      WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.uploader_id AND role='admin')
        OR (NEW.course_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id))
        OR EXISTS(SELECT 1 FROM lesson_materials m JOIN lessons l ON l.id=m.lesson_id WHERE m.upload_id=OLD.id AND (NEW.kind<>'lesson-material' OR NEW.course_id IS NULL OR NEW.course_id<>l.course_id))
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS upload_requests_reference_insert BEFORE INSERT ON upload_requests
      WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.uploader_id AND role='admin')
        OR (NEW.course_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id))
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS upload_requests_reference_update BEFORE UPDATE OF uploader_id,course_id ON upload_requests
      WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.uploader_id AND role='admin')
        OR (NEW.course_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id))
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS lesson_materials_reference_insert BEFORE INSERT ON lesson_materials
      WHEN NOT EXISTS(SELECT 1 FROM lessons l JOIN uploads u ON u.id=NEW.upload_id WHERE l.id=NEW.lesson_id AND u.kind='lesson-material' AND u.course_id=l.course_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS lesson_materials_reference_update BEFORE UPDATE OF lesson_id,upload_id ON lesson_materials
      WHEN NOT EXISTS(SELECT 1 FROM lessons l JOIN uploads u ON u.id=NEW.upload_id WHERE l.id=NEW.lesson_id AND u.kind='lesson-material' AND u.course_id=l.course_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS lessons_materials_cleanup BEFORE DELETE ON lessons BEGIN
      DELETE FROM lesson_materials WHERE lesson_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS lessons_materials_preserve_course BEFORE UPDATE OF course_id ON lessons
      WHEN NEW.course_id<>OLD.course_id AND EXISTS(SELECT 1 FROM lesson_materials WHERE lesson_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Lesson has course materials'); END;
    CREATE TRIGGER IF NOT EXISTS courses_uploads_cleanup BEFORE DELETE ON courses BEGIN
      DELETE FROM uploads WHERE course_id=OLD.id;
      DELETE FROM upload_requests WHERE course_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS users_preserve_uploads BEFORE DELETE ON users
      WHEN EXISTS(SELECT 1 FROM uploads WHERE uploader_id=OLD.id) OR EXISTS(SELECT 1 FROM upload_requests WHERE uploader_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'User has uploaded files'); END;
  `;

// Apply after upgrading existing slots tables, so these triggers can reference
// schedule_id without replacing or losing historical slots and bookings.
export const SLOT_SCHEDULE_SCHEMA = `
    CREATE TRIGGER IF NOT EXISTS practitioners_photo_reference_insert BEFORE INSERT ON practitioners
      WHEN NEW.photo_upload_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM uploads WHERE id=NEW.photo_upload_id AND kind='practitioner-photo')
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS practitioners_photo_reference_update BEFORE UPDATE OF photo_upload_id ON practitioners
      WHEN NEW.photo_upload_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM uploads WHERE id=NEW.photo_upload_id AND kind='practitioner-photo')
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS uploads_cleanup BEFORE DELETE ON uploads BEGIN
      DELETE FROM lesson_materials WHERE upload_id=OLD.id;
      UPDATE practitioners SET photo_upload_id=NULL WHERE photo_upload_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS uploads_preserve_kind BEFORE UPDATE OF kind ON uploads
      WHEN NEW.kind<>OLD.kind AND (EXISTS(SELECT 1 FROM practitioners WHERE photo_upload_id=OLD.id) OR EXISTS(SELECT 1 FROM lesson_materials WHERE upload_id=OLD.id))
      BEGIN SELECT RAISE(ABORT,'Upload is in use'); END;
    CREATE INDEX IF NOT EXISTS slots_schedule ON slots(schedule_id,archived,start);
    CREATE TRIGGER IF NOT EXISTS slots_schedule_reference_insert BEFORE INSERT ON slots
      WHEN NEW.schedule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM availability_schedules WHERE id=NEW.schedule_id AND treatment_id=NEW.treatment_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS slots_schedule_reference_update BEFORE UPDATE OF schedule_id,treatment_id ON slots
      WHEN NEW.schedule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM availability_schedules WHERE id=NEW.schedule_id AND treatment_id=NEW.treatment_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS availability_schedules_preserve_slots BEFORE DELETE ON availability_schedules
      WHEN EXISTS(SELECT 1 FROM slots WHERE schedule_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Schedule has slot history'); END;
    CREATE INDEX IF NOT EXISTS slots_practitioner_dates ON slots(practitioner_id,start,end,archived);
    CREATE INDEX IF NOT EXISTS bookings_practitioner_dates ON bookings(practitioner_id,start,end,status);
    CREATE INDEX IF NOT EXISTS availability_blocks_practitioner_dates ON availability_blocks(practitioner_id,start,end);
    CREATE TRIGGER IF NOT EXISTS slots_practitioner_reference_insert BEFORE INSERT ON slots
      WHEN NOT EXISTS(SELECT 1 FROM practitioners WHERE id=NEW.practitioner_id)
        OR (NEW.schedule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM availability_schedules WHERE id=NEW.schedule_id AND practitioner_id=NEW.practitioner_id))
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS slots_practitioner_reference_update BEFORE UPDATE OF practitioner_id,schedule_id ON slots
      WHEN NOT EXISTS(SELECT 1 FROM practitioners WHERE id=NEW.practitioner_id)
        OR (NEW.schedule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM availability_schedules WHERE id=NEW.schedule_id AND practitioner_id=NEW.practitioner_id))
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS slots_preserve_practitioner BEFORE UPDATE OF practitioner_id ON slots
      WHEN NEW.practitioner_id<>OLD.practitioner_id AND EXISTS(SELECT 1 FROM bookings WHERE slot_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Slot has booking history'); END;
    CREATE TRIGGER IF NOT EXISTS bookings_practitioner_reference_insert BEFORE INSERT ON bookings
      WHEN NOT EXISTS(SELECT 1 FROM slots WHERE id=NEW.slot_id AND practitioner_id=NEW.practitioner_id)
        OR NOT EXISTS(SELECT 1 FROM practitioners WHERE id=NEW.practitioner_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS bookings_practitioner_reference_update BEFORE UPDATE OF practitioner_id,slot_id ON bookings
      WHEN NOT EXISTS(SELECT 1 FROM slots WHERE id=NEW.slot_id AND practitioner_id=NEW.practitioner_id)
        OR NOT EXISTS(SELECT 1 FROM practitioners WHERE id=NEW.practitioner_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS availability_schedules_practitioner_reference_insert BEFORE INSERT ON availability_schedules
      WHEN NOT EXISTS(SELECT 1 FROM practitioners WHERE id=NEW.practitioner_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS availability_schedules_practitioner_reference_update BEFORE UPDATE OF practitioner_id ON availability_schedules
      WHEN NOT EXISTS(SELECT 1 FROM practitioners WHERE id=NEW.practitioner_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS availability_schedules_preserve_practitioner BEFORE UPDATE OF practitioner_id ON availability_schedules
      WHEN NEW.practitioner_id<>OLD.practitioner_id AND EXISTS(SELECT 1 FROM slots WHERE schedule_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Schedule has slot history'); END;
    CREATE TRIGGER IF NOT EXISTS availability_blocks_practitioner_reference_insert BEFORE INSERT ON availability_blocks
      WHEN NEW.practitioner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM practitioners WHERE id=NEW.practitioner_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS availability_blocks_practitioner_reference_update BEFORE UPDATE OF practitioner_id ON availability_blocks
      WHEN NEW.practitioner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM practitioners WHERE id=NEW.practitioner_id)
      BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
    CREATE TRIGGER IF NOT EXISTS practitioners_preserve_history BEFORE DELETE ON practitioners
      WHEN EXISTS(SELECT 1 FROM slots WHERE practitioner_id=OLD.id)
        OR EXISTS(SELECT 1 FROM bookings WHERE practitioner_id=OLD.id)
        OR EXISTS(SELECT 1 FROM availability_schedules WHERE practitioner_id=OLD.id)
        OR EXISTS(SELECT 1 FROM availability_blocks WHERE practitioner_id=OLD.id)
      BEGIN SELECT RAISE(ABORT,'Practitioner has booking history'); END;
`;
