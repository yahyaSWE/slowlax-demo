import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { enforceRequestLimit } from "@/lib/request-rate-limit";
import { assertMembershipOrigin, createMembershipPortal, MembershipHttpError, membershipRequestJson, membershipResponseError } from "@/lib/membership-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertMembershipOrigin(request);
    const user = await getCurrentUser();
    if (!user) throw new MembershipHttpError("Logga in för att hantera medlemskap.", 401);
    await enforceRequestLimit("membership-portal", String(user.id), 10, request.headers);
    if (!z.object({}).strict().safeParse(await membershipRequestJson(request)).success)
      throw new MembershipHttpError("Uppgifterna kunde inte läsas.", 400);
    return Response.json({ url: await createMembershipPortal(user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return membershipResponseError(error); }
}
