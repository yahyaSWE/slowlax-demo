import { z } from "zod";
import { assertAdmin } from "./admin";
import { DomainError, getDb, getSettings, transaction } from "./db";
import { membershipGroupAccessSql } from "./membership-access";
import { parseGroupRichText, groupRichTextImageIds } from "./group-rich-text";
import { emailSchema, slug, text } from "./validation";
import { appUrl } from "./stripe";
import { getStudentGroupAccessStates } from "./student-access";
import type { Course, UploadedMaterial } from "./types";
import type {
  MembershipGroup, MembershipPlan, MembershipAssignment, MembershipPost, MembershipSettings,
  MembershipGroupInput, MembershipPlanInput, MembershipPostInput,
} from "./membership-types";
export type * from "./membership-types";

type Row = Record<string, unknown>;
const positiveId = z.number().int().positive();
const revision = z.iso.datetime().optional();
const groupSchema = z.object({ name: text(150, 2), slug: text(100), description: text(20000),
  published: z.boolean(), courseIds: z.array(positiveId).max(100), expectedUpdatedAt: revision });
const planSchema = z.object({ groupId: positiveId, groupIds: z.array(positiveId).min(1).max(100).optional(), name: text(150, 2), slug: text(100), description: text(20000),
  priceOre: z.number().int().min(1).max(10000000), vatPercent: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(25)]),
  interval: z.enum(["month", "year"]), published: z.boolean(), expectedUpdatedAt: revision });
