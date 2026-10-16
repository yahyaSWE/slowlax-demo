import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("KIT newsletter integration verifies registration, idempotency, unsubscribe safety, retries and cron authorization", async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, TIBB_DATABASE_PATH: ":memory:" };
  for (const key of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL", "KIT_API_KEY", "CRON_SECRET", "DATABASE_URL", "SUPABASE_DATABASE_URL", "SUPABASE_AUTH_ENABLED", "SUPABASE_DATABASE_ENABLED", "NODE_TEST_CONTEXT"]) delete env[key];
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--conditions=react-server", "--import=tsx", "--test", "--test-reporter=tap", "tests/fixtures/kit-newsletter-checks.ts"],
    { env, timeout: 60000, maxBuffer: 1_000_000 });
  assert.match(stdout, /# fail 0/);
  assert.match(stdout, /# tests 1[2-9]/);
});
