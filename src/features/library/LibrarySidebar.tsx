import { useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  GraduationCap,
  Layers3,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Shapes,
  Trash2,
} from "lucide-react";
import type { LibraryNode, NodeType } from "../../core/types";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import { Input, Label } from "../../components/ui/Form";
import { cn, formatTime } from "../../lib/utils";

const iconByType = {
  workspace: GraduationCap,
  course: BookOpen,
  module: Layers3,
  topic: Shapes,
  lecture: FileText,
} satisfies Record<NodeType, typeof BookOpen>;

const labelByType: Record<NodeType, string> = {
  workspace: "Studier",
  course: "Kurs",
  module: "Modul",
  topic: "Ämne",
  lecture: "Föreläsning",
};

type CreateRequest = { parentId: string; type: NodeType };
type SearchResult = {
  node: LibraryNode;
  source: string;
  preview: string;
  time?: number;
};

export function LibrarySidebar() {
  const {
    nodes,
    lectures,
    segments,
    markers,
    cards,
    selectedId,
    settings,
    updateSettings,
    addNode,
    selectNode,
    removeNode,
  } = useAppStore();
  const [query, setQuery] = useState("");
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const root = nodes.find((node) => node.type === "workspace") ?? nodes[0];
  const courses = nodes.filter(
    (node) => node.type === "course" && node.parentId === root?.id,
  );

  const results = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.toLowerCase();
    const results: SearchResult[] = [];
    const addResult = (
      nodeId: string,
      source: string,
      preview: string,
      time?: number,
    ) => {
      const node = nodes.find((item) => item.id === nodeId);
      if (node) results.push({ node, source, preview, time });
    };
    nodes.forEach((node) => {
      if (`${node.title} ${node.context}`.toLowerCase().includes(q))
        addResult(node.id, labelByType[node.type], node.context || node.title);
    });
    Object.values(lectures).forEach((lecture) => {
      if (lecture.notes.toLowerCase().includes(q))
        addResult(lecture.lectureId, "Anteckningar", lecture.notes);
    });
    segments.forEach(
      (segment) =>
        segment.text.toLowerCase().includes(q) &&
        addResult(
          segment.lectureId,
          `Transkript · ${formatTime(segment.start)}`,
          segment.text,
          segment.start,
        ),
    );
    markers.forEach(
      (marker) =>
        marker.note.toLowerCase().includes(q) &&
        addResult(
          marker.lectureId,
          `Markering · ${formatTime(marker.time)}`,
          marker.note,
          marker.time,
        ),
    );
    cards.forEach(
      (card) =>
        `${card.front} ${card.back} ${card.tags.join(" ")}`
          .toLowerCase()
          .includes(q) &&
        addResult(card.lectureId, "Anki-kort", `${card.front} ${card.back}`),
    );
    return results.slice(0, 20);
  }, [query, nodes, lectures, segments, markers, cards]);

  const create = () => {
    if (!createRequest || !title.trim()) return;
    addNode(createRequest.parentId, createRequest.type, title.trim());
    setTitle("");
    setCreateRequest(null);
  };

  if (settings.librarySidebarCollapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-slate-200/80 bg-white pt-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => updateSettings({ librarySidebarCollapsed: false })}
          className="size-8 text-[var(--palette-text-subtle)]"
          title="Visa bibliotek"
          aria-label="Visa bibliotek"
        >
          <PanelLeftOpen className="size-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[286px] shrink-0 flex-col border-r border-slate-200/80 bg-white">
      <div className="flex h-16 items-center justify-between px-5">
        <div className="text-sm font-semibold text-slate-800">Mina studier</div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => updateSettings({ librarySidebarCollapsed: true })}
            className="size-8 text-[var(--palette-text-subtle)]"
            title="Dölj bibliotek"
            aria-label="Dölj bibliotek"
          >
            <PanelLeftClose className="size-4" />
          </Button>
          <Button
            size="icon"
            className="size-8 rounded-full"
            onClick={() =>
              root && setCreateRequest({ parentId: root.id, type: "course" })
            }
            title="Ny kurs"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative px-3">
        <Search className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Sök i allt material"
          className="h-9 border-transparent bg-slate-100 pl-9 focus:bg-white"
        />
        {query.length >= 2 && (
          <div className="absolute left-3 right-3 top-11 z-30 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
            {results.length ? (
              results.map((result, index) => {
                const Icon = iconByType[result.node.type] ?? FileText;
                return (
                  <button
                    key={`${result.node.id}-${result.source}-${index}`}
                    onClick={() => {
                      selectNode(result.node.id);
                      setQuery("");
                      if (result.time !== undefined) {
                        window.setTimeout(
                          () =>
                            window.dispatchEvent(
                              new CustomEvent("lectio:seek", {
                                detail: {
                                  lectureId: result.node.id,
                                  time: result.time,
                                },
                              }),
                            ),
                          100,
                        );
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-primary-soft)] focus-visible:bg-[var(--palette-primary-soft)]"
                  >
                    <Icon className="size-4 text-violet-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-700">
                        {result.node.title}
                      </span>
                      <span className="block truncate text-[10px] text-slate-400">
                        {result.preview}
                      </span>
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {result.source}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">
                Inga träffar
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-2">
        {courses.length ? (
          courses.map((course) => (
            <CourseItem
              key={course.id}
              course={course}
              nodes={nodes}
              selectedId={selectedId}
              onSelect={selectNode}
              onCreate={setCreateRequest}
              onRemove={removeNode}
            />
          ))
        ) : (
          <button
            onClick={() =>
              root && setCreateRequest({ parentId: root.id, type: "course" })
            }
            className="mx-2 flex w-[calc(100%-16px)] flex-col items-center rounded-2xl border border-dashed border-slate-200 px-5 py-8 text-center hover:border-violet-300 hover:bg-violet-50/40"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-600">
              <BookOpen className="size-5" />
            </div>
            <span className="mt-3 text-sm font-semibold text-slate-700">
              Skapa din första kurs
            </span>
            <span className="mt-1 text-xs leading-5 text-slate-400">
              Moduler, ämnen och föreläsningar organiseras automatiskt.
            </span>
          </button>
        )}
      </div>

      <Dialog
        open={!!createRequest}
        onOpenChange={(open) => !open && setCreateRequest(null)}
        title={`Skapa ${createRequest ? labelByType[createRequest.type].toLowerCase() : "objekt"}`}
        description={
          createRequest?.type === "module"
            ? "Modulen läggs i den valda kursen."
            : createRequest?.type === "course"
              ? "Kursen placeras i Mina studier."
              : "Lägg till material på modulnivå."
        }
      >
        <div className="space-y-4">
          <div>
            <Label>Namn</Label>
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && create()}
              placeholder={
                createRequest?.type === "course"
                  ? "Exempel: Diskret matematik"
                  : createRequest?.type === "module"
                    ? "Exempel: Grafteori"
                    : createRequest?.type === "topic"
                      ? "Exempel: Dijkstras algoritm"
                      : "Exempel: Föreläsning 4"
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateRequest(null)}>
              Avbryt
            </Button>
            <Button onClick={create}>Skapa</Button>
          </div>
        </div>
      </Dialog>
    </aside>
  );
}

function CourseItem({
  course,
  nodes,
  selectedId,
  onSelect,
  onCreate,
  onRemove,
}: {
  course: LibraryNode;
  nodes: LibraryNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (request: CreateRequest) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const modules = nodes.filter(
    (node) => node.type === "module" && node.parentId === course.id,
  );
  return (
    <div className="mb-1">
      <div
        className={cn(
          "group flex h-10 items-center rounded-xl",
          selectedId === course.id ? "ui-selected" : "text-slate-700 ui-hover",
        )}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-1 grid size-7 place-items-center text-slate-400"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <button
          onClick={() => onSelect(course.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm font-semibold"
        >
          <BookOpen className="size-4 shrink-0 text-violet-500" />
          <span className="truncate">{course.title}</span>
        </button>
        <NodeMenu
          items={[
            {
              label: "Ny modul",
              icon: Plus,
              action: () => onCreate({ parentId: course.id, type: "module" }),
            },
            {
              label: "Ta bort kurs",
              icon: Trash2,
              danger: true,
              action: () =>
                confirm(`Ta bort ${course.title} och allt innehåll?`) &&
                onRemove(course.id),
            },
          ]}
        />
      </div>
      {expanded && (
        <div className="ml-4 border-l border-slate-200 pl-1">
          {modules.length ? (
            modules.map((module) => (
              <ModuleItem
                key={module.id}
                module={module}
                nodes={nodes}
                selectedId={selectedId}
                onSelect={onSelect}
                onCreate={onCreate}
                onRemove={onRemove}
              />
            ))
          ) : (
            <button
              onClick={() => onCreate({ parentId: course.id, type: "module" })}
              className="ml-3 flex h-8 items-center gap-2 text-xs text-slate-400 hover:text-violet-600"
            >
              <Plus className="size-3" /> Lägg till modul
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ModuleItem({
  module,
  nodes,
  selectedId,
  onSelect,
  onCreate,
  onRemove,
}: {
  module: LibraryNode;
  nodes: LibraryNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (request: CreateRequest) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const leaves = nodes.filter(
    (node) =>
      (node.type === "topic" || node.type === "lecture") &&
      node.parentId === module.id,
  );
  return (
    <div>
      <div
        className={cn(
          "group flex h-9 items-center rounded-lg",
          selectedId === module.id ? "ui-selected" : "text-slate-600 ui-hover",
        )}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="grid size-7 place-items-center text-slate-400"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>
        <button
          onClick={() => onSelect(module.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium"
        >
          <Layers3 className="size-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{module.title}</span>
        </button>
        <NodeMenu
          items={[
            {
              label: "Nytt ämne",
              icon: Shapes,
              action: () => onCreate({ parentId: module.id, type: "topic" }),
            },
            {
              label: "Ny föreläsning",
              icon: FileText,
              action: () => onCreate({ parentId: module.id, type: "lecture" }),
            },
            {
              label: "Ta bort modul",
              icon: Trash2,
              danger: true,
              action: () =>
                confirm(`Ta bort ${module.title}?`) && onRemove(module.id),
            },
          ]}
        />
      </div>
      {expanded && (
        <div className="ml-5 border-l border-slate-100 pl-2">
          {leaves.map((leaf) => {
            const Icon = iconByType[leaf.type];
            return (
              <div
                key={leaf.id}
                className={cn(
                  "group flex h-8 items-center rounded-lg pr-1",
                  selectedId === leaf.id
                    ? "ui-selected"
                    : "text-slate-500 ui-hover",
                )}
              >
                <button
                  onClick={() => onSelect(leaf.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs"
                >
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      leaf.type === "lecture"
                        ? "text-violet-500"
                        : "text-sky-500",
                    )}
                  />
                  <span className="truncate">{leaf.title}</span>
                </button>
                <NodeMenu
                  items={[
                    {
                      label: `Ta bort ${labelByType[leaf.type].toLowerCase()}`,
                      icon: Trash2,
                      danger: true,
                      action: () =>
                        confirm(`Ta bort ${leaf.title}?`) && onRemove(leaf.id),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NodeMenu({
  items,
}: {
  items: {
    label: string;
    icon: typeof Plus;
    danger?: boolean;
    action: () => void;
  }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="mr-1 grid size-7 place-items-center rounded-md text-[var(--palette-text-subtle)] opacity-0 transition-[opacity,color,background-color] hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] group-hover:opacity-100 data-[state=open]:bg-[var(--palette-surface-hover)] data-[state=open]:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
          align="start"
        >
          {items.map(({ label, icon: Icon, danger, action }) => (
            <DropdownMenuItem
              key={label}
              onSelect={action}
              className={cn(
                "cursor-pointer",
                danger ? "text-red-600" : "text-slate-700",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
