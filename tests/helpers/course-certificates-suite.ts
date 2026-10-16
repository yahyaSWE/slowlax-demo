import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getDb, createFirstAdmin, createUser, transaction, type User } from "../../src/lib/db";
import { PostgresDatabaseAdapter } from "../../src/lib/postgres-database";
import { pglitePostgres } from "./pglite-postgres";
import { saveCourseActivity, submitQuiz, saveAssignment, reviewAssignment } from "../../src/lib/course-activities";
import { getCourseCertificateSettings, saveCourseCertificateSettings, getCourseCertificateEligibility,
  issueCourseCertificate, getUserCourseCertificates, getCourseCertificateForDownload } from "../../src/lib/course-certificates";

const token = () => randomBytes(12).toString("hex");
const now = () => new Date().toISOString();
export function courseCertificateSuite(provider: "sqlite" | "postgres") {
  for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "SUPABASE_AUTH_ENABLED", "KIT_API_KEY"]) delete process.env[key];
  process.env.SUPABASE_DATABASE_ENABLED = provider === "postgres" ? "true" : "false";
  process.env.DATABASE_URL = "postgres://test:test@localhost/test";
  let directory: string | undefined;
  let admin: User, student: User, other: User, unverified: User;
  before(async () => {
    if (provider === "postgres") {
      const adapter = getDb() as PostgresDatabaseAdapter;
      await pglitePostgres(adapter); await adapter.migrate();
    } else {
      directory = await mkdtemp(join(tmpdir(), "slowlax-diploma-"));
      process.env.TIBB_DATABASE_PATH = join(directory, "certificates.sqlite");
    }
    admin = await createFirstAdmin({ name: "Diploma teacher", email: "teacher@example.test", passwordHash: "fixture" });
    student = await createUser({ name: "Diploma student", email: "student@example.test", role: "student", passwordHash: "fixture" });
    other = await createUser({ name: "Other student", email: "other@example.test", role: "student", passwordHash: "fixture" });
    unverified = await createUser({ name: "Unverified student", email: "unverified@example.test", role: "student", passwordHash: "fixture" });
    await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(now(), student.id, other.id);
  });
  after(async () => {
    await getDb().close();
    if (directory) await rm(directory, {recursive: true, force: true, maxRetries: 12, retryDelay: 200});
  });
  async function courseFixture(lessonCount = 1, owner = student) {
    const stamp = now();
    const id = Number((await getDb().prepare("INSERT INTO courses(title,slug,published,created_at,updated_at) VALUES(?,?,1,?,?)")
      .run(`Certificate course ${token()}`, `certificate-${token()}`, stamp, stamp)).lastInsertRowid);
    const lessons: number[] = [];
    for (let i = 0; i < lessonCount; i++) lessons.push(Number((await getDb().prepare("INSERT INTO lessons(course_id,title,position) VALUES(?,?,?)").run(id, `Lesson ${i+1}`, i+1)).lastInsertRowid));
    await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(owner.id, id, stamp);
    return { id, lessons };
  }
  const enable = async (courseId: number) => saveCourseCertificateSettings(admin.id, courseId, { enabled: true, expectedUpdatedAt: (await getCourseCertificateSettings(courseId)).updatedAt });
  async function mark(courseId: number, lessonIds: number[], userId = student.id) {
    for (const lessonId of lessonIds) await getDb().prepare("INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?) ON CONFLICT(user_id,lesson_id) DO NOTHING").run(userId, lessonId, now());
  }
  const quiz = (courseId: number, lessonId: number, instructions = "First instructions") => ({courseId, lessonId, kind: "quiz" as const, title: "Required quiz", instructions,
    position: 1, active: true, questions: [{ id: "one", prompt: "Choose", options: ["Yes", "No"], correctOption: 0 }], passPercent: 100});
  const assignment = (courseId: number, lessonId: number, instructions = "Explain your answer") => ({courseId, lessonId, kind: "assignment" as const, title: "Required assignment", instructions, position: 2, active: true});

  test(`${provider}: diploma is default-off; settings use admin CAS; GET and invalid eligibility never issue`, async () => {
    const course = await courseFixture(2);
    assert.deepEqual(await getCourseCertificateSettings(course.id), {courseId:course.id, enabled:false, updatedAt:null});
    await getCourseCertificateEligibility(student.id, course.id);
    assert.equal(Number((await getDb().prepare("SELECT COUNT(*) AS total FROM course_certificate_settings").get())?.total), 0);
    assert.equal(Number((await getDb().prepare("SELECT COUNT(*) AS total FROM course_certificates").get())?.total), 0);
    await assert.rejects(saveCourseCertificateSettings(other.id, course.id, {enabled:true,expectedUpdatedAt:null}), /behörighet|administration/);
    await assert.rejects(issueCourseCertificate(student.id, course.id), /inte aktiverat/);
    const results = await Promise.allSettled([enable(course.id), enable(course.id)]);
    assert.equal(results.filter(result=>result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result=>result.status === "rejected").length, 1);
    const setting = await getCourseCertificateSettings(course.id);
    await assert.rejects(saveCourseCertificateSettings(admin.id, course.id, {enabled:false,expectedUpdatedAt:null}), /ändrats/);
    const saved = await saveCourseCertificateSettings(admin.id, course.id, {enabled:true,expectedUpdatedAt:setting.updatedAt});
    assert.ok(saved.updatedAt! > setting.updatedAt!);
    const status = await getCourseCertificateEligibility(student.id, course.id);
    assert.equal(status.reason, "incomplete"); assert.deepEqual(status.lessons, {total:2,completed:0});
    assert.equal((await getCourseCertificateEligibility(other.id, course.id)).reason, "not_available");
    assert.equal((await getCourseCertificateEligibility(admin.id, course.id)).reason, "not_available");
    await assert.rejects(issueCourseCertificate(other.id, course.id), /inte hämta diplom/);
    const notVerified = await courseFixture(1, unverified); await enable(notVerified.id); await mark(notVerified.id, notVerified.lessons, unverified.id);
    await assert.rejects(issueCourseCertificate(unverified.id, notVerified.id), /inte hämta diplom/);
    const empty = await courseFixture(0); await enable(empty.id);
    assert.equal((await getCourseCertificateEligibility(student.id, empty.id)).reason, "no_lessons");
    await assert.rejects(issueCourseCertificate(student.id, empty.id));
    const wrapper = await courseFixture(1); await getDb().prepare("INSERT INTO course_bundles(course_id) VALUES(?)").run(wrapper.id);
    await assert.rejects(enable(wrapper.id), /enskilda kurser/);
    assert.equal((await getCourseCertificateEligibility(student.id, wrapper.id)).reason, "not_available");
  });

  test(`${provider}: all lessons and current active activities are required; issued diploma is atomic and immutable`, async () => {
    const course = await courseFixture(2); await enable(course.id);
    const quizId = await saveCourseActivity(admin.id, quiz(course.id, course.lessons[0]));
    const assignmentId = await saveCourseActivity(admin.id, assignment(course.id, course.lessons[1]));
    await saveCourseActivity(admin.id, {...quiz(course.id, course.lessons[1]), title:"Inactive quiz", active:false});
    await mark(course.id, [course.lessons[0]]);
    assert.equal((await getCourseCertificateEligibility(student.id, course.id)).eligible, false);
    await mark(course.id, [course.lessons[1]]);
    await submitQuiz(student.id, {activityId:quizId,courseId:course.id,lessonId:course.lessons[0],revision:1,answers:[{questionId:"one",optionIndex:0}]});
    await submitQuiz(student.id, {activityId:quizId,courseId:course.id,lessonId:course.lessons[0],revision:1,answers:[{questionId:"one",optionIndex:1}]});
    const submissionInput = {activityId:assignmentId,courseId:course.id,lessonId:course.lessons[1],revision:1,text:"My considered answer",submit:true};
    const first = await saveAssignment(student.id, submissionInput);
    await reviewAssignment(admin.id, {submissionId:first.id,courseId:course.id,lessonId:course.lessons[1],status:"approved",feedback:"Good"});
    assert.equal((await getCourseCertificateEligibility(student.id, course.id)).eligible, true);
    await saveAssignment(student.id, {...submissionInput,text:"New draft",submit:false});
    assert.equal((await getCourseCertificateEligibility(student.id, course.id)).eligible, true);
    const second = await saveAssignment(student.id, {...submissionInput,text:"New submitted answer"});
    assert.equal((await getCourseCertificateEligibility(student.id, course.id)).assignments.approved, 0);
    await reviewAssignment(admin.id, {submissionId:second.id,courseId:course.id,lessonId:course.lessons[1],status:"approved",feedback:"Good again"});
    await saveCourseActivity(admin.id, {...quiz(course.id,course.lessons[0],"New quiz revision"),id:quizId,revision:1});
    assert.equal((await getCourseCertificateEligibility(student.id, course.id)).quizzes.passed, 0);
    await assert.rejects(issueCourseCertificate(student.id, course.id));
    await submitQuiz(student.id, {activityId:quizId,courseId:course.id,lessonId:course.lessons[0],revision:2,answers:[{questionId:"one",optionIndex:0}]});
    await saveCourseActivity(admin.id, {...assignment(course.id,course.lessons[1],"New assignment revision"),id:assignmentId,revision:1});
    assert.equal((await getCourseCertificateEligibility(student.id, course.id)).assignments.approved, 0);
    const final = await saveAssignment(student.id, {...submissionInput,revision:2});
    await reviewAssignment(admin.id, {submissionId:final.id,courseId:course.id,lessonId:course.lessons[1],status:"approved",feedback:"Approved"});
    const ready = await getCourseCertificateEligibility(student.id, course.id);
    assert.equal(ready.eligible,true); assert.deepEqual(ready.quizzes,{total:1,passed:1}); assert.deepEqual(ready.assignments,{total:1,approved:1});
    const certificates = await Promise.all(Array.from({length:8},()=>issueCourseCertificate(student.id,course.id)));
    assert.equal(new Set(certificates.map(certificate=>certificate.id)).size,1);
    assert.ok(certificates.every(certificate=>certificate.issuedAt === certificates[0].issuedAt));
    const issued = certificates[0];
    assert.equal(issued.studentName,"Diploma student"); assert.equal(issued.issuerName,"Slowlax"); assert.ok(issued.completedAt <= issued.issuedAt);
    await getDb().prepare("UPDATE users SET name='Changed name' WHERE id=?").run(student.id);
    await getDb().prepare("UPDATE courses SET title='Changed title',published=0 WHERE id=?").run(course.id);
    await getDb().prepare("DELETE FROM enrollments WHERE user_id=? AND course_id=?").run(student.id,course.id);
    const setting=await getCourseCertificateSettings(course.id); await saveCourseCertificateSettings(admin.id,course.id,{enabled:false,expectedUpdatedAt:setting.updatedAt});
    assert.deepEqual(await issueCourseCertificate(student.id,course.id),issued);
    assert.equal((await getCourseCertificateEligibility(student.id,course.id)).reason,"issued");
    await assert.rejects(getDb().prepare("UPDATE course_certificates SET student_name='Forged' WHERE id=?").run(issued.id),/immutable/);
    await assert.rejects(getDb().prepare("DELETE FROM course_certificates WHERE id=?").run(issued.id),/immutable/);
    await assert.rejects(getDb().prepare("UPDATE course_certificates SET course_id=NULL WHERE id=?").run(issued.id),/immutable/);
    await getDb().prepare("UPDATE users SET name='Diploma student' WHERE id=?").run(student.id);
  });

  test(`${provider}: owners and admins retain historical diploma downloads after course deletion and ID reuse`, async () => {
    const course = await courseFixture(); await enable(course.id); await mark(course.id,course.lessons);
    const issued=await issueCourseCertificate(student.id,course.id);
    assert.deepEqual(await getCourseCertificateForDownload(student.id,issued.id),issued);
    assert.deepEqual(await getCourseCertificateForDownload(admin.id,issued.id),issued);
    assert.equal(await getCourseCertificateForDownload(other.id,issued.id),null);
    assert.equal(await getCourseCertificateForDownload(student.id,"bad-id"),null);
    assert.ok((await getUserCourseCertificates(student.id)).some(certificate=>certificate.id===issued.id));
    assert.ok(!(await getUserCourseCertificates(other.id)).some(certificate=>certificate.id===issued.id));
    await getDb().prepare("DELETE FROM courses WHERE id=?").run(course.id);
    const historical=await getCourseCertificateForDownload(student.id,issued.id);
    assert.deepEqual(historical,{...issued,courseId:null});
    const createdAt="2001-02-03T12:00:00.000Z";
    await getDb().prepare("INSERT INTO courses(id,title,slug,published,created_at,updated_at) VALUES(?,?,?,1,?,?)").run(course.id,"New course with reused ID",`reused-${token()}`,createdAt,createdAt);
    const lessonId=Number((await getDb().prepare("INSERT INTO lessons(course_id,title) VALUES(?,?)").run(course.id,"New lesson")).lastInsertRowid);
    await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(student.id,course.id,now());
    await enable(course.id); await mark(course.id,[lessonId]);
    assert.equal((await getCourseCertificateEligibility(student.id,course.id)).certificate,null);
    const next=await issueCourseCertificate(student.id,course.id);
    assert.notEqual(next.id,issued.id); assert.equal(next.courseTitle,"New course with reused ID");
    assert.deepEqual(await getCourseCertificateForDownload(student.id,issued.id),historical);
  });

  test(`${provider}: completion and settings are rechecked inside issuance; forged inserts cannot bypass gates`, async () => {
    const course=await courseFixture(); await enable(course.id); await mark(course.id,course.lessons);
    assert.equal((await getCourseCertificateEligibility(student.id,course.id)).eligible,true);
    const setting=await getCourseCertificateSettings(course.id);
    const disabled=await Promise.allSettled([
      saveCourseCertificateSettings(admin.id,course.id,{enabled:false,expectedUpdatedAt:setting.updatedAt}),
      issueCourseCertificate(student.id,course.id),
    ]);
    assert.equal(disabled[0].status,"fulfilled"); assert.equal(disabled[1].status,"rejected");
    await enable(course.id);
    const unmarked=await Promise.allSettled([
      transaction(async()=>{await getDb().prepare("DELETE FROM progress WHERE user_id=? AND lesson_id=?").run(student.id,course.lessons[0]);}),
      issueCourseCertificate(student.id,course.id),
    ]);
    assert.equal(unmarked[0].status,"fulfilled"); assert.equal(unmarked[1].status,"rejected");
    const row=(await getDb().prepare("SELECT * FROM courses WHERE id=?").get(course.id))!;
    await assert.rejects(getDb().prepare(`INSERT INTO course_certificates(id,user_id,course_id,course_identity,student_name,course_title,issuer_name,completed_at,issued_at)
      VALUES(?,?,?,?,?,?,'Slowlax',?,?)`).run(token()+"01234567",student.id,course.id,`${course.id}:${row.created_at}`,"Diploma student",String(row.title),now(),now()),/requirements failed/);
    assert.equal(await getDb().prepare("SELECT id FROM course_certificates WHERE user_id=? AND course_id=?").get(student.id,course.id),undefined);
  });

  test(`${provider}: deleting the owning user removes diploma snapshots for privacy`, async () => {
    const owner=await createUser({name:"Privacy student",email:`privacy-${token()}@example.test`,role:"student",passwordHash:"fixture"});
    await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(),owner.id);
    const course=await courseFixture(1,owner); await enable(course.id); await mark(course.id,course.lessons,owner.id);
    const issued=await issueCourseCertificate(owner.id,course.id);
    // Native FK cleanup and explicit HTTP fallback must provide identical privacy.
    if(provider==="sqlite") await getDb().exec("PRAGMA foreign_keys=OFF");
    await getDb().prepare("DELETE FROM users WHERE id=?").run(owner.id);
    if(provider==="sqlite") await getDb().exec("PRAGMA foreign_keys=ON");
    assert.equal(await getCourseCertificateForDownload(admin.id,issued.id),null);
    assert.deepEqual(await getUserCourseCertificates(owner.id),[]);
  });

  test(`${provider}: unsupported diploma glyphs are rejected before immutable issuance and can be corrected`, async () => {
    const owner=await createUser({name:"Ali 🚀",email:`glyph-${token()}@example.test`,role:"student",passwordHash:"fixture"});
    await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(),owner.id);
    const course=await courseFixture(1,owner); await enable(course.id); await mark(course.id,course.lessons,owner.id);
    assert.equal((await getCourseCertificateEligibility(owner.id,course.id)).eligible,true);
    await assert.rejects(issueCourseCertificate(owner.id,course.id));
    assert.equal(await getDb().prepare("SELECT id FROM course_certificates WHERE user_id=? AND course_id=?").get(owner.id,course.id),undefined);
    await getDb().prepare("UPDATE users SET name='Ali' WHERE id=?").run(owner.id);
    const issued=await issueCourseCertificate(owner.id,course.id);
    assert.equal(issued.studentName,"Ali");
    const second=await courseFixture(); await enable(second.id); await mark(second.id,second.lessons);
    await getDb().prepare("UPDATE courses SET title='Course 🚀' WHERE id=?").run(second.id);
    await assert.rejects(issueCourseCertificate(student.id,second.id));
    assert.equal(await getDb().prepare("SELECT id FROM course_certificates WHERE user_id=? AND course_id=?").get(student.id,second.id),undefined);
    await getDb().prepare("UPDATE courses SET title='Supported title' WHERE id=?").run(second.id);
    assert.equal((await issueCourseCertificate(student.id,second.id)).courseTitle,"Supported title");
  });
}
