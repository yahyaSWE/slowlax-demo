"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  CircleAlert,
  PenLine,
  Send,
} from "lucide-react";
import { saveAssignmentAction, submitQuizAction } from "@/lib/activity-actions";
import type { ActivityActionState } from "@/lib/activity-action-state";
import { withLessonActivityErrors } from "@/lib/lesson-activity-actions";
import type {
  AssignmentStatus,
  AssignmentSubmission,
  QuizAttempt,
  StudentCourseActivity,
} from "@/lib/types";
import styles from "./lesson-activities.module.css";
import {
  allowLessonVersionReset,
  useLessonNavigationGuard,
} from "./use-lesson-navigation-guard";

type ActivityIdentity = Pick<
  StudentCourseActivity,
  "id" | "courseId" | "lessonId" | "revision" | "title" | "instructions"
>;
type QuizHistoryItem = Omit<QuizAttempt, "userId" | "activityId">;
type AssignmentHistoryItem = Omit<
  AssignmentSubmission,
  "userId" | "activityId" | "reviewedBy"
>;
type LessonActivityView = ActivityIdentity &
  Pick<StudentCourseActivity, "kind" | "questions" | "passPercent"> & {
    quizAttempts: QuizHistoryItem[];
    assignmentSubmissions: AssignmentHistoryItem[];
  };

const INITIAL_STATE: ActivityActionState = {};
const saveAssignmentSafely = withLessonActivityErrors(saveAssignmentAction);
const submitQuizSafely = withLessonActivityErrors(submitQuizAction);
const ASSIGNMENT_STATUS: Record<AssignmentStatus, string> = {
  draft: "Utkast sparat",
  submitted: "Inlämnad",
  approved: "Godkänd",
  needs_revision: "Behöver kompletteras",
};

export function LessonActivity({ activity }: { activity: LessonActivityView }) {
  const guardId = useId();
  const [openedVersion, setOpenedVersion] = useState(activity);
  const container = useRef<HTMLDivElement>(null);
  const focusNewVersion = useRef(false);
  const outdated = openedVersion.revision !== activity.revision;
  const displayed = outdated
    ? {
        ...openedVersion,
        quizAttempts: activity.quizAttempts,
        assignmentSubmissions: activity.assignmentSubmissions,
      }
    : activity;

  useEffect(() => {
    if (!focusNewVersion.current) return;
    focusNewVersion.current = false;
    container.current?.querySelector<HTMLElement>("h3")?.focus();
  }, [openedVersion.revision]);

  return (
    <div id={`activity-${activity.id}`} ref={container} className={styles.versionContainer}>
      {outdated && (
        <aside className={styles.versionWarning}>
          <div role="alert">
            <p>
              <strong>Aktiviteten har uppdaterats.</strong> Du ser fortfarande
              den gamla versionen och dina tidigare svar. Du kan inte spara
              eller lämna in den här versionen.
            </p>
            <p>
              {displayed.kind === "assignment"
                ? "Kopiera din osparade text innan du öppnar den nya versionen."
                : "Anteckna dina val om du vill behålla dem innan du öppnar den nya versionen."}{" "}
              När du öppnar den nya versionen nollställs formuläret. Redan
              sparade svar och utkast finns kvar i historiken.
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (!allowLessonVersionReset(guardId)) return;
              focusNewVersion.current = true;
              setOpenedVersion(activity);
            }}
          >
            Öppna den nya versionen
          </button>
        </aside>
      )}
      {displayed.kind === "quiz" ? (
        <QuizActivityForm
          key={`${displayed.id}-${displayed.revision}`}
          activity={displayed}
          outdated={outdated}
          guardId={guardId}
        />
      ) : (
        <AssignmentActivityForm
          key={`${displayed.id}-${displayed.revision}`}
          activity={displayed}
          outdated={outdated}
          guardId={guardId}
        />
      )}
    </div>
  );
}

function ActivityFields({ activity }: { activity: ActivityIdentity }) {
  return (
    <>
      <input type="hidden" name="activityId" value={activity.id} />
      <input type="hidden" name="courseId" value={activity.courseId} />
      <input type="hidden" name="lessonId" value={activity.lessonId} />
      <input type="hidden" name="revision" value={activity.revision} />
    </>
  );
}

function ActivityMessage({
  state,
  showSuccess = true,
}: {
  state: ActivityActionState;
  showSuccess?: boolean;
}) {
  if (state.error)
    return (
      <p className="notice notice-error" role="alert">
        {state.error}
      </p>
    );
  if (state.success && showSuccess)
    return (
      <p className="notice notice-success" role="status">
        {state.success}
      </p>
    );
  return null;
}

