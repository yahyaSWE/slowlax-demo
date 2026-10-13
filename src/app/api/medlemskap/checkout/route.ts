import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { enforceRequestLimit } from "@/lib/request-rate-limit";
import { assertMembershipOrigin, createMembershipCheckout, MembershipHttpError, membershipRequestJson, membershipResponseError } from "@/lib/membership-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({ planId: z.number().int().positive(), consent: z.literal(true),
  planRevision: z.string().min(1).max(100), termsRevision: z.string().min(1).max(100) }).strict();
export async function POST(request: Request) {
  try {
    assertMembershipOrigin(request);
    const user = await getCurrentUser();
    if (!user) throw new MembershipHttpError("Logga in för att köpa medlemskap.", 401);
    await enforceRequestLimit("membership-checkout", String(user.id), 10, request.headers);
    const input = inputSchema.safeParse(await membershipRequestJson(request));
    if (!input.success) throw new MembershipHttpError("Kontrollera medlemskapet och godkänn villkoren.", 400);
    const url = await createMembershipCheckout(user.id, input.data.planId, input.data);
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return membershipResponseError(error); }
}
