import {
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Folder,
  Home,
  Inbox,
  Layers2,
  Library,
  MoreHorizontal,
  PanelLeftClose,
  Minus,
  Plus,
  Search,
  Settings2,
  X,
  Square,
  Zap,
} from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type DragEvent,
} from "react";
import type {
  LectioClient,
  LibraryNode,
  NodeType,
} from "../../application/lectioClient";
import { useLibrary, useSession } from "../shared/useLectioClient";
import { sidebarCopy as c } from "./sidebarCopy";
import { NextButton, NextIconButton } from "./ui/NextPrimitives";
import {
  canMoveLibraryNode,
  canReorderLibraryNode,
} from "../../domain/libraryTree";
import { version } from "../../../package.json";

const destinations = [
  { view: "dashboard", Icon: Home, label: c.home, shortcut: "Ctrl+1" },
  { view: "inbox", Icon: Inbox, label: c.views.inbox, shortcut: "Ctrl+4" },
  {
    view: "super-actions",
    Icon: Zap,
    label: c.views["super-actions"],
    shortcut: "Ctrl+5",
  },
] as const;
const icons = {
  workspace: Library,
  course: BookOpen,
  module: Layers2,
  topic: Folder,
  lecture: FileText,
};
type Editor = {
  parentId: string | null;
  type: NodeType;
  id?: string;
  title: string;
};
type Drop = {
  id: string;
  mode: "inside" | "before" | "after";
  valid: boolean;
};
const SIDEBAR_OVERLAY_OFFSET = 24;

