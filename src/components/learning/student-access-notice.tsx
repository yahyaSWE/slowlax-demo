import Link from "next/link";
import type { StudentAccessState } from "@/lib/student-access";
import { formatDateTime } from "@/lib/time";

const sourceLabels = { manual: "Tilldelad av Tibb.nu", subscription: "Abonnemang", course_purchase: "Kursköp" };

export function StudentAccessDetails({ access }: { access: StudentAccessState }) {
  return <div className="small">
    <p><strong>{access.expiresAt ? `Tillgång till ${formatDateTime(access.expiresAt)}` : "Tillgång utan tidsgräns"}</strong></p>
    <p className="muted">{access.sources.map(source => sourceLabels[source]).join(" · ")}</p>
  </div>;
}

export function StudentAccessNotice({ access, kind = "course" }: { access: StudentAccessState; kind?: "course" | "group" }) {
  const noun = kind === "group" ? "Gruppen" : "Kursen";
  return <section className="panel stack">
    <h1 className="page-title">{access.title}</h1>
    <h2>{access.status === "unpublished" ? `${noun} är tillfälligt otillgänglig` : access.status === "expired" ? "Din åtkomst har löpt ut" : "Din åtkomst är inte aktiv"}</h2>
    <p>{access.status === "unpublished" ? "Innehållet är för närvarande inte publicerat. Din tidigare tilldelning eller ditt köp finns sparat. Kontakta oss så hjälper vi dig."
      : access.status === "expired" ? `Du behöver förnyad åtkomst för att öppna ${kind === "group" ? "gruppens material" : "kursen"}. Kontakta oss om du vill fortsätta eller om något verkar fel.`
        : "Åtkomsten kan ha avslutats eller spärrats efter en betalningskontroll. Kontakta oss om du har frågor."}</p>
    {access.expiresAt && <p className="small muted">Tidigare tillgång till {formatDateTime(access.expiresAt)}.</p>}
    {kind === "group" && <p className="small muted">En kurs som du har köpt separat har fortfarande sin egen åtkomst. Se Mina kurser.</p>}
    <div className="membership-actions">
      <Link href="/kontakt" className="button button-primary">Kontakta oss om åtkomsten</Link>
      <Link href={kind === "group" ? "/elevportal/grupper" : "/elevportal"} className="button button-secondary">{kind === "group" ? "Till mina grupper" : "Till mina kurser"}</Link>
    </div>
  </section>;
}
