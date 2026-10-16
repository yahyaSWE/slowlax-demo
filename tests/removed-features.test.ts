import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

const removedPaths = [
  "/boka", "/bokning/bekraftelse", "/butik", "/butik/kassa", "/bestallning/bekraftelse",
  "/api/shop/checkout", "/api/shop/images/image-id", "/api/stripe/webhook", "/api/email/outbox",
  "/admin/bokningar/1", "/admin/behandlingar", "/admin/behandlare", "/admin/tider",
  "/admin/butik", "/admin/produkter/1", "/admin/rabatter", "/admin/frakt", "/admin/bestallningar/1",
];

test("removed booking and shop URLs return 404 for reads and mutations, including during installation", async () => {
  const original = { VERCEL: process.env.VERCEL, TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL, TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN };
  try {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    for (const installation of [false, true]) {
      if (installation) process.env.VERCEL = "1";
      else delete process.env.VERCEL;
      for (const path of removedPaths) for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        const response = await proxy(new NextRequest(`https://slowlax.se${path}`, { method }));
        assert.equal(response.status, 404, `${method} ${path}, installation=${installation}`);
        assert.equal(response.headers.get("x-middleware-rewrite"), null);
      }
    }
    delete process.env.VERCEL;
    for (const path of ["/kurser", "/medlemskap", "/elevportal", "/api/kurser/checkout", "/api/kurser/webhook", "/api/medlemskap/webhook", "/api/uploads"]) {
      assert.equal((await proxy(new NextRequest(`https://slowlax.se${path}`))).headers.get("x-middleware-next"), "1", path);
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
