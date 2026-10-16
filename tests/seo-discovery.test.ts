import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

type Rule = { userAgent: string | string[]; allow?: string; disallow?: string | string[] };
type Snapshot = {
  sitemap: { url: string; lastModified?: string }[];
  robots: { rules: Rule | Rule[]; sitemap?: string };
  llms: { status: number; text: string; type: string | null; cache: string | null; indexing: string | null };
};
type DiscoveryResults = {
  production: Snapshot;
  unpublished: Snapshot;
  preview: Snapshot;
  local: Snapshot;
  installation: Snapshot;
  pages: string[];
};
const run = promisify(execFile);
const directory = mkdtempSync(join(tmpdir(), "tibb-seo-discovery-"));
const truncatedSlug = `${"a".repeat(99)}-`;
let results: DiscoveryResults;

before(async () => {
  const env = { ...process.env };
  for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "APP_URL", "SITE_URL", "VERCEL_ENV"]) delete env[key];
  env.TIBB_DATABASE_PATH = join(directory, "discovery.sqlite");
  env.SITE_URL = "https://tibbnu.vercel.app";
  env.VERCEL_ENV = "production";
  env.NODE_ENV = "production";

  // The React server condition permits importing server-only data helpers.
  // All database mutations take place in this child process's fresh local file.
  const script = `
    const { getDb } = require('./src/lib/db.ts');
    const { slug } = require('./src/lib/validation.ts');
    const { PUBLIC_PAGES } = require('./src/lib/seo.ts');
    const robots = require('./src/app/robots.ts').default;
    const sitemap = require('./src/app/sitemap.ts').default;
    const { GET } = require('./src/app/llms.txt/route.ts');
    (async () => {
      const db = getDb();
      try {
        await db.initialize();
        await db.prepare('DELETE FROM articles').run();
        await db.prepare('DELETE FROM courses').run();
        const date = '2026-05-01T10:11:12.000Z';
        const truncatedSlug = slug('', 'a'.repeat(99) + ' b');
        for (const [id, title, slug, published, updated] of [
          [1000, 'Offentlig [artikel]\\nNy rad', 'public-article', 1, date],
          [1001, 'Hemlig artikel', 'draft-article', 0, date],
          [1002, 'Artikel utan datum', 'invalid-date', 1, 'not-a-date'],
          [1003, 'Felaktig sökväg', '../admin?token=private', 1, date],
          [1004, 'Felaktigt kalenderdatum', 'invalid-calendar-date', 1, '2026-02-31T10:11:12.000Z'],
          [1005, 'Lång offentlig artikel', truncatedSlug, 1, date],
        ]) {
          await db.prepare('INSERT INTO articles(id,title,slug,excerpt,body,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(id, title, slug, 'Public excerpt', 'PRIVATE_ARTICLE_BODY', published, date, updated);
        }
        for (const [id, title, slug, published] of [
          [1000, 'Öppen kurs', 'public-course', 1],
          [1001, 'Hemlig kurs', 'private-course', 0],
          [1002, 'Lång offentlig kurs', truncatedSlug, 1],
        ]) {
          await db.prepare('INSERT INTO courses(id,title,slug,description,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
            .run(id, title, slug, 'PRIVATE_COURSE_DESCRIPTION', published, date, date);
        }
        for (const [id, title, slug, published, secondCourseId] of [
          [2000, 'Öppet kurspaket', 'public-bundle', 1, 1002],
          [2001, 'SECRET_DRAFT_BUNDLE', 'draft-bundle', 0, 1002],
          [2002, 'SECRET_UNPUBLISHED_CHILD', 'hidden-child-bundle', 1, 1001],
        ]) {
          await db.prepare('INSERT INTO courses(id,title,slug,description,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
            .run(id, title, slug, 'PRIVATE_BUNDLE_DESCRIPTION', published, date, date);
          await db.prepare('INSERT INTO course_bundles(course_id) VALUES(?)').run(id);
          await db.prepare('INSERT INTO course_bundle_courses(bundle_course_id,course_id) VALUES(?,?)').run(id, 1000);
          await db.prepare('INSERT INTO course_bundle_courses(bundle_course_id,course_id) VALUES(?,?)').run(id, secondCourseId);
        }
        await db.prepare('INSERT INTO lessons(id,course_id,title,body,video_url,material_url) VALUES(?,?,?,?,?,?)')
          .run(1000, 1000, 'Privat lektionsrubrik', 'PRIVATE_LESSON_BODY', 'https://private.example.test/video', 'https://private.example.test/material');
        await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
          .run(1000, 'private-admin@example.test', 'PRIVATE_ADMIN_NAME', 'private-test-hash', 'admin', date);
        await db.prepare('INSERT INTO uploads(id,kind,filename,content_type,size,storage_path,storage_provider,uploader_id,course_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run('private-material', 'lesson-material', 'PRIVATE_FILENAME.pdf', 'application/pdf', 100, '/PRIVATE_STORAGE_PATH.pdf', 'local', 1000, 1000, date);
        await db.prepare('INSERT INTO lesson_materials(lesson_id,upload_id) VALUES(?,?)').run(1000, 'private-material');

        async function snapshot() {
          const map = await sitemap();
          const rules = robots();
          const response = await GET();
          return { sitemap: map, robots: rules, llms: {
            status: response.status, text: await response.text(),
            type: response.headers.get('content-type'), cache: response.headers.get('cache-control'),
            indexing: response.headers.get('x-robots-tag'),
          }};
        }
        const production = await snapshot();
        await db.prepare('UPDATE articles SET published=0 WHERE id=1000').run();
        await db.prepare('UPDATE courses SET published=0 WHERE id=1000').run();
        const unpublished = await snapshot();
        process.env.VERCEL_ENV = 'preview';
        const preview = await snapshot();
        delete process.env.VERCEL_ENV;
        process.env.NODE_ENV = 'development';
        const local = await snapshot();
        process.env.NODE_ENV = 'production';
        process.env.VERCEL_ENV = 'production';
        process.env.VERCEL = '1';
        const installation = await snapshot();
        console.log(JSON.stringify({ production, unpublished, preview, local, installation, pages: PUBLIC_PAGES.map(page => page.path) }));
      } finally { await db.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const { stdout } = await run(process.execPath, ["--conditions=react-server", "--import=tsx", "--eval", script], {
    cwd: resolve("."), env, timeout: 60_000, maxBuffer: 2_000_000,
  });
  results = JSON.parse(stdout.trim()) as DiscoveryResults;
});

after(async () => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("tibb-seo-discovery-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

test("the production sitemap discovers only canonical public pages and currently published content", () => {
  const urls = results.production.sitemap.map((entry) => entry.url);
  const expected = results.pages.map((path) => new URL(path, "https://tibbnu.vercel.app").href);
  expected.push("https://tibbnu.vercel.app/medlemskap/bas");
  expected.push("https://tibbnu.vercel.app/artiklar/public-article", "https://tibbnu.vercel.app/artiklar/invalid-date", "https://tibbnu.vercel.app/artiklar/invalid-calendar-date", `https://tibbnu.vercel.app/artiklar/${truncatedSlug}`, "https://tibbnu.vercel.app/kurser/public-course", `https://tibbnu.vercel.app/kurser/${truncatedSlug}`, "https://tibbnu.vercel.app/paket/public-bundle");
  assert.deepEqual(urls.toSorted(), expected.toSorted());
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every((url) => new URL(url).origin === "https://tibbnu.vercel.app" && !new URL(url).search));
  assert.ok(!urls.some((url) => /draft-article|private-course|admin|elevportal|api\/uploads|token=/.test(url)));
});

