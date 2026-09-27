import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import type { LectioClient } from "../../application/lectioClient";
import { useLibrary, useSession, useSettings } from "../shared/useLectioClient";
import { ProgressCenter } from "../../components/ProgressCenter";
import { StudySidebar } from "./StudySidebar";
import { DashboardView } from "./DashboardView";
import { sidebarCopy as copy } from "./sidebarCopy";
import { nextThemeStyle, resolveNextTheme } from "./themes";
import { Grainient } from "./ui/Grainient";
import "./next.css";

const StudySettings = lazy(() =>
  import("./StudySettings").then((module) => ({
    default: module.StudySettings,
  })),
);

const SuperActionsView = lazy(() =>
  import("./SuperActionsView").then((module) => ({
    default: module.SuperActionsView,
  })),
);

const LibraryOverview = lazy(() =>
  import("./LibraryOverview").then((module) => ({
    default: module.LibraryOverview,
  })),
);

const LectureView = lazy(() =>
  import("./lecture/LectureView").then((module) => ({
    default: module.LectureView,
  })),
);

const InboxView = lazy(() =>
  import("./inbox/InboxView").then((module) => ({
    default: module.InboxView,
  })),
);

export function NextApp({ client }: { client: LectioClient }) {
  const library = useLibrary(client);
  const session = useSession(client);
  const settings = useSettings(client);
  const [nativeError, setNativeError] = useState("");
  const [libraryBusy, setLibraryBusy] = useState(false);
  const selected = library.nodes.find((node) => node.id === session.selectedId);
  const title =
    session.activeView === "workspace"
      ? (selected?.title ?? copy.library)
      : (copy.views[session.activeView] ?? copy.home);
  const theme = resolveNextTheme(settings.selectedPaletteId);
  const themeStyle = useMemo(() => nextThemeStyle(theme), [theme]);

  // Radix portals render below <body>, outside .study-shell. Mirror the theme
  // tokens onto the document root so dialogs and popovers inherit the exact
  // same palette as the workspace, then restore the host styles on unmount.
  useEffect(() => {
    const root = document.documentElement;
    const declarations = Object.entries(themeStyle).filter(([name]) =>
      name.startsWith("--"),
    ) as Array<[string, string]>;
    const previous = declarations.map(
      ([name]) => [name, root.style.getPropertyValue(name)] as const,
    );
    const previousColorScheme = root.style.colorScheme;
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const previousThemeColor = themeMeta?.content;

    declarations.forEach(([name, value]) =>
      root.style.setProperty(name, value),
    );
    root.style.colorScheme = theme.tone;
    if (themeMeta) themeMeta.content = theme.palette.background;

    return () => {
      previous.forEach(([name, value]) => {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      });
      root.style.colorScheme = previousColorScheme;
      if (themeMeta && previousThemeColor !== undefined)
        themeMeta.content = previousThemeColor;
    };
  }, [theme.palette.background, theme.tone, themeStyle]);

  return (
    <div
      className="study-shell"
      data-frontend="next"
      data-theme={theme.palette.id}
      data-tone={theme.tone}
      style={themeStyle}
    >
      <a className="study-skip-link" href="#study-main-content">
        Hoppa till huvudinnehållet
      </a>
      <Grainient
        className="study-grainient"
        color1={theme.chrome[0]}
        color2={theme.chrome[1]}
        color3={theme.chrome[2]}
        fps={15}
        timeSpeed={0.18}
      />
      <div className="study-body">
        <StudySidebar
          client={client}
          disabled={libraryBusy}
          onNativeError={setNativeError}
        />
        <main
          id="study-main-content"
          tabIndex={-1}
          className="study-canvas"
          data-view={session.activeView}
          aria-label={copy.workspace}
        >
          <Suspense
            fallback={
              <div className="study-canvas-location" role="status">
                Öppnar vyn…
              </div>
            }
          >
            {session.activeView === "dashboard" ? (
              <DashboardView client={client} />
            ) : session.activeView === "super-actions" ? (
              <SuperActionsView client={client} />
            ) : session.activeView === "settings" ? (
              <StudySettings client={client} onBusyChange={setLibraryBusy} />
            ) : session.activeView === "inbox" ? (
              <InboxView client={client} />
            ) : session.activeView === "workspace" &&
              selected &&
              selected.type === "lecture" ? (
              <LectureView
                key={selected.id}
                client={client}
                lectureId={selected.id}
                onBusyChange={setLibraryBusy}
              />
            ) : session.activeView === "workspace" &&
              selected &&
              (selected.type === "course" ||
                selected.type === "module" ||
                selected.type === "topic") ? (
              <LibraryOverview
                key={selected.id}
                client={client}
                nodeId={selected.id}
              />
            ) : (
              <>
                <div className="study-canvas-location" aria-live="polite">
                  {title}
                </div>
                <div className="study-canvas-placeholder">
                  <span className="study-canvas-mark" aria-hidden="true">
                    <BookOpen />
                  </span>
                  <p>{copy.canvas}</p>
                </div>
              </>
            )}
          </Suspense>
          {nativeError && (
            <p className="study-native-error" role="alert">
              {nativeError}
            </p>
          )}
        </main>
      </div>
      <ProgressCenter
        client={client}
        bottomOffset={selected?.type === "lecture" ? 92 : 20}
      />
    </div>
  );
}
