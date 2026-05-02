import { useCallback, useState } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { ScrollArea } from "@g-spot/ui/components/scroll-area";
import { Separator } from "@g-spot/ui/components/separator";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Link } from "@tanstack/react-router";
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
import { GripVertical, Pencil, Plus } from "lucide-react";

import { SectionBuilder } from "@/components/inbox/section-builder";
import { SecondarySidebar } from "@/components/shell/secondary-sidebar";
import { useDrafts } from "@/contexts/drafts-context";
import { useSectionCounts } from "@/contexts/section-counts-context";
import { usePreferredComposeGoogleAccount } from "@/hooks/use-preferred-compose-google-account";
import { useReorderSectionsMutation, useSections } from "@/hooks/use-sections";

function SortableSectionItem({
  section,
  count,
}: {
  section: { id: string; name: string; showBadge: boolean };
  count: number | undefined;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id });
  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };

  return (
    <Link
      ref={setNodeRef}
      style={style}
      to="/"
      hash={`section-${section.id}`}
      className={cn(
        "group flex min-w-0 touch-none items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent active:cursor-grabbing",
        isDragging && "z-50 opacity-50",
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical
        aria-hidden
        className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
      <div className="min-w-0 flex-1">
        <span className="block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {section.name}
        </span>
      </div>
      {section.showBadge && count !== undefined && (
        <Badge
          variant="secondary"
          className="h-4 min-w-[1.25rem] shrink-0 px-1 text-[10px] tabular-nums"
        >
          {count}
        </Badge>
      )}
    </Link>
  );
}

export function SectionsSidebar() {
  const user = useUser();
  const accounts = user?.useConnectedAccounts();
  const { data: sections, isLoading } = useSections();
  const reorderMutation = useReorderSectionsMutation();
  const { drafts, openDraft } = useDrafts();
  const { counts } = useSectionCounts();
  const { preferredAccountId } = usePreferredComposeGoogleAccount(accounts);
  const [builderOpen, setBuilderOpen] = useState(false);

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
      reorderMutation.mutate({
        orderedIds: reordered.map((s) => s.id),
        nextSections: reordered,
      });
    },
    [sections, reorderMutation],
  );

  const handleCompose = useCallback(() => {
    openDraft({ mode: "new", accountId: preferredAccountId });
  }, [openDraft, preferredAccountId]);

  return (
    <SecondarySidebar
      title={<span>Sections</span>}
      headerAction={
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Add section"
          onClick={() => setBuilderOpen(true)}
        >
          <Plus className="size-3.5" />
        </Button>
      }
    >
      <div className="flex flex-col border-b border-sidebar-border p-2">
        <button
          type="button"
          onClick={handleCompose}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent"
        >
          <Pencil className="size-3 shrink-0 text-muted-foreground" />
          <span>Compose</span>
          {drafts.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-auto h-4 min-w-[1.25rem] px-1 text-[10px] tabular-nums"
            >
              {drafts.length}
            </Badge>
          )}
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-0.5 p-2">
          {isLoading && (
            <>
              <Skeleton className="h-7 rounded-md" />
              <Skeleton className="h-7 rounded-md" />
              <Skeleton className="h-7 rounded-md" />
            </>
          )}

          {sections && sections.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {sections.map((section) => (
                  <SortableSectionItem
                    key={section.id}
                    section={section}
                    count={counts[section.id]}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {!isLoading && (
            <>
              {sections && sections.length > 0 && <Separator className="my-1" />}
              <button
                type="button"
                onClick={() => setBuilderOpen(true)}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <Plus className="size-3 shrink-0" />
                <span>Add section</span>
              </button>
            </>
          )}
        </nav>
      </ScrollArea>

      <SectionBuilder open={builderOpen} onOpenChange={setBuilderOpen} />
    </SecondarySidebar>
  );
}
