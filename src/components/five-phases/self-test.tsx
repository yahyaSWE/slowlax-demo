"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Leaf,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { QUESTIONS } from "@/lib/five-phases/questions";
import {
  ELEMENT_PROFILES,
  TEST_DISCLAIMER,
  getCombinationDescription,
} from "@/lib/five-phases/profiles";
import { calculateResult } from "@/lib/five-phases/scoring";
import {
  SESSION_STORAGE_KEY,
  createSession,
  parseStoredSession,
} from "@/lib/five-phases/session";
import {
  ELEMENTS,
  type AnswerValue,
  type ElementType,
  type TestResult,
  type TestSession,
} from "@/lib/five-phases/types";
import "./self-test.css";

const ANSWER_OPTIONS: readonly { value: AnswerValue; label: string }[] = [
  { value: 1, label: "Stämmer inte alls" },
  { value: 2, label: "Stämmer ganska dåligt" },
  { value: 3, label: "Stämmer delvis" },
  { value: 4, label: "Stämmer ganska väl" },
  { value: 5, label: "Stämmer mycket väl" },
];
const questionById = new Map(
  QUESTIONS.map((question) => [question.id, question]),
);

function PhaseGlyph({ element }: { element: ElementType }) {
  return (
    <span className="selftest-phase-glyph" aria-hidden="true">
      {ELEMENT_PROFILES[element].character}
    </span>
  );
}

function Disclaimer() {
  return (
    <aside className="selftest-disclaimer" aria-label="Om testets syfte">
      <ShieldCheck size={21} aria-hidden="true" />
      <p>{TEST_DISCLAIMER}</p>
    </aside>
  );
}