const postSchema = z.object({ groupId: positiveId, title: text(180, 2), body: z.unknown(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Ange en månad i formatet ÅÅÅÅ-MM.").nullable(),
  published: z.boolean(), uploadIds: z.array(z.uuid()).max(20), expectedUpdatedAt: revision });

function nextRevision(current: unknown): string {
  return new Date(Math.max(Date.now(), Date.parse(String(current)) + 1)).toISOString();
}
function assertRevision(current: Row, expected: string | undefined, noun: string) {
  if (!expected || expected !== current.updated_at)
    throw new DomainError(`${noun} har ändrats sedan du öppnade formuläret. Ladda om sidan innan du sparar igen.`);
}
function course(row: Row): Course {
  return { id: Number(row.id), title: String(row.title), slug: String(row.slug), description: String(row.description),
    priceOre: Number(row.price_ore), published: !!row.published, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function group(row: Row, courses: Course[]): MembershipGroup {
  return { id: Number(row.id), name: String(row.name), slug: String(row.slug), description: String(row.description),
    published: !!row.published, createdAt: String(row.created_at), updatedAt: String(row.updated_at), courses, courseIds: courses.map(c => c.id) };
}
function plan(row: Row): MembershipPlan {
  return { id: Number(row.id), groupId: Number(row.group_id), groupName: String(row.group_name), name: String(row.name),
    groupIds: [Number(row.group_id)], groups: [{ id: Number(row.group_id), name: String(row.group_name) }],
    slug: String(row.slug), description: String(row.description), priceOre: Number(row.price_ore),
    vatPercent: Number(row.vat_percent) as MembershipPlan["vatPercent"], interval: row.interval as MembershipPlan["interval"],
    published: !!row.published, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
async function plansFromRows(rows: Row[]): Promise<MembershipPlan[]> {
  return Promise.all(rows.map(async row => {
    const result = plan(row), groups = await getMembershipPlanGroups(result.id, result.groupId);
    return { ...result, groups, groupIds: groups.map(group => group.id), groupName: groups.map(group => group.name).join(" · ") };
  }));
}
export async function getMembershipPlanGroups(planId: number, legacyGroupId?: number): Promise<{ id: number; name: string }[]> {
  const rows = await getDb().prepare(`SELECT g.id,g.name FROM membership_plan_groups pg JOIN membership_groups g ON g.id=pg.group_id WHERE pg.plan_id=? ORDER BY g.id`).all(planId);
  if (!rows.length) {
    const legacy = await getDb().prepare(`SELECT g.id,g.name FROM membership_plans p JOIN membership_groups g ON g.id=p.group_id WHERE p.id=?`).get(planId);
    if (legacy) rows.push(legacy);
    else if (legacyGroupId) { const group = await getDb().prepare("SELECT id,name FROM membership_groups WHERE id=?").get(legacyGroupId); if (group) rows.push(group); }
  }
  return rows.map(group => ({ id: Number(group.id), name: String(group.name) }));
}
async function groupsFromRows(rows: Row[], publishedCoursesOnly = false): Promise<MembershipGroup[]> {
  if (!rows.length) return [];
  const links = await getDb().prepare(`SELECT c.*,gc.group_id FROM membership_group_courses gc JOIN courses c ON c.id=gc.course_id
    WHERE gc.group_id IN (${rows.map(() => "?").join(",")}) ${publishedCoursesOnly ? "AND c.published=1" : ""} ORDER BY c.title,c.id`)
    .all(...rows.map(row => Number(row.id)));
  return rows.map(row => group(row, links.filter(link => Number(link.group_id) === Number(row.id)).map(course)));
}
export async function getAdminGroups(actorId: number): Promise<MembershipGroup[]> {
  await assertAdmin(actorId);
  return groupsFromRows(await getDb().prepare("SELECT * FROM membership_groups ORDER BY name,id").all());
}
export async function getAdminGroup(actorId: number, groupId: number): Promise<MembershipGroup | undefined> {
  await assertAdmin(actorId); positiveId.parse(groupId);
  const row = await getDb().prepare("SELECT * FROM membership_groups WHERE id=?").get(groupId);
  return row ? (await groupsFromRows([row]))[0] : undefined;
}
export async function saveGroup(actorId: number, groupId: number | undefined, input: MembershipGroupInput): Promise<number> {
  return transaction(async () => {
    await assertAdmin(actorId);
    if (groupId !== undefined) positiveId.parse(groupId);
    const value = groupSchema.parse(input);
    if (new Set(value.courseIds).size !== value.courseIds.length) throw new DomainError("Välj varje kurs bara en gång.");
    for (const courseId of value.courseIds) {
      const found = await getDb().prepare("SELECT published FROM courses WHERE id=?").get(courseId);
      if (!found) throw new DomainError("Välj kurser som finns på webbplatsen.");
      if (value.published && !found.published) throw new DomainError("Publicera gruppens kurser först eller spara gruppen som utkast.");
    }
    const path = slug(value.slug, value.name);
    if (await getDb().prepare("SELECT id FROM membership_groups WHERE slug=? AND id<>?").get(path, groupId ?? -1))
      throw new DomainError("En annan grupp använder redan den webbadressen.");
    let savedId = groupId;
    let now = new Date().toISOString();
    if (groupId !== undefined) {
      const current = await getDb().prepare("SELECT * FROM membership_groups WHERE id=?").get(groupId);
      if (!current) throw new DomainError("Gruppen finns inte.");
      assertRevision(current, value.expectedUpdatedAt, "Gruppen"); now = nextRevision(current.updated_at);
      const result = await getDb().prepare("UPDATE membership_groups SET name=?,slug=?,description=?,published=?,updated_at=? WHERE id=? AND updated_at=?")
        .run(value.name, path, value.description, value.published ? 1 : 0, now, groupId, value.expectedUpdatedAt!);
      if (!result.changes) throw new DomainError("Gruppen har ändrats. Ladda om sidan.");
    } else {
      savedId = Number((await getDb().prepare("INSERT INTO membership_groups(name,slug,description,published,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .run(value.name, path, value.description, value.published ? 1 : 0, now, now)).lastInsertRowid);
    }
    await getDb().prepare("DELETE FROM membership_group_courses WHERE group_id=?").run(savedId!);
    for (const courseId of value.courseIds)
      await getDb().prepare("INSERT INTO membership_group_courses(group_id,course_id) VALUES(?,?)").run(savedId!, courseId);
    return savedId!;
  });
}

const viableGroup = `g.published=1 AND NOT EXISTS(SELECT 1 FROM membership_group_courses gc
  JOIN courses c ON c.id=gc.course_id WHERE gc.group_id=g.id AND c.published<>1)`;
const viablePlanGroups = `NOT EXISTS(SELECT 1 FROM membership_plan_groups vpg JOIN membership_groups vg ON vg.id=vpg.group_id
  WHERE vpg.plan_id=p.id AND (vg.published<>1 OR EXISTS(SELECT 1 FROM membership_group_courses vgc JOIN courses vc ON vc.id=vgc.course_id WHERE vgc.group_id=vg.id AND vc.published<>1)))`;
export async function getPublicPlans(): Promise<MembershipPlan[]> {
  return plansFromRows(await getDb().prepare(`SELECT p.*,g.name AS group_name FROM membership_plans p
    JOIN membership_groups g ON g.id=p.group_id
    WHERE p.published=1 AND ${viableGroup} AND ${viablePlanGroups} ORDER BY p.price_ore,p.id`).all());
}
export async function getPublicPlan(slugValue: string): Promise<MembershipPlan | undefined> {
  return (await getPublicPlans()).find(p => p.slug === slugValue);
}
export async function getPublicPlanCourses(planId: number): Promise<Course[]> {
  positiveId.parse(planId);
  return (await getDb().prepare(`SELECT DISTINCT c.* FROM membership_plans p
    JOIN membership_groups g ON g.id=p.group_id
    JOIN membership_group_courses gc ON (gc.group_id=g.id OR EXISTS(SELECT 1 FROM membership_plan_groups pcg WHERE pcg.plan_id=p.id AND pcg.group_id=gc.group_id)) JOIN courses c ON c.id=gc.course_id
    WHERE p.id=? AND p.published=1 AND ${viableGroup} AND ${viablePlanGroups} AND c.published=1
    ORDER BY c.title,c.id`).all(planId)).map(course);
}
export async function getAdminPlans(actorId: number): Promise<MembershipPlan[]> {
  await assertAdmin(actorId);
  return plansFromRows(await getDb().prepare("SELECT p.*,g.name AS group_name FROM membership_plans p JOIN membership_groups g ON g.id=p.group_id ORDER BY p.name,p.id").all());
}
export async function getAdminPlan(actorId: number, planId: number): Promise<MembershipPlan | undefined> {
  await assertAdmin(actorId); positiveId.parse(planId);
  const row = await getDb().prepare("SELECT p.*,g.name AS group_name FROM membership_plans p JOIN membership_groups g ON g.id=p.group_id WHERE p.id=?").get(planId);
  return row ? (await plansFromRows([row]))[0] : undefined;
}
export async function savePlan(actorId: number, planId: number | undefined, input: MembershipPlanInput): Promise<number> {
  return transaction(async () => {
    await assertAdmin(actorId); if (planId !== undefined) positiveId.parse(planId);
    const value = planSchema.parse(input);
    const groupIds = value.groupIds ?? [value.groupId];
    if (new Set(groupIds).size !== groupIds.length || !groupIds.includes(value.groupId)) throw new DomainError("Välj varje grupp en gång och behåll huvudgruppen bland valen.");
    for (const groupId of groupIds) {
      const group = await getDb().prepare("SELECT published FROM membership_groups WHERE id=?").get(groupId);
      if (!group) throw new DomainError("Välj grupper som finns på webbplatsen.");
      if (value.published && (!group.published || await getDb().prepare(`SELECT c.id FROM membership_group_courses gc JOIN courses c ON c.id=gc.course_id WHERE gc.group_id=? AND c.published<>1`).get(groupId)))
        throw new DomainError("Publicera alla grupper och deras kurser först eller spara medlemskapet som utkast.");
    }
    const target = await getDb().prepare("SELECT * FROM membership_groups WHERE id=?").get(value.groupId);
    if (!target) throw new DomainError("Välj en grupp som finns.");
    if (value.published && (!target.published || await getDb().prepare(`SELECT c.id FROM membership_group_courses gc JOIN courses c ON c.id=gc.course_id WHERE gc.group_id=? AND c.published<>1`).get(value.groupId)))
      throw new DomainError("Publicera gruppen och dess kurser först eller spara medlemskapet som utkast.");
    const path = slug(value.slug, value.name);
    if (path === "bas") throw new DomainError("Välj en annan webbadress. Adressen bas är reserverad för det kostnadsfria Bas-medlemskapet.");
    if (["kassa", "bekraftelse", "villkor"].includes(path)) throw new DomainError("Välj en annan webbadress för medlemskapet.");
    if (await getDb().prepare("SELECT id FROM membership_plans WHERE slug=? AND id<>?").get(path, planId ?? -1))
      throw new DomainError("Ett annat medlemskap använder redan den webbadressen.");
    let now = new Date().toISOString();
    if (planId !== undefined) {
      const current = await getDb().prepare("SELECT * FROM membership_plans WHERE id=?").get(planId);
      if (!current) throw new DomainError("Medlemskapet finns inte.");
      assertRevision(current, value.expectedUpdatedAt, "Medlemskapet");
      if (Number(current.group_id) !== value.groupId && await getDb().prepare("SELECT id FROM membership_checkout_attempts WHERE plan_id=? LIMIT 1").get(planId))
        throw new DomainError("Gruppen kan inte ändras efter att en betalning har påbörjats. Skapa ett nytt medlemskap för en annan grupp.");
      now = nextRevision(current.updated_at);
      const result = await getDb().prepare("UPDATE membership_plans SET group_id=?,name=?,slug=?,description=?,price_ore=?,vat_percent=?,interval=?,published=?,updated_at=? WHERE id=? AND updated_at=?")
        .run(value.groupId, value.name, path, value.description, value.priceOre, value.vatPercent, value.interval, value.published ? 1 : 0, now, planId, value.expectedUpdatedAt!);
      if (!result.changes) throw new DomainError("Medlemskapet har ändrats. Ladda om sidan.");
      await savePlanGroups(planId, groupIds);
      return planId;
    }
    const newId = Number((await getDb().prepare("INSERT INTO membership_plans(group_id,name,slug,description,price_ore,vat_percent,interval,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(value.groupId, value.name, path, value.description, value.priceOre, value.vatPercent, value.interval, value.published ? 1 : 0, now, now)).lastInsertRowid);
    await savePlanGroups(newId, groupIds);
    return newId;
  });
}
async function savePlanGroups(planId: number, groupIds: number[]) {
  await getDb().prepare("DELETE FROM membership_plan_groups WHERE plan_id=?").run(planId);
  for (const groupId of groupIds) await getDb().prepare("INSERT INTO membership_plan_groups(plan_id,group_id) VALUES(?,?)").run(planId, groupId);
}
export async function getMembershipSettings(): Promise<MembershipSettings> {
  const row = (await getDb().prepare("SELECT * FROM membership_settings WHERE id=1").get())!;
  return { salesEnabled: !!row.sales_enabled, terms: String(row.terms), updatedAt: String(row.updated_at) };
}
export async function saveMembershipSettings(actorId: number, input: { salesEnabled: boolean; terms: string; expectedUpdatedAt?: string }): Promise<MembershipSettings> {
  return transaction(async () => {
    await assertAdmin(actorId);
    const value = z.object({ salesEnabled: z.boolean(), terms: text(20000), expectedUpdatedAt: revision }).parse(input);
    const current = (await getDb().prepare("SELECT * FROM membership_settings WHERE id=1").get())!;
    assertRevision(current, value.expectedUpdatedAt, "Inställningarna");
    if (value.salesEnabled) {
      if (!process.env.STRIPE_SECRET_KEY || !process.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET || !process.env.MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID)
        throw new DomainError("Lägg till Stripe, MEMBERSHIP_STRIPE_WEBHOOK_SECRET och MEMBERSHIP_STRIPE_PORTAL_CONFIGURATION_ID innan du aktiverar medlemsförsäljning.");
      appUrl();
      if (!z.email().safeParse((await getSettings()).email).success) throw new DomainError("Fyll i en fungerande kontaktadress i webbplatsens inställningar.");
      if (value.terms.length < 20) throw new DomainError("Fyll i medlemsvillkor innan du aktiverar försäljningen.");
      if (!await getDb().prepare(`SELECT p.id FROM membership_plans p JOIN membership_groups g ON g.id=p.group_id WHERE p.published=1 AND ${viableGroup} AND ${viablePlanGroups} LIMIT 1`).get())
        throw new DomainError("Publicera minst ett medlemskap med en publicerad grupp och publicerade kurser innan du aktiverar försäljningen.");
    }
    const now = nextRevision(current.updated_at);
    if (!(await getDb().prepare("UPDATE membership_settings SET sales_enabled=?,terms=?,updated_at=? WHERE id=1 AND updated_at=?")
      .run(value.salesEnabled ? 1 : 0, value.terms, now, value.expectedUpdatedAt!)).changes) throw new DomainError("Inställningarna har ändrats. Ladda om sidan.");
    return { salesEnabled: value.salesEnabled, terms: value.terms, updatedAt: now };
  });
}

const groupPermission = `(u.role='admin' OR (u.role='student' AND ${membershipGroupAccessSql()}))`;
export async function getPortalGroups(userId: number): Promise<MembershipGroup[]> {
  positiveId.parse(userId);
  const groups = await groupsFromRows(await getDb().prepare(`SELECT g.* FROM membership_groups g JOIN users u ON u.id=?
    WHERE ${groupPermission} ORDER BY g.name,g.id`).all(userId), true);
  const access = await getStudentGroupAccessStates(userId);
  return groups.map(group => ({ ...group, access: access.find(state => state.id === group.id) }));
}
export async function getAccessibleGroup(userId: number, groupId: number): Promise<MembershipGroup | undefined> {
  positiveId.parse(userId); positiveId.parse(groupId);
  const row = await getDb().prepare(`SELECT g.* FROM membership_groups g JOIN users u ON u.id=? WHERE g.id=? AND ${groupPermission}`).get(userId, groupId);
  return row ? (await groupsFromRows([row], true))[0] : undefined;
}
async function postsFromRows(rows: Row[]): Promise<MembershipPost[]> {
  if (!rows.length) return [];
  const attachments = await getDb().prepare(`SELECT pu.post_id,m.id,m.filename,m.content_type,m.size
    FROM membership_post_uploads pu JOIN membership_uploads m ON m.id=pu.upload_id AND m.kind='document'
    WHERE pu.post_id IN (${rows.map(() => "?").join(",")}) ORDER BY m.created_at,m.id`).all(...rows.map(row => Number(row.id)));
  return rows.map(row => ({ id: Number(row.id), groupId: Number(row.group_id), title: String(row.title),
    body: parseGroupRichText(row.body_json), period: row.period == null ? null : String(row.period), published: !!row.published,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    uploads: attachments.filter(item => Number(item.post_id) === Number(row.id)).map((item): UploadedMaterial => ({
      id: String(item.id), name: String(item.filename), contentType: String(item.content_type), size: Number(item.size), url: `/api/gruppfiler/${item.id}`,
    })) }));
}
const postPermission = `(u.role='admin' OR (u.role='student' AND p.published=1 AND ${membershipGroupAccessSql("u.id", "p.group_id")}))`;
export async function getGroupPosts(userId: number, groupId: number): Promise<MembershipPost[]> {
  positiveId.parse(userId); positiveId.parse(groupId);
  return postsFromRows(await getDb().prepare(`SELECT p.* FROM membership_posts p JOIN users u ON u.id=?
    WHERE p.group_id=? AND ${postPermission} ORDER BY COALESCE(p.period,'') DESC,p.created_at DESC,p.id DESC`).all(userId, groupId));
}
export async function getAccessiblePost(userId: number, groupId: number, postId: number): Promise<MembershipPost | undefined> {
  positiveId.parse(userId); positiveId.parse(groupId); positiveId.parse(postId);
  const row = await getDb().prepare(`SELECT p.* FROM membership_posts p JOIN users u ON u.id=? WHERE p.group_id=? AND p.id=? AND ${postPermission}`).get(userId, groupId, postId);
  return row ? (await postsFromRows([row]))[0] : undefined;
}
export async function getAdminPosts(actorId: number, groupId: number): Promise<MembershipPost[]> {
  await assertAdmin(actorId); positiveId.parse(groupId);
  return postsFromRows(await getDb().prepare("SELECT * FROM membership_posts WHERE group_id=? ORDER BY COALESCE(period,'') DESC,created_at DESC,id DESC").all(groupId));
}
export async function getAdminPost(actorId: number, groupId: number, postId: number): Promise<MembershipPost | undefined> {
  await assertAdmin(actorId); positiveId.parse(groupId); positiveId.parse(postId);
  const row = await getDb().prepare("SELECT * FROM membership_posts WHERE group_id=? AND id=?").get(groupId, postId);
  return row ? (await postsFromRows([row]))[0] : undefined;
}
export async function savePost(actorId: number, postId: number | undefined, input: MembershipPostInput): Promise<number> {
  return transaction(async () => {
    await assertAdmin(actorId); if (postId !== undefined) positiveId.parse(postId);
    const value = postSchema.parse(input);
    if (!await getDb().prepare("SELECT id FROM membership_groups WHERE id=?").get(value.groupId)) throw new DomainError("Gruppen finns inte.");
    let body: ReturnType<typeof parseGroupRichText>;
    try { body = parseGroupRichText(value.body); }
    catch (error) { throw new DomainError(error instanceof Error ? error.message : "Kontrollera inläggets innehåll."); }
    const documents = [...new Set(value.uploadIds)];
    if (documents.length !== value.uploadIds.length) throw new DomainError("Välj varje gruppfil bara en gång.");
    const images = groupRichTextImageIds(body);
    for (const [ids, kind] of [[documents, "document"], [images, "image"]] as const) {
      for (const uploadId of ids)
        if (!await getDb().prepare("SELECT id FROM membership_uploads WHERE id=? AND group_id=? AND kind=?").get(uploadId, value.groupId, kind))
          throw new DomainError("Välj uppladdade bilder och dokument som tillhör den här gruppen.");
    }
    if (value.published && !body && !documents.length) throw new DomainError("Lägg till innehåll eller en gruppfil innan du publicerar inlägget.");
    let savedId = postId;
    let now = new Date().toISOString();
    if (postId !== undefined) {
      const current = await getDb().prepare("SELECT * FROM membership_posts WHERE id=? AND group_id=?").get(postId, value.groupId);
      if (!current) throw new DomainError("Inlägget tillhör inte denna grupp.");
      assertRevision(current, value.expectedUpdatedAt, "Inlägget"); now = nextRevision(current.updated_at);
      if (!(await getDb().prepare("UPDATE membership_posts SET title=?,body_json=?,period=?,published=?,updated_at=? WHERE id=? AND group_id=? AND updated_at=?")
        .run(value.title, body ? JSON.stringify(body) : null, value.period, value.published ? 1 : 0, now, postId, value.groupId, value.expectedUpdatedAt!)).changes)
        throw new DomainError("Inlägget har ändrats. Ladda om sidan.");
    } else {
      savedId = Number((await getDb().prepare("INSERT INTO membership_posts(group_id,title,body_json,period,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(value.groupId, value.title, body ? JSON.stringify(body) : null, value.period, value.published ? 1 : 0, now, now)).lastInsertRowid);
    }
    await getDb().prepare("DELETE FROM membership_post_uploads WHERE post_id=?").run(savedId!);
    for (const uploadId of [...documents, ...images])
      await getDb().prepare("INSERT INTO membership_post_uploads(post_id,upload_id) VALUES(?,?)").run(savedId!, uploadId);
    return savedId!;
  });
}
export async function getAdminAssignments(actorId: number, groupId?: number): Promise<MembershipAssignment[]> {
  await assertAdmin(actorId); if (groupId !== undefined) positiveId.parse(groupId);
  return (await getDb().prepare(`SELECT a.*,u.name,u.email,g.name AS group_name FROM membership_assignments a
    JOIN users u ON u.id=a.user_id JOIN membership_groups g ON g.id=a.group_id ${groupId === undefined ? "" : "WHERE a.group_id=?"}
    ORDER BY a.created_at DESC,a.id DESC`).all(...(groupId === undefined ? [] : [groupId]))).map(row => ({
      id: Number(row.id), userId: Number(row.user_id), groupId: Number(row.group_id), name: String(row.name), email: String(row.email),
      groupName: String(row.group_name), expiresAt: row.expires_at == null ? null : String(row.expires_at),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
}
export async function assignGroup(actorId: number, input: { email: string; groupId: number; expiresAt: string | null }): Promise<number> {
  return transaction(async () => {
    await assertAdmin(actorId);
    const value = z.object({ email: emailSchema, groupId: positiveId, expiresAt: z.iso.datetime().nullable() }).parse(input);
    if (value.expiresAt !== null && Date.parse(value.expiresAt) <= Date.now()) throw new DomainError("Välj ett framtida slutdatum för medlemskapet.");
    if (!await getDb().prepare("SELECT id FROM membership_groups WHERE id=?").get(value.groupId)) throw new DomainError("Gruppen finns inte.");
    const student = await getDb().prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND role='student' AND email_verified_at IS NOT NULL").get(value.email);
    if (!student) throw new DomainError("Eleven behöver ett befintligt elevkonto med verifierad e-postadress.");
    const previous = await getDb().prepare("SELECT * FROM membership_assignments WHERE user_id=? AND group_id=?").get(Number(student.id), value.groupId);
    const now = previous ? nextRevision(previous.updated_at) : new Date().toISOString();
    await getDb().prepare(`INSERT INTO membership_assignments(user_id,group_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,group_id) DO UPDATE SET expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
      .run(Number(student.id), value.groupId, value.expiresAt, now, now);
    return Number((await getDb().prepare("SELECT id FROM membership_assignments WHERE user_id=? AND group_id=?").get(Number(student.id), value.groupId))!.id);
  });
}
export async function removeAssignment(actorId: number, assignmentId: number): Promise<void> {
  await transaction(async () => {
    await assertAdmin(actorId); positiveId.parse(assignmentId);
    if (!(await getDb().prepare("DELETE FROM membership_assignments WHERE id=?").run(assignmentId)).changes) throw new DomainError("Den manuella grupptillgången finns inte.");
  });
}