test("sitemap dates come from valid saved update dates and are omitted for static pages and invalid dates", () => {
  for (const entry of results.production.sitemap) {
    if (/\/(public-article|public-course|public-bundle)$/.test(entry.url) || entry.url.endsWith(`/${truncatedSlug}`)) {
      assert.equal(entry.lastModified, "2026-05-01T10:11:12.000Z");
    } else if (entry.url.endsWith("/medlemskap/bas")) {
      assert.ok(entry.lastModified && Number.isFinite(Date.parse(entry.lastModified)));
    } else {
      assert.equal(Object.hasOwn(entry, "lastModified"), false, entry.url);
    }
  }
});

test("published packages use package URLs and drafts or unpublished contents remain private", () => {
  assert.ok(results.production.llms.text.includes("https://tibbnu.vercel.app/paket/public-bundle"));
  for (const snapshot of [results.production, results.unpublished]) {
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /\/kurser\/public-bundle|draft-bundle|hidden-child-bundle|SECRET_DRAFT_BUNDLE|SECRET_UNPUBLISHED_CHILD/);
  }
  assert.ok(!results.unpublished.sitemap.some(entry => entry.url.endsWith("/paket/public-bundle")));
  assert.ok(!results.unpublished.llms.text.includes("/paket/public-bundle"));
});