function ProfileDetails({ element }: { element: ElementType }) {
  const profile = ELEMENT_PROFILES[element];
  return (
    <div className="selftest-profile-details" data-phase={element}>
      <section className="selftest-nature">
        <p className="eyebrow">Din grundnatur</p>
        <h2>
          {profile.label} <span aria-hidden="true">{profile.character}</span>
        </h2>
        <p className="selftest-profile-theme">{profile.theme}</p>
        <p>{profile.summary}</p>
      </section>
      <div className="selftest-detail-grid">
        <section className="selftest-detail-card">
          <h3>Dina styrkor</h3>
          <ul className="selftest-strengths">
            {profile.strengths.map((strength) => (
              <li key={strength}>{strength}</li>
            ))}
          </ul>
        </section>
        <section className="selftest-detail-card">
          <h3>När du är i balans</h3>
          <p>{profile.balanced}</p>
        </section>
        <section className="selftest-detail-card">
          <h3>När du är under stress</h3>
          <p>{profile.stress}</p>
        </section>
        <section className="selftest-detail-card">
          <h3>Vad som brukar stödja din konstitution</h3>
          <ul className="selftest-support">
            {profile.support.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
      <details className="selftest-traditional">
        <summary>Traditionella associationer för {profile.label}</summary>
        <p>
          Associationerna beskriver den traditionella teorimodellen och dess
          symboliska kopplingar. De säger inget om tillståndet i dina organ.
        </p>
        <ul>
          {profile.traditional.map((association) => (
            <li key={association}>{association}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function CombinationCard({
  first,
  second,
}: {
  first: ElementType;
  second: ElementType;
}) {
  return (
    <div className="selftest-combination-card">
      <h3>
        {ELEMENT_PROFILES[first].label} + {ELEMENT_PROFILES[second].label}
      </h3>
      <p>{getCombinationDescription(first, second)}</p>
    </div>
  );
}

function ResultView({
  result,
  headingRef,
  onRestart,
  canPersist,
}: {
  result: TestResult;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRestart: () => void;
  canPersist: boolean;
}) {
  const tied = result.tiedElements.length > 1;
  const zeroResult = result.scores.every((score) => score.percentage === 0);
  const primary = ELEMENT_PROFILES[result.primary.element];
  const secondary = ELEMENT_PROFILES[result.secondary.element];
  const secondaryElements = result.scores
    .filter(
      (score) =>
        score.element !== result.primary.element &&
        score.percentage === result.scores[1].percentage,
    )
    .map((score) => score.element);
  const topLabels = result.tiedElements
    .map((element) => ELEMENT_PROFILES[element].label)
    .join(", ");
  const gap = result.scores[0].percentage - result.scores[1].percentage;
  const tiedPairs = result.tiedElements.flatMap((first, index) =>
    result.tiedElements.slice(index + 1).map((second) => ({ first, second })),
  );
  return (
    <div className="selftest-result">
      <header className="selftest-result-hero">
        <p className="eyebrow">Dina fem faser · Wu Xing</p>
        <h1 ref={headingRef} tabIndex={-1} className="selftest-focus">
          {tied
            ? result.tiedElements.length === ELEMENTS.length
              ? "Alla fem faser delar högsta poängen"
              : `Delad högsta poäng: ${topLabels}`
            : `Din primära konstitution är ${primary.label}`}
        </h1>
        <p>
          {zeroResult
            ? "Dina svar gav 0/100 för alla fem faser. Testet visar därför inga tydliga konstitutionsdrag; beskrivningarna längre ned är allmänna reflektionsunderlag."
            : tied
              ? "Flera faser får samma högsta poäng i dina svar. Ingen enskild primär konstitution kan särskiljas utifrån testet."
              : secondaryElements.length > 1
                ? `Med ${secondaryElements.map((element) => ELEMENT_PROFILES[element].label).join(", ")} på delad andra plats.`
                : `Med ${secondary.label} som sekundär konstitution.`}
        </p>
        {!tied && (
          <div className="selftest-result-symbol" aria-hidden="true">
            {primary.character}
          </div>
        )}
      </header>

      {result.isMixed && (
        <aside className="selftest-mixed">
          <Sparkles size={21} aria-hidden="true" />
          <div>
            <h2>
              {zeroResult
                ? "Jämna poäng utan framträdande drag"
                : tied
                  ? "Ett jämnt resultat med delad högsta poäng"
                  : "En tydlig blandkonstitution"}
            </h2>
            <p>
              {zeroResult
                ? "Du valde skalans lägsta svar för varje fråga. Alla faser fick samma poäng, men det betyder inte att alla fem är starka drag hos dig. Testet skiljer inte ut någon primär eller sekundär konstitution."
                : tied
                  ? `${topLabels} delar högsta poängen. Det finns ingen rangordning mellan dem; beskrivningarna är olika utgångspunkter för självreflektion.`
                  : `Det skiljer bara ${gap} poäng på skalan 0–100 mellan dina två högsta resultat. Dina svar visar tydliga drag från flera faser, snarare än en enda dominerande konstitution.`}
            </p>
          </div>
        </aside>
      )}

      <section className="selftest-score-panel">
        <div className="selftest-section-heading">
          <p className="eyebrow">Alla fem resultaten</p>
          <h2>Så fördelas dina svar</h2>
          <p>
            Varje fas visas på en skala från 0 till 100. Poängen beskriver dina
            svar, inte en sannolikhet eller en medicinsk bedömning.
          </p>
        </div>
        <ol
          className="selftest-score-list"
          aria-label="Poäng för de fem faserna"
        >
          {result.scores.map((score) => (
            <li key={score.element} data-phase={score.element}>
              <div className="selftest-score-heading">
                <span>
                  <PhaseGlyph element={score.element} />
                  {ELEMENT_PROFILES[score.element].label}
                </span>
                <strong>
                  {score.percentage}
                  <span>/100</span>
                </strong>
              </div>
              <div className="selftest-score-track" aria-hidden="true">
                <span style={{ width: `${score.percentage}%` }} />
              </div>
              <small>{score.rawScore} av 40 råpoäng</small>
            </li>
          ))}
        </ol>
        <p className="selftest-score-note">
          Varje fas har åtta frågor. Summan 8–40 normaliseras till 0–100. Faser
          med samma poäng visas i en fast ordning, utan att den ordningen
          innebär någon skillnad i styrka.
        </p>
      </section>

      {tied ? (
        <section className="selftest-tied-profiles">
          <div className="selftest-section-heading">
            <p className="eyebrow">Flera perspektiv</p>
            <h2>Utforska faserna med delad högsta poäng</h2>
            <p>
              Öppna de beskrivningar du vill läsa. Alla dessa faser delar den
              högsta poängen; testet väljer inte en godtycklig huvudfas.
            </p>
          </div>
          {result.tiedElements.map((element) => (
            <details
              className="selftest-profile-accordion"
              key={element}
              data-phase={element}
            >
              <summary>
                <PhaseGlyph element={element} />
                <span>
                  {ELEMENT_PROFILES[element].label}
                  <small>{ELEMENT_PROFILES[element].theme}</small>
                </span>
              </summary>
              <ProfileDetails element={element} />
            </details>
          ))}
        </section>
      ) : (
        <ProfileDetails element={result.primary.element} />
      )}

      {!tied && (
        <section className="selftest-secondary">
          <div className="selftest-section-heading">
            <p className="eyebrow">Ett kompletterande drag</p>
            <h2>
              {secondaryElements.length > 1
                ? "Dina sekundära konstitutioner"
                : "Din sekundära konstitution"}
            </h2>
            {secondaryElements.length > 1 && (
              <p>
                Dessa faser delar den näst högsta poängen. Ingen av dem har en
                starkare andraplats än de andra.
              </p>
            )}
          </div>
          <div className="selftest-secondary-grid">
            {secondaryElements.map((element) => (
              <article
                className="selftest-secondary-card"
                data-phase={element}
                key={element}
              >
                <PhaseGlyph element={element} />
                <h3>{ELEMENT_PROFILES[element].label}</h3>
                <p>{ELEMENT_PROFILES[element].summary}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="selftest-combination">
        <div className="selftest-section-heading">
          <p className="eyebrow">När dragen möts</p>
          <h2>
            {zeroResult
              ? "Kombinationer i teorimodellen"
              : "Kombinationen av dina starkaste element"}
          </h2>
        </div>
        {tied && result.tiedElements.length > 2 ? (
          <>
            <p>
              Fler än två faser delar högsta poängen. Därför kan testet inte
              välja ut en enda kombination. Du kan utforska de möjliga paren som
              allmänna reflektionsunderlag.
            </p>
            <details className="selftest-combination-options">
              <summary>
                Utforska kombinationer mellan faserna med samma poäng
              </summary>
              {tiedPairs.map(({ first, second }) => (
                <CombinationCard
                  key={`${first}-${second}`}
                  first={first}
                  second={second}
                />
              ))}
            </details>
          </>
        ) : tied ? (
          <CombinationCard
            first={result.tiedElements[0]}
            second={result.tiedElements[1]}
          />
        ) : (
          secondaryElements.map((element) => (
            <CombinationCard
              key={element}
              first={result.primary.element}
              second={element}
            />
          ))
        )}
      </section>
      <div className="selftest-result-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={onRestart}
        >
          <RotateCcw size={17} aria-hidden="true" />
          Gör om testet
        </button>
        <p>
          {canPersist
            ? "Resultatet sparas bara i den här webbläsaren."
            : "Resultatet finns bara kvar under det här besöket."}
        </p>
      </div>
      <Disclaimer />
    </div>
  );
}

export function FivePhasesSelfTest() {
  const [session, setSession] = useState<TestSession | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [canPersist, setCanPersist] = useState(true);
  const [storageNotice, setStorageNotice] = useState("");
  const [restoredNotice, setRestoredNotice] = useState("");
  const [answerNotice, setAnswerNotice] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const quizRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      const stored = parseStoredSession(raw);
      if (stored) {
        setSession(stored);
        setRestoredNotice(
          stored.completed
            ? "Ditt tidigare resultat har återställts från den här webbläsaren."
            : "Ditt pågående test har återställts. Du kan fortsätta där du slutade.",
        );
      } else if (raw) {
        setStorageNotice(
          "Ett tidigare sparat test kunde inte läsas. Du kan starta ett nytt test.",
        );
      }
    } catch {
      setCanPersist(false);
      setStorageNotice(
        "Din webbläsare tillåter inte lokal lagring. Du kan göra testet, men svaren och resultatet finns bara kvar under det här besöket.",
      );
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady || !canPersist || !session) return;
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      setCanPersist(false);
      setStorageNotice(
        "Dina svar kunde inte sparas i webbläsaren. Du kan fortsätta testet, men svaren och resultatet finns bara kvar under det här besöket.",
      );
    }
  }, [session, storageReady, canPersist]);

  const currentIndex = session?.currentIndex;
  const completed = session?.completed;
  const questionOrder = session?.questionOrder;
  useEffect(() => {
    if (currentIndex === undefined) return;
    headingRef.current?.focus({ preventScroll: true });
    const scrollTarget = completed ? headingRef.current : quizRef.current;
    scrollTarget?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [currentIndex, completed, questionOrder]);

  function start() {
    setRestoredNotice("");
    setAnswerNotice("");
    setSession(createSession());
  }

  function restart() {
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      setCanPersist(false);
      setStorageNotice(
        "Det sparade testet kunde inte rensas i webbläsaren. Ett nytt test har ändå startats för det här besöket.",
      );
    }
    dialogRef.current?.close();
    start();
  }

  function answer(questionId: number, value: AnswerValue) {
    setAnswerNotice("");
    setSession((current) =>
      current
        ? {
            ...current,
            answers: [
              ...current.answers.filter(
                (item) => item.questionId !== questionId,
              ),
              { questionId, value },
            ],
          }
        : null,
    );
  }

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const questionId = session.questionOrder[session.currentIndex];
    if (!session.answers.some((item) => item.questionId === questionId)) {
      setAnswerNotice("Välj ett svar innan du går vidare.");
      return;
    }
    setAnswerNotice("");
    setRestoredNotice("");
    setSession({
      ...session,
      currentIndex: Math.min(session.currentIndex + 1, QUESTIONS.length - 1),
      completed: session.currentIndex === QUESTIONS.length - 1,
    });
  }

  const question =
    session && !session.completed
      ? questionById.get(session.questionOrder[session.currentIndex])
      : undefined;
  const chosen =
    question &&
    session?.answers.find((item) => item.questionId === question.id)?.value;
  const result = session?.completed ? calculateResult(session.answers) : null;

  return (
    <section className="section container five-phases-test">
      <noscript>
        <p className="selftest-storage-notice">
          Aktivera JavaScript i webbläsaren för att göra självtestet. Du kan
          läsa introduktionen och om de fem faserna här utan JavaScript.
        </p>
      </noscript>
      {(storageNotice || restoredNotice) && (
        <p className="selftest-storage-notice" role="status">
          {storageNotice || restoredNotice}
        </p>
      )}
      {!session ? (
        <>
          <header className="selftest-intro-hero">
            <div>
              <p className="eyebrow">Fem faser · Wu Xing</p>
              <h1>Vilken av de fem konstitutionerna är du?</h1>
              <p className="selftest-subtitle">
                Upptäck din konstitution enligt de fem faserna inom traditionell
                kinesisk medicin.
              </p>
              <p className="selftest-intro-copy">
                Ett konstitutionstest inspirerat av klassisk kinesisk medicin
                och Five Phases/Wu Xing. Utforska olika drag hos dig själv, som
                ett underlag för utbildning och självreflektion.
              </p>
              <ul className="selftest-facts" aria-label="Om självtestet">
                <li>
                  <Leaf size={15} aria-hidden="true" />
                  40 frågor
                </li>
                <li>
                  <Clock3 size={15} aria-hidden="true" />
                  Cirka 5 minuter
                </li>
                <li>
                  <Check size={15} aria-hidden="true" />
                  Gratis test
                </li>
              </ul>
              <button
                type="button"
                className="button button-primary"
                onClick={start}
                disabled={!storageReady}
              >
                Starta testet
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="selftest-wheel" aria-hidden="true">
              <div className="selftest-wheel-center">
                <span>五行</span>
                <small>Wu Xing</small>
              </div>
              {ELEMENTS.map((element) => (
                <div
                  key={element}
                  className="selftest-wheel-phase"
                  data-phase={element}
                >
                  <span>{ELEMENT_PROFILES[element].character}</span>
                  <small>{ELEMENT_PROFILES[element].label}</small>
                </div>
              ))}
            </div>
          </header>
          <section className="selftest-introduction">
            <div className="selftest-section-heading">
              <p className="eyebrow">En traditionell modell</p>
              <h2>Fem faser, olika uttryck</h2>
              <p>
                Faserna beskriver kvaliteter som kan samspela. Alla fem finns
                med i testet, och ingen fas är bättre än någon annan.
              </p>
            </div>
            <div className="selftest-intro-grid">
              {ELEMENTS.map((element) => (
                <article
                  key={element}
                  className="selftest-intro-card"
                  data-phase={element}
                >
                  <PhaseGlyph element={element} />
                  <h3>{ELEMENT_PROFILES[element].label}</h3>
                  <p>{ELEMENT_PROFILES[element].description}</p>
                </article>
              ))}
            </div>
          </section>
          <p className="selftest-local-note">
            {canPersist
              ? "Dina svar sparas bara i den här webbläsaren. De skickas inte till Slowlax."
              : "Dina svar skickas inte till Slowlax. Lokal lagring är blockerad, så testet finns bara kvar under det här besöket."}
          </p>
          <Disclaimer />
        </>
      ) : result ? (
        <ResultView
          result={result}
          headingRef={headingRef}
          canPersist={canPersist}
          onRestart={() => dialogRef.current?.showModal()}
        />
      ) : question ? (
        <div className="selftest-quiz" ref={quizRef}>
          <div className="selftest-progress-header">
            <p>
              Fråga {session.currentIndex + 1} av {QUESTIONS.length}
            </p>
            <button
              type="button"
              className="selftest-restart-link"
              onClick={() => dialogRef.current?.showModal()}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Gör om testet
            </button>
          </div>
          <progress
            className="selftest-progress"
            value={session.answers.length}
            max={QUESTIONS.length}
            aria-label={`${session.answers.length} av ${QUESTIONS.length} frågor besvarade`}
          />
          <div className="selftest-question-card">
            <p className="selftest-question-hint">
              Utgå från hur du oftast upplever dig själv. Det finns inga rätt
              eller fel svar.
            </p>
            <h1
              id="selftest-question"
              ref={headingRef}
              tabIndex={-1}
              className="selftest-focus"
              aria-label={`Fråga ${session.currentIndex + 1} av ${QUESTIONS.length}: ${question.text}`}
            >
              {question.text}
            </h1>
            <form onSubmit={next}>
              <fieldset aria-describedby="selftest-question">
                <legend>Hur väl stämmer detta för dig?</legend>
                <div className="selftest-answers">
                  {ANSWER_OPTIONS.map((option) => (
                    <label
                      className="selftest-answer"
                      key={option.value}
                      htmlFor={`selftest-answer-${option.value}`}
                    >
                      <input
                        id={`selftest-answer-${option.value}`}
                        type="radio"
                        name="selftest-answer"
                        value={option.value}
                        checked={chosen === option.value}
                        onChange={() => answer(question.id, option.value)}
                        required
                      />
                      <span
                        className="selftest-answer-number"
                        aria-hidden="true"
                      >
                        {option.value}
                      </span>
                      <span>
                        <span className="sr-only">{option.value} = </span>
                        {option.label}
                      </span>
                      <Check
                        className="selftest-answer-check"
                        size={18}
                        aria-hidden="true"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              {answerNotice && (
                <p className="selftest-answer-notice" role="alert">
                  {answerNotice}
                </p>
              )}
              <div className="selftest-quiz-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={session.currentIndex === 0}
                  onClick={() => {
                    setAnswerNotice("");
                    setSession({
                      ...session,
                      currentIndex: session.currentIndex - 1,
                    });
                  }}
                >
                  <ArrowLeft size={17} aria-hidden="true" />
                  Föregående
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={!chosen}
                >
                  {session.currentIndex === QUESTIONS.length - 1
                    ? "Visa resultat"
                    : "Nästa fråga"}
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            </form>
          </div>
          <p className="selftest-local-note">
            {canPersist
              ? "Du kan pausa och återkomma. Svaren sparas automatiskt i den här webbläsaren."
              : "Testet fungerar under det här besöket. Svaren kan inte sparas lokalt."}
          </p>
        </div>
      ) : null}
      <dialog
        className="selftest-dialog"
        ref={dialogRef}
        aria-labelledby="selftest-restart-title"
        aria-describedby="selftest-restart-description"
      >
        <h2 id="selftest-restart-title">Gör om testet?</h2>
        <p id="selftest-restart-description">
          Dina tidigare svar och ditt sparade resultat för det här testet
          rensas. Du börjar ett nytt test med frågorna i en ny blandad ordning.
        </p>
        <div className="selftest-dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            autoFocus
            onClick={() => dialogRef.current?.close()}
          >
            {session?.completed ? "Behåll resultatet" : "Fortsätt testet"}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={restart}
          >
            Gör om testet
          </button>
        </div>
      </dialog>
    </section>
  );
}
