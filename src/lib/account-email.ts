import { z } from "zod";
import { DomainError, getDb, getUser, getUserByEmail, transaction, type User } from "./db";
import { randomToken, tokenHash, hashPassword, verifyPassword } from "./security";
import { emailSchema, passwordSchema } from "./validation";
import { requireEmailConfiguration, sendEmail } from "./email-provider";
import { safeAccountReturnTo } from "./account-return";
import { supabaseAuthRequested } from "./supabase-auth-config";

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, "Länken är ogiltig eller har löpt ut.");
type TokenKind = "verify-email" | "reset-password";
export const RESET_REQUEST_MESSAGE = "Om adressen hör till ett konto kan du få en återställningslänk. Kontrollera även skräpposten. Om ingen länk kommer, försök igen eller kontakta verksamheten. Detta bekräftar inte att ett konto finns eller att e-post har levererats.";

async function issueToken(userId: number, kind: TokenKind) {
  const token = randomToken();
  const hash = tokenHash(token);
  await transaction(async () => {
    if (!(await getUser(userId))) throw new DomainError("Kontot finns inte.");
    await getDb().prepare("DELETE FROM auth_tokens WHERE expires_at<=?").run(new Date().toISOString());
    await getDb().prepare("INSERT INTO auth_tokens(token_hash,user_id,kind,expires_at,created_at) VALUES(?,?,?,?,?)")
      .run(hash, userId, kind, new Date(Date.now() + (kind === "verify-email" ? 24 * 60 : 30) * 60000).toISOString(), new Date().toISOString());
    // Keep the three most recent links. A resend/provider timeout must not
    // invalidate a link already delivered; any successful consumption revokes all.
    await getDb().prepare("DELETE FROM auth_tokens WHERE user_id=? AND kind=? AND token_hash NOT IN (SELECT token_hash FROM auth_tokens WHERE user_id=? AND kind=? ORDER BY created_at DESC,token_hash DESC LIMIT 3)")
      .run(userId, kind, userId, kind);
  });
  return { token, hash };
}
async function deliverToken(user: User, kind: TokenKind, returnTo?: string) {
  const config = requireEmailConfiguration();
  const issued = await issueToken(user.id, kind);
  const url = new URL(kind === "verify-email" ? "/verifiera-epost" : "/aterstall-losenord", config.origin);
  url.searchParams.set("token", issued.token);
  const destination = safeAccountReturnTo(returnTo, "");
  if (destination) url.searchParams.set("returnTo", destination);
  const text = kind === "verify-email"
    ? `Bekräfta e-postadressen för ditt konto hos Slowlax:\n\n${url}\n\nLänken gäller i 24 timmar och behöver ditt registrerade lösenord. Om du inte skapade kontot ska du inte bekräfta det; använd Glömt lösenord på hemsidan för att återta adressen. Dela inte länken.`
    : `Välj ett nytt lösenord till ditt konto hos Slowlax:\n\n${url}\n\nLänken gäller i 30 minuter och kan användas en gång. Återställningen loggar ut alla tidigare sessioner och bekräftar att du äger e-postadressen. Om du inte begärde detta behöver du inte göra något. Dela inte länken.`;
  // An uncertain response can follow actual acceptance. Keep the hashed link
  // valid until expiry instead of breaking a message already in the recipient's inbox.
  await sendEmail({ to: user.email, subject: kind === "verify-email" ? "Bekräfta din e-postadress hos Slowlax" : "Återställ ditt lösenord hos Slowlax", text,
    idempotencyKey: `account-${issued.hash}` });
}
export async function sendVerificationEmail(userId: number, returnTo?: string) {
  if (supabaseAuthRequested()) {
    const user = await getUser(userId);
    if (!user) throw new DomainError("Kontot finns inte.");
    const { resendSupabaseVerification } = await import("./supabase-auth");
    await resendSupabaseVerification(user.email, returnTo);
    return;
  }
  requireEmailConfiguration();
  const user = await getUser(userId);
  if (!user || user.role !== "student") throw new DomainError("Verifiering gäller ditt elevkonto.");
  if (user.emailVerifiedAt) return;
  await deliverToken(user, "verify-email", returnTo);
}
export async function requestPasswordReset(email: string, returnTo?: string): Promise<string> {
  if (supabaseAuthRequested()) {
    const { requestSupabasePasswordReset } = await import("./supabase-auth");
    try { await requestSupabasePasswordReset(emailSchema.parse(email), returnTo); }
    catch { /* The request response reveals neither account nor delivery. */ }
    return RESET_REQUEST_MESSAGE;
  }
  // Configuration errors are identical for every address and never pretend
  // that an email was sent. Provider failures must not enumerate accounts.
  requireEmailConfiguration();
  const user = await getUserByEmail(emailSchema.parse(email));
  if (user) {
    try { await deliverToken(user, "reset-password", returnTo); }
    catch { /* A generic request response reveals neither account nor delivery. */ }
  }
  return RESET_REQUEST_MESSAGE;
}
export async function verifyEmail(input: { token: string; password: string }): Promise<User> {
  if (supabaseAuthRequested()) {
    const { verifySupabaseEmail } = await import("./supabase-auth");
    return verifySupabaseEmail(input.token);
  }
  const token = tokenSchema.parse(input.token);
  const password = z.string().min(1).max(128).parse(input.password);
  return transaction(async () => {
    const row = await getDb().prepare(
      "SELECT u.id,u.password_hash FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind='verify-email' AND t.expires_at>?",
    ).get(tokenHash(token), new Date().toISOString());
    if (!row || !verifyPassword(password, String(row.password_hash)))
      throw new DomainError("Länken eller lösenordet är fel. Använd Glömt lösenord om du inte skapade kontot.");
    const now = new Date().toISOString();
    await getDb().prepare("UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?").run(now, Number(row.id));
    await getDb().prepare("DELETE FROM auth_tokens WHERE user_id=?").run(Number(row.id));
    await getDb().prepare("DELETE FROM sessions WHERE user_id=?").run(Number(row.id));
    return (await getUser(Number(row.id)))!;
  });
}
export async function resetPassword(input: { token: string; password: string }): Promise<number> {
  if (supabaseAuthRequested()) {
    const { resetSupabasePassword } = await import("./supabase-auth");
    return resetSupabasePassword(input);
  }
  const token = tokenSchema.parse(input.token);
  const password = passwordSchema.parse(input.password);
  const passwordHash = hashPassword(password);
  return transaction(async () => {
    const row = await getDb().prepare(
      "SELECT user_id FROM auth_tokens WHERE token_hash=? AND kind='reset-password' AND expires_at>?",
    ).get(tokenHash(token), new Date().toISOString());
    if (!row) throw new DomainError("Återställningslänken är ogiltig, har redan använts eller har löpt ut.");
    const userId = Number(row.user_id);
    await getDb().prepare("UPDATE users SET password_hash=?,email_verified_at=COALESCE(email_verified_at,?) WHERE id=?")
      .run(passwordHash, new Date().toISOString(), userId);
    await getDb().prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
    await getDb().prepare("DELETE FROM auth_tokens WHERE user_id=?").run(userId);
    return userId;
  });
}
