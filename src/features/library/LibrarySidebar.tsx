import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  GripVertical,
  GraduationCap,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Shapes,
  Trash2,
} from "lucide-react";
import type { LibraryNode, NodeType } from "../../core/types";
import {
  canMoveLibraryNode,
  canReorderLibraryNode,
  useAppStore,
} from "../../core/store";
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
import { toast } from "../../services/feedbackToast";

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

const sortNodes = (items: LibraryNode[]) =>
  [...items].sort((left, right) => (left.sortIndex ?? 0) - (right.sortIndex ?? 0));

type CreateRequest = { parentId: string; type: NodeType };
type SearchResult = {
  node: LibraryNode;
  source: string;
  preview: string;
  time?: number;
};

type TreeDragHandlers = {
  draggedNodeId: string | null;
  dropTargetId: string | null;
  onDragStart: (event: DragEvent<HTMLElement>, nodeId: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, targetId: string) => void;
  onDrop: (event: DragEvent<HTMLElement>, targetId: string) => void;
};

export function LibrarySidebar() {
  const {
    nodes,
    lectures,
    segments,
    markers,
    cards,
    selectedId,
    activeView,
    settings,
    updateSettings,
    addNode,
    updateNode,
    moveNode,
    reorderNode,
    selectNode,
    removeNode,
  } = useAppStore();
  const [query, setQuery] = useState("");
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [renameNode, setRenameNode] = useState<LibraryNode | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  // `dataTransfer.getData()` is intentionally unavailable during dragover in
  // Chromium/WebView2. Keep the active id in a ref as well as state so the
  // first target receives preventDefault and becomes a real drop target.
  const draggedNodeIdRef = useRef<string | null>(null);
  const root = nodes.find((node) => node.type === "workspace") ?? nodes[0];
  const courses = sortNodes(
    nodes.filter((node) => node.type === "course" && node.parentId === root?.id),
  );
  const hidden = activeView !== "workspace" && activeView !== "cards";

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
  const openRename = (node: LibraryNode) => {
    setRenameNode(node);
    setRenameTitle(node.title);
  };
  const rename = () => {
    const nextTitle = renameTitle.trim();
    if (!renameNode || !nextTitle) {
      toast.error("Skriv ett namn innan du sparar");
      return;
    }
    if (nextTitle !== renameNode.title) {
      updateNode(renameNode.id, { title: nextTitle });
      toast.success(`${labelByType[renameNode.type]} har bytt namn`);
    }
    setRenameNode(null);
    setRenameTitle("");
  };

  const onDragStart = (event: DragEvent<HTMLElement>, nodeId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", nodeId);
    draggedNodeIdRef.current = nodeId;
    setDraggedNodeId(nodeId);
  };
  const onDragEnd = () => {
    draggedNodeIdRef.current = null;
    setDraggedNodeId(null);
    setDropTargetId(null);
  };
  const onDragOver = (event: DragEvent<HTMLElement>, targetId: string) => {
    const nodeId =
      draggedNodeIdRef.current ?? event.dataTransfer.getData("text/plain");
    if (
      !nodeId ||
      (!canMoveLibraryNode(nodes, nodeId, targetId) &&
        !canReorderLibraryNode(nodes, nodeId, targetId))
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(targetId);
  };
  const onDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    const nodeId =
      draggedNodeIdRef.current ?? event.dataTransfer.getData("text/plain");
    const moved = nodeId
      ? canMoveLibraryNode(nodes, nodeId, targetId)
        ? moveNode(nodeId, targetId)
        : canReorderLibraryNode(nodes, nodeId, targetId)
          ? reorderNode(nodeId, targetId)
          : false
      : false;
    if (moved) {
      const movedNode = nodes.find((node) => node.id === nodeId);
      const target = nodes.find((node) => node.id === targetId);
      toast.success(
        `Flyttade ${movedNode?.title ?? "objektet"} till ${target?.title ?? "ny plats"}`,
      );
    } else if (nodeId) {
      toast.error("Det objektet kan inte placeras där");
    }
    onDragEnd();
  };
  const dragHandlers: TreeDragHandlers = {
    draggedNodeId,
    dropTargetId,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
  };

  useEffect(() => {
    const focusSearch = () => {
      if (settings.librarySidebarCollapsed)
        updateSettings({ librarySidebarCollapsed: false });
      window.setTimeout(() => searchInput.current?.focus(), 0);
    };
    const createSelectedChild = (event: Event) => {
      const mode = (event as CustomEvent<{ type?: "next" | "lecture" }>).detail
        ?.type;
      const selected = nodes.find((node) => node.id === selectedId);
      if (!selected) return;
      if (selected.type === "workspace")
        setCreateRequest({ parentId: selected.id, type: "course" });
      else if (selected.type === "course")
        setCreateRequest({ parentId: selected.id, type: "module" });
      else if (selected.type === "module")
        setCreateRequest({
          parentId: selected.id,
          type: mode === "lecture" ? "lecture" : "topic",
        });
    };
    window.addEventListener("lectio:focus-library-search", focusSearch);
    window.addEventListener("lectio:create-library-node", createSelectedChild);
    return () => {
      window.removeEventListener("lectio:focus-library-search", focusSearch);
      window.removeEventListener(
        "lectio:create-library-node",
        createSelectedChild,
      );
    };
  }, [nodes, selectedId, settings.librarySidebarCollapsed, updateSettings]);

  if (settings.librarySidebarCollapsed) return null;

  return (
    <aside
      className={cn(
        hidden
          ? "hidden"
          : "flex h-full w-[286px] shrink-0 flex-col border-r border-border bg-card",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center justify-between px-6 transition-colors",
          dropTargetId === root?.id &&
            "bg-[var(--palette-primary-muted)] ring-1 ring-inset ring-[var(--palette-primary)]",
        )}
        onDragOver={(event) => root && onDragOver(event, root.id)}
        onDrop={(event) => root && onDrop(event, root.id)}
      >
        <div className="text-sm font-semibold text-foreground">
          {dropTargetId === root?.id ? "Släpp kursen här" : "Mina studier"}
        </div>
        <div className="flex items-center gap-1">
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
        <Search className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Sök i allt material"
          className="h-9 border-transparent bg-muted pl-9 focus:bg-background"
        />
        {query.length >= 2 && (
          <div className="absolute left-3 right-3 top-11 z-30 max-h-72 overflow-auto rounded-xl border border-border bg-card p-1.5 shadow-xl">
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
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-primary-muted)] focus-visible:bg-[var(--palette-primary-muted)]"
                  >
                    <Icon className="size-4 text-[var(--palette-text-subtle)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-700">
                        {result.node.title}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {result.preview}
                      </span>
                    </span>
                    <span className="text-xs text-slate-400">
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

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-2">
        {courses.length ? (
          courses.map((course) => (
            <CourseItem
              key={course.id}
              course={course}
              nodes={nodes}
              selectedId={selectedId}
              onSelect={selectNode}
              onCreate={setCreateRequest}
              onRename={openRename}
              onRemove={removeNode}
              {...dragHandlers}
            />
          ))
        ) : (
          <button
            onClick={() =>
              root && setCreateRequest({ parentId: root.id, type: "course" })
            }
            className="mx-2 flex w-[calc(100%-16px)] flex-col items-center px-6 py-8 text-center hover:bg-[var(--palette-surface-hover)]"
          >
            <div className="grid size-10 place-items-center rounded-lg bg-[var(--palette-primary-muted)] text-[var(--palette-accent)]">
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
      <Dialog
        open={!!renameNode}
        onOpenChange={(open) => {
          if (!open) {
            setRenameNode(null);
            setRenameTitle("");
          }
        }}
        title={`Byt namn på ${renameNode ? labelByType[renameNode.type].toLowerCase() : "objekt"}`}
        description="Namnet uppdateras i biblioteket och används vid nästa Anki- och molnsynk."
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="rename-library-node">Namn</Label>
            <Input
              id="rename-library-node"
              autoFocus
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && rename()}
              aria-describedby="rename-library-node-help"
            />
            <p id="rename-library-node-help" className="mt-2 text-xs leading-5 text-[var(--palette-text-muted)]">
              Tomma namn kan inte sparas.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameNode(null)}>
              Avbryt
            </Button>
            <Button onClick={rename} disabled={!renameTitle.trim()}>
              Spara namn
            </Button>
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
  onRename,
  onRemove,
  draggedNodeId,
  dropTargetId,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  course: LibraryNode;
  nodes: LibraryNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (request: CreateRequest) => void;
  onRename: (node: LibraryNode) => void;
  onRemove: (id: string) => void;
} & TreeDragHandlers) {
  const [expanded, setExpanded] = useState(true);
  const modules = sortNodes(
    nodes.filter((node) => node.type === "module" && node.parentId === course.id),
  );
  return (
    <div className="mb-1">
      <div
        className={cn(
          "group flex h-10 items-center rounded-xl transition-[background-color,box-shadow,opacity]",
          selectedId === course.id ? "ui-selected" : "text-slate-700 ui-hover",
          draggedNodeId === course.id && "opacity-45",
          dropTargetId === course.id &&
            "bg-[var(--palette-primary-muted)] ring-2 ring-[var(--palette-primary)]",
        )}
        onDragOver={(event) => onDragOver(event, course.id)}
        onDrop={(event) => onDrop(event, course.id)}
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
          draggable
          onDragStart={(event) => onDragStart(event, course.id)}
          onDragEnd={onDragEnd}
          onClick={() => onSelect(course.id)}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-2 py-2 text-left text-sm font-semibold active:cursor-grabbing"
          title="Dra kursen till Mina studier"
        >
          <GripVertical className="size-3.5 shrink-0 text-[var(--palette-text-subtle)] opacity-0 transition-opacity group-hover:opacity-100" />
          <BookOpen className="size-4 shrink-0 text-[var(--palette-text-subtle)]" />
          <span className="truncate">{course.title}</span>
        </button>
        <NodeMenu
          items={[
            {
              label: "Byt namn",
              icon: Pencil,
              action: () => onRename(course),
            },
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
                onRename={onRename}
                onRemove={onRemove}
                draggedNodeId={draggedNodeId}
                dropTargetId={dropTargetId}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDrop={onDrop}
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
  onRename,
  onRemove,
  draggedNodeId,
  dropTargetId,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  module: LibraryNode;
  nodes: LibraryNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (request: CreateRequest) => void;
  onRename: (node: LibraryNode) => void;
  onRemove: (id: string) => void;
} & TreeDragHandlers) {
  const [expanded, setExpanded] = useState(true);
  const leaves = sortNodes(
    nodes.filter(
      (node) =>
        (node.type === "topic" || node.type === "lecture") &&
        node.parentId === module.id,
    ),
  );
  return (
    <div>
      <div
        className={cn(
          "group flex h-9 items-center rounded-lg transition-[background-color,box-shadow,opacity]",
          selectedId === module.id ? "ui-selected" : "text-slate-600 ui-hover",
          draggedNodeId === module.id && "opacity-45",
          dropTargetId === module.id &&
            "bg-[var(--palette-primary-muted)] ring-2 ring-[var(--palette-primary)]",
        )}
        onDragOver={(event) => onDragOver(event, module.id)}
        onDrop={(event) => onDrop(event, module.id)}
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
          draggable
          onDragStart={(event) => onDragStart(event, module.id)}
          onDragEnd={onDragEnd}
          onClick={() => onSelect(module.id)}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left text-xs font-medium active:cursor-grabbing"
          title="Dra modulen till en kurs"
        >
          <GripVertical className="size-3 shrink-0 text-[var(--palette-text-subtle)] opacity-0 transition-opacity group-hover:opacity-100" />
          <Layers3 className="size-3.5 shrink-0 text-[var(--palette-text-subtle)]" />
          <span className="truncate">{module.title}</span>
        </button>
        <NodeMenu
          items={[
            {
              label: "Byt namn",
              icon: Pencil,
              action: () => onRename(module),
            },
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
        <div className="ml-6 border-l border-slate-100 pl-2">
          {leaves.map((leaf) => {
            const Icon = iconByType[leaf.type];
            return (
              <div
                key={leaf.id}
                className={cn(
                  "group flex h-8 items-center rounded-lg pr-1 transition-opacity",
                  selectedId === leaf.id
                    ? "ui-selected"
                    : "text-slate-500 ui-hover",
                  draggedNodeId === leaf.id && "opacity-45",
                  dropTargetId === leaf.id &&
                    "bg-[var(--palette-primary-muted)] ring-2 ring-[var(--palette-primary)]",
                )}
                onDragOver={(event) => onDragOver(event, leaf.id)}
                onDrop={(event) => onDrop(event, leaf.id)}
              >
                <button
                  draggable
                  onDragStart={(event) => onDragStart(event, leaf.id)}
                  onDragEnd={onDragEnd}
                  onClick={() => onSelect(leaf.id)}
                  className="flex min-w-0 flex-1 cursor-grab items-center gap-2 px-2 text-left text-xs active:cursor-grabbing"
                  title="Dra till en modul"
                >
                  <GripVertical className="size-3 shrink-0 text-[var(--palette-text-subtle)] opacity-0 transition-opacity group-hover:opacity-100" />
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
                      label: "Byt namn",
                      icon: Pencil,
                      action: () => onRename(leaf),
                    },
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
      <DropdownMenuContent align="start">
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
