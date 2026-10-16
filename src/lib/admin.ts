import { z } from "zod";
import {
  DomainError,
  expireBookings,
  getDb,
  getLesson,
  getPractitioner,
  getSettings,
  getTreatment,
  getUpload,
  getUser,
  getUserByEmail,
  hasCourseAccess,
  transaction,
} from "./db";
import { stockholmToIso } from "./time";
import { emailSchema, money, safeUrl, slug, text } from "./validation";
export {
  saveAvailabilitySchedule,
  deleteAvailabilitySchedule,
  saveAvailabilityBlock,
  deleteAvailabilityBlock,
} from "./availability";
export async function assertAdmin(actorId: number) {
  if ((await getUser(actorId))?.role !== "admin")
    throw new DomainError("Du har inte behörighet för denna åtgärd.");
}
export async function savePractitioner(
  actorId: number,
  input: {
    id?: number;
    name: string;
    description: string;
    active: boolean;
    photoUploadId?: string | null;
  },
): Promise<number> {
  return transaction(async () => {
    await assertAdmin(actorId);
    const value = z
      .object({
        id: z.number().int().positive().optional(),
        name: text(150, 2),
        description: text(6000),
        active: z.boolean(),
        photoUploadId: z.uuid().nullable().optional(),
      })
      .parse(input);
    if (value.photoUploadId) {
      const upload = await getUpload(value.photoUploadId);
      if (!upload || upload.kind !== "practitioner-photo")
        throw new DomainError("Välj en uppladdad profilbild.");
    }
    if (value.id) {
      if (!(await getPractitioner(value.id)))
        throw new DomainError("Behandlaren finns inte.");
      await getDb()
        .prepare(
          "UPDATE practitioners SET name=?,description=?,active=? WHERE id=?",
        )
        .run(value.name, value.description, value.active ? 1 : 0, value.id);
      if (value.photoUploadId !== undefined)
        await getDb()
          .prepare("UPDATE practitioners SET photo_upload_id=? WHERE id=?")
          .run(value.photoUploadId, value.id);
      return value.id;
    }
    return Number(
      (
        await getDb()
          .prepare(
            "INSERT INTO practitioners(name,description,active,photo_upload_id) VALUES(?,?,?,?)",
          )
          .run(
            value.name,
            value.description,
            value.active ? 1 : 0,
            value.photoUploadId ?? null,
          )
      ).lastInsertRowid,
    );
  });
}
export async function archivePractitioner(
  actorId: number,
  id: number,
): Promise<void> {
  await transaction(async () => {
    await assertAdmin(actorId);
    z.number().int().positive().parse(id);
    if (
      !(
        await getDb()
          .prepare("UPDATE practitioners SET active=0 WHERE id=?")
          .run(id)
      ).changes
    )
      throw new DomainError("Behandlaren finns inte.");
  });
}
export async function saveTreatment(
  actorId: number,
  input: {
    id?: number;
    name: string;
    description: string;
    durationMinutes: number;
    price: string;
    active: boolean;
  },
) {
  return await transaction(async () => {
    await assertAdmin(actorId);
    const value = z
      .object({
        id: z.number().int().positive().optional(),
        name: text(150, 2),
        description: text(6000),
        durationMinutes: z.number().int().min(5).max(480),
        price: z.string(),
        active: z.boolean(),
      })
      .parse(input);
    const price = money(value.price);
    if (value.id) {
      const current = await getTreatment(value.id);
      if (!current) throw new DomainError("Behandlingen finns inte.");
      if (
        current.durationMinutes !== value.durationMinutes &&
        (await getDb()
          .prepare(
            "SELECT id FROM slots WHERE treatment_id=? AND start>? AND archived=0",
          )
          .get(value.id, new Date().toISOString()))
      )
        throw new DomainError(
          "Ta bort framtida lediga tider innan du ändrar behandlingens längd. Befintliga bokningar behåller sin längd.",
        );
      await getDb()
        .prepare(
          "UPDATE treatments SET name=?,description=?,duration_minutes=?,price_ore=?,active=? WHERE id=?",
        )
        .run(
          value.name,
          value.description,
          value.durationMinutes,
          price,
          value.active ? 1 : 0,
          value.id,
        );
    } else
      await getDb()
        .prepare(
          "INSERT INTO treatments(name,description,duration_minutes,price_ore,active) VALUES(?,?,?,?,?)",
        )
        .run(
          value.name,
          value.description,
          value.durationMinutes,
          price,
          value.active ? 1 : 0,
        );
  });
}
export async function archiveTreatment(actorId: number, id: number) {
  await assertAdmin(actorId);
  await getDb().prepare("UPDATE treatments SET active=0 WHERE id=?").run(id);
}
export async function saveSlot(
  actorId: number,
  treatmentId: number,
  localStart: string,
  practitionerId = 1,
) {
  await assertAdmin(actorId);
  const start = stockholmToIso(localStart);
  if (
    Date.parse(start) <= Date.now() ||
    Date.parse(start) > Date.now() + 730 * 86400000
  )
    throw new DomainError("Välj en framtida tid inom två år.");
  return await transaction(async () => {
    await assertAdmin(actorId);
    await expireBookings();
    const treatment = await getTreatment(treatmentId);
    if (!treatment || !treatment.active)
      throw new DomainError("Välj en aktiv behandling.");
    z.number().int().positive().parse(practitionerId);
    const practitioner = await getPractitioner(practitionerId);
    if (!practitioner || !practitioner.active)
      throw new DomainError("Välj en aktiv behandlare.");
    const end = new Date(
      Date.parse(start) + treatment.durationMinutes * 60000,
    ).toISOString();
    if (
      await getDb()
        .prepare(
          "SELECT id FROM availability_blocks WHERE (practitioner_id IS NULL OR practitioner_id=?) AND start<? AND end>?",
        )
        .get(practitionerId, end, start)
    )
      throw new DomainError("Tiden överlappar en spärrad period.");
    if (
      (await getDb()
        .prepare(
          "SELECT id FROM slots WHERE practitioner_id=? AND archived=0 AND start<? AND end>?",
        )
        .get(practitionerId, end, start)) ||
      (await getDb()
        .prepare(
          "SELECT id FROM bookings WHERE practitioner_id=? AND status IN ('pending','confirmed','completed') AND start<? AND end>?",
        )
        .get(practitionerId, end, start))
    )
      throw new DomainError(
        "Tiden överlappar en annan tillgänglig tid eller bokning.",
      );
    return Number(
      (
        await getDb()
          .prepare(
            "INSERT INTO slots(treatment_id,practitioner_id,start,end) VALUES(?,?,?,?)",
          )
          .run(treatmentId, practitionerId, start, end)
      ).lastInsertRowid,
    );
  });
}
export async function deleteSlot(actorId: number, id: number) {
  await assertAdmin(actorId);
  await transaction(async () => {
    await expireBookings();
    if (
      await getDb()
        .prepare(
          "SELECT id FROM bookings WHERE slot_id=? AND status IN ('pending','confirmed','completed')",
        )
        .get(id)
    )
      throw new DomainError(
        "En bokad tid kan inte tas bort. Avboka bokningen först.",
      );
    await getDb().prepare("UPDATE slots SET archived=1 WHERE id=?").run(id);
  });
}
export async function updateBooking(
  actorId: number,
  id: number,
  status: string,
  paymentStatus: string,
) {
  await assertAdmin(actorId);
  z.enum(["confirmed", "cancelled", "completed"]).parse(status);
  z.enum(["pending", "paid", "refunded"]).parse(paymentStatus);
  await transaction(async () => {
    await expireBookings();
    const row = await getDb()
      .prepare("SELECT * FROM bookings WHERE id=?")
      .get(id);
    if (!row) throw new DomainError("Bokningen finns inte.");
    if (row.payment_method === "stripe" && paymentStatus !== row.payment_status)
      throw new DomainError(
        "Kortbetalningar uppdateras av Stripe. Hantera återbetalningar i Stripe.",
      );
    if (
      row.payment_method === "stripe" &&
      row.payment_status !== "paid" &&
      status !== "cancelled"
    )
      throw new DomainError("Kortbetalningen måste bekräftas av Stripe först.");
    if (row.status === "cancelled" && status !== "cancelled")
      throw new DomainError(
        "En avbokad bokning kan inte återaktiveras. Skapa en ny bokning.",
      );
    await getDb()
      .prepare(
        "UPDATE bookings SET status=?,payment_status=?,expires_at=NULL WHERE id=?",
      )
      .run(status, paymentStatus, id);
  });
}
export async function saveSettings(
  actorId: number,
  input: {
    siteName: string;
    email: string;
    phone: string;
    address: string;
    location: string;
  },
) {
  await assertAdmin(actorId);
  const value = z
    .object({
      siteName: text(100, 2),
      email: z.union([emailSchema, z.literal("")]),
      phone: text(40),
      address: text(500),
      location: text(200),
    })
    .parse(input);
  await getDb()
    .prepare(
      "UPDATE settings SET site_name=?,email=?,phone=?,address=?,location=? WHERE id=1",
    )
    .run(
      value.siteName,
      value.email,
      value.phone,
      value.address,
      value.location,
    );
}
export async function saveArticle(
  actorId: number,
  input: {
    id?: number;
    title: string;
    slug: string;
    excerpt: string;
    body: string;
    published: boolean;
  },
) {
  await assertAdmin(actorId);
  const value = z
    .object({
      id: z.number().int().positive().optional(),
      title: text(180, 2),
      slug: text(100),
      excerpt: text(500),
      body: text(100000),
      published: z.boolean(),
    })
    .parse(input);
  if (value.published && !value.body.trim())
    throw new DomainError("Lägg till artikeltext innan du publicerar.");
  const now = new Date().toISOString();
  const url = slug(value.slug, value.title);
  if (value.id)
    await getDb()
      .prepare(
        "UPDATE articles SET title=?,slug=?,excerpt=?,body=?,published=?,updated_at=? WHERE id=?",
      )
      .run(
        value.title,
        url,
        value.excerpt,
        value.body,
        value.published ? 1 : 0,
        now,
        value.id,
      );
  else
    await getDb()
      .prepare(
        "INSERT INTO articles(title,slug,excerpt,body,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        value.title,
        url,
        value.excerpt,
        value.body,
        value.published ? 1 : 0,
        now,
        now,
      );
}
export async function deleteArticle(actorId: number, id: number) {
  await assertAdmin(actorId);
  await getDb().prepare("DELETE FROM articles WHERE id=?").run(id);
}
export async function saveCourse(
  actorId: number,
  input: {
    id?: number;
    title: string;
    slug: string;
    description: string;
    price: string;
    published: boolean;
  },
) {
  return await transaction(async () => {
    await assertAdmin(actorId);
    const value = z
      .object({
        id: z.number().int().positive().optional(),
        title: text(180, 2),
        slug: text(100),
        description: text(12000),
        price: z.string(),
        published: z.boolean(),
      })
      .parse(input);
    const price = money(value.price);
    const now = new Date().toISOString();
    const url = slug(value.slug, value.title);
    if (
      value.published &&
      value.id &&
      !(await getDb()
        .prepare("SELECT id FROM lessons WHERE course_id=?")
        .get(value.id))
    )
      throw new DomainError(
        "Lägg till minst en lektion innan du publicerar kursen.",
      );
    if (value.published && !value.id)
      throw new DomainError(
        "Spara kursen som utkast och lägg till lektioner innan publicering.",
      );
    if (value.id)
      await getDb()
        .prepare(
          "UPDATE courses SET title=?,slug=?,description=?,price_ore=?,published=?,updated_at=? WHERE id=?",
        )
        .run(
          value.title,
          url,
          value.description,
          price,
          value.published ? 1 : 0,
          now,
          value.id,
        );
    else
      await getDb()
        .prepare(
          "INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          value.title,
          url,
          value.description,
          price,
          value.published ? 1 : 0,
          now,
          now,
        );
  });
}
export async function deleteCourse(actorId: number, id: number) {
  await assertAdmin(actorId);
  await getDb().prepare("DELETE FROM courses WHERE id=?").run(id);
}
export async function saveLesson(
  actorId: number,
  input: {
    id?: number;
    courseId: number;
    title: string;
    body: string;
    videoUrl: string;
    materialUrl: string;
    position: number;
    materialUploadIds?: string[];
  },
) {
  return await transaction(async () => {
    await assertAdmin(actorId);
    const value = z
      .object({
        id: z.number().int().positive().optional(),
        courseId: z.number().int().positive(),
        title: text(180, 2),
        body: text(100000),
        videoUrl: text(2000),
        materialUrl: text(2000),
        position: z.number().int().min(1).max(10000),
        materialUploadIds: z
          .array(z.uuid())
          .max(20, "En lektion får ha högst 20 uppladdade filer.")
          .optional(),
      })
      .parse(input);
    const video = safeUrl(value.videoUrl),
      material = safeUrl(value.materialUrl);
    if (
      !(await getDb()
        .prepare("SELECT id FROM courses WHERE id=?")
        .get(value.courseId))
    )
      throw new DomainError("Kursen finns inte.");
    const current = value.id ? await getLesson(value.id) : undefined;
    if (value.id && (!current || current.courseId !== value.courseId))
      throw new DomainError("Lektionen tillhör inte denna kurs.");
    const materialIds =
      value.materialUploadIds === undefined
        ? (current?.materials.map((upload) => upload.id) ?? [])
        : [...new Set(value.materialUploadIds)];
    if (materialIds.length) {
      const records = await getDb()
        .prepare(
          `SELECT id,kind,course_id FROM uploads WHERE id IN (${materialIds.map(() => "?").join(",")})`,
        )
        .all(...materialIds);
      if (
        records.length !== materialIds.length ||
        records.some(
          (record) =>
            record.kind !== "lesson-material" ||
            Number(record.course_id) !== value.courseId,
        )
      )
        throw new DomainError(
          "Välj uppladdat kursmaterial som tillhör den här kursen.",
        );
    }
    if (!value.body && !video && !material && !materialIds.length)
      throw new DomainError(
        "Lägg till text, en videolänk eller kursmaterial i lektionen.",
      );
    let lessonId: number;
    if (value.id) {
      lessonId = value.id;
      await getDb()
        .prepare(
          "UPDATE lessons SET title=?,body=?,video_url=?,material_url=?,position=? WHERE id=? AND course_id=?",
        )
        .run(
          value.title,
          value.body,
          video,
          material,
          value.position,
          value.id,
          value.courseId,
        );
    } else {
      const result = await getDb()
        .prepare(
          "INSERT INTO lessons(course_id,title,body,video_url,material_url,position) VALUES(?,?,?,?,?,?)",
        )
        .run(
          value.courseId,
          value.title,
          value.body,
          video,
          material,
          value.position,
        );
      lessonId = Number(result.lastInsertRowid);
    }
    if (value.materialUploadIds !== undefined) {
      await getDb()
        .prepare("DELETE FROM lesson_materials WHERE lesson_id=?")
        .run(lessonId);
      if (materialIds.length)
        await getDb()
          .prepare(
            `INSERT INTO lesson_materials(lesson_id,upload_id) VALUES ${materialIds.map(() => "(?,?)").join(",")}`,
          )
          .run(...materialIds.flatMap((uploadId) => [lessonId, uploadId]));
    }
  });
}
export async function deleteLesson(
  actorId: number,
  id: number,
  courseId: number,
) {
  return await transaction(async () => {
    await assertAdmin(actorId);
    await getDb()
      .prepare("DELETE FROM lessons WHERE id=? AND course_id=?")
      .run(id, courseId);
    if (
      !(await getDb()
        .prepare("SELECT id FROM lessons WHERE course_id=?")
        .get(courseId))
    )
      await getDb()
        .prepare("UPDATE courses SET published=0 WHERE id=?")
        .run(courseId);
  });
}
export async function enrollStudent(
  actorId: number,
  courseId: number,
  email: string,
) {
  return await transaction(async () => {
    await assertAdmin(actorId);
    const normalized = emailSchema.parse(email);
    const student = await getUserByEmail(normalized);
    if (!student || student.role !== "student")
      throw new DomainError(
        "Eleven behöver först skapa ett konto med den här e-postadressen.",
      );
    if (
      !(await getDb()
        .prepare("SELECT id FROM courses WHERE id=?")
        .get(courseId))
    )
      throw new DomainError("Kursen finns inte.");
    if (await getDb().prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=?").get(student.id, courseId))
      return;
    if (!student.emailVerifiedAt)
      throw new DomainError("Eleven behöver verifiera sin e-postadress innan du tilldelar en ny kurs. Eleven kan göra det från elevportalen.");
    await getDb()
      .prepare(
        "INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id,course_id) DO NOTHING",
      )
      .run(student.id, courseId, new Date().toISOString());
  });
}
export async function removeEnrollment(actorId: number, id: number) {
  await assertAdmin(actorId);
  await getDb().prepare("DELETE FROM enrollments WHERE id=?").run(id);
}
export async function markLesson(
  userId: number,
  lessonId: number,
  completed: boolean,
) {
  return await transaction(async () => {
    const lesson = await getLesson(lessonId);
    if (!lesson || !(await hasCourseAccess(userId, lesson.courseId)))
      throw new DomainError("Du har inte tillgång till denna lektion.");
    if (completed)
      await getDb()
        .prepare(
          "INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?) ON CONFLICT(user_id,lesson_id) DO NOTHING",
        )
        .run(userId, lessonId, new Date().toISOString());
    else
      await getDb()
        .prepare("DELETE FROM progress WHERE user_id=? AND lesson_id=?")
        .run(userId, lessonId);
  });
}
