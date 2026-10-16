import { randomBytes } from "node:crypto";
import { queueBookingEmails } from "./email-outbox";
import { membershipCourseAccessSql } from "./membership-access";
import { coursePurchaseAccessSql } from "./course-purchase-access";
import type {
  Article,
  Booking,
  Course,
  Enrollment,
  Lesson,
  Practitioner,
  Settings,
  Slot,
  Treatment,
  User,
  UploadedMaterial,
  UploadRecord,
} from "./types";
export type {
  Article,
  Booking,
  Course,
  Enrollment,
  Lesson,
  Practitioner,
  Settings,
  Slot,
  Treatment,
  User,
  UploadedMaterial,
  UploadRecord,
  UploadKind,
} from "./types";
export class DomainError extends Error {}
export {
  getAvailabilitySchedules,
  getAvailabilityBlocks,
} from "./availability";
export type {
  AvailabilitySchedule,
  AvailabilityBlock,
  AvailabilityBreak,
  AvailabilityScheduleInput,
  AvailabilityBlockInput,
} from "./types";
import { getDb, transaction } from "./database";
export {
  getDb,
  transaction,
  databaseConfigured,
  initializeDatabase,
} from "./database";
type Row = Record<string, unknown>;
const integer = (value: unknown) => Number(value);
const str = (value: unknown) => String(value ?? "");
function treatment(row: Row): Treatment {
  return {
    id: integer(row.id),
    name: str(row.name),
    description: str(row.description),
    durationMinutes: integer(row.duration_minutes),
    priceOre: integer(row.price_ore),
    active: !!row.active,
  };
}
function practitioner(row: Row): Practitioner {
  const photo = row.upload_id
    ? uploadedMaterial({
        id: row.upload_id,
        filename: row.upload_filename,
        content_type: row.upload_content_type,
        size: row.upload_size,
      })
    : null;
  return {
    id: integer(row.id),
    name: str(row.name),
    description: str(row.description),
    active: !!row.active,
    photoUrl: photo?.url ?? null,
    photo,
  };
}
function uploadedMaterial(row: Row): UploadedMaterial {
  const id = str(row.id);
  return {
    id,
    name: str(row.filename),
    contentType: str(row.content_type),
    size: integer(row.size),
    url: `/api/uploads/${id}`,
  };
}
const PRACTITIONER_SELECT =
  "SELECT p.*,u.id AS upload_id,u.filename AS upload_filename,u.content_type AS upload_content_type,u.size AS upload_size FROM practitioners p LEFT JOIN uploads u ON u.id=p.photo_upload_id AND u.kind='practitioner-photo'";