function Hint({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="study-tooltip"
          side="right"
          sideOffset={SIDEBAR_OVERLAY_OFFSET}
        >
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function readPreference<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function StudySidebar({
  client,
  disabled = false,
  onNativeError,
}: {
  client: LectioClient;
  disabled?: boolean;
  onNativeError?: (message: string) => void;
}) {
  const { nodes } = useLibrary(client);
  const session = useSession(client);
  const [collapsed, setCollapsed] = useState(() =>
    readPreference("lectio-next-sidebar-collapsed", false),
  );
  const [expanded, setExpanded] = useState<string[]>(() =>
    readPreference("lectio-next-sidebar-open", []),
  );
  const [flyout, setFlyout] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [notice, setNotice] = useState("");
  const [dragId, setDragId] = useState<string>();
  const [drop, setDrop] = useState<Drop>();
  const dragIdRef = useRef<string | undefined>(undefined);
  const dropRef = useRef<Drop | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollSpeed = useRef(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hoverId = useRef("");
  const collapseRef = useRef<HTMLButtonElement>(null);
  const root = nodes.find((node) => node.type === "workspace");
  const runWindowAction = async (
    action: "minimize" | "toggleMaximize" | "close",
  ) => {
    const result = await client.nativeWindow[action]();
    onNativeError?.(result.ok ? "" : result.error.message);
  };
  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const children = useMemo(() => {
    const map = new Map<string | null, LibraryNode[]>();
    for (const node of nodes) {
      const siblings = map.get(node.parentId) ?? [];
      siblings.push(node);
      map.set(node.parentId, siblings);
    }
    for (const siblings of map.values())
      siblings.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    return map;
  }, [nodes]);
  const matching = useMemo(() => {
    if (!query.trim()) return null;
    const found = new Set<string>();
    for (const node of nodes)
      if (
        node.title
          .toLocaleLowerCase("sv")
          .includes(query.trim().toLocaleLowerCase("sv"))
      ) {
        let current: LibraryNode | undefined = node;
        while (current && !found.has(current.id)) {
          found.add(current.id);
          current = current.parentId
            ? nodeMap.get(current.parentId)
            : undefined;
        }
      }
    return found;
  }, [nodes, nodeMap, query]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "lectio-next-sidebar-collapsed",
        JSON.stringify(collapsed),
      );
    } catch {
      /* UI preference only. */
    }
  }, [collapsed]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "lectio-next-sidebar-open",
        JSON.stringify(expanded),
      );
    } catch {
      /* UI preference only. */
    }
  }, [expanded]);
  useEffect(() => {
    const ancestors: string[] = [];
    let current = nodeMap.get(session.selectedId);
    while (current?.parentId) {
      const parent = nodeMap.get(current.parentId);
      if (!parent) break;
      if (parent.type === "course" || parent.type === "module")
        ancestors.push(parent.id);
      current = parent;
    }
    if (ancestors.length)
      setExpanded((old) => [...new Set([...old, ...ancestors])]);
  }, [nodeMap, session.selectedId]);
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching, flyout]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (disabled) return;
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, [contenteditable=true]",
        ) ||
        event.altKey
      )
        return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setCollapsed((v) => !v);
        setFlyout(false);
      }
      const destination = destinations.find((item) =>
        item.shortcut.endsWith(`+${event.key}`),
      );
      if (destination) {
        event.preventDefault();
        client.session.setActiveView(destination.view);
      }
      if (event.key === ",") {
        event.preventDefault();
        client.session.setActiveView("settings");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [client, disabled]);
  useEffect(() => {
    if (!dragId) return;
    let frame = 0;
    const tick = () => {
      scrollRef.current?.scrollBy(0, scrollSpeed.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hoverTimer.current);
      hoverId.current = "";
      scrollSpeed.current = 0;
    };
  }, [dragId]);

  const toggle = (id: string) =>
    setExpanded((old) =>
      old.includes(id) ? old.filter((item) => item !== id) : [...old, id],
    );
  const select = (node: LibraryNode) => {
    client.session.selectNode(node.id);
    client.session.setActiveView("workspace");
    setFlyout(false);
  };
  const add = (parentId: string | null, type: NodeType) => {
    setEditor({ parentId, type, title: "" });
    setQuery("");
    if (parentId) setExpanded((old) => [...new Set([...old, parentId])]);
  };
  const finishEdit = () => {
    if (!editor?.title.trim()) return;
    const result = editor.id
      ? client.library.updateNode(editor.id, { title: editor.title.trim() })
      : client.library.addNode(
          editor.parentId,
          editor.type,
          editor.title.trim(),
        );
    if (!result.ok) {
      setNotice(result.error.message);
      return;
    }
    if (!editor.id && typeof result.value === "string") {
      client.session.selectNode(result.value);
      client.session.setActiveView("workspace");
    }
    setEditor(undefined);
  };
  const stopDrag = () => {
    dragIdRef.current = undefined;
    dropRef.current = undefined;
    setDragId(undefined);
    setDrop(undefined);
  };
  const setDropTarget = (target?: Drop) => {
    dropRef.current = target;
    setDrop(target);
  };
  const dragOver = (event: DragEvent, target: LibraryNode) => {
    const sourceId = dragIdRef.current;
    if (!sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const canReorder = canReorderLibraryNode(nodes, sourceId, target.id);
    const mode: Drop["mode"] = canReorder
      ? event.clientY < bounds.top + bounds.height / 2
        ? "before"
        : "after"
      : "inside";
    const valid =
      mode === "inside"
        ? canMoveLibraryNode(nodes, sourceId, target.id)
        : canReorder;
    event.dataTransfer.dropEffect = valid ? "move" : "none";
    const next = { id: target.id, mode, valid };
    const old = dropRef.current;
    if (
      old?.id !== next.id ||
      old.mode !== next.mode ||
      old.valid !== next.valid
    )
      setDropTarget(next);
    if (hoverId.current !== `${target.id}:${mode}`) {
      clearTimeout(hoverTimer.current);
      hoverId.current = `${target.id}:${mode}`;
      if (valid && mode === "inside")
        hoverTimer.current = setTimeout(
          () => setExpanded((old) => [...new Set([...old, target.id])]),
          650,
        );
    }
    const scroller = scrollRef.current?.getBoundingClientRect();
    if (scroller)
      scrollSpeed.current =
        event.clientY < scroller.top + 48
          ? -Math.min(12, (scroller.top + 48 - event.clientY) / 4)
          : event.clientY > scroller.bottom - 48
            ? Math.min(12, (event.clientY - scroller.bottom + 48) / 4)
            : 0;
  };
  const commitDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = dragIdRef.current;
    const target = dropRef.current;
    if (sourceId && target?.valid) {
      // The domain owns hierarchy validation and the complete reorder transaction.
      const result =
        target.mode === "inside"
          ? client.library.moveNode(sourceId, target.id)
          : client.library.reorderNode(sourceId, target.id, target.mode);
      if (!result.ok) setNotice(result.error.message);
      else if (!result.value) setNotice(c.moveFailed);
      else if (target.mode === "inside")
        setExpanded((old) => [...new Set([...old, target.id])]);
    }
    stopDrag();
  };

  const editorRow = (parentId: string | null, depth: number) =>
    editor && !editor.id && editor.parentId === parentId
      ? editInput(depth)
      : null;
  const editInput = (depth: number) => (
    <form
      className="study-tree-editor"
      style={{ marginLeft: depth * 16 + 8 }}
      onSubmit={(event) => {
        event.preventDefault();
        finishEdit();
      }}
    >
      <input
        autoFocus
        aria-label={c.name}
        value={editor?.title ?? ""}
        placeholder={editor ? c.type[editor.type] : c.name}
        onChange={(event) =>
          setEditor((old) => old && { ...old, title: event.target.value })
        }
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") setEditor(undefined);
        }}
      />
      <button
        type="submit"
        aria-label={c.save}
        disabled={!editor?.title.trim()}
      >
        <Check />
      </button>
      <button
        type="button"
        aria-label={c.cancel}
        onClick={() => setEditor(undefined)}
      >
        <X />
      </button>
    </form>
  );

  const renderNode = (node: LibraryNode, depth = 0): ReactElement | null => {
    if (node.type === "workspace")
      return (
        <div key={node.id}>
          {(children.get(node.id) ?? []).map((child) => renderNode(child))}
          {editorRow(node.id, 0)}
        </div>
      );
    if (matching && !matching.has(node.id)) return null;
    const Icon = icons[node.type];
    const branch = node.type === "course" || node.type === "module";
    const open = matching ? true : expanded.includes(node.id);
    const selected =
      session.selectedId === node.id && session.activeView === "workspace";
    const descendants = children.get(node.id) ?? [];
    const isTarget = drop?.id === node.id;
    return (
      <div key={node.id} className="study-tree-node">
        {editor?.id === node.id ? (
          editInput(depth)
        ) : (
          <div
            className={`study-tree-row ${selected ? "next-tree-row-selected" : ""}`}
            data-node-id={node.id}
            data-depth={depth}
            data-dragged={dragId === node.id || undefined}
            data-drop={
              isTarget ? (drop.valid ? drop.mode : "invalid") : undefined
            }
            style={{ "--depth": depth } as CSSProperties}
            onDragEnd={stopDrag}
            onDragOver={(event) => dragOver(event, node)}
            onDrop={commitDrop}
          >
            <NextIconButton
              className="study-tree-select"
              draggable={!searching}
              aria-label={node.title}
              aria-current={selected ? "page" : undefined}
              onClick={() => select(node)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", node.id);
                dragIdRef.current = node.id;
                setDragId(node.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" && branch && !open) {
                  event.preventDefault();
                  toggle(node.id);
                } else if (event.key === "ArrowLeft" && branch && open) {
                  event.preventDefault();
                  toggle(node.id);
                } else if (
                  ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const buttons = [
                    ...(scrollRef.current?.querySelectorAll<HTMLButtonElement>(
                      ".study-tree-select",
                    ) ?? []),
                  ].filter((button) => !button.closest("[inert]"));
                  const index = buttons.indexOf(event.currentTarget);
                  buttons[
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              buttons.length - 1,
                              index + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          )
                  ]?.focus();
                }
              }}
            >
              <Icon />
              <span title={node.title}>{node.title}</span>
            </NextIconButton>
            {branch && (
              <button
                className="study-tree-chevron"
                aria-label={`${open ? "Fäll ihop" : "Visa innehåll i"} ${node.title}`}
                aria-expanded={open}
                onClick={() => toggle(node.id)}
              >
                <ChevronRight />
              </button>
            )}
            <Menu.Root>
              <Menu.Trigger asChild>
                <NextIconButton
                  className="study-tree-menu"
                  aria-label={`${c.menu} ${node.title}`}
                >
                  <MoreHorizontal />
                </NextIconButton>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  className="study-menu"
                  side="right"
                  sideOffset={SIDEBAR_OVERLAY_OFFSET}
                  align="start"
                >
                  {node.type === "course" && (
                    <Menu.Item onSelect={() => add(node.id, "module")}>
                      <Plus />
                      {c.newModule}
                    </Menu.Item>
                  )}
                  {node.type === "module" && (
                    <>
                      <Menu.Item onSelect={() => add(node.id, "lecture")}>
                        <FileText />
                        {c.newLecture}
                      </Menu.Item>
                      <Menu.Item onSelect={() => add(node.id, "topic")}>
                        <Folder />
                        {c.newTopic}
                      </Menu.Item>
                    </>
                  )}
                  <Menu.Item
                    onSelect={() =>
                      setEditor({
                        id: node.id,
                        parentId: node.parentId,
                        type: node.type,
                        title: node.title,
                      })
                    }
                  >
                    <Settings2 />
                    {c.rename}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        )}
        {branch && (
          <div className="study-tree-branch" data-open={open} inert={!open}>
            <div>
              {descendants.map((child) => renderNode(child, depth + 1))}
              {editorRow(node.id, depth + 1)}
            </div>
          </div>
        )}
      </div>
    );
  };

  const hasCourses = nodes.some((node) => node.type === "course");
  const tree = (
    <div className="study-library-content">
      <div className="study-library-heading">
        {searching ? (
          <div className="study-search">
            <Search />
            <input
              ref={searchRef}
              aria-label={c.search}
              placeholder="Sök…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearching(false);
                  setQuery("");
                }
              }}
            />
            <button
              aria-label={c.clearSearch}
              onClick={() => {
                setSearching(false);
                setQuery("");
              }}
            >
              <X />
            </button>
          </div>
        ) : (
          <>
            <span>{c.courses}</span>
            <div>
              <Hint label={c.search}>
                <button
                  className="study-icon"
                  aria-label={c.search}
                  onClick={() => setSearching(true)}
                >
                  <Search />
                </button>
              </Hint>
              <Hint label={c.newCourse}>
                <button
                  className="study-icon"
                  aria-label={c.newCourse}
                  onClick={() => add(root?.id ?? null, "course")}
                >
                  <Plus />
                </button>
              </Hint>
            </div>
          </>
        )}
      </div>
      <div
        ref={(element) => {
          scrollRef.current = element;
          if (element) element.scrollTop = scrollPosition.current;
        }}
        onScroll={(event) => {
          scrollPosition.current = event.currentTarget.scrollTop;
        }}
        className="study-tree-scroll"
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            scrollSpeed.current = 0;
            setDropTarget(undefined);
            clearTimeout(hoverTimer.current);
            hoverId.current = "";
          }
        }}
      >
        <nav aria-label="Biblioteksträd">
          {(children.get(null) ?? []).map((node) => renderNode(node))}
          {editorRow(null, 0)}
        </nav>
        {!hasCourses && !editor && (
          <div className="study-tree-empty">
            <BookOpen />
            <p>{c.empty}</p>
            <button onClick={() => add(root?.id ?? null, "course")}>
              {c.emptyAction}
              <Plus />
            </button>
          </div>
        )}
        {matching &&
          !nodes.some(
            (node) => node.type !== "workspace" && matching.has(node.id),
          ) && <p className="study-no-results">{c.noResults}</p>}
      </div>
    </div>
  );

  return (
    <Tooltip.Provider
      delayDuration={450}
      skipDelayDuration={150}
      disableHoverableContent
    >
      <aside
        className="study-sidebar"
        inert={disabled}
        data-collapsed={collapsed}
        aria-label="Sidofält"
      >
        <div className="study-sidebar-top" data-tauri-drag-region>
          <Hint label={collapsed ? c.expand : c.collapse} shortcut="Ctrl+B">
            <button
              ref={collapseRef}
              className="study-collapse study-icon"
              aria-label={collapsed ? c.expand : c.collapse}
              aria-expanded={!collapsed}
              onClick={() => {
                if (!collapsed) collapseRef.current?.focus();
                setCollapsed(!collapsed);
                setFlyout(false);
              }}
            >
              <PanelLeftClose />
            </button>
          </Hint>
          <div className="study-window-actions" aria-label="Fönsterkontroller">
            {(
              [
                ["minimize", Minus, c.minimize],
                ["toggleMaximize", Square, c.maximize],
                ["close", X, c.close],
              ] as const
            ).map(([action, Icon, label]) => (
              <Hint key={action} label={label}>
                <button
                  aria-label={label}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => void runWindowAction(action)}
                >
                  <Icon />
                </button>
              </Hint>
            ))}
          </div>
        </div>
        <nav className="study-destinations" aria-label="Vyer">
          {destinations.map(({ view, Icon, label, shortcut }, index) => (
            <Hint key={view} label={label} shortcut={shortcut}>
              <NextIconButton
                className="study-destination"
                style={{ "--slot": index } as CSSProperties}
                aria-label={label}
                aria-current={session.activeView === view ? "page" : undefined}
                onClick={() => {
                  client.session.setActiveView(view);
                  setFlyout(false);
                }}
              >
                <Icon />
              </NextIconButton>
            </Hint>
          ))}
        </nav>
        <div className="study-library" inert={collapsed}>
          {!collapsed || !flyout ? tree : null}
        </div>
        <div className="study-rail-library" inert={!collapsed}>
          <Popover.Root open={flyout} onOpenChange={setFlyout}>
            <Popover.Trigger asChild>
              <NextIconButton
                className="study-icon study-rail-button"
                aria-label={c.library}
                aria-expanded={flyout}
              >
                <Library />
              </NextIconButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="study-library-flyout"
                side="right"
                align="start"
                sideOffset={SIDEBAR_OVERLAY_OFFSET}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                {collapsed && flyout ? tree : null}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <footer className="study-sidebar-footer">
          <Hint label={c.views.settings} shortcut="Ctrl+,">
            <NextIconButton
              className="study-footer-button"
              aria-label={c.views.settings}
              aria-current={
                session.activeView === "settings" ? "page" : undefined
              }
              onClick={() => client.session.setActiveView("settings")}
            >
              <Settings2 />
            </NextIconButton>
          </Hint>
          <Popover.Root>
            <Popover.Trigger asChild>
              <NextIconButton
                className="study-footer-button"
                aria-label={c.help}
              >
                <CircleHelp />
              </NextIconButton>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="study-help study-menu"
                side="right"
                align="end"
                sideOffset={SIDEBAR_OVERLAY_OFFSET}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <h2>{c.shortcuts}</h2>
                {destinations.map((item) => (
                  <p key={item.view}>
                    <span>{item.label}</span>
                    <kbd>{item.shortcut}</kbd>
                  </p>
                ))}
                <p>
                  <span>{c.collapse}</span>
                  <kbd>Ctrl+B</kbd>
                </p>
                <NextButton
                  tone="quiet"
                  onClick={async () => {
                    const result = await client.workflows.exportDiagnostics();
                    setNotice(
                      result.ok ? c.diagnosticDone : result.error.message,
                    );
                  }}
                >
                  {c.feedback}
                </NextButton>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <span className="study-version">{version}</span>
        </footer>
      </aside>
      {notice && (
        <div className="study-sidebar-notice" role="status">
          {notice}
          <NextIconButton aria-label={c.dismiss} onClick={() => setNotice("")}>
            <X />
          </NextIconButton>
        </div>
      )}
    </Tooltip.Provider>
  );
}
