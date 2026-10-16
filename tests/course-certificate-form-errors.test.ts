import { test } from "node:test";
import assert from "node:assert/strict";
import { redirect } from "next/navigation";
import { withCourseCertificateFormErrors } from "../src/lib/course-certificate-form-errors";

test("diploma transport failures retain the persisted CAS revision and known certificate without stale success", async () => {
  const form = new FormData();
  form.set("courseId", "7");
  form.set("enabled", "on");
  const previous = { message: "Previously saved", settings: { courseId: 7, enabled: false, updatedAt: "2026-10-15T10:00:00.000Z" }, certificateId: "a".repeat(32) };
  const action = withCourseCertificateFormErrors(async () => { throw new Error("private transport failure detail"); });
  const result = await action(previous, form);
  assert.match(result.error!, /inmatning finns kvar/);
  assert.doesNotMatch(result.error!, /private transport/);
  assert.equal(result.message, undefined);
  assert.equal(result.settings, previous.settings);
  assert.equal(result.certificateId, previous.certificateId);
  assert.equal(form.get("enabled"), "on");
});

test("diploma validation errors remain actionable and authentication redirects cannot be swallowed", async () => {
  const state = { error: "Diplominställningen har ändrats. Ladda om sidan innan du sparar igen." };
  const validation = withCourseCertificateFormErrors(async () => state);
  assert.equal(await validation({}, new FormData()), state);
  const authenticating = withCourseCertificateFormErrors(async () => redirect("/logga-in"));
  await assert.rejects(authenticating({}, new FormData()), /NEXT_REDIRECT/);
});
