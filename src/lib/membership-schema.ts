export const MEMBERSHIP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS membership_groups (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS membership_group_courses (
    group_id INTEGER NOT NULL REFERENCES membership_groups(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    PRIMARY KEY(group_id,course_id)
  );
  CREATE INDEX IF NOT EXISTS membership_group_courses_course ON membership_group_courses(course_id,group_id);
  CREATE TABLE IF NOT EXISTS membership_assignments (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES membership_groups(id) ON DELETE CASCADE,
    expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(user_id,group_id)
  );
  CREATE INDEX IF NOT EXISTS membership_assignments_group ON membership_assignments(group_id,user_id);
  CREATE TABLE IF NOT EXISTS membership_plans (
    id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES membership_groups(id),
    name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
    price_ore INTEGER NOT NULL CHECK(price_ore BETWEEN 1 AND 10000000),
    vat_percent INTEGER NOT NULL CHECK(vat_percent IN (0,6,12,25)),
    interval TEXT NOT NULL CHECK(interval IN ('month','year')),
    published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS membership_plans_group ON membership_plans(group_id,published);
  CREATE TABLE IF NOT EXISTS membership_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), sales_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sales_enabled IN (0,1)),
    terms TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  INSERT OR IGNORE INTO membership_settings(id) VALUES(1);
  CREATE TABLE IF NOT EXISTS membership_posts (
    id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES membership_groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL, body_json TEXT, period TEXT,
    published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    CHECK(period IS NULL OR (length(period)=7 AND period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(period,6,2) BETWEEN '01' AND '12'))
  );
  CREATE INDEX IF NOT EXISTS membership_posts_group ON membership_posts(group_id,published,period,id);
  CREATE TABLE IF NOT EXISTS membership_post_uploads (
    post_id INTEGER NOT NULL REFERENCES membership_posts(id) ON DELETE CASCADE,
    upload_id TEXT NOT NULL REFERENCES membership_uploads(id) ON DELETE CASCADE,
    PRIMARY KEY(post_id,upload_id)
  );
  CREATE INDEX IF NOT EXISTS membership_post_uploads_upload ON membership_post_uploads(upload_id,post_id);
  CREATE TRIGGER IF NOT EXISTS membership_course_reference BEFORE INSERT ON membership_group_courses
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
      OR NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_course_reference_update BEFORE UPDATE ON membership_group_courses
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
      OR NOT EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_assignment_reference BEFORE INSERT ON membership_assignments
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_assignment_reference_update BEFORE UPDATE OF user_id,group_id ON membership_assignments
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student' AND email_verified_at IS NOT NULL)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_plan_reference BEFORE INSERT ON membership_plans
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_plan_reference_update BEFORE UPDATE OF group_id ON membership_plans
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_post_reference BEFORE INSERT ON membership_posts
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_post_reference_update BEFORE UPDATE OF group_id ON membership_posts
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_post_upload_reference BEFORE INSERT ON membership_post_uploads
    WHEN NOT EXISTS(SELECT 1 FROM membership_posts p JOIN membership_uploads m ON m.group_id=p.group_id
      WHERE p.id=NEW.post_id AND m.id=NEW.upload_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_post_upload_reference_update BEFORE UPDATE ON membership_post_uploads
    WHEN NOT EXISTS(SELECT 1 FROM membership_posts p JOIN membership_uploads m ON m.group_id=p.group_id
      WHERE p.id=NEW.post_id AND m.id=NEW.upload_id)
    BEGIN SELECT RAISE(ABORT,'Foreign key constraint failed'); END;
  CREATE TRIGGER IF NOT EXISTS membership_courses_cleanup BEFORE DELETE ON courses BEGIN
    DELETE FROM membership_group_courses WHERE course_id=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS membership_users_cleanup BEFORE DELETE ON users BEGIN
    DELETE FROM membership_assignments WHERE user_id=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS membership_groups_cleanup BEFORE DELETE ON membership_groups BEGIN
    DELETE FROM membership_group_courses WHERE group_id=OLD.id;
    DELETE FROM membership_assignments WHERE group_id=OLD.id;
    DELETE FROM membership_posts WHERE group_id=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS membership_posts_cleanup BEFORE DELETE ON membership_posts BEGIN
    DELETE FROM membership_post_uploads WHERE post_id=OLD.id;
  END;
`;
