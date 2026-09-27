import {
  AudioLines,
  BookOpen,
  Brain,
  CheckCircle2,
  Clock3,
  FileAudio,
  Layers2,
  Sparkles,
} from "lucide-react";
import type { LectioClient, LibraryNode } from "../../application/lectioClient";
import { useJobs, useLibrary } from "../shared/useLectioClient";
import { NextButton, NextEmptyState } from "./ui/NextPrimitives";
import "./overview.css";

const byRecent = (a: LibraryNode, b: LibraryNode) =>
  b.createdAt.localeCompare(a.createdAt);

export function DashboardView({ client }: { client: LectioClient }) {
  const library = useLibrary(client);
  const jobs = useJobs(client);
  const lectures = library.nodes.filter((node) => node.type === "lecture");
  const courses = library.nodes.filter((node) => node.type === "course");
  const transcribedLectureIds = new Set<string>();
  for (const segment of library.segments)
    transcribedLectureIds.add(segment.lectureId);
  const transcribedCount = lectures.reduce(
    (count, lecture) => count + Number(transcribedLectureIds.has(lecture.id)),
    0,
  );
  const approvedCards = library.cards.filter((card) => card.status !== "generated");
  const activeJobs = jobs.filter((job) => job.status === "active" || job.status === "queued");
  const recent = [...lectures].sort(byRecent).slice(0, 6);

  const openLecture = (id: string) => {
    client.session.selectNode(id);
    client.session.setActiveView("workspace");
  };

  return (
    <div className="overview-page" aria-labelledby="overview-title">
      <header className="overview-header">
        <div>
          <p className="overview-eyebrow">Översikt</p>
          <h1 id="overview-title">Dina studier</h1>
          <p>Fortsätt där du slutade eller se vad som väntar.</p>
        </div>
      </header>

      <section className="overview-metrics" aria-label="Bibliotekets status">
        <article><BookOpen aria-hidden="true" /><strong>{courses.length}</strong><span>kurser</span></article>
        <article><Layers2 aria-hidden="true" /><strong>{lectures.length}</strong><span>föreläsningar</span></article>
        <article><FileAudio aria-hidden="true" /><strong>{transcribedCount}</strong><span>transkriberade</span></article>
        <article><CheckCircle2 aria-hidden="true" /><strong>{approvedCards.length}</strong><span>godkända kort</span></article>
      </section>

      {activeJobs.length > 0 && (
        <section className="overview-status" aria-live="polite" aria-label="Pågående arbete">
          <Clock3 aria-hidden="true" />
          <div>
            <strong>{activeJobs.length === 1 ? "1 åtgärd pågår" : `${activeJobs.length} åtgärder pågår`}</strong>
            <span>{activeJobs.map((job) => job.label).join(" · ")}</span>
          </div>
          <NextButton tone="quiet" onClick={() => void Promise.all(activeJobs.map((job) => client.jobs.cancel(job.id)))}>
            Avbryt
          </NextButton>
        </section>
      )}

      <section className="overview-flow" aria-labelledby="flow-title">
        <header>
          <p className="overview-eyebrow">Så fungerar Lectio</p>
          <h2 id="flow-title">Från föreläsning till repetition</h2>
          <p>Samla materialet först. Lectio hjälper dig sedan att göra det sökbart och omvandla det till kort du själv godkänner.</p>
        </header>
        <ol>
          <li>
            <span className="overview-flow-icon"><AudioLines aria-hidden="true" /></span>
            <div><strong>Samla</strong><span>Spela in eller importera ljud och lägg till slides.</span></div>
          </li>
          <li>
            <span className="overview-flow-icon"><BookOpen aria-hidden="true" /></span>
            <div><strong>Förstå</strong><span>Transkribera, anteckna och markera det viktiga.</span></div>
          </li>
          <li>
            <span className="overview-flow-icon"><Sparkles aria-hidden="true" /></span>
            <div><strong>Skapa</strong><span>Generera relevanta Anki-kort från hela materialet.</span></div>
          </li>
          <li>
            <span className="overview-flow-icon"><Brain aria-hidden="true" /></span>
            <div><strong>Repetera</strong><span>Granska, godkänn och synka korten till Anki.</span></div>
          </li>
        </ol>
      </section>

      <section className="overview-section" aria-labelledby="recent-title">
        <div className="overview-section-heading">
          <h2 id="recent-title">Senaste föreläsningar</h2>
        </div>
        {recent.length ? (
          <div className="overview-list">
            {recent.map((lecture) => {
              const data = library.lectures[lecture.id];
              const hasTranscript = library.segments.some((segment) => segment.lectureId === lecture.id);
              return (
                <button key={lecture.id} type="button" onClick={() => openLecture(lecture.id)}>
                  <span className="overview-list-icon"><BookOpen aria-hidden="true" /></span>
                  <span className="overview-list-copy"><strong>{lecture.title}</strong><small>{[data?.slideAssetId && "slides", data?.audioParts?.length && "ljud", hasTranscript && "transkript"].filter(Boolean).join(" · ") || "Tom föreläsning"}</small></span>
                  <span aria-hidden="true">→</span>
                </button>
              );
            })}
          </div>
        ) : (
          <NextEmptyState
            icon={<BookOpen />}
            title="Biblioteket är tomt"
            description="Skapa en kurs i sidofältet för att börja."
            action={<NextButton onClick={() => client.session.setActiveView("workspace")}>Öppna biblioteket</NextButton>}
          />
        )}
      </section>
    </div>
  );
}
