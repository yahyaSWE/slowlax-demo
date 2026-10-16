import "server-only";
import { cache } from "react";
import { getArticle, getCourse, getDb } from "./db";
import { databaseConfigured } from "./database-config";
import { getCourseBundles } from "./course-bundles";

export const getPublicArticle = cache((slug: string) => getArticle(slug, { publishedOnly: true }));
export const getPublicCourse = cache((slug: string) => getCourse(slug, { publishedOnly: true }));

type PublicSeoRecord = { slug: string; title: string; updatedAt: string };
export const getPublicSeoContent = cache(async (): Promise<{
  articles: PublicSeoRecord[]; courses: PublicSeoRecord[]; bundles: PublicSeoRecord[]; installationRequired: boolean;
}> => {
  if (!databaseConfigured()) return { articles: [], courses: [], bundles: [], installationRequired: true };
  const db = getDb();
  const [articles, courses, bundles] = await Promise.all([
    db.prepare("SELECT slug, title, updated_at FROM articles WHERE published = 1 ORDER BY updated_at DESC").all(),
    db.prepare("SELECT slug, title, updated_at FROM courses WHERE published = 1 AND NOT EXISTS(SELECT 1 FROM course_bundles b WHERE b.course_id=courses.id) ORDER BY updated_at DESC").all(),
    getCourseBundles({ publishedOnly: true }),
  ]);
  const publicRecords = (rows: Record<string, unknown>[]) => rows.map((row) => ({
    slug: String(row.slug), title: String(row.title), updatedAt: String(row.updated_at),
  }));
  return { articles: publicRecords(articles), courses: publicRecords(courses), bundles: bundles.map(({ slug, title, updatedAt }) => ({ slug, title, updatedAt })), installationRequired: false };
});
