import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createFirstAdmin, createUser, getDb, type User } from "../src/lib/db";
import { getAdminStudentChoices } from "../src/lib/admin-students";

const directory = mkdtempSync(join(tmpdir(), "tibb-admin-students-"));
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.TIBB_DATABASE_PATH = join(directory, "students.sqlite");
let admin: User;
let verified: User;
let unverified: User;
let sameName: User;

before(async () => {
  admin = await createFirstAdmin({
    name: "Administratör",
    email: "admin@students.example.test",
    passwordHash: "isolated-admin-hash",
  });
  verified = await createUser({
    name: "anna",
    email: "z@students.example.test",
    role: "student",
    passwordHash: "private-student-hash",
  });
  unverified = await createUser({
    name: "Beatrice",
    email: "b@students.example.test",
    role: "student",
    passwordHash: "private-unverified-hash",
  });
  sameName = await createUser({
    name: "Anna",
    email: "a@students.example.test",
    role: "student",
    passwordHash: "private-second-student-hash",
  });
  await getDb()
    .prepare("UPDATE users SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), verified.id);
});

after(async () => {
  await getDb().close();
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("tibb-admin-students-"));
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 150,
  });
});

test("admin sees only registered students in name and email order with a minimal DTO", async () => {
  const choices = await getAdminStudentChoices(admin.id);
  assert.deepEqual(choices, [
    {
      id: sameName.id,
      name: sameName.name,
      email: sameName.email,
      emailVerified: false,
    },
    {
      id: verified.id,
      name: verified.name,
      email: verified.email,
      emailVerified: true,
    },
    {
      id: unverified.id,
      name: unverified.name,
      email: unverified.email,
      emailVerified: false,
    },
  ]);
  for (const choice of choices)
    assert.deepEqual(Object.keys(choice).sort(), [
      "email",
      "emailVerified",
      "id",
      "name",
    ]);
});

test("student and nonexistent actors cannot enumerate student accounts", async () => {
  for (const actorId of [verified.id, unverified.id, 0, -1, 999999])
    await assert.rejects(getAdminStudentChoices(actorId), /behörighet/);
});

test("every read checks the actor's current role after access is revoked", async () => {
  assert.equal((await getAdminStudentChoices(admin.id)).length, 3);
  await getDb()
    .prepare("UPDATE users SET role='student' WHERE id=?")
    .run(admin.id);
  try {
    await assert.rejects(getAdminStudentChoices(admin.id), /behörighet/);
  } finally {
    await getDb()
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(admin.id);
  }
});
