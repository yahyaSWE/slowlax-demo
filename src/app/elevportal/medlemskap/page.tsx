import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMembershipSettings } from "@/lib/memberships";
import { getUserPendingCheckouts, getUserSubscriptions, membershipPortalReady } from "@/lib/membership-billing";
import { formatMoney } from "@/lib/time";
import { SubscriptionList } from "@/components/memberships/subscription-list";
import { MembershipCheckoutCancelButton, MembershipPortalButton, MembershipStatusRefreshButton } from "@/components/memberships/billing-controls";

export default async function PortalMembershipsPage() {
  const user = await requireUser();
  const verifiedStudent = user.role === "student" && !!user.emailVerifiedAt;
  const [subscriptions, settings, checkouts] = await Promise.all([
    getUserSubscriptions(user.id),
    getMembershipSettings(),
    verifiedStudent ? getUserPendingCheckouts(user.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <Link href="/elevportal/konto" className="back-link">Till mitt konto</Link>
      <header className="membership-hero">
        <h1 className="page-title">Mina abonnemang</h1>
        <p>Se betalningsstatus och hantera dina återkommande medlemskap.</p>
      </header>
      {user.role === "student" && !verifiedStudent && (
        <p className="notice">
          Verifiera din e-postadress för att hantera medlemskap och betalningar. {" "}
          <Link href="/verifiera-epost" className="inline-link">Verifiera e-post</Link>
        </p>
      )}
      {subscriptions.length > 0 && verifiedStudent && (
        membershipPortalReady() ? <MembershipPortalButton /> : (
          <p className="notice">
            Betalningsportalen är inte tillgänglig just nu. Kontakta Tibb.nu för
            hjälp med ditt abonnemang.
          </p>
        )
      )}
      {checkouts.length > 0 && (
        <section className="membership-pending" aria-labelledby="pending-checkouts-heading">
          <h2 id="pending-checkouts-heading">Påbörjade betalningar</h2>
          {checkouts.map(checkout => (
            <article className="membership-subscription" key={checkout.planId}>
              <h3>{checkout.planName}</h3>
              <p>{checkout.groupName} · {formatMoney(checkout.priceOre)} / {checkout.interval === "month" ? "månad" : "år"}</p>
              {checkout.canCancel ? (
                <MembershipCheckoutCancelButton planId={checkout.planId} />
              ) : (
                <div className="stack">
                  <p>Betalningen behandlas. Åtkomsten visas här när betalningen har bekräftats.</p>
                  <MembershipStatusRefreshButton />
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      <section className="section">
        <SubscriptionList subscriptions={subscriptions} />
      </section>
      <div className="membership-actions">
        <Link href="/elevportal/grupper" className="button button-secondary">Mina grupper</Link>
        {settings.salesEnabled && <Link href="/medlemskap" className="text-link">Utforska medlemskap</Link>}
      </div>
    </>
  );
}
