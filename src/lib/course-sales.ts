import { z } from "zod";
import { assertAdmin } from "./admin";
import { DomainError, getDb, transaction } from "./db";
import { appUrl, stripeReady } from "./stripe";
import { text } from "./validation";
import { coursePurchaseAccessSql } from "./course-purchase-access";

export type CourseSalesSettings = {
  courseId: number;
  enabled: boolean;
  groupId: number | null;
  groupIds: number[];
  groupAccessDays: number | null;
  vatPercent: 0 | 6 | 12 | 25;
  terms: string;
  updatedAt: string | null;
};
export type CourseSalesSettingsInput = Omit<CourseSalesSettings, "courseId" | "updatedAt" | "groupIds"> & {
  groupIds?: number[];
  expectedUpdatedAt: string | null;
};

const positiveId = z.number().int().positive();
const salesSchema = z.object({
  enabled: z.boolean(),
  groupId: positiveId.nullable(),
  groupIds: z.array(positiveId).max(100).optional(),
  groupAccessDays: z.number().int().min(1).max(3650).nullable(),
  vatPercent: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(25)]),
  terms: text(20000),
  expectedUpdatedAt: z.iso.datetime().nullable(),
}).strict();

/** Missing rows represent disabled sales; reads never mutate the database. */
export async function getCourseSalesSettings(courseId: number): Promise<CourseSalesSettings> {
  positiveId.parse(courseId);
  if (!(await getDb().prepare("SELECT id FROM courses WHERE id=?").get(courseId)))
    throw new DomainError("Kursen finns inte längre.");
  const row = await getDb().prepare("SELECT * FROM course_sales_settings WHERE course_id=?").get(courseId);
  return {
    courseId,
    enabled: !!row?.enabled,
    groupId: row?.group_id == null ? null : Number(row.group_id),
    groupIds: (await salesGroups(courseId, row?.group_id)).map(group => group.id),
    groupAccessDays: row?.group_access_days == null ? null : Number(row.group_access_days),
    vatPercent: row ? Number(row.vat_percent) as CourseSalesSettings["vatPercent"] : 25,
    terms: row ? String(row.terms) : "",
    updatedAt: row ? String(row.updated_at) : null,
  };
}

export async function saveCourseSalesSettings(
  actorId: number,
  courseId: number,
  input: CourseSalesSettingsInput,
): Promise<CourseSalesSettings> {
  return transaction(async () => {
    await assertAdmin(actorId);
    positiveId.parse(courseId);
    const value = salesSchema.parse(input);
    const groupIds = value.groupIds ?? (value.groupId === null ? [] : [value.groupId]);
    if (new Set(groupIds).size !== groupIds.length) throw new DomainError("Välj varje grupp bara en gång.");
    const primaryGroupId = groupIds[0] ?? null;
    const course = await getDb().prepare("SELECT id,published,price_ore FROM courses WHERE id=?").get(courseId);
    if (!course) throw new DomainError("Kursen finns inte längre.");
    if (primaryGroupId === null && value.groupAccessDays !== null)
      throw new DomainError("Välj en grupp innan du anger hur länge gruppåtkomsten ska gälla.");
    for (const groupId of groupIds) {
      const group = await getDb().prepare("SELECT published FROM membership_groups WHERE id=?").get(groupId);
      if (!group) throw new DomainError("Välj en grupp som finns på webbplatsen.");
      if (value.enabled && !group.published)
        throw new DomainError("Publicera gruppen innan du aktiverar kursförsäljningen.");
    }
    if (value.enabled && (!course.published || Number(course.price_ore) <= 0))
      throw new DomainError("Publicera kursen och ange ett pris större än noll innan du aktiverar försäljningen.");
    if (value.enabled && !await validBundleCourses(courseId))
      throw new DomainError("Paketet behöver minst två publicerade kurser innan försäljningen kan aktiveras.");
    if (value.enabled && !value.terms)
      throw new DomainError("Skriv köp- och åtkomstvillkor innan du aktiverar försäljningen.");
    const current = await getDb().prepare("SELECT updated_at FROM course_sales_settings WHERE course_id=?").get(courseId);
    const currentRevision = current ? String(current.updated_at) : null;
    if (value.expectedUpdatedAt !== currentRevision)
      throw new DomainError("Kursens köpinställningar har ändrats sedan du öppnade formuläret. Ladda om sidan innan du sparar igen.");
    const updatedAt = new Date(Math.max(Date.now(), currentRevision ? Date.parse(currentRevision) + 1 : 0)).toISOString();
    if (current) {
      const saved = await getDb().prepare(`UPDATE course_sales_settings
        SET enabled=?,group_id=?,group_access_days=?,vat_percent=?,terms=?,updated_at=?
        WHERE course_id=? AND updated_at=?`)
        .run(value.enabled ? 1 : 0, primaryGroupId, value.groupAccessDays, value.vatPercent, value.terms, updatedAt, courseId, currentRevision);
      if (!saved.changes) throw new DomainError("Kursens köpinställningar har ändrats. Ladda om sidan.");
    } else {
      await getDb().prepare(`INSERT INTO course_sales_settings
        (course_id,enabled,group_id,group_access_days,vat_percent,terms,updated_at) VALUES(?,?,?,?,?,?,?)`)
        .run(courseId, value.enabled ? 1 : 0, primaryGroupId, value.groupAccessDays, value.vatPercent, value.terms, updatedAt);
    }
    await getDb().prepare("DELETE FROM course_sales_groups WHERE course_id=?").run(courseId);
    for (const groupId of groupIds) await getDb().prepare("INSERT INTO course_sales_groups(course_id,group_id) VALUES(?,?)").run(courseId, groupId);
    return { courseId, enabled: value.enabled, groupId: primaryGroupId, groupIds, groupAccessDays: value.groupAccessDays,
      vatPercent: value.vatPercent, terms: value.terms, updatedAt };
  });
}