function ActivityDate({ value }: { value: string | null }) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString("sv-SE", {
        timeZone: "Europe/Stockholm",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}

function QuizAttemptReview({
  attempt,
  oldVersion,
}: {
  attempt: QuizHistoryItem;
  oldVersion: boolean;
}) {
  return (
    <details className={styles.historyItem}>
      <summary>
        Försök {attempt.attemptNumber} · {attempt.scorePercent} % ·{" "}
        {attempt.passed ? "Godkänt" : "Inte godkänt"}
      </summary>
      <div className={styles.historyContent}>
        <p className="small muted">
          <ActivityDate value={attempt.submittedAt} />
        </p>
        {oldVersion && (
          <p className="small muted">
            Det här försöket gäller en tidigare version av quizet.
          </p>
        )}
        <p>
          {attempt.correctCount} av {attempt.questionCount} rätt. Gränsen för
          godkänt var {attempt.passPercent} %.
        </p>
        <ol className={styles.answerReview}>
          {attempt.answers.map((answer) => (
            <li
              key={answer.questionId}
              className={
                answer.correct ? styles.correctAnswer : styles.incorrectAnswer
              }
            >
              <p>
                <strong>{answer.prompt}</strong>
              </p>
              <p className={styles.answerStatus}>
                {answer.correct ? (
                  <CheckCircle2 size={17} aria-hidden="true" />
                ) : (
                  <CircleAlert size={17} aria-hidden="true" />
                )}
                {answer.correct ? "Rätt" : "Inte rätt"}
              </p>
              <p>
                Ditt svar:{" "}
                {answer.options[answer.selectedOption] ?? "Svaret saknas"}
              </p>
              {!answer.correct && (
                <p>
                  Rätt svar:{" "}
                  {answer.options[answer.correctOption] ?? "Svaret saknas"}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

export function QuizActivityForm({
  activity,
  outdated = false,
  guardId,
}: {
  activity: ActivityIdentity &
    Pick<StudentCourseActivity, "questions" | "passPercent"> & {
      quizAttempts: QuizHistoryItem[];
    };
  outdated?: boolean;
  guardId: string;
}) {
  const [state, action, pending] = useActionState(
    submitQuizSafely,
    INITIAL_STATE,
  );
  const attempts = [...activity.quizAttempts].sort((a, b) => b.id - a.id);
  const latest = attempts.find(
    (attempt) => attempt.revision === activity.revision,
  );
  const hasPassedCurrentVersion = attempts.some(
    (attempt) => attempt.revision === activity.revision && attempt.passed,
  );
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const changedAnswers =
    !!latest &&
    Object.keys(answers).length > 0 &&
    activity.questions.some(
      (question) =>
        answers[question.id] !==
        latest.answers.find((answer) => answer.questionId === question.id)
          ?.selectedOption,
    );
  const unsavedAnswers =
    Object.keys(answers).length > 0 && (!latest || changedAnswers);
  useLessonNavigationGuard(guardId, { dirty: unsavedAnswers, pending });
  const headingId = `quiz-${activity.id}-heading`;
  return (
    <section className={styles.activityCard} aria-labelledby={headingId}>
      <header className={styles.activityHeading}>
        <span className={styles.typeIcon}>
          <BookOpenCheck size={21} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Quiz</p>
          <h3 id={headingId} tabIndex={-1}>
            {activity.title}
          </h3>
        </div>
        <span className={styles.badge}>
          {activity.questions.length}{" "}
          {activity.questions.length === 1 ? "fråga" : "frågor"}
        </span>
      </header>
      {activity.instructions && (
        <p className={styles.instructions}>{activity.instructions}</p>
      )}
      <p className="small muted">
        Välj ett svar på varje fråga. Dina svar rättas när du lämnar in.
        {activity.passPercent !== null &&
          ` Gräns för godkänt: ${activity.passPercent} %.`}
      </p>
      {latest && (
        <div className={styles.resultPanel}>
          <p className={styles.resultLabel}>
            <strong>Senaste resultat</strong>
            <span
              className={latest.passed ? styles.approvedBadge : styles.badge}
            >
              {latest.passed ? "Godkänt" : "Inte godkänt"}
            </span>
          </p>
          <p className={styles.score}>
            {latest.scorePercent} %{" "}
            <span>
              {latest.correctCount} av {latest.questionCount} rätt
            </span>
          </p>
          <p className="small muted">
            Försök {latest.attemptNumber} ·{" "}
            <ActivityDate value={latest.submittedAt} />
          </p>
          {!latest.passed && hasPassedCurrentVersion && (
            <p className="small muted">
              Du har redan ett godkänt försök på den här versionen. Det finns kvar
              i kursens resultat när du fortsätter öva.
            </p>
          )}
        </div>
      )}
      <ActivityMessage
        state={state}
        showSuccess={!changedAnswers && !outdated}
      />
      {unsavedAnswers && (
        <p className="small muted" role="status">
          Dina ändrade svar har inte skickats in ännu.
        </p>
      )}
      <form
        action={action}
        data-lesson-activity-form
        aria-busy={pending}
        onSubmit={(event) => {
          if (outdated) event.preventDefault();
        }}
      >
        <ActivityFields activity={activity} />
        <fieldset disabled={pending || outdated} className={styles.formFields}>
          <legend className={styles.visuallyHidden}>
            Dina svar på {activity.title}
          </legend>
          <div className={styles.questions}>
            {activity.questions.map((question, index) => (
              <fieldset className={styles.question} key={question.id}>
                <legend>
                  {index + 1}. {question.prompt}
                </legend>
                <div className={styles.options}>
                  {question.options.map((option, optionIndex) => (
                    <label className={styles.option} key={optionIndex}>
                      <input
                        type="radio"
                        required
                        name={`answer:${question.id}`}
                        value={optionIndex}
                        checked={answers[question.id] === optionIndex}
                        onChange={() =>
                          setAnswers((previous) => ({
                            ...previous,
                            [question.id]: optionIndex,
                          }))
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <button
            className="button button-primary"
            type="submit"
            disabled={pending || outdated}
          >
            {pending
              ? "Rättar dina svar…"
              : latest
                ? "Lämna in ett nytt försök"
                : "Lämna in quiz"}
            <Send size={16} aria-hidden="true" />
          </button>
        </fieldset>
        {pending && (
          <p className="small muted" role="status">
            Dina svar skickas och rättas.
          </p>
        )}
      </form>
      {attempts.length > 0 && (
        <div className={styles.history}>
          <h4>Dina försök ({attempts.length})</h4>
          <p className="small muted">
            Öppna ett försök för att se dina svar och rättningen. Du kan göra
            quizet igen.
          </p>
          {attempts.map((attempt) => (
            <QuizAttemptReview
              key={attempt.id}
              attempt={attempt}
              oldVersion={attempt.revision !== activity.revision}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SubmissionReview({
  submission,
  oldVersion = false,
}: {
  submission: AssignmentHistoryItem;
  oldVersion?: boolean;
}) {
  return (
    <div className={styles.submissionReview}>
      <p className={styles.resultLabel}>
        <span
          className={
            submission.status === "approved"
              ? styles.approvedBadge
              : styles.badge
          }
        >
          {ASSIGNMENT_STATUS[submission.status]}
        </span>
        <span className="small muted">
          {submission.status === "draft" && "Utkast skapat "}
          <ActivityDate
            value={submission.submittedAt ?? submission.createdAt}
          />
        </span>
      </p>
      {oldVersion && (
        <p className="small muted">
          Svaret gäller en tidigare version av uppgiften.
        </p>
      )}
      <details className={styles.submissionText}>
        <summary>
          {submission.status === "draft"
            ? "Visa ditt tidigare utkast"
            : "Visa ditt inlämnade svar"}
        </summary>
        <p className={styles.instructions}>{submission.text}</p>
      </details>
      {submission.feedback && (
        <div className={styles.teacherFeedback}>
          <h4>Lärarens återkoppling</h4>
          <p className={styles.instructions}>{submission.feedback}</p>
          {submission.reviewedAt && (
            <p className="small muted">
              <ActivityDate value={submission.reviewedAt} />
            </p>
          )}
        </div>
      )}
      {submission.status === "submitted" && (
        <p className="small muted">
          Ditt svar har lämnats in och väntar på lärarens återkoppling.
        </p>
      )}
    </div>
  );
}

export function AssignmentActivityForm({
  activity,
  outdated = false,
  guardId,
}: {
  activity: ActivityIdentity & {
    assignmentSubmissions: AssignmentHistoryItem[];
  };
  outdated?: boolean;
  guardId: string;
}) {
  const [state, action, pending] = useActionState(
    saveAssignmentSafely,
    INITIAL_STATE,
  );
  const submissions = [...activity.assignmentSubmissions].sort(
    (a, b) => b.id - a.id,
  );
  const currentSubmissions = submissions.filter(
    (submission) => submission.revision === activity.revision,
  );
  const latest = currentSubmissions[0];
  const lastSubmitted = currentSubmissions.find(
    (submission) => submission.status !== "draft",
  );
  const [text, setText] = useState(
    latest?.status === "draft" || latest?.status === "needs_revision"
      ? latest.text
      : "",
  );
  const [editingFrom, setEditingFrom] = useState<number | null>(null);
  const editable =
    !latest || latest.status === "draft" || editingFrom === latest.id;
  const dirty =
    editable &&
    text.trim() !== (latest?.status === "draft" ? latest.text.trim() : "");
  useLessonNavigationGuard(guardId, { dirty, pending });
  const headingId = `assignment-${activity.id}-heading`;
  const textId = `assignment-${activity.id}-text`;
  const history = submissions.filter(
    (submission) =>
      submission.id !== latest?.id && submission.id !== lastSubmitted?.id,
  );
  return (
    <section className={styles.activityCard} aria-labelledby={headingId}>
      <header className={styles.activityHeading}>
        <span className={styles.typeIcon}>
          <PenLine size={21} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Skrivuppgift</p>
          <h3 id={headingId} tabIndex={-1}>
            {activity.title}
          </h3>
        </div>
        <span
          className={
            latest?.status === "approved" ? styles.approvedBadge : styles.badge
          }
        >
          {latest ? ASSIGNMENT_STATUS[latest.status] : "Inte påbörjad"}
        </span>
      </header>
      {activity.instructions && (
        <p className={styles.instructions}>{activity.instructions}</p>
      )}
      <ActivityMessage state={state} showSuccess={!dirty && !outdated} />
      {lastSubmitted && (
        <div className={styles.resultPanel}>
          <h4>Senast inlämnade svar</h4>
          <SubmissionReview submission={lastSubmitted} />
        </div>
      )}
      {editable ? (
        <form
          action={action}
          data-lesson-activity-form
          aria-busy={pending}
          onSubmit={(event) => {
            if (outdated) event.preventDefault();
          }}
        >
          <ActivityFields activity={activity} />
          <fieldset disabled={pending} className={styles.formFields}>
            <legend className={styles.visuallyHidden}>
              Ditt svar på {activity.title}
            </legend>
            <label htmlFor={textId} className={styles.textLabel}>
              {latest && latest.status !== "draft"
                ? "Ditt nya svar"
                : "Ditt svar"}
            </label>
            <p id={`${textId}-help`} className="small muted">
              Texten sparas när du väljer Spara utkast eller Lämna in. Spara
              innan du lämnar lektionen. Ditt utkast är privat tills du lämnar
              in det för lärarens återkoppling.
            </p>
            <textarea
              id={textId}
              name="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={9}
              required
              readOnly={outdated}
              maxLength={20_000}
              aria-describedby={`${textId}-help ${textId}-count`}
              className={styles.assignmentInput}
            />
            <div className={styles.draftMeta}>
              <p className="small muted" role="status">
                {pending
                  ? "Sparar ditt svar…"
                  : dirty
                    ? state.error
                      ? "Svaret är inte sparat. Texten finns kvar här; försök att spara igen."
                      : "Osparade ändringar – spara innan du lämnar lektionen."
                    : latest?.status === "draft"
                      ? "Ditt utkast är sparat."
                      : "Texten sparas när du väljer Spara utkast eller Lämna in."}
              </p>
              <p id={`${textId}-count`} className="small muted">
                {text.length.toLocaleString("sv-SE")} / 20 000 tecken
              </p>
            </div>
            <div className={styles.formButtons}>
              <button
                type="submit"
                className="button button-secondary"
                name="intent"
                value="draft"
                formNoValidate
                disabled={pending || outdated}
              >
                {pending ? "Sparar…" : "Spara utkast"}
              </button>
              <button
                type="submit"
                className="button button-primary"
                name="intent"
                value="submit"
                disabled={pending || outdated}
              >
                {pending ? "Sparar…" : "Lämna in"}
                <Send size={16} aria-hidden="true" />
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <button
          type="button"
          className="button button-secondary"
          disabled={outdated}
          onClick={() => {
            setText(latest.text);
            setEditingFrom(latest.id);
          }}
        >
          {latest.status === "needs_revision"
            ? "Komplettera ditt svar"
            : latest.status === "submitted"
              ? "Skriv en ny version"
              : "Skapa ett nytt utkast"}
        </button>
      )}
      {history.length > 0 && (
        <details className={styles.historyItem}>
          <summary>Tidigare svar och utkast ({history.length})</summary>
          <div className={styles.historyContent}>
            {history.map((submission) => (
              <SubmissionReview
                key={submission.id}
                submission={submission}
                oldVersion={submission.revision !== activity.revision}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
