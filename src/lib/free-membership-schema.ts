/** Bas is a free, live membership source, independent of paid contracts. */
export const FREE_MEMBERSHIP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS free_membership_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    description TEXT NOT NULL DEFAULT 'Nyhetsbrev och communityuppdateringar från Slowlax.',
    updated_at TEXT NOT NULL
  );
  INSERT INTO free_membership_settings(id,updated_at) VALUES(1,'1970-01-01T00:00:00.000Z') ON CONFLICT(id) DO NOTHING;
  CREATE TABLE IF NOT EXISTS free_membership_groups (
    group_id INTEGER PRIMARY KEY REFERENCES membership_groups(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS free_membership_members (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS free_membership_group_reference BEFORE INSERT ON free_membership_groups
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id AND published=1)
    BEGIN SELECT RAISE(ABORT,'Published group required for free membership'); END;
  CREATE TRIGGER IF NOT EXISTS free_membership_group_reference_update BEFORE UPDATE OF group_id ON free_membership_groups
    WHEN NOT EXISTS(SELECT 1 FROM membership_groups WHERE id=NEW.group_id AND published=1)
    BEGIN SELECT RAISE(ABORT,'Published group required for free membership'); END;
  CREATE TRIGGER IF NOT EXISTS free_membership_member_reference BEFORE INSERT ON free_membership_members
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student')
    BEGIN SELECT RAISE(ABORT,'Student required for free membership'); END;
  CREATE TRIGGER IF NOT EXISTS free_membership_member_immutable BEFORE UPDATE ON free_membership_members
    BEGIN SELECT RAISE(ABORT,'Free membership identity is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS users_free_membership_cleanup AFTER DELETE ON users BEGIN
    DELETE FROM free_membership_members WHERE user_id=OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS groups_free_membership_cleanup AFTER DELETE ON membership_groups BEGIN
    DELETE FROM free_membership_groups WHERE group_id=OLD.id;
  END;
`;
