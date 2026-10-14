import { getDb, hasCourseAccess } from "./db";

export type StudentAccessSource = "manual" | "subscription" | "course_purchase";
export type StudentAccessState = {
  id: number;
  title: string;
  status: "active" | "expired" | "blocked" | "unpublished";
  available: boolean;
  expiresAt: string | null;
  sources: StudentAccessSource[];
};

type Grant = { group_id: unknown; source: unknown; expires_at: unknown; active: unknown; blocked: unknown };
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
async function isVerifiedStudent(userId: number) {
  return validId(userId) && !!await getDb().prepare("SELECT id FROM users WHERE id=? AND role='student' AND email_verified_at IS NOT NULL").get(userId);
}

// Read only identities already associated with this student. Material, descriptions,
// posts, and files continue to use the existing publication/access checks.
async function groupGrants(userId: number): Promise<Grant[]> {
  return getDb().prepare(`
    SELECT group_id,'manual' AS source,expires_at,
      (expires_at IS NULL OR julianday(expires_at)>julianday('now')) AS active,0 AS blocked
      FROM membership_assignments WHERE user_id=?
    UNION ALL
    SELECT group_id,'subscription',paid_until,
      (status IN ('active','past_due') AND blocked=0 AND julianday(paid_until)>julianday('now')),
      (blocked=1 OR status NOT IN ('active','past_due'))
      FROM membership_subscriptions WHERE user_id=? AND julianday(paid_until) IS NOT NULL
    UNION ALL
    SELECT p.group_id,'course_purchase',p.group_expires_at,
      (p.revoked=0 AND (p.group_expires_at IS NULL OR julianday(p.group_expires_at)>julianday('now'))),p.revoked
      FROM course_purchases p JOIN course_purchase_attempts a ON a.id=p.attempt_id AND a.status='paid'
      WHERE p.user_id=? AND p.group_id IS NOT NULL AND julianday(p.paid_at)<=julianday('now')
  `).all(userId, userId, userId) as Promise<Grant[]>;
}

function grantState(id: number, title: string, published: boolean, grants: Grant[]): StudentAccessState {
  const active = grants.filter(grant => !!grant.active);
  const selected = active.length ? active : grants;
  const unlimited = selected.some(grant => grant.expires_at === null);
  const dates = selected.map(grant => String(grant.expires_at)).filter(date => Number.isFinite(Date.parse(date))).sort((a, b) => Date.parse(b) - Date.parse(a));
  return {
    id, title, available: published && active.length > 0,
    status: !published ? "unpublished" : active.length ? "active" : grants.some(grant => !grant.blocked) ? "expired" : "blocked",
    expiresAt: unlimited ? null : dates[0] ?? null,
    sources: [...new Set(selected.map(grant => grant.source as StudentAccessSource))],
  };
}

export async function getStudentGroupAccessStates(userId: number): Promise<StudentAccessState[]> {
  if (!await isVerifiedStudent(userId)) return [];
  const grants = await groupGrants(userId);
  const ids = [...new Set(grants.map(grant => Number(grant.group_id)))];
  if (!ids.length) return [];
  const rows = await getDb().prepare(`SELECT id,name,published FROM membership_groups WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY name,id`).all(...ids);
  return rows.map(row => grantState(Number(row.id), String(row.name), !!row.published, grants.filter(grant => Number(grant.group_id) === Number(row.id))));
}

export async function getStudentGroupAccessState(userId: number, groupId: number): Promise<StudentAccessState | undefined> {
  if (!validId(groupId)) return undefined;
  return (await getStudentGroupAccessStates(userId)).find(state => state.id === groupId);
}

export async function getStudentGroupPostAccessState(userId: number, groupId: number, postId: number): Promise<StudentAccessState | undefined> {
  if (!validId(postId)) return undefined;
  const access = await getStudentGroupAccessState(userId, groupId);
  if (!access) return undefined;
  const known = await getDb().prepare(`SELECT p.id FROM membership_posts p JOIN users u ON u.id=?
    WHERE p.id=? AND p.group_id=? AND p.published=1 AND u.role='student' AND u.email_verified_at IS NOT NULL`).get(userId, postId, groupId);
  return known ? access : undefined;
}

export async function getStudentCourseAccessState(userId: number, courseId: number): Promise<StudentAccessState | undefined> {
  if (!validId(courseId) || !await isVerifiedStudent(userId)) return undefined;
  const row = await getDb().prepare(`SELECT c.id,c.title,c.published,
    EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=? AND e.course_id=c.id) AS manual,
    EXISTS(SELECT 1 FROM course_purchases p JOIN course_purchase_attempts a ON a.id=p.attempt_id AND a.status='paid'
      WHERE p.user_id=? AND p.course_id=c.id AND julianday(p.paid_at)<=julianday('now')) AS purchased,
    EXISTS(SELECT 1 FROM course_purchases p JOIN course_purchase_attempts a ON a.id=p.attempt_id AND a.status='paid'
      WHERE p.user_id=? AND p.course_id=c.id AND p.revoked=0 AND julianday(p.paid_at)<=julianday('now')) AS paid_active,
    EXISTS(SELECT 1 FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE p.user_id=? AND l.course_id=c.id) AS studied
    FROM courses c WHERE c.id=?`).get(userId, userId, userId, userId, courseId);
  if (!row) return undefined;
  const [states, links] = await Promise.all([
    getStudentGroupAccessStates(userId),
    getDb().prepare("SELECT group_id FROM membership_group_courses WHERE course_id=?").all(courseId),
  ]);
  const linked = states.filter(state => links.some(link => Number(link.group_id) === state.id));
  // A current group association alone cannot prove that a student previously saw
  // a now-private course. Keep hidden course identities private unless that
  // student's direct grant, purchase, or saved progress establishes history.
  if (!row.published && !row.manual && !row.purchased && !row.studied) return undefined;
  if (!row.manual && !row.purchased && !row.studied && !linked.length) return undefined;
  const available = await hasCourseAccess(userId, courseId);
  const activeGroups = linked.filter(state => state.available);
  const permanent = !!row.manual || !!row.paid_active;
  const selected = activeGroups.length ? activeGroups : linked;
  const unlimited = permanent || selected.some(state => state.expiresAt === null);
  const expires = selected.map(state => state.expiresAt).filter((date): date is string => date !== null).sort((a, b) => Date.parse(b) - Date.parse(a));
  const sources = new Set<StudentAccessSource>(selected.flatMap(state => state.sources));
  if (row.manual) sources.add("manual");
  if (row.paid_active || (!available && row.purchased)) sources.add("course_purchase");
  return { id: courseId, title: String(row.title), available,
    status: !row.published || (!available && !permanent && linked.length > 0 && linked.every(state => state.status === "unpublished")) ? "unpublished"
      : available ? "active" : row.purchased && !row.paid_active ? "blocked" : linked.some(state => state.status === "expired") ? "expired" : "blocked",
    expiresAt: unlimited ? null : expires[0] ?? null, sources: [...sources] };
}