function user(row: Row): User {
  return {
    id: integer(row.id),
    email: str(row.email),
    name: str(row.name),
    role: row.role as User["role"],
    createdAt: str(row.created_at),
    emailVerifiedAt: row.email_verified_at ? str(row.email_verified_at) : null,
  };
}
function article(row: Row): Article {
  return {
    id: integer(row.id),
    title: str(row.title),
    slug: str(row.slug),
    excerpt: str(row.excerpt),
    body: str(row.body),
    published: !!row.published,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}
function course(row: Row): Course {
  return {
    id: integer(row.id),
    title: str(row.title),
    slug: str(row.slug),
    description: str(row.description),
    priceOre: integer(row.price_ore),
    published: !!row.published,
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}
function lesson(row: Row, materials: UploadedMaterial[] = []): Lesson {
  return {
    id: integer(row.id),
    courseId: integer(row.course_id),
    title: str(row.title),
    body: str(row.body),
    videoUrl: str(row.video_url),
    materialUrl: str(row.material_url),
    materials,
    position: integer(row.position),
  };
}
function booking(row: Row): Booking {
  return {
    id: integer(row.id),
    reference: str(row.reference),
    treatmentId: integer(row.treatment_id),
    slotId: integer(row.slot_id),
    treatmentName: str(row.treatment_name),
    practitionerId: integer(row.practitioner_id),
    practitionerName: str(row.practitioner_name),
    durationMinutes: integer(row.duration_minutes),
    priceOre: integer(row.price_ore),
    start: str(row.start),
    end: str(row.end),
    name: str(row.name),
    email: str(row.email),
    phone: str(row.phone),
    status: row.status as Booking["status"],
    paymentMethod: row.payment_method as Booking["paymentMethod"],
    paymentStatus: row.payment_status as Booking["paymentStatus"],
    checkoutSessionId: row.checkout_session_id
      ? str(row.checkout_session_id)
      : null,
    expiresAt: row.expires_at ? str(row.expires_at) : null,
    createdAt: str(row.created_at),
  };
}
export async function getTreatments(
  options: {
    activeOnly?: boolean;
  } = {},
) {
  return (
    await getDb()
      .prepare(
        `SELECT * FROM treatments ${options.activeOnly ? "WHERE active=1" : ""} ORDER BY id`,
      )
      .all()
  ).map((row) => treatment(row));
}
export async function getPractitioners(
  options: { activeOnly?: boolean } = {},
): Promise<Practitioner[]> {
  return (
    await getDb()
      .prepare(
        `${PRACTITIONER_SELECT} ${options.activeOnly ? "WHERE p.active=1" : ""} ORDER BY p.id`,
      )
      .all()
  ).map(practitioner);
}
export async function getPractitioner(
  id: number,
): Promise<Practitioner | undefined> {
  const row = await getDb()
    .prepare(`${PRACTITIONER_SELECT} WHERE p.id=?`)
    .get(id);
  return row ? practitioner(row) : undefined;
}
export async function getTreatment(id: number) {
  const row = await getDb()
    .prepare("SELECT * FROM treatments WHERE id=?")
    .get(id);
  return row ? treatment(row) : undefined;
}
export async function expireBookings() {
  await getDb()
    .prepare(
      "UPDATE bookings SET status='cancelled' WHERE status='pending' AND payment_method='stripe' AND expires_at<=?",
    )
    .run(new Date().toISOString());
}
export async function getSlots(
  options: {
    futureOnly?: boolean;
    treatmentId?: number;
    practitionerId?: number;
    includeBlocked?: boolean;
  } = {},
) {
  await expireBookings();
  const conditions: string[] = ["s.archived=0"];
  if (!options.includeBlocked)
    conditions.push(
      "NOT EXISTS(SELECT 1 FROM availability_blocks a WHERE (a.practitioner_id IS NULL OR a.practitioner_id=s.practitioner_id) AND a.start<s.end AND a.end>s.start)",
    );
  const values: (string | number)[] = [];
  if (options.futureOnly) {
    conditions.push("s.start>?");
    values.push(new Date().toISOString());
  }
  if (options.treatmentId) {
    conditions.push("s.treatment_id=?");
    values.push(options.treatmentId);
  }
  if (options.practitionerId !== undefined) {
    conditions.push("s.practitioner_id=?");
    values.push(options.practitionerId);
  }
  return (
    await getDb()
      .prepare(
        `SELECT s.*,t.name AS treatment_name,p.name AS practitioner_name, EXISTS(SELECT 1 FROM bookings b WHERE b.practitioner_id=s.practitioner_id AND b.status IN ('pending','confirmed','completed') AND b.start<s.end AND b.end>s.start) AS booked, EXISTS(SELECT 1 FROM availability_blocks a WHERE (a.practitioner_id IS NULL OR a.practitioner_id=s.practitioner_id) AND a.start<s.end AND a.end>s.start) AS blocked FROM slots s JOIN treatments t ON t.id=s.treatment_id JOIN practitioners p ON p.id=s.practitioner_id WHERE ${conditions.join(" AND ")} ORDER BY s.start,s.id`,
      )
      .all(...values)
  ).map(
    (row) =>
      ({
        id: integer(row.id),
        treatmentId: integer(row.treatment_id),
        treatmentName: str(row.treatment_name),
        practitionerId: integer(row.practitioner_id),
        practitionerName: str(row.practitioner_name),
        start: str(row.start),
        end: str(row.end),
        booked: !!row.booked,
        blocked: !!row.blocked,
        scheduleId:
          row.schedule_id === null || row.schedule_id === undefined
            ? null
            : integer(row.schedule_id),
      }) satisfies Slot,
  );
}
export async function getBookings() {
  await expireBookings();
  return (
    await getDb().prepare("SELECT * FROM bookings ORDER BY start DESC").all()
  ).map(booking);
}
export async function getBookingById(id: number) {
  await expireBookings();
  const row = await getDb()
    .prepare("SELECT * FROM bookings WHERE id=?")
    .get(id);
  return row ? booking(row) : undefined;
}
export async function getBookingByReference(reference: string) {
  await expireBookings();
  const row = await getDb()
    .prepare("SELECT * FROM bookings WHERE reference=?")
    .get(reference);
  return row ? booking(row) : undefined;
}
export async function getSettings(): Promise<Settings> {
  const row = (await getDb()
    .prepare("SELECT * FROM settings WHERE id=1")
    .get())!;
  return {
    siteName: str(row.site_name),
    email: str(row.email),
    phone: str(row.phone),
    address: str(row.address),
    location: str(row.location),
    payOnSite: !!row.pay_on_site,
    stripeEnabled: !!row.stripe_enabled,
  };
}
export async function getArticles(
  options: {
    publishedOnly?: boolean;
  } = {},
) {
  return (
    await getDb()
      .prepare(
        `SELECT * FROM articles ${options.publishedOnly ? "WHERE published=1" : ""} ORDER BY updated_at DESC`,
      )
      .all()
  ).map(article);
}
export async function getArticleById(id: number) {
  const row = await getDb()
    .prepare("SELECT * FROM articles WHERE id=?")
    .get(id);
  return row ? article(row) : undefined;
}
export async function getArticle(
  slug: string,
  options: {
    publishedOnly?: boolean;
  } = {},
) {
  const row = await getDb()
    .prepare(
      `SELECT * FROM articles WHERE slug=? ${options.publishedOnly ? "AND published=1" : ""}`,
    )
    .get(slug);
  return row ? article(row) : undefined;
}
export async function getCourses(
  options: {
    publishedOnly?: boolean;
  } = {},
) {
  return (
    await getDb()
      .prepare(
        `SELECT * FROM courses WHERE NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=courses.id) ${options.publishedOnly ? "AND published=1" : ""} ORDER BY id DESC`,
      )
      .all()
  ).map(course);
}
export type CourseSummary = Course & {
  lessonCount: number;
  enrollmentCount: number;
};
export async function getCourseSummaries(): Promise<CourseSummary[]> {
  return (
    await getDb()
      .prepare(
        `SELECT c.*,COALESCE(l.total,0) AS lesson_count,COALESCE(e.total,0) AS enrollment_count
         FROM courses c
         LEFT JOIN (SELECT course_id,COUNT(*) AS total FROM lessons GROUP BY course_id) l ON l.course_id=c.id
         LEFT JOIN (SELECT course_id,COUNT(*) AS total FROM (
           SELECT course_id,user_id FROM enrollments
           UNION
           SELECT cp.course_id,cp.user_id FROM course_purchases cp
             JOIN course_purchase_attempts ca ON ca.id=cp.attempt_id AND ca.status='paid'
             JOIN users cu ON cu.id=cp.user_id AND cu.role='student' AND cu.email_verified_at IS NOT NULL
             WHERE cp.revoked=0 AND julianday(cp.paid_at)<=julianday('now')
           UNION
           SELECT sc.course_id,cp.user_id FROM course_purchase_attempt_courses sc JOIN course_purchases cp ON cp.attempt_id=sc.attempt_id
             JOIN course_purchase_attempts ca ON ca.id=cp.attempt_id AND ca.status='paid'
             JOIN users cu ON cu.id=cp.user_id AND cu.role='student' AND cu.email_verified_at IS NOT NULL
             WHERE cp.revoked=0 AND julianday(cp.paid_at)<=julianday('now')
         ) GROUP BY course_id) e ON e.course_id=c.id
         WHERE NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=c.id)
         ORDER BY c.id DESC`,
      )
      .all()
  ).map((row) => ({
    ...course(row),
    lessonCount: integer(row.lesson_count),
    enrollmentCount: integer(row.enrollment_count),
  }));
}
export type PortalCourseSummary = Course & {
  lessonCount: number;
  completedLessonCount: number;
  progress: number;
};
export async function getPortalCourseSummaries(
  userId: number,
): Promise<PortalCourseSummary[]> {
  return (
    await getDb()
      .prepare(
        `SELECT c.*,COALESCE(l.total,0) AS lesson_count,COALESCE(p.total,0) AS completed_count
         FROM courses c JOIN users u ON u.id=?
         LEFT JOIN enrollments e ON e.course_id=c.id AND e.user_id=u.id
         LEFT JOIN (SELECT course_id,COUNT(*) AS total FROM lessons GROUP BY course_id) l ON l.course_id=c.id
         LEFT JOIN (SELECT l.course_id,COUNT(*) AS total FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE p.user_id=? GROUP BY l.course_id) p ON p.course_id=c.id
         WHERE NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=c.id)
           AND (u.role='admin' OR (u.role='student' AND c.published=1 AND (e.id IS NOT NULL OR ${membershipCourseAccessSql()} OR ${coursePurchaseAccessSql()})))
         ORDER BY CASE WHEN u.role='admin' THEN c.id END DESC,e.created_at DESC,c.id DESC`,
      )
      .all(userId, userId)
  ).map((row) => {
    const lessonCount = integer(row.lesson_count);
    const completedLessonCount = integer(row.completed_count);
    return {
      ...course(row),
      lessonCount,
      completedLessonCount,
      progress: lessonCount
        ? Math.round((completedLessonCount / lessonCount) * 100)
        : 0,
    };
  });
}
export async function getCourse(
  slug: string,
  options: {
    publishedOnly?: boolean;
  } = {},
) {
  const row = await getDb()
    .prepare(
      `SELECT * FROM courses WHERE slug=? AND NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=courses.id) ${options.publishedOnly ? "AND published=1" : ""}`,
    )
    .get(slug);
  return row ? course(row) : undefined;
}
export async function getCourseById(id: number) {
  const row = await getDb().prepare("SELECT * FROM courses WHERE id=?").get(id);
  return row ? course(row) : undefined;
}
export async function getAccessibleCourse(userId: number, courseId: number) {
  const row = await getDb()
    .prepare(
      `SELECT c.* FROM courses c JOIN users u ON u.id=? WHERE c.id=? AND (u.role='admin' OR (u.role='student' AND c.published=1 AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=u.id AND e.course_id=c.id) OR ${membershipCourseAccessSql()} OR ${coursePurchaseAccessSql()})))`,
    )
    .get(userId, courseId);
  return row ? course(row) : undefined;
}
export type LessonOutline = Pick<
  Lesson,
  "id" | "courseId" | "title" | "position"
> & {
  hasVideo: boolean;
  hasText: boolean;
  hasMaterial: boolean;
};
export async function getLessonOutline(
  courseId: number,
): Promise<LessonOutline[]> {
  return (
    await getDb()
      .prepare(
        "SELECT l.id,l.course_id,l.title,l.position,l.video_url<>'' AS has_video,l.body<>'' AS has_text,(l.material_url<>'' OR EXISTS(SELECT 1 FROM lesson_materials m WHERE m.lesson_id=l.id)) AS has_material FROM lessons l WHERE l.course_id=? ORDER BY l.position,l.id",
      )
      .all(courseId)
  ).map((row) => ({
    id: integer(row.id),
    courseId: integer(row.course_id),
    title: str(row.title),
    position: integer(row.position),
    hasVideo: !!row.has_video,
    hasText: !!row.has_text,
    hasMaterial: !!row.has_material,
  }));
}
export async function getLessons(courseId: number) {
  const [rows, materials] = await Promise.all([
    getDb()
      .prepare("SELECT * FROM lessons WHERE course_id=? ORDER BY position,id")
      .all(courseId),
    getDb()
      .prepare(
        "SELECT m.lesson_id,u.id,u.filename,u.content_type,u.size FROM lesson_materials m JOIN lessons l ON l.id=m.lesson_id JOIN uploads u ON u.id=m.upload_id WHERE l.course_id=? ORDER BY u.created_at,u.id",
      )
      .all(courseId),
  ]);
  const byLesson = new Map<number, UploadedMaterial[]>();
  for (const material of materials) {
    const lessonId = integer(material.lesson_id);
    const list = byLesson.get(lessonId) ?? [];
    list.push(uploadedMaterial(material));
    byLesson.set(lessonId, list);
  }
  return rows.map((row) => lesson(row, byLesson.get(integer(row.id)) ?? []));
}
export async function getLesson(id: number, courseId?: number) {
  const courseFilter = courseId === undefined ? [] : [courseId];
  const [row, materials] = await Promise.all([
    getDb()
      .prepare(
        `SELECT * FROM lessons WHERE id=?${courseId === undefined ? "" : " AND course_id=?"}`,
      )
      .get(id, ...courseFilter),
    getDb()
      .prepare(
        `SELECT u.id,u.filename,u.content_type,u.size FROM lesson_materials m JOIN lessons l ON l.id=m.lesson_id JOIN uploads u ON u.id=m.upload_id WHERE m.lesson_id=?${courseId === undefined ? "" : " AND l.course_id=?"} ORDER BY u.created_at,u.id`,
      )
      .all(id, ...courseFilter),
  ]);
  return row ? lesson(row, materials.map(uploadedMaterial)) : undefined;
}
export async function getUpload(id: string): Promise<UploadRecord | undefined> {
  const row = await getDb().prepare("SELECT * FROM uploads WHERE id=?").get(id);
  if (!row) return undefined;
  return {
    id: str(row.id),
    kind: row.kind as UploadRecord["kind"],
    filename: str(row.filename),
    contentType: str(row.content_type),
    size: integer(row.size),
    storagePath: str(row.storage_path),
    storageProvider: row.storage_provider as UploadRecord["storageProvider"],
    uploaderId: integer(row.uploader_id),
    courseId: row.course_id == null ? null : integer(row.course_id),
    createdAt: str(row.created_at),
  };
}
export async function getUsers() {
  return (
    await getDb().prepare("SELECT * FROM users ORDER BY created_at DESC").all()
  ).map(user);
}
export async function getUser(id: number) {
  const row = await getDb().prepare("SELECT * FROM users WHERE id=?").get(id);
  return row ? user(row) : undefined;
}
export async function getSessionUser(hash: string) {
  const row = await getDb()
    .prepare(
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
    )
    .get(hash, new Date().toISOString());
  return row ? user(row) : undefined;
}
export async function getUserByEmail(email: string) {
  const row = await getDb()
    .prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE")
    .get(email);
  return row
    ? { ...user(row), passwordHash: str(row.password_hash) }
    : undefined;
}
export async function getEnrollments(userId?: number): Promise<Enrollment[]> {
  return (
    await getDb()
      .prepare(
        `SELECT e.*,u.name,u.email,c.title AS course_title FROM enrollments e JOIN users u ON u.id=e.user_id JOIN courses c ON c.id=e.course_id ${userId ? "WHERE e.user_id=?" : ""} ORDER BY e.created_at DESC`,
      )
      .all(...(userId ? [userId] : []))
  ).map((row) => ({
    id: integer(row.id),
    userId: integer(row.user_id),
    courseId: integer(row.course_id),
    name: str(row.name),
    email: str(row.email),
    courseTitle: str(row.course_title),
    createdAt: str(row.created_at),
  }));
}
export async function getStudentCourses(userId: number): Promise<Course[]> {
  return (
    await getDb()
      .prepare(
        `SELECT c.* FROM courses c JOIN users u ON u.id=? LEFT JOIN enrollments e ON e.course_id=c.id AND e.user_id=u.id
         WHERE u.role='student' AND c.published=1 AND NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=c.id)
           AND (e.id IS NOT NULL OR ${membershipCourseAccessSql()} OR ${coursePurchaseAccessSql()}) ORDER BY e.created_at DESC,c.id DESC`,
      )
      .all(userId)
  ).map(course);
}
export async function hasCourseAccess(userId: number, courseId: number) {
  return !!(await getDb()
    .prepare(
      `SELECT c.id FROM courses c JOIN users u ON u.id=? WHERE c.id=? AND (u.role='admin' OR (u.role='student' AND c.published=1 AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=u.id AND e.course_id=c.id) OR ${membershipCourseAccessSql()} OR ${coursePurchaseAccessSql()})))`,
    )
    .get(userId, courseId));
}
export async function getCourseProgress(userId: number, courseId: number) {
  return (
    await getDb()
      .prepare(
        "SELECT p.lesson_id FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE p.user_id=? AND l.course_id=?",
      )
      .all(userId, courseId)
  ).map((row) => integer(row.lesson_id));
}
export async function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  role: User["role"];
}) {
  const result = await getDb()
    .prepare(
      "INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)",
    )
    .run(
      input.name,
      input.email.toLowerCase(),
      input.passwordHash,
      input.role,
      new Date().toISOString(),
    );
  return (await getUser(Number(result.lastInsertRowid)))!;
}
export async function createFirstAdmin(input: {
  name: string;
  email: string;
  passwordHash: string;
}) {
  return await transaction(async () => {
    if (await getDb().prepare("SELECT id FROM users WHERE role='admin'").get())
      throw new DomainError("Ett administratörskonto finns redan.");
    return await createUser({ ...input, role: "admin" });
  });
}
export async function hasAdmin() {
  return !!(await getDb()
    .prepare("SELECT id FROM users WHERE role='admin'")
    .get());
}
export async function rateLimit(
  key: string,
  limit: number,
  windowMinutes: number,
): Promise<boolean> {
  return await transaction(async () => {
    const now = new Date().toISOString();
    await getDb()
      .prepare("DELETE FROM rate_limits WHERE expires_at<=?")
      .run(now);
    const row = await getDb()
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .get(key);
    if (row && integer(row.count) >= limit) return false;
    await getDb()
      .prepare(
        "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      )
      .run(key, new Date(Date.now() + windowMinutes * 60000).toISOString());
    return true;
  });
}
export async function reserveBooking(input: {
  slotId: number;
  name: string;
  email: string;
  phone: string;
  paymentMethod: "onsite" | "stripe";
}): Promise<Booking> {
  return await transaction(async () => {
    await expireBookings();
    const row = await getDb()
      .prepare(
        "SELECT s.*,t.name,t.description,t.active,t.duration_minutes,t.price_ore,p.name AS practitioner_name,p.active AS practitioner_active FROM slots s JOIN treatments t ON t.id=s.treatment_id JOIN practitioners p ON p.id=s.practitioner_id WHERE s.id=?",
      )
      .get(input.slotId);
    if (
      !row ||
      !row.active ||
      !row.practitioner_active ||
      row.archived ||
      str(row.start) <= new Date().toISOString()
    )
      throw new DomainError("Den valda tiden är inte längre tillgänglig.");
    if (
      await getDb()
        .prepare(
          "SELECT id FROM availability_blocks WHERE (practitioner_id IS NULL OR practitioner_id=?) AND start<? AND end>?",
        )
        .get(integer(row.practitioner_id), str(row.end), str(row.start))
    )
      throw new DomainError(
        "Den valda tiden är spärrad och kan inte bokas. Välj en annan tid.",
      );
    if (
      await getDb()
        .prepare(
          "SELECT id FROM bookings WHERE practitioner_id=? AND status IN ('pending','confirmed','completed') AND start<? AND end>?",
        )
        .get(integer(row.practitioner_id), str(row.end), str(row.start))
    )
      throw new DomainError(
        "Tiden hann bokas av någon annan. Välj en annan tid.",
      );
    const settings = await getSettings();
    if (input.paymentMethod === "onsite" && !settings.payOnSite)
      throw new DomainError("Betalning vid besöket är inte tillgänglig.");
    if (
      input.paymentMethod === "stripe" &&
      (!settings.stripeEnabled ||
        !process.env.STRIPE_SECRET_KEY ||
        !process.env.STRIPE_WEBHOOK_SECRET ||
        !process.env.APP_URL)
    )
      throw new DomainError("Kortbetalning är inte tillgänglig ännu.");
    const reference = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const expires =
      input.paymentMethod === "stripe"
        ? new Date(Date.now() + 35 * 60000).toISOString()
        : null;
    await getDb()
      .prepare(
        "INSERT INTO bookings(reference,treatment_id,practitioner_id,practitioner_name,slot_id,treatment_name,duration_minutes,price_ore,start,end,name,email,phone,status,payment_method,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        reference,
        integer(row.treatment_id),
        integer(row.practitioner_id),
        str(row.practitioner_name),
        input.slotId,
        str(row.name),
        integer(row.duration_minutes),
        integer(row.price_ore),
        str(row.start),
        str(row.end),
        input.name,
        input.email.toLowerCase(),
        input.phone,
        input.paymentMethod === "onsite" ? "confirmed" : "pending",
        input.paymentMethod,
        expires,
        now,
      );
    const result = (await getBookingByReference(reference))!;
    const { recordBookingTermsSnapshot } = await import("./business-settings");
    await recordBookingTermsSnapshot(result);
    if (result.status === "confirmed") await queueBookingEmails(result.id);
    return result;
  });
}
export async function cancelPendingBooking(reference: string) {
  await getDb()
    .prepare(
      "UPDATE bookings SET status='cancelled' WHERE reference=? AND status='pending' AND payment_status='pending'",
    )
    .run(reference);
}
export async function attachCheckout(reference: string, sessionId: string) {
  await getDb()
    .prepare(
      "UPDATE bookings SET checkout_session_id=? WHERE reference=? AND status='pending'",
    )
    .run(sessionId, reference);
}
export async function completeStripeBooking(
  sessionId: string,
  amount: number,
  currency: string,
): Promise<"confirmed" | "already-paid" | "already-refunded" | "needs-refund"> {
  return await transaction(async () => {
    await expireBookings();
    const row = await getDb()
      .prepare("SELECT * FROM bookings WHERE checkout_session_id=?")
      .get(sessionId);
    if (
      !row ||
      row.payment_method !== "stripe" ||
      integer(row.price_ore) !== amount ||
      currency !== "sek"
    )
      throw new DomainError("Betalningen matchar inte bokningen.");
    if (row.payment_status === "paid") {
      if (row.status === "confirmed") await queueBookingEmails(integer(row.id));
      return "already-paid";
    }
    if (row.payment_status === "refunded") return "already-refunded";
    if (row.status !== "pending") return "needs-refund";
    if (
      await getDb()
        .prepare(
          "SELECT id FROM bookings WHERE id<>? AND practitioner_id=? AND status IN ('pending','confirmed','completed') AND start<? AND end>?",
        )
        .get(
          integer(row.id),
          integer(row.practitioner_id),
          str(row.end),
          str(row.start),
        )
    ) {
      await getDb()
        .prepare("UPDATE bookings SET status='cancelled' WHERE id=?")
        .run(integer(row.id));
      return "needs-refund";
    }
    await getDb()
      .prepare(
        "UPDATE bookings SET status='confirmed',payment_status='paid',expires_at=NULL WHERE id=?",
      )
      .run(integer(row.id));
    await queueBookingEmails(integer(row.id));
    return "confirmed";
  });
}
export async function expireStripeSession(sessionId: string) {
  await getDb()
    .prepare(
      "UPDATE bookings SET status='cancelled' WHERE checkout_session_id=? AND status='pending' AND payment_status='pending'",
    )
    .run(sessionId);
}
export async function refundStripeBooking(sessionId: string) {
  await getDb()
    .prepare(
      "UPDATE bookings SET status='cancelled',payment_status='refunded',expires_at=NULL WHERE checkout_session_id=? AND payment_method='stripe' AND payment_status IN ('paid','pending')",
    )
    .run(sessionId);
}
