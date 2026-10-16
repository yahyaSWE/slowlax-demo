import { z } from "zod";
import { DomainError, createFirstAdmin, createUser, getDb, getUser, getUserByEmail, transaction, type User } from "./db";
import { enrollNewStudentInFreeMembership } from "./free-membership-domain";

// This internal helper accepts a provider record only after getClaims/getUser,
// or a trusted signUp response. It is not a Server Action or a public endpoint.
const providerUserSchema = z.object({
  id: z.uuid(), email: z.email().max(254).transform((value) => value.toLowerCase()),
  email_confirmed_at: z.iso.datetime({ offset: true }).nullable().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});
export type VerifiedSupabaseUser = z.infer<typeof providerUserSchema>;

function displayName(input: VerifiedSupabaseUser) {
  const name = input.user_metadata?.name;
  // Metadata may provide a display name, never a role, confirmation or access.
  return typeof name === "string" && name.trim().length >= 2 ? name.trim().slice(0, 100) : "Elev";
}

export async function synchronizeSupabaseUser(input: unknown, options: { newRegistration?: boolean; firstAdmin?: boolean } = {}): Promise<User | null> {
  const provider = providerUserSchema.parse(input);
  const verifiedAt = provider.email_confirmed_at ?? null;
  return transaction(async () => {
    let row = await getDb().prepare("SELECT id,email,role,supabase_id FROM users WHERE supabase_id=?").get(provider.id);
    if (!row) {
      const existing = await getDb().prepare("SELECT id,email,role,supabase_id FROM users WHERE email=? COLLATE NOCASE").get(provider.email);
      if (existing) {
        if (!verifiedAt) return null; // Unverified signup cannot claim legacy data.
        if (existing.supabase_id && existing.supabase_id !== provider.id)
          throw new DomainError("Kontot är kopplat till en annan identitet. Kontakta verksamheten.");
        if (existing.role === "admin" && process.env.SUPABASE_ADMIN_USER_ID !== provider.id)
          throw new DomainError("Administratörskontot behöver kopplas till Supabase av den som ansvarar för driften.");
        const result = await getDb().prepare("UPDATE users SET supabase_id=?,password_hash='supabase-managed',email_verified_at=? WHERE id=? AND supabase_id IS NULL")
          .run(provider.id, verifiedAt, Number(existing.id));
        if (!result.changes) throw new DomainError("Kontokopplingen ändrades. Försök logga in igen.");
        await getDb().prepare("DELETE FROM sessions WHERE user_id=?").run(Number(existing.id));
        await getDb().prepare("DELETE FROM auth_tokens WHERE user_id=?").run(Number(existing.id));
        row = existing;
      } else {
        if (!verifiedAt && !options.newRegistration && !options.firstAdmin) return null;
        const user = options.firstAdmin
          ? await createFirstAdmin({ name: displayName(provider), email: provider.email, passwordHash: "supabase-managed" })
          : await createUser({ name: displayName(provider), email: provider.email, passwordHash: "supabase-managed", role: "student" });
        await getDb().prepare("UPDATE users SET supabase_id=?,email_verified_at=? WHERE id=?").run(provider.id, verifiedAt, user.id);
        // A verified provider signup can outlive a lost response or failed app
        // write. Enroll every newly created app student in Bas, including that
        // recovery path. Existing application students linked above are never
        // enrolled implicitly. Bas and the newsletter intent share this write.
        if (!options.firstAdmin) await enrollNewStudentInFreeMembership(user.id);
        return (await getUser(user.id))!;
      }
    }
    if (!verifiedAt) return null;
    if (String(row.email).toLowerCase() !== provider.email) {
      const collision = await getUserByEmail(provider.email);
      if (collision && collision.id !== Number(row.id))
        throw new DomainError("E-postadressen används av ett annat elevkonto. Kontakta verksamheten.");
    }
    // Keep the application's current role, name and integer relationships.
    // A provider metadata edit cannot overwrite an administrator's app role.
    await getDb().prepare("UPDATE users SET email=?,email_verified_at=?,password_hash='supabase-managed' WHERE id=?")
      .run(provider.email, verifiedAt, Number(row.id));
    return (await getUser(Number(row.id)))!;
  });
}
