import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  getArticle, getArticleById, getArticles, getCourse, getCourseById,
  getCourses, getDb, getLessonOutline, getSettings, getUser,
} from "../src/lib/db";
import { getBusinessSettings, getCourseInformation } from "../src/lib/business-settings";
import { DEFAULT_BUSINESS_SETTINGS, EMPTY_COURSE_INFORMATION } from "../src/lib/business-config";
import { DEMO_ARTICLES, DEMO_COURSES, DEMO_LESSON_OUTLINES, DEMO_SETTINGS } from "../src/lib/demo-data";
import { DEMO_MODE } from "../src/lib/demo-mode";

before(() => {
  // The presentation has to work in a fresh deployment with no credentials,
  // local database, or account setup. Do not load a developer's .env file.
  for (const key of Object.keys(process.env)) {
    if (/^(?:DATABASE_URL|TURSO_|TIBB_DATABASE_PATH|SUPABASE_|NEXT_PUBLIC_SUPABASE_|STRIPE_|KIT_)/.test(key)) {
      delete process.env[key];
    }
  }
});

test("demo settings and business information work without a configured database", async () => {
  assert.equal(DEMO_MODE, true);
  assert.deepEqual(await getSettings(), DEMO_SETTINGS);
  assert.equal((await getSettings()).stripeEnabled, false);
  assert.equal((await getSettings()).payOnSite, false);
  assert.deepEqual(await getBusinessSettings(), DEFAULT_BUSINESS_SETTINGS);
  // A caller cannot alter the shared settings used by a later render.
  const settings = await getSettings();
  settings.siteName = "Changed only in this caller";
  assert.equal((await getSettings()).siteName, "Slowlax");
});

test("article lists and known details use only the checked-in public content", async () => {
  const articles = await getArticles({ publishedOnly: true });
  assert.ok(articles.length > 0);
  assert.deepEqual(articles, DEMO_ARTICLES);
  assert.ok(articles.every(article => article.published));
  for (const article of articles) {
    assert.deepEqual(await getArticle(article.slug, { publishedOnly: true }), article);
    assert.deepEqual(await getArticleById(article.id), article);
    assert.ok(Number.isFinite(Date.parse(article.createdAt)));
    assert.deepEqual(Object.keys(article).sort(), [
      "id", "title", "slug", "excerpt", "body", "published", "createdAt", "updatedAt",
    ].sort());
  }
  assert.equal(await getArticle("an-unknown-article"), undefined);
  assert.equal(await getArticleById(-1), undefined);
  assert.equal(await getArticle("../../admin"), undefined);
});

test("course details, public information and lesson outlines are static presentation examples", async () => {
  const courses = await getCourses({ publishedOnly: true });
  assert.deepEqual(courses, DEMO_COURSES);
  assert.deepEqual(courses.map(course => course.id), [1, 2, 3]);
  for (const course of courses) {
    assert.deepEqual(await getCourse(course.slug, { publishedOnly: true }), course);
    assert.deepEqual(await getCourseById(course.id), course);
    const information = await getCourseInformation(course);
    assert.ok(information.audience);
    assert.ok(information.learningOutcomes);
    const outline = await getLessonOutline(course.id);
    assert.deepEqual(outline, DEMO_LESSON_OUTLINES[course.id]);
    assert.ok(outline.length > 0);
    assert.ok(outline.every(lesson => lesson.courseId === course.id));
    for (const lesson of outline) {
      // Outlines must not expose lesson bodies, private downloads, or students.
      assert.deepEqual(Object.keys(lesson).sort(), [
        "id", "courseId", "title", "position", "hasVideo", "hasText", "hasMaterial",
      ].sort());
    }
  }
  assert.equal(await getCourse("an-unknown-course"), undefined);
  assert.equal(await getCourseById(-1), undefined);
  assert.deepEqual(await getLessonOutline(-1), []);
  assert.deepEqual(await getCourseInformation({ id: -1, createdAt: "" }), EMPTY_COURSE_INFORMATION);
  assert.deepEqual(await getCourseInformation({ id: 1, createdAt: "an-unrelated-course" }), EMPTY_COURSE_INFORMATION);
});

test("database access and account lookup stay unavailable even when credentials are present", async () => {
  assert.throws(() => getDb(), /presentation demo has no database access/);
  await assert.rejects(() => getUser(1), /presentation demo has no database access/);
  // A Vercel environment accidentally inherited from the regular app cannot
  // turn the static demo into a live account/database application.
  process.env.DATABASE_URL = "postgresql://not-a-real-account:invalid@invalid.invalid/demo";
  process.env.TURSO_DATABASE_URL = "https://invalid.invalid";
  process.env.TURSO_AUTH_TOKEN = "invalid-demo-fixture";
  try {
    assert.throws(() => getDb(), /presentation demo has no database access/);
    await assert.rejects(() => getUser(1), /presentation demo has no database access/);
    assert.deepEqual(await getCourses(), DEMO_COURSES);
    assert.deepEqual(await getSettings(), DEMO_SETTINGS);
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  }
});
