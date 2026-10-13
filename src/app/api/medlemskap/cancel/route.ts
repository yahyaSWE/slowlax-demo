import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { enforceRequestLimit } from "@/lib/request-rate-limit";
import { assertMembershipOrigin, cancelMembershipCheckout, MembershipHttpError, membershipRequestJson, membershipResponseError } from "@/lib/membership-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertMembershipOrigin(request);
    const user = await getCurrentUser();
    if (!user) throw new MembershipHttpError("Logga in för att avbryta betalningen.", 401);
    await enforceRequestLimit("membership-cancel", String(user.id), 10, request.headers);
    const input = z.object({ planId: z.number().int().positive() }).strict().safeParse(await membershipRequestJson(request));
    if (!input.success) throw new MembershipHttpError("Välj betalningen som ska avbrytas.", 400);
    await cancelMembershipCheckout(user.id, input.data.planId);
    return Response.json({ cancelled: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return membershipResponseError(error); }
}
