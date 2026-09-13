import {
  BookOpen,
  ChevronRight,
  FileAudio,
  FileText,
  Layers3,
  Minus,
  Plus,
  Square,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  LectioClient,
  LectioError,
  LibraryNode,
  NodeType,
} from "../../application/lectioClient";
import { useLibrary, useSession } from "../shared/useLectioClient";

const nodeIcon: Record<NodeType, typeof BookOpen> = {
  workspace: BookOpen,
  course: BookOpen,
  module: Layers3,
  topic: FileText,
  lecture: FileText,
};

const childType: Partial<Record<NodeType, NodeType>> = {
  workspace: "course",
  course: "module",
  module: "lecture",
};

const childLabel: Partial<Record<NodeType, string>> = {
  workspace: "kurs",
  course: "modul",
  module: "föreläsning",
};

function WindowControls({ client }: { client: LectioClient }) {
  return (
    <div className="flex h-full">
      <button
        aria-label="Minimera"
        className="next-window-button"
        onClick={() => void client.nativeWindow.minimize()}
      >
        <Minus />
      </button>
      <button
        aria-label="Maximera eller återställ"
        className="next-window-button"
        onClick={() => void client.nativeWindow.toggleMaximize()}
      >
        <Square />
      </button>
      <button
        aria-label="Stäng"
        className="next-window-button next-window-close"
        onClick={() => void client.nativeWindow.close()}
      >
        <X />
      </button>
    </div>
  );
}

