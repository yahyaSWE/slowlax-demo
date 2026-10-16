"use client";

import { useActionState } from "react";
import { joinFreeMembershipAction, type JoinFreeMembershipState } from "@/lib/free-membership-actions";

export function FreeMembershipJoinButton({ returnTo = "/medlemskap/bas" }: { returnTo?: "/medlemskap/bas" | "/elevportal/medlemskap" }) {
  const [state, action, pending] = useActionState<JoinFreeMembershipState, FormData>(joinFreeMembershipAction, {});
  return <form action={action} aria-busy={pending} className="stack"><input type="hidden" name="returnTo" value={returnTo} />
    <p className="small muted">Du kan få en separat inbjudan till Slowlax nyhetsbrev via e-post. Bekräfta den om du vill få nyhetsbrevet. Du kan avregistrera dig när som helst.</p>
    {state.error && <p className="notice notice-error" role="alert">{state.error}</p>}
    <div><button type="submit" disabled={pending} className="button button-primary">{pending ? "Aktiverar medlemskapet…" : "Bli medlem gratis"}</button></div>
  </form>;
}
