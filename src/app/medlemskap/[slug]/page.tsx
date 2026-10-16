import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAccessibleGroup } from "@/lib/memberships";
import { getUserSubscriptions, membershipPortalReady } from "@/lib/membership-billing";
import { accountAuthHref } from "@/lib/account-return";
import { createPageMetadata, PRIVATE_METADATA, seoDescription } from "@/lib/seo";
import { formatMoney } from "@/lib/time";
import { membershipSettingsForRender, publicMembershipForRender, publicMembershipCoursesForRender } from "@/components/memberships/server-data";
import { MembershipCheckoutButton, MembershipCheckoutCancelButton } from "@/components/memberships/billing-controls";
import { TextContent } from "@/components/learning/cards";
import { getPurificationQuotaSettings } from "@/lib/purification-domain";
import "@/components/memberships/memberships.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ cancelled?: string }> };
export async function generateMetadata({ params }: Props) {
  const plan = await publicMembershipForRender((await params).slug);
  return plan ? createPageMetadata({ title: plan.name, description: seoDescription(plan.description, `Medlemskap med material för ${plan.groupName} hos Slowlax.`), path: `/medlemskap/${plan.slug}` }) : PRIVATE_METADATA;
}

export default async function MembershipPage({ params, searchParams }: Props) {
  const plan = await publicMembershipForRender((await params).slug);
  if (!plan) notFound();
  const quota = await getPurificationQuotaSettings("membership_plan", plan.id);
  const [settings, user, courses, query] = await Promise.all([membershipSettingsForRender(), getCurrentUser(), publicMembershipCoursesForRender(plan.id), searchParams]);
  const subscriptions = user?.role === "student" ? await getUserSubscriptions(user.id) : [];
  const accessibleGroups = user?.role === "student" && user.emailVerifiedAt
    ? (await Promise.all(plan.groups.map(group => getAccessibleGroup(user.id, group.id)))).filter(group => !!group) : [];
  const ongoing = subscriptions.some(subscription => subscription.groups.some(group => plan.groupIds.includes(group.id)) && !["canceled", "incomplete_expired"].includes(subscription.status));
  const returnTo = `/medlemskap/${plan.slug}`;
  return <section className="section container">
    <Link href="/medlemskap" className="back-link">Till alla medlemskap</Link>
    <header className="membership-hero"><h1 className="page-title">{plan.name}</h1><p>Medlemskap i {plan.groupName}</p><p className="membership-price">{formatMoney(plan.priceOre)} <small>/ {plan.interval === "month" ? "månad" : "år"}</small></p><p>Inklusive {plan.vatPercent}% moms. Återkommande betalning tills du säger upp abonnemanget.</p></header>
    {query.cancelled && user?.role === "student" && <div className="notice"><p>Du återvände från betalningen. Ingen ny åtkomst ges utan bekräftad betalning.</p><MembershipCheckoutCancelButton planId={plan.id} /></div>}
    <div className="membership-columns"><div className="membership-panel"><h2>Det här ingår</h2><TextContent text={plan.description} />
      <h3>Grupper i medlemskapet</h3><ul>{plan.groups.map(group => <li key={group.id}>{group.name}</li>)}</ul>
      {quota.credits > 0 && <p><Link href="/rening" className="inline-link">Rening</Link>: {quota.credits} bolag per betald medlemsperiod. Oanvänd kvot upphör vid periodens slut.</p>}
      {courses.length > 0 && <><h3>Kurser i medlemskapet</h3><ul>{courses.map(course => <li key={course.id}><Link href={`/kurser/${course.slug}`} className="inline-link">{course.title}</Link></li>)}</ul></>}
      <p className="muted">Gruppernas publicerade inlägg och material samlas i elevportalen. Du har tillgång medan ditt medlemskap gäller.</p>
      {settings.terms && <><h3>Abonnemangsvillkor</h3><TextContent text={settings.terms} /></>}
    </div><aside className="membership-panel stack"><h2>Kom igång</h2>
      {accessibleGroups.length > 0 && <div className="stack"><p>Du har redan tillgång till {accessibleGroups.length === 1 ? "en av grupperna" : "grupper i medlemskapet"}.</p><div className="membership-actions">{accessibleGroups.map(group => <Link href={`/elevportal/grupper/${group.id}`} className="inline-link" key={group.id}>Öppna {group.name}</Link>)}</div></div>}
      {user?.role === "admin" ? <p className="notice">Du granskar erbjudandet som administratör. Betalda medlemskap tecknas med ett elevkonto.</p>
        : ongoing ? <><p>Du har redan ett abonnemang som omfattar en eller flera av grupperna.</p><Link href="/elevportal/medlemskap" className="button button-primary">Hantera mitt medlemskap</Link></>
          : !settings.salesEnabled || !membershipPortalReady() ? <><p className="notice">Nya betalda abonnemang kan inte tecknas just nu. Du kan fortfarande läsa om medlemskapet och kontakta oss för mer information.</p><Link href="/kontakt" className="button button-secondary">Fråga om medlemskapet</Link></>
            : !user ? <><p>Logga in eller skapa ett elevkonto för att teckna medlemskapet.</p><Link href={accountAuthHref("/logga-in", returnTo)} className="button button-primary">Logga in</Link><Link href={accountAuthHref("/registrera", returnTo)} className="text-link">Skapa konto</Link></>
              : !user.emailVerifiedAt ? <p className="notice">Verifiera din e-postadress innan betalning. <Link href={accountAuthHref("/verifiera-epost", returnTo)} className="inline-link">Verifiera e-post</Link></p>
                : <MembershipCheckoutButton planId={plan.id} planRevision={plan.updatedAt} termsRevision={settings.updatedAt} purificationRevision={quota.updatedAt} />}
    </aside></div>
  </section>;
}
