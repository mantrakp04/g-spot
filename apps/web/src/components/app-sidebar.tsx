import { useState, useCallback } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { ScrollArea } from "@g-spot/ui/components/scroll-area";
import { Separator } from "@g-spot/ui/components/separator";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn, Plus, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { Logo } from "./logo";
import { NavUser } from "./nav-user";
import { SectionBuilder } from "./inbox/section-builder";
import { trpc, trpcClient } from "@/utils/trpc";

function SortableSectionItem({
  section,
}: {
  section: { id: string; name: string; showBadge: boolean };
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };

  return (
    <a
      ref={setNodeRef}
      style={style}
      href={`#section-${section.id}`}
      className={cn(
        "group flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent",
        isDragging && "z-50 opacity-50",
      )}
      {...attributes}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        {...listeners}
        onClick={(e) => e.preventDefault()}
      >
        <GripVertical className="size-3" />
      </button>
      <span className="min-w-0 flex-1 truncate">{section.name}</span>
      {section.showBadge && (
        <Badge
          variant="secondary"
          className="h-4 min-w-[1.25rem] shrink-0 px-1 text-[10px] tabular-nums"
        >
          &mdash;
        </Badge>
      )}
    </a>
  );
}

export function AppSidebar() {
  const user = useUser();
  const queryClient = useQueryClient();
  const { data: sections, isLoading } = useQuery(
    trpc.sections.list.queryOptions(),
  );
  const [builderOpen, setBuilderOpen] = useState(false);

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) =>
      trpcClient.sections.reorder.mutate({ orderedIds }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [["sections", "list"]] }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !sections) return;

      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sections, oldIndex, newIndex);

      // Optimistic update
      queryClient.setQueryData(
        trpc.sections.list.queryOptions().queryKey,
        reordered,
      );

      reorderMutation.mutate(reordered.map((s) => s.id));
    },
    [sections, queryClient, reorderMutation],
  );

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="border-b border-sidebar-border p-2">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold tracking-tight text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Logo className="size-5" />
          <span>Inbox</span>
        </Link>
      </div>

      {/* Section list */}
      <ScrollArea className="flex-1">
        <nav className="flex flex-col gap-0.5 p-2">
          {isLoading && (
            <>
              <Skeleton className="h-7 w-full rounded-md" />
              <Skeleton className="h-7 w-full rounded-md" />
              <Skeleton className="h-7 w-full rounded-md" />
            </>
          )}

          {sections && sections.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {sections.map((section) => (
                  <SortableSectionItem key={section.id} section={section} />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {!isLoading && (
            <>
              {sections && sections.length > 0 && (
                <Separator className="my-1" />
              )}
              <Button
                variant="ghost"
                size="xs"
                className="justify-start gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setBuilderOpen(true)}
              >
                <Plus className="size-3" />
                Add section
              </Button>
            </>
          )}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2">
        {user ? (
          <NavUser />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            render={<a href="/handler/sign-in" />}
          >
            <LogIn className="size-4" />
            <span>Sign In</span>
          </Button>
        )}
      </div>

      {/* Section builder dialog */}
      <SectionBuilder open={builderOpen} onOpenChange={setBuilderOpen} />
    </div>
  );
}