test("specific AI search crawler groups retain every private and query exclusion from the wildcard group", () => {
  const rules = results.production.robots.rules;
  assert.ok(Array.isArray(rules));
  assert.deepEqual(rules.map((rule) => rule.userAgent), ["*", "OAI-SearchBot", "PerplexityBot"]);
  for (const rule of rules) {
    assert.equal(rule.allow, "/");
    for (const path of ["/admin", "/elevportal", "/api/", "/bokning", "/*?*"]) {
      assert.ok(Array.isArray(rule.disallow) && rule.disallow.includes(path), `${rule.userAgent}: ${path}`);
    }
    for (const form of ["/logga-in", "/registrera", "/setup", "/installation"]) {
      assert.ok(Array.isArray(rule.disallow) && !rule.disallow.includes(form), `${form} must allow reading noindex`);
    }
    assert.deepEqual(rule.disallow, rules[0].disallow);
  }
  assert.equal(results.production.robots.sitemap, "https://tibbnu.vercel.app/sitemap.xml");
  assert.ok(!JSON.stringify(rules).includes("GPTBot"));
});

test("existing safe CMS slugs ending with a truncation hyphen remain discoverable without allowing paths or queries", () => {
  assert.equal(truncatedSlug.length, 100);
  for (const [prefix, title] of [["artiklar", "Lång offentlig artikel"], ["kurser", "Lång offentlig kurs"]]) {
    const url = `https://tibbnu.vercel.app/${prefix}/${truncatedSlug}`;
    assert.ok(results.production.sitemap.some((entry) => entry.url === url));
    assert.ok(results.production.llms.text.includes(`[${title}](${url})`));
  }
  assert.ok(!results.production.sitemap.some((entry) => entry.url.includes("token=private")));
  assert.doesNotMatch(results.production.llms.text, /Felaktig sökväg|token=private|\.\.\/admin/);
});

test("the optional text map contains public links and a truthful selftest boundary without private records", () => {
  const map = results.production.llms;
  assert.equal(map.status, 200);
  assert.equal(map.type, "text/plain; charset=utf-8");
  assert.equal(map.cache, "no-store");
  assert.equal(map.indexing, "noindex");
  assert.ok(map.text.includes("https://tibbnu.vercel.app/artiklar/public-article"));
  assert.ok(map.text.includes("https://tibbnu.vercel.app/kurser/public-course"));
  assert.ok(map.text.includes("Offentlig \\[artikel\\] Ny rad"));
  assert.match(map.text, /inte ett medicinskt diagnostiskt verktyg/);
  assert.match(map.text, /ingen garanti om indexering/);
  assert.doesNotMatch(map.text, /PRIVATE_|private-admin|draft-article|private-course|Felaktig sökväg|Privat lektionsrubrik|\/api\/|\/elevportal|private\.example\.test/);
});

test("unpublishing articles and courses removes them from the next sitemap and text-map request", () => {
  const serialized = JSON.stringify(results.unpublished);
  assert.doesNotMatch(serialized, /public-article|public-course/);
  assert.ok(results.unpublished.sitemap.some((entry) => entry.url.endsWith("/artiklar/invalid-date")));
});

test("preview, local and unconfigured installations deny crawling and never expose sitemap content", () => {
  for (const state of [results.preview, results.local, results.installation]) {
    assert.deepEqual(state.sitemap, []);
    assert.deepEqual(state.robots.rules, { userAgent: "*", disallow: "/" });
    assert.equal(Object.hasOwn(state.robots, "sitemap"), false);
    assert.notEqual(state.llms.status, 200);
    assert.equal(state.llms.indexing, "noindex");
    assert.equal(state.llms.cache, "no-store");
    assert.doesNotMatch(state.llms.text, /public-article|public-course|https:\/\//);
  }
});
