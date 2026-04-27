import { useEffect, useMemo, useRef, useState } from "react";

import type { Note } from "@g-spot/types";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@g-spot/ui/lib/utils";

interface TreeNode {
  note: Note;
  children: TreeNode[];
}

function buildTree(notes: Note[]): TreeNode[] {
  const byParent = new Map<string | null, Note[]>();
  for (const note of notes) {
    const arr = byParent.get(note.parentId) ?? [];
    arr.push(note);
    byParent.set(note.parentId, arr);
  }
  const sortNotes = (a: Note, b: Note) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.title.localeCompare(b.title);
  };
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).sort(sortNotes).map((note) => ({
      note,
      children: note.kind === "folder" ? build(note.id) : [],
    }));
  return build(null);
}

interface NotesTreeProps {
  notes: Note[];
  activeNoteId: string | null;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onSelect: (note: Note) => void;
  onDelete: (note: Note) => void;
  onRename: (note: Note, nextTitle: string) => void;
  onMove: (noteId: string, nextParentId: string | null) => void;
  renamingId: string | null;
  onRequestRename: (id: string | null) => void;
}

interface RowProps {
  node: TreeNode;
  depth: number;
  isOpen: boolean;
  isActive: boolean;
  isRenaming: boolean;
  onToggle: (id: string) => void;
  onSelect: NotesTreeProps["onSelect"];
  onDelete: NotesTreeProps["onDelete"];
  onStartRename: (id: string) => void;
  onSubmitRename: (note: Note, value: string) => void;
  onCancelRename: () => void;
}

function TreeRow({
  node,
  depth,
  isOpen,
  isActive,
  isRenaming,
  onToggle,
  onSelect,
  onDelete,
  onStartRename,
  onSubmitRename,
  onCancelRename,
}: RowProps) {
  const isFolder = node.note.kind === "folder";

  const draggable = useDraggable({ id: `note-${node.note.id}` });
  const droppable = useDroppable({
    id: `drop-${node.note.id}`,
    data: { kind: node.note.kind, id: node.note.id, parentId: node.note.parentId },
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  return (
    <div
      ref={(el) => {
        draggable.setNodeRef(el);
        droppable.setNodeRef(el);
      }}
      className={cn(
        "group relative flex items-center gap-1 rounded px-1.5 py-0.5 text-[13px] hover:bg-muted/40",
        isActive && "bg-muted/70",
        droppable.isOver && "ring-1 ring-primary/60",
        draggable.isDragging && "opacity-40",
      )}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
    >
      {isFolder ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.note.id);
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              isOpen && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <div
        {...draggable.listeners}
        {...draggable.attributes}
        className="flex flex-1 min-w-0 items-center"
        onDoubleClick={(e) => {
          e.preventDefault();
          onStartRename(node.note.id);
        }}
        onClick={() =>
          isFolder ? onToggle(node.note.id) : onSelect(node.note)
        }
      >
        {isRenaming ? (
          <input
            ref={inputRef}
            defaultValue={node.note.title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSubmitRename(node.note, e.currentTarget.value);
              } else if (e.key === "Escape") {
                onCancelRename();
              }
            }}
            onBlur={(e) => onSubmitRename(node.note, e.currentTarget.value)}
            className="flex-1 bg-transparent text-[13px] outline-none ring-1 ring-primary/40 rounded px-1"
          />
        ) : (
          <span className="truncate">{node.note.title}</span>
        )}
      </div>
      {!isRenaming ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.note);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-60"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export function NotesTree({
  notes,
  activeNoteId,
  expanded,
  onToggleExpanded,
  onSelect,
  onDelete,
  onRename,
  onMove,
  renamingId,
  onRequestRename,
}: NotesTreeProps) {
  const tree = useMemo(() => buildTree(notes), [notes]);
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const rootDroppable = useDroppable({ id: "drop-root" });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const draggedId = String(active.id).replace(/^note-/, "");
    if (over.id === "drop-root") {
      onMove(draggedId, null);
      return;
    }
    const targetId = String(over.id).replace(/^drop-/, "");
    if (targetId === draggedId) return;
    const target = noteById.get(targetId);
    if (!target) return;
    if (target.kind === "folder") {
      let cur: Note | undefined = target;
      while (cur) {
        if (cur.id === draggedId) return;
        cur = cur.parentId ? noteById.get(cur.parentId) : undefined;
      }
      onMove(draggedId, targetId);
    } else {
      onMove(draggedId, target.parentId);
    }
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isFolder = node.note.kind === "folder";
    const isOpen = expanded.has(node.note.id);
    return (
      <div key={node.note.id}>
        <TreeRow
          node={node}
          depth={depth}
          isOpen={isOpen}
          isActive={node.note.id === activeNoteId}
          isRenaming={renamingId === node.note.id}
          onToggle={onToggleExpanded}
          onSelect={onSelect}
          onDelete={onDelete}
          onStartRename={onRequestRename}
          onSubmitRename={(note, value) => {
            const trimmed = value.trim();
            if (trimmed && trimmed !== note.title) {
              onRename(note, trimmed);
            }
            onRequestRename(null);
          }}
          onCancelRename={() => onRequestRename(null)}
        />
        {isFolder && isOpen ? (
          <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>
        ) : null}
      </div>
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={rootDroppable.setNodeRef}
        className={cn(
          "flex flex-col py-1 min-h-12",
          rootDroppable.isOver && "ring-1 ring-primary/60 rounded",
        )}
      >
        {tree.map((node) => renderNode(node, 0))}
      </div>
    </DndContext>
  );
}

interface UseExpandedReturn {
  expanded: Set<string>;
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

export function useTreeExpansion(notes: Note[]): UseExpandedReturn {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  return {
    expanded,
    toggle: (id) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    expandAll: () =>
      setExpanded(
        new Set(notes.filter((n) => n.kind === "folder").map((n) => n.id)),
      ),
    collapseAll: () => setExpanded(new Set()),
  };
}
