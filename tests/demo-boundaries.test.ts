import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { DEMO_MODE, demoPublicPath } from "../src/lib/demo-mode";
import { getCurrentUser } from "../src/lib/auth";
import { getPublicPlans, getPublicPlan, getPublicPlanCourses, getMembershipSettings } from "../src/lib/memberships";
import { getPublicFreeMembership } from "../src/lib/free-membership-domain";
import { getCourseBundles, getPublicCourseBundle } from "../src/lib/course-bundles";
import { getCoursePurchaseOffer, getPublicCourseSalesDetails } from "../src/lib/course-sales";
import { getPurificationQuotaSettings } from "../src/lib/purification-domain";
import { getPublicReningOffers, getReningSettings, reningBillingReady } from "../src/lib/rening-offers";
import { getKitNewsletterSettings } from "../src/lib/kit-newsletter-domain";

test("demo serves public GET/HEAD routes without a database and denies account/API routes", async () => {
  assert.equal(DEMO_MODE, true);
  process.env.VERCEL = "1";
  for (const path of ["/", "/kurser", "/kurser/introduktion-till-halal-investering", "/medlemskap", "/medlemskap/bas", "/medlemskap/premium", "/paket/bas-kit", "/rening", "/kontakt", "/robots.txt"]) {
    assert.equal(demoPublicPath(path), true);
    const response = await proxy(new NextRequest(`https://demo.example.test${path}`));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  }
  for (const path of ["/admin", "/admin/rening", "/elevportal", "/elevportal/konto", "/logga-in", "/registrera", "/glomt-losenord", "/aterstall-losenord", "/verifiera-epost", "/setup", "/installation", "/api/rening/checkout", "/api/cron/kit-newsletter", "/medlemskap/bekraftelse", "/boka", "/butik"]) {
    assert.equal(demoPublicPath(path), false);
    assert.equal((await proxy(new NextRequest(`https://demo.example.test${path}`))).status, 404, path);
  }
  assert.equal((await proxy(new NextRequest("https://demo.example.test/", { method: "HEAD" }))).status, 200);
});

test("demo blocks every mutation including Server Actions and payment webhooks", async () => {
  for (const path of ["/", "/kontakt", "/kurser", "/registrera", "/api/rening/webhook", "/api/medlemskap/checkout"]) {
    const response = await proxy(new NextRequest(`https://demo.example.test${path}`, { method: "POST", body: "synthetic" }));
    assert.equal(response.status, 405, path);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  }
});

test("configured integration variables cannot enable authentication or purchases", async () => {
  process.env.SUPABASE_AUTH_ENABLED = "true";
  process.env.SUPABASE_DATABASE_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_demo";
  process.env.RENING_STRIPE_WEBHOOK_SECRET = "whsec_synthetic_demo";
  assert.equal(await getCurrentUser(), null);
  assert.equal(reningBillingReady(), false);
  assert.equal((await getMembershipSettings()).salesEnabled, false);
  assert.equal((await getReningSettings()).salesEnabled, false);
  assert.equal((await getKitNewsletterSettings()).enabled, false);
});

test("membership, package and Rening catalogues contain static public examples only", async () => {
  const plans = await getPublicPlans();
  assert.equal(plans[0].slug, "premium");
  assert.equal((await getPublicPlan("premium"))?.id, 201);
  assert.equal(await getPublicPlan("does-not-exist"), undefined);
  assert.ok((await getPublicPlanCourses(201)).length >= 2);
  assert.equal((await getPublicFreeMembership()).priceOre, 0);
  const bundles = await getCourseBundles({ publishedOnly: true });
  assert.equal(bundles[0].courses.length, 2);
  assert.equal((await getPublicCourseBundle("bas-kit"))?.id, 101);
  assert.equal(await getCoursePurchaseOffer(101), undefined);
  assert.equal((await getPublicCourseSalesDetails(101))?.groups.length, 2);
  assert.equal((await getPurificationQuotaSettings("membership_plan", 201)).credits, 4);
  assert.deepEqual((await getPublicReningOffers()).map(offer => offer.credits), [4, 9, 14]);
});
