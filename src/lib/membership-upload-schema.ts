export const MEMBERSHIP_UPLOAD_SCHEMA = `
CREATE TABLE IF NOT EXISTS membership_upload_requests (
  id TEXT PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES membership_groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('image','document')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0 AND size<=20971520 AND (kind!='image' OR size<=2097152)),
  storage_path TEXT NOT NULL UNIQUE,
  storage_provider TEXT NOT NULL CHECK(storage_provider IN ('local','blob')),
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  completing INTEGER NOT NULL DEFAULT 0 CHECK(completing IN (0,1))
);
CREATE INDEX IF NOT EXISTS membership_upload_requests_uploader ON membership_upload_requests(uploader_id,created_at);
CREATE TABLE IF NOT EXISTS membership_uploads (
  id TEXT PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES membership_groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('image','document')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0 AND size<=20971520 AND (kind!='image' OR size<=2097152)),
  storage_path TEXT NOT NULL UNIQUE,
  storage_provider TEXT NOT NULL CHECK(storage_provider IN ('local','blob')),
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS membership_uploads_group ON membership_uploads(group_id);
CREATE TRIGGER IF NOT EXISTS membership_upload_requests_reference BEFORE INSERT ON membership_upload_requests
  WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.uploader_id AND role='admin')
  BEGIN SELECT RAISE(ABORT,'Administrator and group required'); END;
CREATE TRIGGER IF NOT EXISTS membership_uploads_reference BEFORE INSERT ON membership_uploads
  WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id)
    OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.uploader_id AND role='admin')
  BEGIN SELECT RAISE(ABORT,'Administrator and group required'); END;
CREATE TRIGGER IF NOT EXISTS membership_group_uploads_cleanup BEFORE DELETE ON membership_groups BEGIN
  DELETE FROM membership_upload_requests WHERE group_id=OLD.id;
  DELETE FROM membership_uploads WHERE group_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS membership_uploads_cleanup BEFORE DELETE ON membership_uploads BEGIN
  DELETE FROM membership_post_uploads WHERE upload_id=OLD.id;
END;
`;
