import { getAccessibleCourse, getCourseProgress, getDb, getLessonOutline, getPortalCourseSummaries } from "./db";
import { getGroupPosts, getPortalGroups } from "./memberships";

export async function getPortalDashboard(userId: number) {
  const [summaries, groups, lastMarks] = await Promise.all([
    getPortalCourseSummaries(userId), getPortalGroups(userId),
    getDb().prepare(`SELECT l.course_id,MAX(p.completed_at) AS last_marked_at FROM progress p
      JOIN lessons l ON l.id=p.lesson_id WHERE p.user_id=? GROUP BY l.course_id`).all(userId),
  ]);
  const courseChoices = await Promise.all(summaries.map(async summary => {
    if (!await getAccessibleCourse(userId, summary.id)) return null;
    const [outline, completed] = await Promise.all([getLessonOutline(summary.id), getCourseProgress(userId, summary.id)]);
    const nextLesson = outline.find(lesson => !completed.includes(lesson.id));
    const lastMarkedAt = lastMarks.find(row => Number(row.course_id) === summary.id)?.last_marked_at;
    return { ...summary, nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
      lastMarkedAt: lastMarkedAt ? String(lastMarkedAt) : null };
  }));
  const courses = courseChoices.filter((course): course is NonNullable<typeof course> => course !== null);
  const resume = [...courses].filter(course => course.nextLesson).sort((a, b) => {
    const aStarted = a.progress > 0 ? 1 : 0, bStarted = b.progress > 0 ? 1 : 0;
    return bStarted - aStarted || Date.parse(b.lastMarkedAt ?? "1970-01-01") - Date.parse(a.lastMarkedAt ?? "1970-01-01") || b.id - a.id;
  })[0] ?? null;
  const groupPosts = await Promise.all(groups.filter(group => group.published).map(async group =>
    (await getGroupPosts(userId, group.id)).filter(post => post.published).map(post => ({
      id: post.id, title: post.title, period: post.period, updatedAt: post.updatedAt,
      groupId: group.id, groupName: group.name, fileCount: post.uploads.length,
    }))));
  const latestMaterials = groupPosts.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id).slice(0, 3);
  return { courses, groups, resume, latestMaterials };
}
