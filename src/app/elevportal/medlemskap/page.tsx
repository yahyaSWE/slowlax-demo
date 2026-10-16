import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPublicFreeMembership, getStudentFreeMembership } from "@/lib/free-membership-domain";
import { getUserPendingCheckouts, getUserSubscriptions, membershipPortalReady } from "@/lib/membership-billing";
import { formatMoney } from "@/lib/time";
import { SubscriptionList } from "@/components/memberships/subscription-list";
import { MembershipCheckoutCancelButton, MembershipPortalButton, MembershipStatusRefreshButton } from "@/components/memberships/billing-controls";
import { StudentFreeMembershipCard } from "@/components/memberships/free-membership";

export default async function PortalMembershipsPage({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const user = await requireUser();
  const verifiedStudent = user.role === "student" && !!user.emailVerifiedAt;
  const [subscriptions, checkouts, freeOffer, freeMembership, query] = await Promise.all([
    getUserSubscriptions(user.id),
    verifiedStudent ? getUserPendingCheckouts(user.id) : Promise.resolve([]),
    getPublicFreeMembership(),
    user.role === "student" ? getStudentFreeMembership(user.id) : Promise.resolve(null),
    searchParams,
  ]);

  return (
    <>
      <Link href="/elevportal/konto" className="back-link">Till mitt konto</Link>
      <header className="membership-hero">
        <h1 className="page-title">Mina medlemskap</h1>
        <p>Ditt kostnadsfria Bas-medlemskap och dina betalda abonnemang.</p>
      </header>
      {typeof query.success === "string" && <p className="notice notice-success" role="status">{query.success.slice(0, 500)}</p>}
      {freeMembership && <StudentFreeMembershipCard offer={freeOffer} membership={freeMembership} />}
      {user.role === "student" && !verifiedStudent && (
        <p className="notice">
          Verifiera din e-postadress för att hantera medlemskap och betalningar. {" "}
          <Link href="/verifiera-epost" className="inline-link">Verifiera e-post</Link>
        </p>
      )}
      {subscriptions.length > 0 && verifiedStudent && (
        membershipPortalReady() ? <MembershipPortalButton /> : (
          <p className="notice">
            Betalningsportalen är inte tillgänglig just nu. Kontakta Slowlax för
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
        <h2>Betalda abonnemang</h2>
        <SubscriptionList subscriptions={subscriptions} />
      </section>
      <div className="membership-actions">
        <Link href="/elevportal/grupper" className="button button-secondary">Mina grupper</Link>
        <Link href="/medlemskap" className="text-link">Utforska medlemskap</Link>
      </div>
    </>
  );
}
