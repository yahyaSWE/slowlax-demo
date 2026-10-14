import { test } from "node:test";
import assert from "node:assert/strict";
import { accountAuthHref, accountReturnWithMessage, safeAccountReturnTo } from "../src/lib/account-return";

test("account redirects reject external, encoded, control-character and authentication-loop destinations", () => {
  for (const destination of [
    "https://evil.example/", "//evil.example/", "/\\evil.example/", "/%2f%2fevil.example/",
    "/%252f%252fevil.example/", "/%5cevil.example/", "/%255cevil.example/", "/\nevil.example/",
    "/%0devil.example/", "/%250devil.example/", "/logga-in", "/registrera?returnTo=/registrera",
    "/kurser/../logga-in", "/%6Cogga-in", "/%256Cogga-in", "/verifiera-epost?token=abc", "/%invalid",
    " /kurser/hijama", null, ["/kurser/hijama"], "/" + "a".repeat(2048),
  ]) assert.equal(safeAccountReturnTo(destination), "/elevportal", String(destination));
});

test("a selected course or private confirmation survives auth switching without changing its destination", () => {
  for (const destination of ["/kurser/avancerad-hijama", "/kurskop/bekraftelse?session_id=cs_test_example", "/elevportal/grupper/3#material"]) {
    assert.equal(safeAccountReturnTo(destination), destination);
    for (const route of ["/registrera", "/logga-in", "/verifiera-epost", "/glomt-losenord"] as const) {
      const url = new URL(accountAuthHref(route, destination), "https://tibb.example");
      assert.equal(url.pathname, route);
      assert.equal(url.searchParams.get("returnTo"), destination);
      assert.equal(url.origin, "https://tibb.example");
    }
  }
  assert.equal(accountAuthHref("/logga-in", "https://evil.example"), "/logga-in");
  assert.equal(accountAuthHref("/registrera", undefined), "/registrera");
});

test("verification notices preserve private query parameters and fragments safely", () => {
  const destination = accountReturnWithMessage("/kurskop/bekraftelse?session_id=cs_example#resultat", "E-postadressen är verifierad.");
  const url = new URL(destination, "https://tibb.example");
  assert.equal(url.searchParams.get("session_id"), "cs_example");
  assert.equal(url.searchParams.get("success"), "E-postadressen är verifierad.");
  assert.equal(url.hash, "#resultat");
  assert.equal(new URL(accountReturnWithMessage("//evil.example", "Verifierad"), "https://tibb.example").pathname, "/elevportal");
});
