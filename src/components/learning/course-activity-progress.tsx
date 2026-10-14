import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import {
  learningActivityStatusLabel,
  type StudentCourseLearningStatus,
} from "@/lib/course-learning-status";
import styles from "./portal-learning.module.css";

export function CourseActivityProgress({
  courseId,
  status,
}: {
  courseId: number;
  status: StudentCourseLearningStatus;
}) {
  if (!status.activities.length) return null;
  return (
    <section className={`panel ${styles.activityOverview}`} aria-labelledby="course-activity-progress-title">
      <h2 id="course-activity-progress-title"><ClipboardList size={23} aria-hidden="true" /> Quiz och skrivuppgifter</h2>
      <p className="small muted">Resultaten gäller de aktuella versionerna och räknas separat från markerade lektioner.</p>
      <div className={styles.activityCounts}>
        {status.quizzes.total > 0 && <p><strong>{status.quizzes.passed} av {status.quizzes.total}</strong> quiz godkända</p>}
        {status.assignments.total > 0 && (
          <div>
            <p><strong>{status.assignments.approved} av {status.assignments.total}</strong> skrivuppgifter godkända</p>
            {status.assignments.awaitingReview > 0 && <p className="small muted">{status.assignments.awaitingReview} väntar på återkoppling</p>}
            {status.assignments.needsRevision > 0 && <p className="small muted">{status.assignments.needsRevision} behöver kompletteras</p>}
            {status.assignments.draft > 0 && <p className="small muted">{status.assignments.draft} har ett sparat utkast</p>}
          </div>
        )}
      </div>
      <details className={styles.activityDetails}>
        <summary>Visa uppgifter och resultat ({status.activities.length})</summary>
        <ul className={styles.activityList}>
          {status.activities.map((activity) => (
            <li key={activity.id}>
              <Link href={`/elevportal/kurser/${courseId}/lektioner/${activity.lessonId}#activity-${activity.id}`}>
                <span><strong>{activity.title}</strong><small>{activity.lessonTitle} · {learningActivityStatusLabel(activity.status)}</small></span>
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