/** Publication and sales gates apply only to new purchases, never existing grants. */
export async function getPublicCourseSalesSettings(courseId: number): Promise<CourseSalesSettings | undefined> {
  positiveId.parse(courseId);
  const row = await getDb().prepare(`SELECT s.* FROM course_sales_settings s JOIN courses c ON c.id=s.course_id
    WHERE s.course_id=? AND s.enabled=1 AND c.published=1 AND c.price_ore>0 AND length(trim(s.terms))>0
      AND (s.group_id IS NULL OR EXISTS(SELECT 1 FROM membership_groups g WHERE g.id=s.group_id AND g.published=1))`).get(courseId);
  if (row && !await validOfferContents(courseId)) return undefined;
  return row ? { courseId, enabled: true, groupId: row.group_id == null ? null : Number(row.group_id), groupIds: (await salesGroups(courseId, row.group_id)).map(group => group.id),
    groupAccessDays: row.group_access_days == null ? null : Number(row.group_access_days),
    vatPercent: Number(row.vat_percent) as CourseSalesSettings["vatPercent"], terms: String(row.terms), updatedAt: String(row.updated_at) } : undefined;
}

/** Published contents remain visible when payment credentials are unavailable. */
export async function getPublicCourseSalesDetails(courseId: number): Promise<(CourseSalesSettings & {
  groups: { id: number; name: string; accessDays: number | null }[];
}) | undefined> {
  const settings = await getPublicCourseSalesSettings(courseId);
  if (!settings) return undefined;
  return { ...settings, groups: (await salesGroups(courseId, settings.groupId))
    .map(group => ({ ...group, accessDays: settings.groupAccessDays })) };
}

