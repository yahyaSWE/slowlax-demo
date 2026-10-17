import { z } from "zod";
import { DEMO_MODE } from "./demo-mode";
import { DEMO_BUNDLES } from "./demo-offers";
import { assertAdmin } from "./admin";
import { DomainError, getDb, transaction } from "./db";
import { slug, text } from "./validation";
import type { Course } from "./types";

export type CourseBundle = Course & { courseIds: number[]; courses: Course[] };
const positiveId = z.number().int().positive();
const schema = z.object({
  title: text(180, 2), slug: text(100), description: text(12000), priceOre: z.number().int().min(1).max(10000000),
  published: z.boolean(), courseIds: z.array(positiveId).min(2, "Välj minst två kurser till paketet.").max(100),
  expectedUpdatedAt: z.iso.datetime().optional(),
}).strict();
function course(row: Record<string, unknown>): Course {
  return { id: Number(row.id), title: String(row.title), slug: String(row.slug), description: String(row.description),
    priceOre: Number(row.price_ore), published: !!row.published, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
export async function getCourseBundles(options: { publishedOnly?: boolean; actorId?: number } = {}): Promise<CourseBundle[]> {
  if (DEMO_MODE && options.publishedOnly) return DEMO_BUNDLES;
  if (!options.publishedOnly) {
    if (!options.actorId) throw new DomainError("Du har inte tillgång till administrationen.");
    await assertAdmin(options.actorId);
  }
  const rows = await getDb().prepare(`SELECT c.* FROM course_bundles b JOIN courses c ON c.id=b.course_id
    ${options.publishedOnly ? `WHERE c.published=1 AND (SELECT COUNT(*) FROM course_bundle_courses bc WHERE bc.bundle_course_id=c.id)>=2
      AND NOT EXISTS(SELECT 1 FROM course_bundle_courses bc JOIN courses cc ON cc.id=bc.course_id WHERE bc.bundle_course_id=c.id AND cc.published<>1)` : ""}
    ORDER BY c.id DESC`).all();
  return Promise.all(rows.map(async row => {
    const courses = (await getDb().prepare(`SELECT c.* FROM course_bundle_courses bc JOIN courses c ON c.id=bc.course_id WHERE bc.bundle_course_id=? ORDER BY c.title,c.id`).all(Number(row.id))).map(course);
    return { ...course(row), courseIds: courses.map(course => course.id), courses };
  }));
}
export async function getCourseBundle(id: number, actorId: number) {
  positiveId.parse(id);
  return (await getCourseBundles({ actorId })).find(bundle => bundle.id === id);
}
export async function getPublicCourseBundle(slugValue: string) {
  return (await getCourseBundles({ publishedOnly: true })).find(bundle => bundle.slug === slugValue);
}
export async function saveCourseBundle(actorId: number, id: number | undefined, input: z.input<typeof schema>): Promise<number> {
  return transaction(async () => {
    await assertAdmin(actorId);
    if (id !== undefined) positiveId.parse(id);
    const value = schema.parse(input);
    if (new Set(value.courseIds).size !== value.courseIds.length) throw new DomainError("Välj varje kurs bara en gång.");
    for (const courseId of value.courseIds) {
      const found = await getDb().prepare("SELECT id,published FROM courses WHERE id=? AND NOT EXISTS(SELECT 1 FROM course_bundles WHERE course_id=courses.id)").get(courseId);
      if (!found) throw new DomainError("Paket får endast innehålla befintliga enskilda kurser.");
      if (value.published && !found.published) throw new DomainError("Publicera alla kurser i paketet först eller spara paketet som utkast.");
    }
    const path = slug(value.slug, value.title);
    if (await getDb().prepare("SELECT id FROM courses WHERE slug=? AND id<>?").get(path, id ?? -1)) throw new DomainError("Adressnamnet används redan. Välj ett annat.");
    let updatedAt = new Date().toISOString(), savedId = id;
    if (id !== undefined) {
      const current = await getDb().prepare("SELECT c.updated_at FROM courses c JOIN course_bundles b ON b.course_id=c.id WHERE c.id=?").get(id);
      if (!current) throw new DomainError("Paketet finns inte.");
      if (current.updated_at !== value.expectedUpdatedAt) throw new DomainError("Paketet har ändrats. Ladda om sidan innan du sparar igen.");
      updatedAt = new Date(Math.max(Date.now(), Date.parse(String(current.updated_at)) + 1)).toISOString();
      const saved = await getDb().prepare("UPDATE courses SET title=?,slug=?,description=?,price_ore=?,published=?,updated_at=? WHERE id=? AND updated_at=?")
        .run(value.title, path, value.description, value.priceOre, Number(value.published), updatedAt, id, value.expectedUpdatedAt!);
      if (!saved.changes) throw new DomainError("Paketet har ändrats. Ladda om sidan.");
    } else {
      savedId = Number((await getDb().prepare("INSERT INTO courses(title,slug,description,price_ore,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(value.title, path, value.description, value.priceOre, Number(value.published), updatedAt, updatedAt)).lastInsertRowid);
      await getDb().prepare("INSERT INTO course_bundles(course_id) VALUES(?)").run(savedId);
    }
    await getDb().prepare("DELETE FROM course_bundle_courses WHERE bundle_course_id=?").run(savedId!);
    for (const courseId of value.courseIds) await getDb().prepare("INSERT INTO course_bundle_courses(bundle_course_id,course_id) VALUES(?,?)").run(savedId!, courseId);
    return savedId!;
  });
}
