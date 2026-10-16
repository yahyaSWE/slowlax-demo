import Link from "next/link";
import { Award, BookOpen, Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getUserCourseCertificates } from "@/lib/course-certificates";
import { PRIVATE_METADATA } from "@/lib/seo";
import styles from "@/components/learning/course-certificates.module.css";

export const dynamic = "force-dynamic";
export const metadata = { ...PRIVATE_METADATA, title: "Mina diplom" };

function date(value: string) { return new Intl.DateTimeFormat("sv-SE", { dateStyle: "long", timeZone: "Europe/Stockholm" }).format(new Date(value)); }

export default async function StudentCertificatesPage() {
  const user = await requireUser();
  const certificates = await getUserCourseCertificates(user.id);
  return <>
    <header className="membership-hero"><p className="eyebrow">Din kunskap</p><h1 className="page-title">Mina diplom</h1><p>Här finns dina utfärdade kursdiplom. Du kan ladda ner dem även efter att kursåtkomsten har upphört.</p></header>
    {certificates.length ? <ul className={styles.list}>{certificates.map((certificate) => <li key={certificate.id} className={`panel ${styles.item}`}>
      <div><p className="eyebrow">Genomförd kurs</p><h2>{certificate.courseTitle}</h2><p>{certificate.studentName}</p><p className="small muted">Utfärdat {date(certificate.issuedAt)} · {certificate.issuerName}</p>
        <div className={styles.actions}><a href={`/api/diplom/${certificate.id}`} className="button button-primary" download><Download size={17} aria-hidden="true" /> Ladda ner PDF</a></div>
        <p className={styles.identity}>Diplom-ID: {certificate.id}</p>
      </div><Award size={36} aria-hidden="true" />
    </li>)}</ul> : <section className="panel empty-state"><Award size={36} aria-hidden="true" /><h2>Dina kommande diplom samlas här</h2><p className="muted">På kurser som erbjuder diplom kan du skapa ett när alla lektioner, quiz och skrivuppgifter är klara.</p><Link href="/elevportal" className="button button-primary"><BookOpen size={17} aria-hidden="true" /> Till mina kurser</Link></section>}
  </>;
}
