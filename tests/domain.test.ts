import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  createFirstAdmin,
  createUser,
  getArticles,
  getBookingByReference,
  getBookings,
  getCourseProgress,
  getCourses,
  getDb,
  getLessons,
  getSessionUser,
  getSlots,
  getStudentCourses,
  getTreatments,
  hasCourseAccess,
  reserveBooking,
  cancelPendingBooking,
  attachCheckout,
  completeStripeBooking,
  expireBookings,
  refundStripeBooking,
  rateLimit,
  type User,
} from "../src/lib/db";
import {
  archiveTreatment,
  assertAdmin,
  deleteSlot,
  enrollStudent,
  markLesson,
  removeEnrollment,
  saveArticle,
  saveCourse,
  saveLesson,
  saveSlot,
  saveTreatment,
  updateBooking,
} from "../src/lib/admin";
import {
  hashPassword,
  randomToken,
  tokenHash,
  verifyPassword,
} from "../src/lib/security";
import { stockholmToIso, localDateTime } from "../src/lib/time";
import { registerStudent } from "../src/lib/accounts";
import { transaction } from "../src/lib/db";
const temp = mkdtempSync(join(tmpdir(), "tibb-tests-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.TIBB_DATABASE_PATH = join(temp, "tibb.sqlite");
let admin: User, student: User, other: User;
before(async () => {
  getDb();
  admin = await createFirstAdmin({
    name: "Test Admin",
    email: "admin@example.test",
    passwordHash: hashPassword("correct horse battery staple"),
  });
  student = await createUser({
    name: "Test Student",
    email: "student@example.test",
    passwordHash: hashPassword("student long password"),
    role: "student",
  });
  other = await createUser({
    name: "Other Student",
    email: "other@example.test",
    passwordHash: hashPassword("other long password"),
    role: "student",
  });
  // Legacy database helpers are tested with explicit fixtures; the Slowlax
  // website no longer seeds any booking practitioners or sample courses.
  await getDb().prepare("INSERT INTO practitioners(id,name,description,active) VALUES(1,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=1")
    .run("Isolated fixture practitioner", "Internal database test only");
  await getDb().prepare("UPDATE settings SET pay_on_site=1,stripe_enabled=1 WHERE id=1").run();
  await saveCourse(admin.id, {
    title: "Isolated fixture course", slug: "isolated-fixture-course", description: "Test only", price: "0", published: false,
  });
  const courseId = (await getCourses()).find(course => course.slug === "isolated-fixture-course")!.id;
  await saveLesson(admin.id, { courseId, title: "Isolated fixture lesson", body: "Test only", videoUrl: "", materialUrl: "", position: 1 });
  // Ownership is explicit in this isolated fixture; real signup stays unverified.
  await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)")
    .run(new Date().toISOString(), student.id, other.id);
});
after(async () => {
  await getDb().close();
  const expected = resolve(tmpdir());
  assert.equal(dirname(resolve(temp)), expected);
  assert.equal(basename(temp).startsWith("tibb-tests-"), true);
  await rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});
test("async transactions roll back every mutation across awaited operations", async () => {
  await assert.rejects(
    transaction(async () => {
      await getDb()
        .prepare("INSERT INTO app_meta(key,value) VALUES(?,?)")
        .run("rollback-first", "first");
      await Promise.resolve();
      await getDb()
        .prepare("INSERT INTO app_meta(key,value) VALUES(?,?)")
        .run("rollback-second", "second");
      throw new Error("rollback-test");
    }),
    /rollback-test/,
  );
  assert.equal(
    await getDb()
      .prepare("SELECT value FROM app_meta WHERE key=?")
      .get("rollback-first"),
    undefined,
  );
  assert.equal(
    await getDb()
      .prepare("SELECT value FROM app_meta WHERE key=?")
      .get("rollback-second"),
    undefined,
  );
});
test("a concurrent local request cannot read an unfinished write transaction", async () => {
  let signalStarted!: () => void;
  let finishWrite!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    signalStarted = resolveStarted;
  });
  const released = new Promise<void>((resolveReleased) => {
    finishWrite = resolveReleased;
  });
  const writing = transaction(async () => {
    await getDb()
      .prepare("INSERT INTO app_meta(key,value) VALUES(?,?)")
      .run("async-isolation", "committed");
    signalStarted();
    await released;
  });
  await started;
  const reading = getDb()
    .prepare("SELECT value FROM app_meta WHERE key=?")
    .get("async-isolation");
  finishWrite();
  await writing;
  assert.equal((await reading)?.value, "committed");
});
test("concurrent treatment duration edits and new slots keep matching durations", async () => {
  for (const [index, order] of ["edit-first", "slot-first"].entries()) {
    const treatment = await activeTreatment(`Duration race ${order}`, 60);
    const edit = () =>
      saveTreatment(admin.id, {
        id: treatment.id,
        name: treatment.name,
        description: "Test",
        durationMinutes: 45,
        price: "850,50",
        active: true,
      });
    const addSlot = () =>
      saveSlot(admin.id, treatment.id, futureLocal(8 + index));
    const results = await Promise.allSettled(
      order === "edit-first" ? [edit(), addSlot()] : [addSlot(), edit()],
    );
    const slotResult = results[order === "edit-first" ? 1 : 0];
    const editResult = results[order === "edit-first" ? 0 : 1];
    assert.equal(slotResult.status, "fulfilled");
    const slot = (await getSlots()).find(
      (value) => value.id === Number(slotResult.value),
    )!;
    const current = (await getTreatments()).find(
      (value) => value.id === treatment.id,
    )!;
    assert.equal(
      (Date.parse(slot.end) - Date.parse(slot.start)) / 60_000,
      current.durationMinutes,
    );
    if (editResult.status === "rejected")
      assert.match(String(editResult.reason), /längd/);
    else assert.equal(current.durationMinutes, 45);
  }
});
test("relationship triggers clean lesson, enrollment and progress rows when foreign keys are off", async () => {
  await saveCourse(admin.id, {
    title: "Cascade test",
    slug: "cascade-test",
    description: "",
    price: "0",
    published: false,
  });
  const course = (await getCourses()).find(
    (value) => value.slug === "cascade-test",
  )!;
  await saveLesson(admin.id, {
    courseId: course.id,
    title: "Cascade lesson",
    body: "Test",
    videoUrl: "",
    materialUrl: "",
    position: 1,
  });
  const lesson = (await getLessons(course.id))[0];
  await saveCourse(admin.id, {
    id: course.id,
    title: course.title,
    slug: course.slug,
    description: "",
    price: "0",
    published: true,
  });
  await enrollStudent(admin.id, course.id, student.email);
  await markLesson(student.id, lesson.id, true);
  await getDb().exec("PRAGMA foreign_keys=OFF");
  try {
    await getDb().prepare("DELETE FROM courses WHERE id=?").run(course.id);
  } finally {
    await getDb().exec("PRAGMA foreign_keys=ON");
  }
  assert.equal(
    await getDb().prepare("SELECT id FROM lessons WHERE id=?").get(lesson.id),
    undefined,
  );
  assert.equal(
    await getDb()
      .prepare("SELECT id FROM enrollments WHERE course_id=?")
      .get(course.id),
    undefined,
  );
  assert.equal(
    await getDb()
      .prepare("SELECT lesson_id FROM progress WHERE lesson_id=?")
      .get(lesson.id),
    undefined,
  );
});
async function activeTreatment(name = "Consultation", duration = 60) {
  await saveTreatment(admin.id, {
    name,
    description: "Test treatment",
    durationMinutes: duration,
    price: "850,50",
    active: true,
  });
  return (await getTreatments()).at(-1)!;
}
function futureLocal(days: number, hour = 10) {
  const date = new Date(Date.now() + days * 86400000);
  return (
    localDateTime(date.toISOString()).slice(0, 10) +
    `T${String(hour).padStart(2, "0")}:00`
  );
}
function worker(slotId: number) {
  return new Promise<{
    ok: boolean;
    id?: number;
    message?: string;
  }>((resolveWorker, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        join(process.cwd(), "scripts/booking-worker.ts"),
        String(slotId),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TIBB_DATABASE_PATH: join(temp, "tibb.sqlite"),
        },
        windowsHide: true,
      },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (chunk) => (out += String(chunk)));
    child.stderr.on("data", (chunk) => (err += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(err));
      else {
        try {
          resolveWorker(JSON.parse(out));
        } catch {
          reject(new Error(out + err));
        }
      }
    });
  });
}
test("password hashes are salted; sessions expire and raw tokens are not stored", async () => {
  const password = "a sufficiently long password";
  const a = hashPassword(password),
    b = hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(verifyPassword(password, a), true);
  assert.equal(verifyPassword("wrong", a), false);
  const token = randomToken();
  await getDb()
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    )
    .run(
      tokenHash(token),
      student.id,
      new Date(Date.now() + 60000).toISOString(),
    );
  assert.equal((await getSessionUser(tokenHash(token)))?.id, student.id);
  assert.equal(await getSessionUser(token), undefined);
  await getDb()
    .prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?")
    .run(new Date(Date.now() - 1000).toISOString(), tokenHash(token));
  assert.equal(await getSessionUser(tokenHash(token)), undefined);
});
test("student cannot mutate administration or create a second administrator", async () => {
  await assert.rejects(async () => await assertAdmin(student.id), /behörighet/);
  await assert.rejects(
    async () =>
      await saveTreatment(student.id, {
        name: "Forbidden",
        description: "",
        durationMinutes: 60,
        price: "1",
        active: true,
      }),
    /behörighet/,
  );
  await assert.rejects(
    async () =>
      await createFirstAdmin({
        name: "Other",
        email: "admin2@example.test",
        passwordHash: hashPassword("long password for test"),
      }),
    /redan/,
  );
});
test("signup validates on server and ignores attempted administrator role escalation", async () => {
  await assert.rejects(
    async () =>
      await registerStudent({
        name: "New Student",
        email: "not-email",
        password: "long enough password",
      }),
    /e-post/,
  );
  await assert.rejects(
    async () =>
      await registerStudent({
        name: "New Student",
        email: "signup@example.test",
        password: "short",
      }),
    /12 tecken/,
  );
  const account = await registerStudent({
    name: "New Student",
    email: "signup@example.test",
    password: "a sufficiently long password",
    role: "admin",
  });
  assert.equal(account.role, "student");
  await assert.rejects(async () => await assertAdmin(account.id), /behörighet/);
  await assert.rejects(
    async () =>
      await registerStudent({
        name: "Duplicate",
        email: "SIGNUP@example.test",
        password: "a sufficiently long password",
      }),
    /redan/,
  );
});
test("editing a lesson cannot move or overwrite a lesson in another course", async () => {
  const courses = await getCourses();
  const first = courses.find(course => course.slug === "isolated-fixture-course")!;
  const lesson = (await getLessons(first.id))[0];
  await saveCourse(admin.id, {
    title: "Other course",
    slug: "foreign-course",
    description: "",
    price: "0",
    published: false,
  });
  const foreign = (await getCourses()).find(
    (value) => value.slug === "foreign-course",
  )!;
  await assert.rejects(
    async () =>
      await saveLesson(admin.id, {
        id: lesson.id,
        courseId: foreign.id,
        title: "Tampered",
        body: "Overwrite attempt",
        videoUrl: "",
        materialUrl: "",
        position: 1,
      }),
    /tillhör inte/,
  );
  assert.notEqual((await getLessons(first.id))[0].title, "Tampered");
});
test("real separate processes cannot double-book the same slot", async () => {
  const treatment = await activeTreatment();
  const slotId = await saveSlot(admin.id, treatment.id, futureLocal(1));
  const attempts = await Promise.all([worker(slotId), worker(slotId)]);
  assert.equal(attempts.filter((result) => result.ok).length, 1);
  assert.equal(attempts.filter((result) => !result.ok).length, 1);
  assert.match(
    attempts.find((result) => !result.ok)?.message || "",
    /bokas|tillgänglig/,
  );
  assert.equal(
    (await getBookings()).filter(
      (booking) => booking.slotId === slotId && booking.status === "confirmed",
    ).length,
    1,
  );
  assert.equal(
    (await getSlots()).find((slot) => slot.id === slotId)?.booked,
    true,
  );
  await assert.rejects(
    async () => await deleteSlot(admin.id, slotId),
    /bokad tid/,
  );
});
test("availability rejects overlap; snapshot price survives edits; cancellation releases a slot", async () => {
  const treatment = await activeTreatment("Follow-up", 45);
  const start = futureLocal(2);
  const slotId = await saveSlot(admin.id, treatment.id, start);
  await assert.rejects(
    async () =>
      await saveSlot(admin.id, treatment.id, start.slice(0, 11) + "10:15"),
    /överlappar/,
  );
  const booking = await reserveBooking({
    slotId,
    name: "Booking Person",
    email: "person@example.test",
    phone: "",
    paymentMethod: "onsite",
  });
  assert.equal(booking.priceOre, 85050);
  await saveTreatment(admin.id, {
    id: treatment.id,
    name: "Changed",
    description: "",
    durationMinutes: 45,
    price: "900",
    active: true,
  });
  assert.equal(
    (await getBookingByReference(booking.reference))?.treatmentName,
    "Follow-up",
  );
  assert.equal(
    (await getBookingByReference(booking.reference))?.priceOre,
    85050,
  );
  await assert.rejects(
    async () =>
      await saveTreatment(admin.id, {
        id: treatment.id,
        name: "Changed",
        description: "",
        durationMinutes: 60,
        price: "900",
        active: true,
      }),
    /längd/,
  );
  await updateBooking(admin.id, booking.id, "cancelled", "pending");
  const next = await reserveBooking({
    slotId,
    name: "Second Person",
    email: "second@example.test",
    phone: "",
    paymentMethod: "onsite",
  });
  assert.equal(next.priceOre, 90000);
  await assert.rejects(
    async () =>
      await updateBooking(admin.id, booking.id, "confirmed", "pending"),
    /återaktiveras/,
  );
  await archiveTreatment(admin.id, treatment.id);
  assert.equal(
    (await getTreatments({ activeOnly: true })).some(
      (item) => item.id === treatment.id,
    ),
    false,
  );
});
test("draft content stays private; enrollments and lesson progress enforce access", async () => {
  await saveArticle(admin.id, {
    title: "Draft article",
    slug: "draft-test",
    excerpt: "",
    body: "Private draft",
    published: false,
  });
  assert.equal(
    (await getArticles({ publishedOnly: true })).some(
      (article) => article.slug === "draft-test",
    ),
    false,
  );
  await saveCourse(admin.id, {
    title: "Access course",
    slug: "access-test",
    description: "",
    price: "0",
    published: false,
  });
  const course = (await getCourses()).find(
    (course) => course.slug === "access-test",
  )!;
  await assert.rejects(
    async () =>
      await saveCourse(admin.id, {
        id: course.id,
        title: course.title,
        slug: course.slug,
        description: "",
        price: "0",
        published: true,
      }),
    /lektion/,
  );
  await assert.rejects(
    async () =>
      await saveLesson(admin.id, {
        courseId: course.id,
        title: "Empty",
        body: "",
        videoUrl: "",
        materialUrl: "",
        position: 1,
      }),
    /text/,
  );
  await saveLesson(admin.id, {
    courseId: course.id,
    title: "Lesson",
    body: "Lesson body",
    videoUrl: "",
    materialUrl: "",
    position: 1,
  });
  const lesson = (await getLessons(course.id))[0];
  await enrollStudent(admin.id, course.id, student.email);
  assert.equal(await hasCourseAccess(student.id, course.id), false);
  assert.equal(
    (await getStudentCourses(student.id)).some(
      (value) => value.id === course.id,
    ),
    false,
  );
  await saveCourse(admin.id, {
    id: course.id,
    title: course.title,
    slug: course.slug,
    description: "",
    price: "0",
    published: true,
  });
  assert.equal(await hasCourseAccess(student.id, course.id), true);
  assert.equal(await hasCourseAccess(other.id, course.id), false);
  await assert.rejects(
    async () => await markLesson(other.id, lesson.id, true),
    /tillgång/,
  );
  await markLesson(student.id, lesson.id, true);
  assert.deepEqual(await getCourseProgress(student.id, course.id), [lesson.id]);
  const enrollment = (await getDb()
    .prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=?")
    .get(student.id, course.id))!;
  await removeEnrollment(admin.id, Number(enrollment.id));
  assert.equal(await hasCourseAccess(student.id, course.id), false);
  assert.deepEqual(await getCourseProgress(student.id, course.id), [lesson.id]);
  await assert.rejects(
    async () => await markLesson(student.id, lesson.id, false),
    /tillgång/,
  );
  await assert.rejects(
    async () => await enrollStudent(admin.id, course.id, "new@example.test"),
    /skapa ett konto/,
  );
  await assert.rejects(
    async () =>
      await saveLesson(admin.id, {
        courseId: course.id,
        title: "Bad link",
        body: "Text",
        videoUrl: "javascript:alert(1)",
        materialUrl: "",
        position: 2,
      }),
    /https/,
  );
});
test("Stripe bookings cannot be manually marked paid, verify amount and expire safely", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_domain";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_domain";
  process.env.APP_URL = "http://localhost:3000";
  await getDb().prepare("UPDATE settings SET stripe_enabled=1").run();
  const treatment = await activeTreatment("Card visit");
  const slotId = await saveSlot(admin.id, treatment.id, futureLocal(3));
  const booking = await reserveBooking({
    slotId,
    name: "Card Person",
    email: "card@example.test",
    phone: "",
    paymentMethod: "stripe",
  });
  await attachCheckout(booking.reference, "cs_test_domain");
  await assert.rejects(
    async () => await updateBooking(admin.id, booking.id, "confirmed", "paid"),
    /Stripe/,
  );
  await assert.rejects(
    async () => await completeStripeBooking("cs_test_domain", 1, "sek"),
    /matchar/,
  );
  assert.equal(
    (await getBookingByReference(booking.reference))?.paymentStatus,
    "pending",
  );
  await completeStripeBooking("cs_test_domain", booking.priceOre, "sek");
  await completeStripeBooking("cs_test_domain", booking.priceOre, "sek");
  assert.equal(
    (await getBookingByReference(booking.reference))?.paymentStatus,
    "paid",
  );
  assert.equal(
    (await getBookingByReference(booking.reference))?.status,
    "confirmed",
  );
  const expiringSlot = await saveSlot(admin.id, treatment.id, futureLocal(4));
  const expiring = await reserveBooking({
    slotId: expiringSlot,
    name: "Expired Person",
    email: "expired@example.test",
    phone: "",
    paymentMethod: "stripe",
  });
  await getDb()
    .prepare("UPDATE bookings SET expires_at=? WHERE id=?")
    .run(new Date(Date.now() - 1000).toISOString(), expiring.id);
  await expireBookings();
  assert.equal(
    (await getBookingByReference(expiring.reference))?.status,
    "cancelled",
  );
  assert.equal(
    (await getSlots()).find((slot) => slot.id === expiringSlot)?.booked,
    false,
  );
  await cancelPendingBooking(booking.reference);
  assert.equal(
    (await getBookingByReference(booking.reference))?.status,
    "confirmed",
  );
});
test("Stockholm conversion handles daylight saving and rate limiting caps requests", async () => {
  assert.equal(stockholmToIso("2027-01-12T10:00"), "2027-01-12T09:00:00.000Z");
  assert.equal(stockholmToIso("2027-07-12T10:00"), "2027-07-12T08:00:00.000Z");
  assert.throws(() => stockholmToIso("2027-03-28T02:30"), /finns inte/);
  assert.equal(await rateLimit("test-key", 2, 15), true);
  assert.equal(await rateLimit("test-key", 2, 15), true);
  assert.equal(await rateLimit("test-key", 2, 15), false);
});
test("delayed verified payment never reclaims an expired slot or marks refund before success", async () => {
  const treatment = await activeTreatment("Delayed payment");
  const slotId = await saveSlot(admin.id, treatment.id, futureLocal(5));
  const expired = await reserveBooking({
    slotId,
    name: "Delayed Person",
    email: "late@example.test",
    phone: "",
    paymentMethod: "stripe",
  });
  await attachCheckout(expired.reference, "cs_test_late");
  await getDb()
    .prepare("UPDATE bookings SET expires_at=? WHERE id=?")
    .run(new Date(Date.now() - 1000).toISOString(), expired.id);
  await expireBookings();
  const next = await reserveBooking({
    slotId,
    name: "Next Visitor",
    email: "next@example.test",
    phone: "",
    paymentMethod: "onsite",
  });
  assert.equal(
    await completeStripeBooking("cs_test_late", expired.priceOre, "sek"),
    "needs-refund",
  );
  assert.equal(
    (await getBookingByReference(expired.reference))?.paymentStatus,
    "pending",
  );
  assert.equal(
    (await getBookingByReference(expired.reference))?.status,
    "cancelled",
  );
  assert.equal(
    (await getBookingByReference(next.reference))?.status,
    "confirmed",
  );
  assert.equal(
    await completeStripeBooking("cs_test_late", expired.priceOre, "sek"),
    "needs-refund",
  );
  await refundStripeBooking("cs_test_late");
  assert.equal(
    (await getBookingByReference(expired.reference))?.paymentStatus,
    "refunded",
  );
  assert.equal(
    await completeStripeBooking("cs_test_late", expired.priceOre, "sek"),
    "already-refunded",
  );
  assert.equal(
    (await getBookingByReference(next.reference))?.status,
    "confirmed",
  );
});