function TreeNode({
  client,
  node,
  nodes,
  selectedId,
  depth = 0,
}: {
  client: LectioClient;
  node: LibraryNode;
  nodes: LibraryNode[];
  selectedId: string;
  depth?: number;
}) {
  const Icon = nodeIcon[node.type];
  const children = nodes
    .filter((candidate) => candidate.parentId === node.id)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
  if (node.type === "workspace")
    return (
      <>
        {children.map((child) => (
          <TreeNode
            key={child.id}
            client={client}
            node={child}
            nodes={nodes}
            selectedId={selectedId}
          />
        ))}
      </>
    );
  return (
    <div>
      <button
        type="button"
        className={`next-tree-row ${selectedId === node.id ? "next-tree-row-selected" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => client.session.selectNode(node.id)}
      >
        {children.length ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <span className="w-3.5" />
        )}
        <Icon className="size-4" />
        <span className="truncate">{node.title}</span>
      </button>
      {children.map((child) => (
        <TreeNode
          key={child.id}
          client={client}
          node={child}
          nodes={nodes}
          selectedId={selectedId}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function NextApp({ client }: { client: LectioClient }) {
  const library = useLibrary(client);
  const session = useSession(client);
  const [error, setError] = useState<LectioError>();
  const selected =
    library.nodes.find((node) => node.id === session.selectedId) ??
    library.nodes[0];
  const lecture =
    selected?.type === "lecture" ? library.lectures[selected.id] : undefined;
  const segments = useMemo(
    () =>
      library.segments.filter((segment) => segment.lectureId === selected?.id),
    [library.segments, selected?.id],
  );
  const markers = library.markers.filter(
    (marker) => marker.lectureId === selected?.id,
  );
  const cards = library.cards.filter((card) => card.lectureId === selected?.id);

  const addChild = (parent = selected) => {
    if (!parent) return;
    const type = childType[parent.type];
    if (!type) return;
    const title = window
      .prompt(`Namn på ny ${childLabel[parent.type]}`)
      ?.trim();
    if (!title) return;
    const result = client.library.addNode(parent.id, type, title);
    if (!result.ok) setError(result.error);
  };

  const rename = (title: string) => {
    if (!selected || !title.trim() || title === selected.title) return;
    const result = client.library.updateNode(selected.id, {
      title: title.trim(),
    });
    if (!result.ok) setError(result.error);
  };

  return (
    <div
      className="next-app ui-app-bg flex h-screen min-h-0 flex-col text-[var(--palette-text)]"
      data-frontend="next"
    >
      <header
        className="flex h-10 shrink-0 items-center border-b border-[var(--palette-border)] bg-[var(--palette-surface)]"
        data-tauri-drag-region
      >
        <strong className="px-4 text-sm tracking-tight">Lectio</strong>
        <span className="rounded-full bg-[var(--palette-primary-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--palette-accent)]">
          Next · {client.runtime.dataProfile}
        </span>
        <div className="ml-auto h-full">
          <WindowControls client={client} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--palette-border)] bg-[var(--palette-surface)]">
          <div className="flex items-center justify-between px-4 pb-2 pt-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--palette-text-subtle)]">
                Bibliotek
              </p>
              <p className="mt-1 text-sm font-semibold">Mina studier</p>
            </div>
            <button
              aria-label="Skapa kurs"
              className="next-icon-button"
              onClick={() => {
                const root = library.nodes.find(
                  (node) => node.type === "workspace",
                );
                if (root) addChild(root);
              }}
            >
              <Plus />
            </button>
          </div>
          <nav
            className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
            aria-label="Biblioteksträd"
          >
            {library.nodes
              .filter((node) => node.type === "workspace")
              .map((root) => (
                <TreeNode
                  key={root.id}
                  client={client}
                  node={root}
                  nodes={library.nodes}
                  selectedId={session.selectedId}
                />
              ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--palette-background)] p-8">
          {selected ? (
            <div className="mx-auto max-w-5xl">
              <div className="flex items-start justify-between gap-6 border-b border-[var(--palette-border)] pb-6">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--palette-text-subtle)]">
                    {selected.type}
                  </p>
                  <input
                    aria-label="Objektnamn"
                    className="mt-1 w-full bg-transparent text-3xl font-semibold tracking-tight outline-none"
                    defaultValue={selected.title}
                    key={selected.id}
                    onBlur={(event) => rename(event.currentTarget.value)}
                  />
                  <p className="mt-2 max-w-2xl text-sm text-[var(--palette-text-muted)]">
                    {selected.context ||
                      "Lägg till material och sammanhang när du behöver det."}
                  </p>
                </div>
                {childType[selected.type] ? (
                  <button
                    className="next-primary-button"
                    onClick={() => addChild()}
                  >
                    <Plus /> Ny {childLabel[selected.type]}
                  </button>
                ) : null}
              </div>
              {lecture ? (
                <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <section className="next-panel">
                    <div className="flex items-center justify-between">
                      <h2>Transkript</h2>
                      <span>{segments.length} segment</span>
                    </div>
                    <div className="mt-4 space-y-1">
                      {segments.length ? (
                        segments.slice(0, 100).map((segment) => (
                          <div
                            key={segment.id}
                            className="grid grid-cols-[56px_1fr] gap-3 rounded-lg px-3 py-2 hover:bg-[var(--palette-surface-hover)]"
                          >
                            <time className="text-xs tabular-nums text-[var(--palette-text-subtle)]">
                              {Math.floor(segment.start / 60)}:
                              {String(Math.floor(segment.start % 60)).padStart(
                                2,
                                "0",
                              )}
                            </time>
                            <p className="text-sm leading-6">{segment.text}</p>
                          </div>
                        ))
                      ) : (
                        <p className="next-empty">Inget transkript ännu.</p>
                      )}
                    </div>
                  </section>
                  <div className="space-y-5">
                    <section className="next-panel">
                      <h2>Material</h2>
                      <div className="mt-4 space-y-3">
                        <div className="next-material">
                          <FileText />{" "}
                          <span>{lecture.slideName || "Inga slides"}</span>
                        </div>
                        <div className="next-material">
                          <FileAudio />{" "}
                          <span>{lecture.audioName || "Inget ljud"}</span>
                        </div>
                      </div>
                    </section>
                    <section className="next-panel">
                      <h2>Studieöversikt</h2>
                      <dl className="mt-4 grid grid-cols-2 gap-3">
                        <div>
                          <dt>Markeringar</dt>
                          <dd>{markers.length}</dd>
                        </div>
                        <div>
                          <dt>Anki-kort</dt>
                          <dd>{cards.length}</dd>
                        </div>
                      </dl>
                    </section>
                  </div>
                </div>
              ) : (
                <section className="next-panel mt-6">
                  <h2>Innehåll</h2>
                  <p className="next-empty">
                    Välj eller skapa ett objekt under {selected.title}.
                  </p>
                </section>
              )}
              {error ? (
                <p
                  role="alert"
                  className="mt-4 rounded-lg bg-[var(--palette-danger-muted)] p-3 text-sm text-[var(--palette-danger)]"
                >
                  {error.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
