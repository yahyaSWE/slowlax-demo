import { requireAdmin } from "@/lib/auth";
import { getKitNewsletterAdminOverview } from "@/lib/kit-newsletter";
import { AdminHeading, SectionHeading, dateTime } from "@/components/admin/common";
import { KitNewsletterForm, KitNewsletterRetryButton } from "@/components/admin/kit-newsletter-form";
import type { KitNewsletterStatus } from "@/lib/kit-newsletter-types";

const labels: Record<KitNewsletterStatus, string> = {
  waiting_verification: "Väntar på verifierat elevkonto", pending: "Väntar på försök", sending: "Behandlas",
  sent: "Överlämnad till Kit", failed: "Behöver åtgärdas", skipped: "Överhoppad",
};

export default async function NewsletterPage() {
  const actor = await requireAdmin();
  const overview = await getKitNewsletterAdminOverview(actor.id);
  return <>
    <AdminHeading title="Nyhetsbrev" description="Anslut nya elever till Slowlax nyhetsbrev genom Kits bekräftelseflöde." />
    <section className="panel form-panel stack">
      <SectionHeading title="Kit-anslutning" />
      <p className={`badge ${overview.active ? "badge-green" : "badge-amber"}`}>{overview.active ? "Aktiverad" : "Inaktiverad"}</p>
      <p>{overview.keyConfigured ? "En API-nyckel finns i serverns miljövariabler." : <>Lägg till en Kit V4 API-nyckel som <code>KIT_API_KEY</code> i serverns miljövariabler och starta om applikationen.</>}</p>
      <p className="muted">Nyckeln sparas och visas aldrig i administrationen. Kontrollera att den valda anslutningen och bekräftelsemejlet fungerar i ditt Kit-konto innan lansering.</p>
      <KitNewsletterForm key={JSON.stringify(overview.settings)} settings={overview.settings} keyConfigured={overview.keyConfigured} />
    </section>
    <section className="panel form-panel stack">
      <SectionHeading title="Automatiska omförsök" description="Misslyckade anslutningar sparas i en kö. Ett tillfälligt Kit-fel påverkar inte elevkontot." />
      <p>{overview.cronConfigured ? "En skyddsnyckel för köarbetaren finns." : <>Lägg till <code>CRON_SECRET</code> för att skydda köarbetaren.</>}</p>
      <p className="muted">Schemalägg ett anrop varje minut till <code>/api/cron/kit-newsletter</code> med din skyddsnyckel som Bearer-token. Första försöket görs även när eleven verifierar sitt konto. Utan ett schemalagt anrop behöver väntande försök startas här.</p>
      <p className="muted">Avregistrerade, studsade och skräppostmarkerade adresser återaktiveras inte. En avstängd anslutning pausar väntande inbjudningar.</p>
    </section>
    <section className="panel form-panel stack">
      <SectionHeading title="Senaste 50 elevinbjudningarna" description="Överlämnad betyder att Kit har accepterat inbjudan. Prenumeration och bekräftelse hanteras i Kit." />
      <p className="muted">Överlämnade: {overview.totals.sent ?? 0} · Väntande: {(overview.totals.pending ?? 0) + (overview.totals.waiting_verification ?? 0)} · Behöver åtgärdas: {overview.totals.failed ?? 0}</p>
      {overview.jobs.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th scope="col">Elev</th><th scope="col">Status</th><th scope="col">Försök</th><th scope="col">Senaste information</th><th scope="col">Åtgärd</th></tr></thead>
        <tbody>{overview.jobs.map((job) => <tr key={job.id}>
          <td>{job.recipient}<br /><small className="muted">{dateTime(job.createdAt)}</small></td>
          <td><span className={`badge ${job.status === "sent" ? "badge-green" : ["failed", "pending"].includes(job.status) ? "badge-amber" : ""}`}>{labels[job.status]}</span></td>
          <td>{job.attempts}</td>
          <td>{job.lastError || (job.sentAt ? dateTime(job.sentAt) : job.status === "pending" ? `Nästa försök tidigast ${dateTime(job.nextAttemptAt)}` : "—")}</td>
          <td>{overview.active && ["failed", "pending", "sending"].includes(job.status) ? <KitNewsletterRetryButton jobId={job.id} /> : "—"}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">Inga inbjudningar har köats ännu. Endast nya elever som registreras medan anslutningen är aktiv hamnar här.</p>}
    </section>
  </>;
}
