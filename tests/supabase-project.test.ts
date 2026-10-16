import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSupabaseDatabaseProject } from "../src/lib/supabase-project";

test("cutover tools bind direct and pooled database endpoints to the intended Supabase project", () => {
  const url = "https://projectfixture.supabase.co";
  assert.equal(matchesSupabaseDatabaseProject(url, "postgresql://postgres:fixture@db.projectfixture.supabase.co:5432/postgres"), true);
  assert.equal(matchesSupabaseDatabaseProject(url, "postgresql://postgres.projectfixture:fixture@aws-1-region.pooler.supabase.com:5432/postgres"), true);
  assert.equal(matchesSupabaseDatabaseProject(url, "postgresql://custom.projectfixture:fixture@aws-1-region.pooler.supabase.com:6543/postgres"), true);
  assert.equal(matchesSupabaseDatabaseProject(url, "postgresql://postgres.other:fixture@aws-1-region.pooler.supabase.com:5432/postgres"), false);
  assert.equal(matchesSupabaseDatabaseProject(url, "postgresql://postgres:fixture@db.other.supabase.co:5432/postgres"), false);
  assert.equal(matchesSupabaseDatabaseProject(url, "postgresql://postgres.projectfixture:fixture@aws-1-region.pooler.supabase.com.evil.test:5432/postgres"), false);
  assert.equal(matchesSupabaseDatabaseProject("", "postgresql://postgres:fixture@localhost/postgres"), false);
  assert.equal(matchesSupabaseDatabaseProject("https://projectfixture.supabase.co/path", "postgresql://postgres:fixture@db.projectfixture.supabase.co/postgres"), false);
});
