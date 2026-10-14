import Link from "next/link";
import { CheckCircle2, ChevronDown, Circle, List } from "lucide-react";
import type { LessonOutline } from "@/lib/db";
import styles from "./portal-learning.module.css";

export function LessonCourseMenu({ courseId, courseTitle, lessons, completed, lessonId }: {
  courseId: number; courseTitle: string; lessons: LessonOutline[]; completed: number[]; lessonId: number;
}) {
  const completedCount = lessons.filter((item) => completed.includes(item.id)).length;
  const progress = lessons.length ? Math.round(completedCount / lessons.length * 100) : 0;
  const contents = (
    <div className={styles.menuContents}>
      <h2>{courseTitle}</h2>
      <div className="progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <p className="small muted">{completedCount} av {lessons.length} lektioner markerade som genomförda</p>
      <nav aria-label="Kurslektioner">
        {lessons.map((item, itemIndex) => (
          <Link className={item.id === lessonId ? "active" : ""} aria-current={item.id === lessonId ? "page" : undefined}
            key={item.id} href={`/elevportal/kurser/${courseId}/lektioner/${item.id}`}>
            <span className="lesson-sidebar-icon" aria-hidden="true">{completed.includes(item.id) ? <CheckCircle2 size={17} /> : <Circle size={17} />}</span>
            <span><small>Lektion {itemIndex + 1}{completed.includes(item.id) ? " · Genomförd" : ""}</small>{item.title}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
  return (
    <aside className={`lesson-sidebar panel ${styles.courseMenu}`}>
      <div className={styles.desktopMenu}>{contents}</div>
      <details className={styles.mobileMenu}>
        <summary><List size={19} aria-hidden="true" /><span>Visa kursinnehåll <small>{lessons.length} {lessons.length === 1 ? "lektion" : "lektioner"}</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
        {contents}
      </details>
    </aside>
  );
}
