import Link from "next/link";
import { Award, CheckCircle2, Circle, Download } from "lucide-react";
import type { CourseCertificateEligibility } from "@/lib/course-certificates";
import { CourseCertificateIssue } from "./course-certificate-issue";
import styles from "./course-certificates.module.css";

function date(value: string) { return new Intl.DateTimeFormat("sv-SE", { dateStyle: "long", timeZone: "Europe/Stockholm" }).format(new Date(value)); }

export function CourseCertificatePanel({ status }: { status: CourseCertificateEligibility }) {
  if (!status.enabled && !status.certificate) return null;
  const certificate = status.certificate;
  if (certificate) return <section className={`panel ${styles.panel}`} aria-labelledby="course-certificate-title">
    <h2 id="course-certificate-title"><Award size={25} aria-hidden="true" /> Ditt diplom</h2>
    <p>Du har ett diplom för <strong>{certificate.courseTitle}</strong>, utfärdat den {date(certificate.issuedAt)}.</p>
    <p className="small muted">Diplomet finns kvar även när kursåtkomsten upphör.</p>
    <div className={styles.actions}><a href={`/api/diplom/${certificate.id}`} className="button button-primary" download><Download size={17} aria-hidden="true" /> Ladda ner diplom (PDF)</a><Link href="/elevportal/diplom" className="text-link">Mina diplom</Link></div>
  </section>;
  const counts = [
    { label: "lektioner markerade som genomförda", done: status.lessons.completed, total: status.lessons.total, complete: status.lessons.total > 0 && status.lessons.completed === status.lessons.total },
    { label: "quiz godkända", done: status.quizzes.passed, total: status.quizzes.total, complete: status.quizzes.passed === status.quizzes.total },
    { label: "skrivuppgifter godkända", done: status.assignments.approved, total: status.assignments.total, complete: status.assignments.approved === status.assignments.total },
  ];
  return <section className={`panel ${styles.panel}`} aria-labelledby="course-certificate-title">
    <h2 id="course-certificate-title"><Award size={25} aria-hidden="true" /> Diplom för genomförd kurs</h2>
    <p>När lektionerna och kursens uppgifter är klara kan du skapa ett diplom med ditt namn och kursens titel.</p>
    <ul className={styles.criteria}>{counts.filter((item, index) => index === 0 || item.total > 0).map((item) => <li key={item.label}>
      {item.complete ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
      <span><strong>{item.done} av {item.total}</strong> {item.label}</span>
    </li>)}</ul>
    <p className="small muted">Quiz och skrivuppgifter behöver vara godkända i sina aktuella versioner. En inskickad skrivuppgift behöver först godkännas av läraren.</p>
    {status.eligible ? <CourseCertificateIssue courseId={status.courseId} /> : <p className="notice" role="status">{status.reason === "no_lessons" ? "Kursen behöver innehålla lektioner innan ett diplom kan utfärdas." : status.reason === "not_available" ? "Du behöver verifierat konto och aktuell kursåtkomst för att skapa diplomet." : "Fortsätt med det som återstår ovan. När alla krav är uppfyllda kan du skapa ditt diplom här."}</p>}
  </section>;
}
