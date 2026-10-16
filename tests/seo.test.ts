import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteUrl, buildOrganizationSchema, createPageMetadata, getSiteUrl, isIndexableDeployment, PRIVATE_METADATA, serializeJsonLd, toIsoDate } from "../src/lib/seo";

function withEnvironment(values: Record<string, string | undefined>, work: () => void) {
  const keys = ["SITE_URL", "APP_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL", "VERCEL_ENV", "VERCEL", "NODE_ENV", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
    work();
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
}

test("canonical origin can migrate independently of payment callbacks and never uses a preview URL", () => {
  withEnvironment({ SITE_URL: "https://tibb.nu", APP_URL: "https://tibbnu.vercel.app", VERCEL_URL: "preview.vercel.app" }, () => {
    assert.equal(getSiteUrl().href, "https://tibb.nu/");
    assert.equal(absoluteUrl("/boka"), "https://tibb.nu/boka");
  });
  withEnvironment({ APP_URL: "http://localhost:3000", VERCEL_URL: "preview.vercel.app" }, () => assert.equal(getSiteUrl().href, "https://slowlax.se/"));
  withEnvironment({ VERCEL_ENV: "preview", APP_URL: "https://preview.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "tibbnu.vercel.app" }, () => assert.equal(getSiteUrl().href, "https://tibbnu.vercel.app/"));
});

test("unsafe, private and non-origin URL configuration cannot become a canonical", () => {
  for (const value of ["http://tibb.nu", "https://name:secret@tibb.nu", "https://tibb.nu/path", "https://tibb.nu/?secret=x", "https://localhost", "https://192.168.1.2", "https://10.0.0.1", "https://[::1]"]) {
    withEnvironment({ SITE_URL: value }, () => assert.equal(getSiteUrl().href, "https://slowlax.se/", value));
  }
  for (const path of ["//attacker.test", "https://attacker.test", "/boka?token=secret", "/\\attacker.test"]) assert.throws(() => absoluteUrl(path));
});

test("only configured production is indexable, including private local next start and installation guards", () => {
  const cases: [Record<string, string>, boolean][] = [
    [{ NODE_ENV: "production", VERCEL_ENV: "production" }, true],
    [{ NODE_ENV: "production", VERCEL_ENV: "preview", SITE_URL: "https://tibb.nu" }, false],
    [{ NODE_ENV: "development", SITE_URL: "https://tibb.nu" }, false],
    [{ NODE_ENV: "production", APP_URL: "http://127.0.0.1:3001", SITE_URL: "https://tibb.nu" }, false],
    [{ NODE_ENV: "production", APP_URL: "https://tibb.nu" }, true],
    [{ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" }, false],
    [{ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production", TURSO_DATABASE_URL: "libsql://example.turso.io", TURSO_AUTH_TOKEN: "test-token" }, true],
  ];
  for (const [env, expected] of cases) withEnvironment(env, () => assert.equal(isIndexableDeployment(), expected, JSON.stringify(env)));
});

test("page-specific canonicals and share metadata agree; private metadata clears inherited public URLs", () => {
  withEnvironment({ NODE_ENV: "production", VERCEL_ENV: "production", SITE_URL: "https://tibb.nu" }, () => {
    const metadata = createPageMetadata({ title: "Boka behandling", description: "Välj datum.", path: "/boka" });
    assert.equal(metadata.alternates?.canonical, "https://tibb.nu/boka");
    assert.equal(metadata.openGraph?.url, "https://tibb.nu/boka");
    assert.equal((metadata.openGraph?.images as { url: string }[])[0].url, "https://tibb.nu/opengraph-image");
    assert.deepEqual(PRIVATE_METADATA.alternates, { canonical: null });
    assert.equal(PRIVATE_METADATA.openGraph, null);
    assert.equal(PRIVATE_METADATA.twitter, null);
    assert.deepEqual(PRIVATE_METADATA.robots, { index: false, follow: false, noarchive: true });
  });
});

test("JSON-LD remains parseable without allowing script termination from stored article text", () => {
  const value = { title: "</script><script>alert(1)</script>\u2028\u2029" };
  const serialized = serializeJsonLd(value);
  assert.ok(!serialized.includes("<"));
  assert.ok(!serialized.includes("\u2028"));
  assert.deepEqual(JSON.parse(serialized), value);
});

test("organization facts do not invent an address, medical license or reviews, and invalid calendar dates are omitted", () => {
  const schema = buildOrganizationSchema();
  assert.equal(schema["@type"], "Organization");
  assert.equal(schema.name, "Slowlax");
  assert.equal(Object.hasOwn(schema, "location"), false);
  assert.equal(Object.hasOwn(schema, "address"), false);
  for (const field of ["aggregateRating", "review", "openingHours", "hasCredential"]) assert.equal(Object.hasOwn(schema, field), false);
  assert.equal(toIsoDate("2026-02-31T00:00:00Z"), undefined);
  assert.equal(toIsoDate("not-a-date"), undefined);
  assert.equal(toIsoDate("2024-02-29T10:00:00Z"), "2024-02-29T10:00:00.000Z");
});
