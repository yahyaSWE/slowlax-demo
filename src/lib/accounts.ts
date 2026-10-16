import { DomainError, createUser, getUserByEmail, transaction } from "./db";
import { hashPassword } from "./security";
import { signupSchema } from "./validation";
import { enrollNewStudentInFreeMembership } from "./free-membership-domain";
import { supabaseAuthRequested } from "./supabase-auth-config";
export async function registerStudent(input: unknown) {
  if (supabaseAuthRequested()) throw new DomainError("Registreringen måste göras genom Supabase Auth.");
  const value = signupSchema.parse(input);
  const passwordHash = hashPassword(value.password);
  return transaction(async () => {
    if (await getUserByEmail(value.email))
      throw new DomainError(
        "E-postadressen används redan. Logga in eller använd Glömt lösenord för att återta ditt konto.",
      );
    const user = await createUser({
      name: value.name,
      email: value.email,
      passwordHash,
      role: "student",
    });
    // Account, Bas enrollment and the local newsletter intent are durable
    // together. Group access and Kit dispatch still wait for email verification.
    await enrollNewStudentInFreeMembership(user.id);
    return user;
  });
}
