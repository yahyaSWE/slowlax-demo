import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { DatabaseAdapter, getDb } from "../src/lib/database";
import { SCHEMA, SCHEMA_VERSION } from "../src/lib/schema";
import { getStudentLessonActivities, saveAssignment, saveCourseActivity, submitQuiz } from "../src/lib/course-activities";

const directory = mkdtempSync(join(tmpdir(), "tibb-activity-migration-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.TIBB_DATABASE_PATH = join(directory, "legacy.sqlite");
const date = "2025-10-01T10:00:00.000Z";
let history: Record<string, unknown>[][];
const historyQueries = [
  "SELECT * FROM users ORDER BY id", "SELECT * FROM courses ORDER BY id", "SELECT * FROM lessons ORDER BY id",
  "SELECT * FROM enrollments ORDER BY id", "SELECT * FROM progress ORDER BY user_id,lesson_id",
];

before(async () => {
  const legacy = createClient({ url: pathToFileURL(process.env.TIBB_DATABASE_PATH!).href, intMode: "number" });
  try {
    // SCHEMA remains the established tables; activities are a separate additive
    // migration executed by DatabaseAdapter for version 3.
    await legacy.executeMultiple(SCHEMA);
    for (const [id, role] of [[40, "admin"], [41, "student"]] as const) {
      await legacy.execute({ sql: "INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)",
        args: [id, `${role}@migration.example.test`, `Existing ${role}`, "local-migration-fixture-hash", role, date] });
    }
    await legacy.execute({ sql: "INSERT INTO courses(id,title,slug,description,price_ore,published,created_at,updated_at) VALUES(42,?,?,?,?,1,?,?)",
      args: ["Existing course", "existing-course", "Original course content", 12300, date, date] });
    await legacy.execute({ sql: "INSERT INTO lessons(id,course_id,title,body,video_url,position) VALUES(43,42,?,?,?,1)",
      args: ["Existing lesson", "Original lesson body", "https://youtu.be/GqLEKNelpDo"] });
    await legacy.execute({ sql: "INSERT INTO enrollments(id,user_id,course_id,created_at) VALUES(44,41,42,?)", args: [date] });
    await legacy.execute({ sql: "INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(41,43,?)", args: [date] });
    await legacy.executeMultiple("INSERT INTO app_meta(key,value) VALUES('seeded','1'),('schema_version','2'),('import-preservation','legacy-course-id:42'); PRAGMA user_version=2;");
    history = [];
    for (const query of historyQueries) history.push((await legacy.execute(query)).rows as Record<string, unknown>[]);
  } finally { legacy.close(); }
});

after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("tibb-activity-migration-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 });
});

test("version 2 migration preserves courses, lesson IDs, enrollments, progress and source markers unchanged", async () => {
  await getDb().initialize();
  for (const [index, query] of historyQueries.entries()) assert.deepEqual(await getDb().prepare(query).all(), index === 0 ? history[index].map((row) => ({ ...row, email_verified_at: null, supabase_id: null })) : history[index]);
  assert.equal((await getDb().prepare("SELECT value FROM app_meta WHERE key='import-preservation'").get())!.value, "legacy-course-id:42");
  assert.equal(Number((await getDb().prepare("PRAGMA user_version").get())!.user_version), SCHEMA_VERSION);
  assert.equal((await getDb().prepare("SELECT value FROM app_meta WHERE key='schema_version'").get())!.value, String(SCHEMA_VERSION));
  for (const table of ["course_activities", "activity_revisions", "quiz_attempts", "assignment_submissions"]) {
    assert.equal(Number((await getDb().prepare(`SELECT COUNT(*) AS total FROM ${table}`).get())!.total), 0);
  }
});

test("migrated lessons accept activities and a fresh adapter's current-schema fast path retains them", async () => {
  const activityId = await saveCourseActivity(40, { courseId: 42, lessonId: 43, kind: "quiz", title: "Migrated quiz",
    instructions: "Existing students may answer", active: true, position: 1, passPercent: 100,
    questions: [{ id: "one", prompt: "One question", options: ["Yes", "No"], correctOption: 0 }] });
  const activity = (await getStudentLessonActivities(41, 42, 43))[0];
  assert.equal(activity.id, activityId);
  assert.equal(Object.hasOwn(activity.questions[0], "correctOption"), false);
  const attempt = await submitQuiz(41, { courseId: 42, lessonId: 43, activityId, revision: 1, answers: [{ questionId: "one", optionIndex: 0 }] });
  assert.equal(attempt.passed, true);
  const fresh = new DatabaseAdapter();
  try {
    await fresh.initialize();
    assert.equal(Number((await fresh.prepare("SELECT COUNT(*) AS total FROM quiz_attempts").get())!.total), 1);
    assert.deepEqual(await fresh.prepare(historyQueries[4]).all(), history[4]);
  } finally { await fresh.close(); }
});

test("explicit course deletion cleans activity history even with connection foreign keys disabled", async () => {
  const activityId = await saveCourseActivity(40, { courseId: 42, lessonId: 43, kind: "assignment", title: "Written assignment",
    instructions: "Describe your reflection", active: true, position: 2 });
  await saveAssignment(41, { courseId: 42, lessonId: 43, activityId, revision: 1, text: "Submitted reflection", submit: true });
  await getDb().exec("PRAGMA foreign_keys=OFF");
  await getDb().prepare("DELETE FROM courses WHERE id=42").run();
  for (const table of ["lessons", "enrollments", "progress", "course_activities", "activity_revisions", "quiz_attempts", "assignment_submissions"]) {
    assert.equal(Number((await getDb().prepare(`SELECT COUNT(*) AS total FROM ${table}`).get())!.total), 0, table);
  }
});
