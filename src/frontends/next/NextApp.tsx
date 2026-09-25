import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { LectioClient } from "../../application/lectioClient";
import { useLibrary, useSession, useSettings } from "../shared/useLectioClient";
import { StudySidebar } from "./StudySidebar";
import { StudySettings } from "./StudySettings";
import { sidebarCopy as copy } from "./sidebarCopy";
import { nextThemeStyle, resolveNextTheme } from "./themes";
import { Grainient } from "./ui/Grainient";
import "./next.css";

const LectureView = lazy(() =>
  import("./lecture/LectureView").then((module) => ({
    default: module.LectureView,
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

    declarations.forEach(([name, value]) =>
      root.style.setProperty(name, value),
    );
    root.style.colorScheme = theme.tone;

    return () => {
      previous.forEach(([name, value]) => {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      });
      root.style.colorScheme = previousColorScheme;
    };
  }, [theme.tone, themeStyle]);

  return (
    <div
      className="study-shell"
      data-frontend="next"
      data-theme={theme.palette.id}
      data-tone={theme.tone}
      style={themeStyle}
    >
      <Grainient
        key={theme.palette.id}
        className="study-grainient"
        color1="var(--arc-coral)"
        color2="var(--arc-rose)"
        color3="var(--arc-plum)"
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
          className="study-canvas"
          data-view={session.activeView}
          aria-label={copy.workspace}
        >
          {session.activeView === "settings" ? (
            <StudySettings client={client} onBusyChange={setLibraryBusy} />
          ) : session.activeView === "workspace" &&
            selected &&
            selected.type === "lecture" ? (
            <Suspense
              fallback={
                <div className="study-canvas-location" role="status">
                  Öppnar föreläsningen…
                </div>
              }
            >
              <LectureView
                key={selected.id}
                client={client}
                lectureId={selected.id}
                onBusyChange={setLibraryBusy}
              />
            </Suspense>
          ) : (
            <>
              <div className="study-canvas-location" aria-live="polite">
                {title}
              </div>
              <div className="study-canvas-placeholder">
                <span className="study-canvas-mark" aria-hidden="true">
                  L<span>·</span>
                </span>
                <p>{copy.canvas}</p>
              </div>
            </>
          )}
          {nativeError && (
            <p className="study-native-error" role="alert">
              {nativeError}
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