export type CoursePurchaseOffer = {
  courseId: number; title: string; slug: string; courseRevision: string;
  settingsRevision: string; termsRevision: string; terms: string;
  priceOre: number; vatPercent: CourseSalesSettings["vatPercent"];
  groupId: number | null; groupName: string | null; groupAccessDays: number | null;
  groups: { id: number; name: string; accessDays: number | null }[];
  courses: { id: number; title: string; slug: string }[];
  isBundle: boolean;
  buyEnabled: true;
};
export async function getCoursePurchaseOffer(courseId: number): Promise<CoursePurchaseOffer | undefined> {
  positiveId.parse(courseId);
  if (!stripeReady()) return undefined;
  try { appUrl(); } catch { return undefined; }
  const row = await getDb().prepare(`SELECT c.id,c.title,c.slug,c.updated_at AS course_revision,c.price_ore,
      s.updated_at AS settings_revision,s.terms,s.vat_percent,s.group_id,s.group_access_days,g.name AS group_name
    FROM course_sales_settings s JOIN courses c ON c.id=s.course_id
      LEFT JOIN membership_groups g ON g.id=s.group_id
    WHERE s.course_id=? AND s.enabled=1 AND c.published=1 AND c.price_ore>0 AND length(trim(s.terms))>0
      AND (s.group_id IS NULL OR g.published=1)
      AND EXISTS(SELECT 1 FROM settings WHERE id=1 AND length(trim(email))>0)`).get(courseId);
  if (!row || !await validOfferContents(courseId)) return undefined;
  return { courseId: Number(row.id), title: String(row.title), slug: String(row.slug), courseRevision: String(row.course_revision),
    settingsRevision: String(row.settings_revision), termsRevision: String(row.settings_revision), terms: String(row.terms),
    priceOre: Number(row.price_ore), vatPercent: Number(row.vat_percent) as CourseSalesSettings["vatPercent"],
    groupId: row.group_id == null ? null : Number(row.group_id), groupName: row.group_name == null ? null : String(row.group_name),
    groupAccessDays: row.group_access_days == null ? null : Number(row.group_access_days),
    groups: (await salesGroups(courseId, row.group_id)).map(group => ({ ...group, accessDays: row.group_access_days == null ? null : Number(row.group_access_days) })),
    courses: await offerCourses(courseId), isBundle: !!await getDb().prepare("SELECT course_id FROM course_bundles WHERE course_id=?").get(courseId), buyEnabled: true };
}

async function salesGroups(courseId: number, legacyGroupId: unknown): Promise<{ id: number; name: string }[]> {
  const rows = await getDb().prepare("SELECT g.id,g.name FROM course_sales_groups s JOIN membership_groups g ON g.id=s.group_id WHERE s.course_id=? ORDER BY g.id").all(courseId);
  if (!rows.length && legacyGroupId != null) {
    const legacy = await getDb().prepare("SELECT id,name FROM membership_groups WHERE id=?").get(Number(legacyGroupId));
    if (legacy) rows.push(legacy);
  }
  return rows.map(group => ({ id: Number(group.id), name: String(group.name) }));
}
async function offerCourses(courseId: number): Promise<{ id: number; title: string; slug: string }[]> {
  const rows = await getDb().prepare(`SELECT c.id,c.title,c.slug FROM courses c WHERE c.id=? OR c.id IN
    (SELECT course_id FROM course_bundle_courses WHERE bundle_course_id=?) ORDER BY c.id`).all(courseId, courseId);
  return rows.map(course => ({ id: Number(course.id), title: String(course.title), slug: String(course.slug) }));
}
async function validOfferContents(courseId: number): Promise<boolean> {
  if (await getDb().prepare(`SELECT 1 FROM course_sales_groups s JOIN membership_groups g ON g.id=s.group_id WHERE s.course_id=? AND g.published<>1`).get(courseId)) return false;
  return validBundleCourses(courseId);
}
async function validBundleCourses(courseId: number): Promise<boolean> {
  if (!await getDb().prepare("SELECT course_id FROM course_bundles WHERE course_id=?").get(courseId)) return true;
  const courses = await getDb().prepare(`SELECT c.id,c.published FROM course_bundle_courses b JOIN courses c ON c.id=b.course_id WHERE b.bundle_course_id=?`).all(courseId);
  return courses.length >= 2 && courses.every(course => !!course.published);
}

/** Indirect access through a group can still be upgraded to a permanent course purchase. */
export async function hasPermanentCourseAccess(userId: number, courseId: number): Promise<boolean> {
  positiveId.parse(userId); positiveId.parse(courseId);
  return !!await getDb().prepare(`SELECT c.id FROM courses c JOIN users u ON u.id=?
    WHERE c.id=? AND u.role='student' AND u.email_verified_at IS NOT NULL AND c.published=1
      AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=u.id AND e.course_id=c.id)
        OR ${coursePurchaseAccessSql()})`).get(userId, courseId);
}
