import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Note } from "@g-spot/types";
import { Button } from "@g-spot/ui/components/button";
import { Input } from "@g-spot/ui/components/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@g-spot/ui/components/resizable";
import { ScrollArea } from "@g-spot/ui/components/scroll-area";
import { cn } from "@g-spot/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus2,
  FolderPlus,
  FolderTree,
  Hash,
  Info,
  Loader2,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { AppLayout } from "@/components/shell/app-layout";
import { SecondarySidebar } from "@/components/shell/secondary-sidebar";
import { NoteEditor } from "@/components/notes/note-editor";
import {
  NotesTree,
  useTreeExpansion,
} from "@/components/notes/notes-tree";
import { TagsPanel } from "@/components/notes/tags-panel";
import { useConfirmDialog } from "@/contexts/confirm-dialog-context";
import {
  useCreateNoteMutation,
  useDeleteNoteMutation,
  useNote,
  useNoteBacklinks,
  useNoteOutgoingLinks,
  useNotes,
  useUpdateNoteMutation,
} from "@/hooks/use-notes";
import { extractAliases } from "@/lib/notes/frontmatter";
import { isEmpty, matchNote, parseQuery } from "@/lib/notes/search";

type NotesSearch = {
  noteId?: string;
  q?: string;
};

export const Route = createFileRoute("/notes")({
  validateSearch: (search: Record<string, unknown>): NotesSearch => ({
    noteId: typeof search.noteId === "string" ? search.noteId : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: NotesPage,
});

const SAVE_DEBOUNCE_MS = 600;
const TAG_INLINE_RE = /(^|[^\w/#])#([\w\-/]+)/g;
const TEMPLATES_FOLDER_NAME = "Templates";
const DAILY_FOLDER_NAME = "Daily";

type SidebarView = "files" | "tags" | "search";

function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function NotesPage() {
  const routeSearch = Route.useSearch();
  const notesQuery = useNotes();
  const createNote = useCreateNoteMutation();
  const updateNote = useUpdateNoteMutation();
  const deleteNote = useDeleteNoteMutation();
  const confirm = useConfirmDialog();

  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchOptionsOpen, setSearchOptionsOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [renamingTreeId, setRenamingTreeId] = useState<string | null>(null);

  // Navigation history (back/forward through opened notes).
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const activeNoteQuery = useNote(activeNoteId);
  const backlinksQuery = useNoteBacklinks(activeNoteId);
  const outgoingLinksQuery = useNoteOutgoingLinks(activeNoteId);

  const expansion = useTreeExpansion(notesQuery.data ?? []);

  // Client-side search: full-text + Obsidian-style operators against the
  // already-loaded note set. Cheap until the vault gets enormous.
  const noteByIdMap = useMemo(
    () => new Map((notesQuery.data ?? []).map((n) => [n.id, n])),
    [notesQuery.data],
  );
  const parsedQuery = useMemo(() => parseQuery(searchQuery), [searchQuery]);
  const searchHits = useMemo(() => {
    if (isEmpty(parsedQuery)) return [] as Note[];
    const all = notesQuery.data ?? [];
    return all.filter((n) =>
      matchNote(n, parsedQuery, noteByIdMap, searchCaseSensitive),
    );
  }, [parsedQuery, notesQuery.data, noteByIdMap, searchCaseSensitive]);

  // Sync drafts with active note.
  const loadedNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    const note = activeNoteQuery.data;
    if (!note) return;
    if (loadedNoteIdRef.current === note.id) return;
    loadedNoteIdRef.current = note.id;
    setTitleDraft(note.title);
    setContentDraft(note.content);
    setEditingTitle(false);
  }, [activeNoteQuery.data]);

  // Debounced save.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const note = activeNoteQuery.data;
    if (!note) return;
    if (loadedNoteIdRef.current !== note.id) return;
    if (titleDraft === note.title && contentDraft === note.content) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      updateNote.mutate({
        id: note.id,
        title: titleDraft.trim() || "Untitled",
        content: contentDraft,
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [titleDraft, contentDraft, activeNoteQuery.data, updateNote]);

  const { knownTitles, titleToNote, aliasToNote } = useMemo(() => {
    const titles = new Set<string>();
    const titleMap = new Map<string, Note>();
    const aliasMap = new Map<string, Note>();
    for (const note of notesQuery.data ?? []) {
      if (note.kind !== "note") continue;
      titles.add(note.title);
      titleMap.set(note.title, note);
      for (const alias of extractAliases(note.content)) {
        titles.add(alias);
        if (!aliasMap.has(alias)) aliasMap.set(alias, note);
      }
    }
    return { knownTitles: titles, titleToNote: titleMap, aliasToNote: aliasMap };
  }, [notesQuery.data]);

  const tagFilteredNotes = useMemo(() => {
    if (!activeTag) return [];
    const out: Note[] = [];
    for (const note of notesQuery.data ?? []) {
      if (note.kind !== "note") continue;
      TAG_INLINE_RE.lastIndex = 0;
      let found = false;
      let m: RegExpExecArray | null;
      while ((m = TAG_INLINE_RE.exec(note.content)) !== null) {
        if (m[2] === activeTag) {
          found = true;
          break;
        }
      }
      if (found) out.push(note);
    }
    return out;
  }, [activeTag, notesQuery.data]);

  const templates = useMemo(() => {
    const all = notesQuery.data ?? [];
    const folder = all.find(
      (n) =>
        n.kind === "folder" &&
        n.parentId === null &&
        n.title === TEMPLATES_FOLDER_NAME,
    );
    if (!folder) return [] as Note[];
    return all.filter((n) => n.kind === "note" && n.parentId === folder.id);
  }, [notesQuery.data]);

  useEffect(() => {
    if (!routeSearch.noteId) return;
    loadedNoteIdRef.current = null;
    setActiveNoteId(routeSearch.noteId);
  }, [routeSearch.noteId]);

  useEffect(() => {
    if (!activeNoteId || !notesQuery.data) return;
    if (notesQuery.data.some((note) => note.id === activeNoteId)) return;
    loadedNoteIdRef.current = null;
    setActiveNoteId(null);
  }, [activeNoteId, notesQuery.data]);

  // Navigation.
  const navigateTo = useCallback(
    (noteId: string) => {
      loadedNoteIdRef.current = null;
      setActiveNoteId(noteId);
      setHistory((prev) => {
        const cut = prev.slice(0, historyIndex + 1);
        if (cut[cut.length - 1] === noteId) return cut;
        return [...cut, noteId];
      });
      setHistoryIndex((i) => i + 1);
    },
    [historyIndex],
  );

  const handleSelectNote = useCallback(
    (note: Note) => {
      if (note.kind !== "note") return;
      navigateTo(note.id);
    },
    [navigateTo],
  );

  const goBack = useCallback(() => {
    if (historyIndex <= 0) return;
    const next = historyIndex - 1;
    setHistoryIndex(next);
    loadedNoteIdRef.current = null;
    setActiveNoteId(history[next] ?? null);
  }, [history, historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const next = historyIndex + 1;
    setHistoryIndex(next);
    loadedNoteIdRef.current = null;
    setActiveNoteId(history[next] ?? null);
  }, [history, historyIndex]);

  const handleCreateNote = useCallback(
    async (parentId: string | null) => {
      const note = await createNote.mutateAsync({
        title: "Untitled",
        parentId,
        kind: "note",
      });
      navigateTo(note.id);
      setRenamingTreeId(note.id);
    },
    [createNote, navigateTo],
  );

  const handleCreateFolder = useCallback(
    async (parentId: string | null) => {
      const folder = await createNote.mutateAsync({
        title: "New folder",
        parentId,
        kind: "folder",
      });
      setRenamingTreeId(folder.id);
    },
    [createNote],
  );

  const handleDelete = useCallback(
    async (note: Note) => {
      const confirmed = await confirm({
        title: "Delete note?",
        description: `Delete "${note.title}"?`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) return;
      await deleteNote.mutateAsync(note.id);
      const deletedIds = new Set<string>([note.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of notesQuery.data ?? []) {
          if (candidate.parentId && deletedIds.has(candidate.parentId) && !deletedIds.has(candidate.id)) {
            deletedIds.add(candidate.id);
            changed = true;
          }
        }
      }
      if (activeNoteId && deletedIds.has(activeNoteId)) {
        loadedNoteIdRef.current = null;
        setActiveNoteId(null);
      }
    },
    [confirm, deleteNote, activeNoteId, notesQuery.data],
  );

  const handleRename = useCallback(
    async (note: Note, nextTitle: string) => {
      await updateNote.mutateAsync({ id: note.id, title: nextTitle });
    },
    [updateNote],
  );

  const handleMove = useCallback(
    async (noteId: string, nextParentId: string | null) => {
      await updateNote.mutateAsync({ id: noteId, parentId: nextParentId });
    },
    [updateNote],
  );

  const handleWikilinkClick = useCallback(
    async (title: string, _alias: string | null) => {
      const existing = titleToNote.get(title) ?? aliasToNote.get(title);
      if (existing) {
        navigateTo(existing.id);
        return;
      }
      const created = await createNote.mutateAsync({ title, kind: "note" });
      navigateTo(created.id);
    },
    [titleToNote, aliasToNote, createNote, navigateTo],
  );

  const handleOpenToday = useCallback(async () => {
    const today = todayDateString();
    const existing = titleToNote.get(today);
    if (existing) {
      navigateTo(existing.id);
      return;
    }
    const all = notesQuery.data ?? [];
    let dailyFolder = all.find(
      (n) =>
        n.kind === "folder" &&
        n.parentId === null &&
        n.title === DAILY_FOLDER_NAME,
    );
    if (!dailyFolder) {
      dailyFolder = await createNote.mutateAsync({
        title: DAILY_FOLDER_NAME,
        kind: "folder",
      });
    }
    const note = await createNote.mutateAsync({
      title: today,
      parentId: dailyFolder.id,
      kind: "note",
    });
    navigateTo(note.id);
  }, [titleToNote, notesQuery.data, createNote, navigateTo]);

  const handleApplyTemplate = useCallback(
    async (template: Note) => {
      const note = await createNote.mutateAsync({
        title: "Untitled",
        kind: "note",
        content: template.content,
      });
      setShowTemplatePicker(false);
      navigateTo(note.id);
      setRenamingTreeId(note.id);
    },
    [createNote, navigateTo],
  );

  const submitTitleEdit = useCallback(() => {
    setEditingTitle(false);
    const note = activeNoteQuery.data;
    if (!note) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === note.title) return;
    updateNote.mutate({ id: note.id, title: trimmed });
  }, [activeNoteQuery.data, titleDraft, updateNote]);

  const wordCount = countWords(contentDraft);
  const charCount = contentDraft.length;
  const backlinkCount = backlinksQuery.data?.length ?? 0;

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const renderNoteList = (list: Note[], emptyMsg: string) => (
    <div className="flex flex-col gap-0.5 p-2">
      {list.length === 0 ? (
        <div className="px-1 py-2 text-xs text-muted-foreground">
          {emptyMsg}
        </div>
      ) : (
        list.map((note) => (
          <button
            key={note.id}
            type="button"
            onClick={() => handleSelectNote(note)}
            className={cn(
              "rounded px-2 py-1 text-left text-[13px] hover:bg-muted/40",
              note.id === activeNoteId && "bg-muted/70",
            )}
          >
            <div className="truncate">{note.title}</div>
          </button>
        ))
      )}
    </div>
  );

  // Top toolbar buttons in sidebar.
  const ToolbarBtn = ({
    icon,
    title,
    onClick,
    active,
    disabled,
  }: {
    icon: React.ReactNode;
    title: string;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
        disabled && "opacity-40 hover:bg-transparent",
      )}
    >
      {icon}
    </button>
  );

  const sidebar = (
    <SecondarySidebar title={<span>Notes</span>}>
      {/* Icon toolbar */}
      <>
        <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5">
          <ToolbarBtn
            icon={<FilePlus2 className="h-3.5 w-3.5" />}
            title="New note"
            onClick={() => handleCreateNote(null)}
          />
          <ToolbarBtn
            icon={<FolderPlus className="h-3.5 w-3.5" />}
            title="New folder"
            onClick={() => handleCreateFolder(null)}
          />
          <ToolbarBtn
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            title="Open today's daily note"
            onClick={handleOpenToday}
          />
          <ToolbarBtn
            icon={<Sparkles className="h-3.5 w-3.5" />}
            title="New from template"
            onClick={() => setShowTemplatePicker((v) => !v)}
            active={showTemplatePicker}
            disabled={templates.length === 0}
          />
          <div className="ml-auto flex items-center gap-0.5">
            <ToolbarBtn
              icon={<ChevronsDownUp className="h-3.5 w-3.5" />}
              title="Collapse all"
              onClick={expansion.collapseAll}
            />
            <ToolbarBtn
              icon={<ChevronsUpDown className="h-3.5 w-3.5" />}
              title="Expand all"
              onClick={expansion.expandAll}
            />
          </div>
        </div>

        {/* View switcher */}
        <div className="flex items-center gap-0.5 border-b px-2 py-1">
          <ToolbarBtn
            icon={<FolderTree className="h-3.5 w-3.5" />}
            title="Files"
            onClick={() => {
              setActiveTag(null);
              setSidebarView("files");
            }}
            active={sidebarView === "files"}
          />
          <ToolbarBtn
            icon={<Search className="h-3.5 w-3.5" />}
            title="Search"
            onClick={() =>
              setSidebarView((v) => (v === "search" ? "files" : "search"))
            }
            active={sidebarView === "search"}
          />
          <ToolbarBtn
            icon={<Hash className="h-3.5 w-3.5" />}
            title="Tags"
            onClick={() => {
              setActiveTag(null);
              setSidebarView((v) => (v === "tags" ? "files" : "tags"));
            }}
            active={sidebarView === "tags"}
          />
        </div>

        {/* Search input row (only when search active) */}
        {sidebarView === "search" ? (
          <div className="border-b px-2 py-2">
            <div className="flex items-center gap-1.5">
              <div className="flex flex-1 items-center gap-1.5 rounded-md border bg-input/40 px-2 py-1 focus-within:border-primary/50 focus-within:bg-input/60">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => setSearchCaseSensitive((v) => !v)}
                  title="Match case"
                  className={cn(
                    "shrink-0 rounded px-1 text-[11px] font-semibold",
                    searchCaseSensitive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Aa
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSearchOptionsOpen((v) => !v)}
                title="Search options"
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground",
                  searchOptionsOpen && "bg-muted text-foreground",
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
            {searchOptionsOpen ? (
              <div className="mt-2 rounded-md border bg-popover p-3 text-popover-foreground">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-sm font-semibold">Search options</span>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  {[
                    { op: "path:", desc: "match path of the file" },
                    { op: "file:", desc: "match file name" },
                    { op: "tag:", desc: "search for tags" },
                    { op: "line:", desc: "search keywords on same line" },
                    {
                      op: "section:",
                      desc: "search keywords under same heading",
                    },
                  ].map(({ op, desc }) => (
                    <li
                      key={op}
                      className="flex cursor-pointer items-baseline gap-1.5 rounded px-2 py-1 hover:bg-muted/60"
                      onClick={() => {
                        setSearchQuery((prev) =>
                          prev ? `${prev.trimEnd()} ${op}` : op,
                        );
                      }}
                    >
                      <span className="font-semibold">{op}</span>
                      <span className="text-muted-foreground">{desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Template picker */}
        {showTemplatePicker && templates.length > 0 ? (
          <div className="border-b">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Pick a template
            </div>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleApplyTemplate(t)}
                className="block w-full px-3 py-1 text-left text-[13px] hover:bg-muted/40"
              >
                {t.title}
              </button>
            ))}
          </div>
        ) : null}

        <ScrollArea className="flex-1">
          {sidebarView === "search" ? (
            isEmpty(parsedQuery) ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Type to search. Try{" "}
                <code className="rounded bg-muted px-1">tag:idea</code> or{" "}
                <code className="rounded bg-muted px-1">file:meeting</code>.
              </div>
            ) : (
              renderNoteList(searchHits, "no matches")
            )
          ) : sidebarView === "tags" ? (
            activeTag ? (
              <div>
                <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
                  <span>
                    Filtering by{" "}
                    <span className="text-primary">#{activeTag}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTag(null)}
                    className="hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {renderNoteList(tagFilteredNotes, "no notes with this tag")}
              </div>
            ) : (
              <TagsPanel activeTag={activeTag} onSelectTag={setActiveTag} />
            )
          ) : (
            <NotesTree
              notes={notesQuery.data ?? []}
              activeNoteId={activeNoteId}
              expanded={expansion.expanded}
              onToggleExpanded={expansion.toggle}
              onSelect={handleSelectNote}
              onDelete={handleDelete}
              onRename={handleRename}
              onMove={handleMove}
              renamingId={renamingTreeId}
              onRequestRename={setRenamingTreeId}
            />
          )}
        </ScrollArea>
      </>
    </SecondarySidebar>
  );

  return (
    <AppLayout sidebar={sidebar}>
      <ResizablePanelGroup
        orientation="horizontal"
        className="h-full min-h-0 bg-background"
      >
      {/* Center: editor column */}
      <ResizablePanel
        defaultSize="75"
        minSize="40"
        className="relative flex flex-col min-w-0"
      >
        {activeNoteQuery.data ? (
          <>
            {/* Editor topbar */}
            <div className="relative flex h-10 items-center px-2 border-b">
              <div className="flex items-center gap-0.5">
                <ToolbarBtn
                  icon={<ChevronLeft className="h-4 w-4" />}
                  title="Back"
                  onClick={goBack}
                  disabled={!canGoBack}
                />
                <ToolbarBtn
                  icon={<ChevronRight className="h-4 w-4" />}
                  title="Forward"
                  onClick={goForward}
                  disabled={!canGoForward}
                />
              </div>
              <div className="absolute inset-x-0 flex justify-center pointer-events-none">
                {editingTitle ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={submitTitleEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitTitleEdit();
                      if (e.key === "Escape") {
                        setTitleDraft(activeNoteQuery.data?.title ?? "");
                        setEditingTitle(false);
                      }
                    }}
                    className="pointer-events-auto bg-transparent text-sm text-foreground outline-none ring-1 ring-primary/40 rounded px-2 py-0.5"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingTitle(true)}
                    className="pointer-events-auto truncate text-sm text-foreground hover:text-foreground/80"
                  >
                    {titleDraft || "Untitled"}
                  </button>
                )}
              </div>
              <div className="ml-auto flex items-center gap-0.5">
                {updateNote.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground mr-1" />
                ) : null}
                <ToolbarBtn
                  icon={<BookOpen className="h-4 w-4" />}
                  title="Toggle backlinks panel"
                  onClick={() => setShowRightPanel((v) => !v)}
                  active={showRightPanel}
                />
                <div className="relative">
                  <ToolbarBtn
                    icon={<MoreHorizontal className="h-4 w-4" />}
                    title="More"
                    onClick={() => setMoreMenuOpen((v) => !v)}
                    active={moreMenuOpen}
                  />
                  {moreMenuOpen ? (
                    <div
                      className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                      onMouseLeave={() => setMoreMenuOpen(false)}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          setEditingTitle(true);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          setMoreMenuOpen(false);
                          if (activeNoteQuery.data) {
                            handleDelete(activeNoteQuery.data);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete note
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Editor body */}
            <div className="flex-1 min-h-0">
              <NoteEditor
                noteId={activeNoteQuery.data.id}
                initialDoc={activeNoteQuery.data.content}
                knownTitles={knownTitles}
                scrollToText={routeSearch.q}
                onChange={setContentDraft}
                onWikilinkClick={handleWikilinkClick}
              />
            </div>

            {/* Status bar */}
            <div className="pointer-events-none absolute bottom-2 right-2 flex h-6 w-fit items-center gap-3 rounded border bg-background/80 px-3 text-[11px] text-muted-foreground backdrop-blur">
              <span>{backlinkCount} backlinks</span>
              <span>·</span>
              <span>{wordCount} words</span>
              <span>·</span>
              <span>{charCount} characters</span>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <span>No note selected</span>
              <Button onClick={() => handleCreateNote(null)}>New note</Button>
            </div>
          </div>
        )}
      </ResizablePanel>

      {/* Right: toggleable backlinks + outgoing */}
      {activeNoteQuery.data && showRightPanel ? (
        <>
          <ResizableHandle />
          <ResizablePanel
            defaultSize="20"
            minSize="12"
            maxSize="40"
            className="flex flex-col border-l"
          >
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Linked mentions
          </div>
          <ScrollArea className="max-h-1/2">
            {(backlinksQuery.data ?? []).length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">
                No backlinks
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 p-2">
                {(backlinksQuery.data ?? []).map((bl) => (
                  <button
                    key={bl.source.id}
                    type="button"
                    onClick={() => handleSelectNote(bl.source)}
                    className="rounded px-2 py-1 text-left text-[13px] hover:bg-muted/40"
                  >
                    <div className="truncate">{bl.source.title}</div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="border-b border-t px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Outgoing links
          </div>
          <ScrollArea className="flex-1">
            {(outgoingLinksQuery.data ?? []).length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">
                No outgoing links
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 p-2">
                {(outgoingLinksQuery.data ?? []).map((link) => (
                  <button
                    key={`${link.targetTitle}-${link.target?.id ?? "u"}`}
                    type="button"
                    onClick={() =>
                      handleWikilinkClick(link.targetTitle, null)
                    }
                    className={cn(
                      "rounded px-2 py-1 text-left text-[13px] hover:bg-muted/40",
                      !link.target && "text-muted-foreground italic",
                    )}
                  >
                    <div className="truncate">{link.targetTitle}</div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          </ResizablePanel>
        </>
      ) : null}
      </ResizablePanelGroup>
    </AppLayout>
  );
}
