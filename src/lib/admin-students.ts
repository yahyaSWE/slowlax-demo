import { assertAdmin } from "./admin";
import { getDb } from "./database";

export type AdminStudentChoice = {
  id: number;
  name: string;
  email: string;
  emailVerified: boolean;
};

export async function getAdminStudentChoices(
  actorId: number,
): Promise<AdminStudentChoice[]> {
  await assertAdmin(actorId);
  const rows = await getDb()
    .prepare(
      `SELECT id,name,email,email_verified_at FROM users
       WHERE role='student'
       ORDER BY name COLLATE NOCASE,email COLLATE NOCASE,id`,
    )
    .all();
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    emailVerified: row.email_verified_at !== null,
  }));
}
