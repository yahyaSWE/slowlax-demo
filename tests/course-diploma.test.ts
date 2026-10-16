import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("diploma PDFs and HTTP downloads preserve ownership, historical snapshots and private response headers", async () => {
  const env: NodeJS.ProcessEnv = { ...process.env, TIBB_DATABASE_PATH: ":memory:", SUPABASE_DATABASE_ENABLED: "false", SUPABASE_AUTH_ENABLED: "false" };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await promisify(execFile)(process.execPath,
    ["--conditions=react-server", "--import=tsx", "--test", "--test-reporter=tap", "tests/fixtures/course-diploma-checks.ts"],
    { env, timeout: 60000, maxBuffer: 500000 });
  assert.match(stdout, /(?:# fail|ℹ fail) 0/);
});
