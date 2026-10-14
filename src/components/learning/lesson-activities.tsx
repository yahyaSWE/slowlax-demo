import { getStudentLessonActivities } from "@/lib/course-activities";
import { LessonActivity } from "./lesson-activity-forms";
import styles from "./lesson-activities.module.css";

export async function LessonActivities({
  userId,
  courseId,
  lessonId,
}: {
  userId: number;
  courseId: number;
  lessonId: number;
}) {
  const activities = await getStudentLessonActivities(
    userId,
    courseId,
    lessonId,
  );
  if (!activities.length) return null;
  return (
    <section
      className={styles.activities}
      aria-labelledby="lesson-activities-title"
    >
      <header className={styles.sectionHeading}>
        <p className="eyebrow">Öva och reflektera</p>
        <h2 id="lesson-activities-title">Aktiviteter i lektionen</h2>
        <p className="muted">
          Svara i din egen takt och följ dina resultat här. Quiz och skrivuppgifter
          bedöms separat från din markering av lektionen som genomförd.
        </p>
      </header>
      {activities.map((activity) => {
        const common = {
          id: activity.id,
          courseId: activity.courseId,
          lessonId: activity.lessonId,
          revision: activity.revision,
          title: activity.title,
          instructions: activity.instructions,
        };
        return (
          <LessonActivity
            key={`${userId}-${activity.id}`}
            activity={{
              ...common,
              kind: activity.kind,
              questions: activity.questions,
              passPercent: activity.passPercent,
              quizAttempts: activity.quizAttempts.map(
                ({ userId: _userId, activityId: _activityId, ...attempt }) =>
                  attempt,
              ),
              assignmentSubmissions: activity.assignmentSubmissions.map(
                ({
                  userId: _userId,
                  activityId: _activityId,
                  reviewedBy: _reviewedBy,
                  ...submission
                }) => submission,
              ),
            }}
          />
        );
      })}
    </section>
  );
}
