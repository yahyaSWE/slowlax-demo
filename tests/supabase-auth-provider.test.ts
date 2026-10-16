import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("Supabase auth verifies provider claims, current user and confirmation settings without trusting cookies", async () => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["NODE_TEST_CONTEXT", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "VERCEL"]) delete env[key];
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--conditions=react-server", "--import=tsx", "--test", "--test-reporter=tap", "tests/fixtures/supabase-auth-provider-checks.ts"],
    { env, timeout: 60000, maxBuffer: 1_000_000 });
  assert.match(stdout, /# fail 0/);
  assert.match(stdout, /# tests (?:[6-9]|1\d)/);
});
