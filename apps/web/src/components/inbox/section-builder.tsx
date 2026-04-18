import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@g-spot/ui/components/accordion";
import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { Checkbox } from "@g-spot/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";
import { Input } from "@g-spot/ui/components/input";
import { Label } from "@g-spot/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@g-spot/ui/components/select";
import { Separator } from "@g-spot/ui/components/separator";
import { Slider } from "@g-spot/ui/components/slider";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Github,
  GripVertical,
  Mail,
  Plus,
  RotateCcw,
  Ruler,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";

import type {
  ColumnAlignment,
  ColumnConfig,
  ColumnMeta,
  ColumnSizing,
  ColumnTruncation,
  FilterCondition,
  SectionSource,
} from "@g-spot/types/filters";
import {
  clampColumnWidth,
  getDefaultColumns,
  getColumnContentAlign,
  getColumnHeaderAlign,
  getColumnLabel,
  getColumnMeta,
  getColumnSizing,
  getColumnTruncation,
  getColumnWidthBounds,
  normalizeColumns,
} from "@g-spot/types/filters";
import {
  useCreateSectionMutation,
  useDeleteSectionMutation,
  useUpdateSectionMutation,
} from "@/hooks/use-sections";
import {
  useGitHubRepoSearch,
  useGitHubLabels,
} from "@/hooks/use-github-options";
import {
  useGmailLabels,
} from "@/hooks/use-gmail-options";
import { useSectionFilterSuggestions } from "@/hooks/use-filter-suggestions";
import { ConnectedAccountSelect } from "./connected-account-select";
import { FilterConditionRow } from "./filter-condition-row";
import { RepoSearchInput } from "./repo-search-input";

type SectionData = {
  id: string;
  name: string;
  source: SectionSource;
  filters: string;
  repos: string;
  columns: string;
  accountId: string | null;
  showBadge: boolean;
};

type SectionBuilderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section?: SectionData;
};

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const SOURCE_LABELS: Record<SectionSource, string> = {
  github_pr: "GitHub PRs",
  github_issue: "GitHub Issues",
  gmail: "Gmail",
};

const ALIGNMENT_OPTIONS: Array<{
  value: ColumnAlignment;
  label: string;
  Icon: typeof AlignLeft;
}> = [
  { value: "left", label: "Align left", Icon: AlignLeft },
  { value: "center", label: "Align center", Icon: AlignCenter },
  { value: "right", label: "Align right", Icon: AlignRight },
];

const TRUNCATION_OPTIONS: Array<{
  value: ColumnTruncation;
  label: string;
}> = [
  { value: "middle", label: "Middle" },
  { value: "end", label: "End" },
];

const SIZING_OPTIONS: Array<{
  value: ColumnSizing;
  label: string;
}> = [
  { value: "fill", label: "Fill" },
  { value: "fit", label: "Fit" },
  { value: "fixed", label: "Fixed" },
];

const COLUMN_BOUND_SLIDER_MIN = 40;
const COLUMN_BOUND_SLIDER_MAX = 1600;

function clampSliderValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function getColumnBoundSliderRange(meta: ColumnMeta, column: ColumnConfig) {
  const bounds = getColumnWidthBounds(meta, column);
  const candidates = [
    COLUMN_BOUND_SLIDER_MIN,
    COLUMN_BOUND_SLIDER_MAX,
    bounds.min ?? COLUMN_BOUND_SLIDER_MIN,
    bounds.max ?? COLUMN_BOUND_SLIDER_MAX,
    column.width ?? 0,
    meta.width ?? 0,
  ];

  const min = Math.max(1, Math.min(...candidates.filter((value) => value > 0)));
  const max = Math.max(
    COLUMN_BOUND_SLIDER_MAX,
    ...candidates,
    min,
  );

  return { min, max };
}

function summarizeColumnWidth(meta: ColumnMeta, column: ColumnConfig): string {
  const sizing = getColumnSizing(meta, column);
  const width = clampColumnWidth(meta, column.width, column);
  const bounds = getColumnWidthBounds(meta, column);
  const parts: string[] = [sizing];

  if (width != null) {
    parts.push(`${width}px`);
  } else if (meta.width != null) {
    parts.push(`${meta.width}px default`);
  } else {
    parts.push("auto");
  }

  parts.push(bounds.min != null ? `min ${bounds.min}px` : "no min");
  parts.push(bounds.max != null ? `max ${bounds.max}px` : "no max");

  return parts.join(" · ");
}

function hasColumnOverrides(column: ColumnConfig): boolean {
  return Boolean(
    column.sizing
    || column.minWidth != null
    || column.maxWidth != null
    || column.label?.trim()
    || column.width != null
    || column.align
    || column.headerAlign
    || column.truncation,
  );
}

function SortableColumnItem({
  id,
  children,
}: {
  id: string;
  children: (args: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    isDragging: boolean;
  }) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "z-50 opacity-60")}
    >
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}

export function SectionBuilder({
  open,
  onOpenChange,
  section,
}: SectionBuilderProps) {
  const isEdit = !!section;
  const user = useUser();
  const accounts = user?.useConnectedAccounts() ?? [];

  // Form state
  const [name, setName] = useState("");
  const [source, setSource] = useState<SectionSource>("github_pr");
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [filterSearchQueries, setFilterSearchQueries] = useState<string[]>([]);
  const [repos, setRepos] = useState<string[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showBadge, setShowBadge] = useState(true);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [openColumnIds, setOpenColumnIds] = useState<string[]>([]);
  const isGitHubSource = source === "github_pr" || source === "github_issue";
  const columnSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      const nextFilters = section ? parseJson<FilterCondition[]>(section.filters, []) : [];
      const nextSource = section?.source ?? "github_pr";
      setName(section?.name ?? "");
      setSource(nextSource);
      setFilters(nextFilters);
      setFilterSearchQueries(Array.from({ length: nextFilters.length }, () => ""));
      setRepos(section ? parseJson(section.repos, []) : []);
      setAccountId(section?.accountId ?? null);
      setShowBadge(section?.showBadge ?? true);
      const savedColumns = section ? parseJson<ColumnConfig[]>(section.columns, []) : [];
      setColumns(normalizeColumns(nextSource, savedColumns));
      setOpenColumnIds([]);
    }
  }, [open, section]);

  // Connected accounts by provider
  const githubAccounts = accounts.filter((a) => a.provider === "github");
  const googleAccounts = accounts.filter((a) => a.provider === "google");

  // Auto-select the first account if none selected
  useEffect(() => {
    if (!accountId) {
      if (isGitHubSource && githubAccounts.length > 0) {
        setAccountId(githubAccounts[0].providerAccountId);
      } else if (source === "gmail" && googleAccounts.length > 0) {
        setAccountId(googleAccounts[0].providerAccountId);
      }
    }
  }, [source, githubAccounts, googleAccounts, accountId, isGitHubSource]);

  // Get the selected connected account object
  const selectedAccount = useMemo(() => {
    if (!accountId) return null;
    return accounts.find((a) => a.providerAccountId === accountId) ?? null;
  }, [accounts, accountId]);

  // Repo search with dynamic query + infinite pagination
  const [repoQuery, setRepoQuery] = useState("");
  const {
    data: repoSearchData,
    isLoading: loadingRepos,
    hasNextPage: hasMoreRepos,
    isFetchingNextPage: fetchingMoreRepos,
    fetchNextPage: fetchMoreRepos,
  } = useGitHubRepoSearch(isGitHubSource ? selectedAccount : null, repoQuery);

  const repoSearchResults = useMemo(
    () => repoSearchData?.pages.flatMap((p) => p.repos) ?? [],
    [repoSearchData],
  );

  // Other options
  const { data: labelOptions, isLoading: loadingLabels } =
    useGitHubLabels(isGitHubSource ? selectedAccount : null, repos);
  const { data: gmailLabelOptions, isLoading: loadingGmailLabels } =
    useGmailLabels(source === "gmail" ? selectedAccount : null);
  const suggestionStates = useSectionFilterSuggestions({
    source,
    account: selectedAccount,
    filters,
    repos,
    searchQueries: filterSearchQueries,
    repoOptions: repoSearchResults.map((repo) => ({
      value: repo.value,
      label: repo.label,
    })),
    githubLabelOptions: labelOptions,
    gmailLabelOptions,
  });

  const createMutation = useCreateSectionMutation();
  const updateMutation = useUpdateSectionMutation();
  const deleteMutation = useDeleteSectionMutation();

  function addCondition() {
    const defaultField = source === "gmail" ? "from" : "status";
    setFilters((prev) => [
      ...prev,
      { field: defaultField, operator: "is" as const, value: "", logic: "and" as const },
    ]);
    setFilterSearchQueries((prev) => [...prev, ""]);
  }

  function updateCondition(index: number, updated: FilterCondition) {
    setFilters((prev) => prev.map((c, i) => (i === index ? updated : c)));
    setFilterSearchQueries((prev) =>
      prev.map((query, i) => (i === index ? "" : query)),
    );
  }

  function removeCondition(index: number) {
    setFilters((prev) => prev.filter((_, i) => i !== index));
    setFilterSearchQueries((prev) => prev.filter((_, i) => i !== index));
  }

  function updateColumn(id: string, updater: (column: ColumnConfig) => ColumnConfig) {
    setColumns((prev) => prev.map((column) => (
      column.id === id ? updater(column) : column
    )));
  }

  const handleColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setColumns((prev) => {
      const oldIndex = prev.findIndex((column) => column.id === active.id);
      const newIndex = prev.findIndex((column) => column.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const validFilters = filters.filter((f) => f.value.trim() !== "");

    if (isEdit && section) {
      await updateMutation.mutateAsync({
        id: section.id,
        name: trimmedName,
        filters: validFilters,
        repos,
        accountId,
        showBadge,
        columns: normalizeColumns(source, columns),
      });
    } else {
      await createMutation.mutateAsync({
        name: trimmedName,
        source,
        filters: validFilters,
        repos,
        accountId,
        showBadge,
        columns: normalizeColumns(source, columns),
      });
    }

    onOpenChange(false);
  }

  async function handleDelete() {
    if (!section) return;
    await deleteMutation.mutateAsync(section.id);
    onOpenChange(false);
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Update "${section.name}"` : "New section"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Section name */}
          <div className="space-y-1.5">
            <Label htmlFor="section-name" className="text-xs font-medium text-muted-foreground">
              Section name
            </Label>
            <Input
              id="section-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Needs your review"
              className="h-9"
            />
          </div>

          {/* Source + Account in a row */}
          <div className="flex gap-3">
            {/* Source selector */}
            {!isEdit && (
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Source</Label>
                <Select
                  value={source}
                  onValueChange={(v) => {
                    if (!v) return;
                    const newSource = v as SectionSource;
                    setSource(newSource);
                    setFilters([]);
                    setFilterSearchQueries([]);
                    setRepos([]);
                    setAccountId(null);
                    setColumns(getDefaultColumns(newSource));
                  }}
                >
                  <SelectTrigger className="h-9">
                    <div className="flex items-center gap-2">
                      {isGitHubSource ? (
                        <Github className="size-3.5" />
                      ) : (
                        <Mail className="size-3.5" />
                      )}
                      <span className="text-sm">{SOURCE_LABELS[source]}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github_pr">
                      <Github className="size-3.5" />
                      GitHub PRs
                    </SelectItem>
                    <SelectItem value="github_issue">
                      <Github className="size-3.5" />
                      GitHub Issues
                    </SelectItem>
                    <SelectItem value="gmail">
                      <Mail className="size-3.5" />
                      Gmail
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Account selector */}
            <div className={cn("space-y-1.5", !isEdit ? "flex-1" : "w-full")}>
              <Label className="text-xs font-medium text-muted-foreground">Account</Label>
              <ConnectedAccountSelect
                accounts={accounts}
                provider={isGitHubSource ? "github" : "google"}
                value={accountId}
                onValueChange={setAccountId}
                className="h-9"
                emptyMessage="No account connected."
              />
            </div>
          </div>

          {/* Repositories (GitHub only) */}
          {isGitHubSource && selectedAccount && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Repositories</Label>

              {repos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {repos.map((repo) => (
                    <Badge
                      key={repo}
                      variant="secondary"
                      className="gap-1.5 py-1 pr-1 pl-2 text-xs"
                    >
                      {repo}
                      <button
                        type="button"
                        onClick={() =>
                          setRepos((prev) => prev.filter((r) => r !== repo))
                        }
                        className="rounded-sm p-0.5 hover:bg-foreground/10"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <RepoSearchInput
                repoOptions={repoSearchResults}
                isLoading={loadingRepos}
                onSelect={(repo) => {
                  if (!repos.includes(repo)) {
                    setRepos((prev) => [...prev, repo]);
                  }
                }}
                onSearchChange={setRepoQuery}
                hasNextPage={hasMoreRepos}
                isFetchingNextPage={fetchingMoreRepos}
                fetchNextPage={fetchMoreRepos}
              />
            </div>
          )}

          <Separator />

          {/* Filters */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">Filters</Label>

            {filters.length === 0 && (
              <p className="py-2 text-xs text-muted-foreground/60">
                No filters — all items will be shown.
              </p>
            )}

            <div className="space-y-0">
              {filters.map((condition, index) => {
                const { options, isLoading } = suggestionStates[index] ?? {};
                const supportsTypedSuggestions =
                  (source === "github_pr"
                    && ["author", "reviewer", "assignee", "mentions", "involves"].includes(condition.field))
                  || (source === "github_issue"
                    && ["author", "assignee", "mentions", "involves"].includes(condition.field));
                return (
                  <FilterConditionRow
                    key={index}
                    condition={condition}
                    source={isEdit ? section!.source : source}
                    index={index}
                    onChange={(updated) => updateCondition(index, updated)}
                    onSearchChange={
                      supportsTypedSuggestions
                        ? (query) =>
                            setFilterSearchQueries((prev) =>
                              prev.map((current, currentIndex) =>
                                currentIndex === index ? query : current,
                              ),
                            )
                        : undefined
                    }
                    onRemove={() => removeCondition(index)}
                    dynamicOptions={options}
                    isLoadingOptions={
                      isLoading
                      || (isGitHubSource && condition.field === "label" && loadingLabels)
                      || (source === "gmail" && condition.field === "label" && loadingGmailLabels)
                      || (isGitHubSource && condition.field === "repo" && loadingRepos)
                    }
                  />
                );
              })}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-full gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={addCondition}
            >
              <Plus className="size-3" />
              Add condition
            </Button>
          </div>

          {/* Columns */}
          {columns.length > 0 && (
            <>
              <Separator />
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Columns</Label>
                <p className="text-xs text-muted-foreground/60">
                  Toggle columns, then open each one to adjust the header label, alignment, width, and truncation.
                </p>
                <TooltipProvider delay={150}>
                  <DndContext
                    sensors={columnSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleColumnDragEnd}
                  >
                    <SortableContext
                      items={columns.map((column) => column.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <Accordion
                        multiple
                        value={openColumnIds}
                        onValueChange={(value) => setOpenColumnIds(value as string[])}
                        className="rounded-lg border border-border/60 bg-muted/15"
                      >
                        {columns.map((col, index) => {
                          const meta = getColumnMeta(source, col.id);
                          if (!meta) return null;

                          const widthBounds = getColumnWidthBounds(meta, col);
                          const sliderRange = getColumnBoundSliderRange(meta, col);
                          const sliderMinValue = clampSliderValue(
                            col.minWidth ?? meta.minWidth ?? sliderRange.min,
                            sliderRange.min,
                            sliderRange.max,
                          );
                          const sliderMaxValue = clampSliderValue(
                            col.maxWidth ?? meta.maxWidth ?? sliderRange.max,
                            sliderMinValue,
                            sliderRange.max,
                          );
                          const displayLabel = getColumnLabel(meta, col) || "(no label)";
                          const itemAlign = getColumnContentAlign(meta, col) ?? "left";
                          const headerAlign = getColumnHeaderAlign(meta, col) ?? "left";
                          const truncation = getColumnTruncation(meta, col);
                          const showReset = hasColumnOverrides(col) && openColumnIds.includes(col.id);

                          return (
                            <SortableColumnItem key={col.id} id={col.id}>
                              {({ attributes, listeners, isDragging }) => (
                                <AccordionItem
                                  value={col.id}
                                  className={cn("border-border/60 px-2", isDragging && "rounded-md bg-background/80 shadow-sm")}
                                >
                                  <AccordionTrigger className="items-center gap-3 px-1 py-2 hover:no-underline">
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                      <button
                                        type="button"
                                        className="shrink-0 cursor-grab touch-none rounded-sm p-0.5 text-muted-foreground/40 transition-colors hover:text-foreground/70 active:cursor-grabbing"
                                        {...attributes}
                                        {...listeners}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                        }}
                                      >
                                        <GripVertical className="size-3" />
                                      </button>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="truncate text-xs font-medium">{displayLabel}</span>
                                          {!col.visible && (
                                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                              Hidden
                                            </Badge>
                                          )}
                                          {hasColumnOverrides(col) && (
                                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                              Custom
                                            </Badge>
                                          )}
                                        </div>
                                        <p className="truncate text-[11px] text-muted-foreground/65">
                                          {meta.label || "Untitled"} · {summarizeColumnWidth(meta, col)} · header {headerAlign} · items {itemAlign} · truncate {truncation}
                                        </p>
                                      </div>
                                    </div>

                                    <div
                                      className="flex shrink-0 items-center gap-1"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Tooltip>
                                        <TooltipTrigger render={
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            className="text-muted-foreground hover:text-foreground"
                                            disabled={index === 0}
                                            onClick={() => {
                                              setColumns((prev) => {
                                                const next = [...prev];
                                                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                                return next;
                                              });
                                            }}
                                          >
                                            <ArrowUp className="size-3" />
                                          </Button>
                                        } />
                                        <TooltipContent>Move up</TooltipContent>
                                      </Tooltip>

                                      <Tooltip>
                                        <TooltipTrigger render={
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            className="text-muted-foreground hover:text-foreground"
                                            disabled={index === columns.length - 1}
                                            onClick={() => {
                                              setColumns((prev) => {
                                                const next = [...prev];
                                                [next[index], next[index + 1]] = [next[index + 1], next[index]];
                                                return next;
                                              });
                                            }}
                                          >
                                            <ArrowDown className="size-3" />
                                          </Button>
                                        } />
                                        <TooltipContent>Move down</TooltipContent>
                                      </Tooltip>

                                      <Tooltip>
                                        <TooltipTrigger render={
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            className="text-muted-foreground hover:text-foreground"
                                            onClick={() => updateColumn(col.id, (column) => ({
                                              ...column,
                                              visible: !column.visible,
                                            }))}
                                          >
                                            {col.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                                          </Button>
                                        } />
                                        <TooltipContent>{col.visible ? "Hide column" : "Show column"}</TooltipContent>
                                      </Tooltip>

                                      {showReset && (
                                        <Tooltip>
                                          <TooltipTrigger render={
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon-xs"
                                              className="text-muted-foreground hover:text-foreground"
                                              onClick={() => updateColumn(col.id, (column) => ({
                                                ...column,
                                                width: null,
                                                label: null,
                                                headerAlign: null,
                                                align: null,
                                                truncation: null,
                                              }))}
                                            >
                                              <RotateCcw className="size-3" />
                                            </Button>
                                          } />
                                          <TooltipContent>Reset overrides</TooltipContent>
                                        </Tooltip>
                                      )}

                                    </div>
                                  </AccordionTrigger>

                                  <AccordionContent className="px-1">
                                    <div className="grid gap-3 rounded-md border border-border/60 bg-background/80 p-3 md:grid-cols-2">
                                      <div className="space-y-1.5">
                                        <Label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                          <Type className="size-3" />
                                          Header label
                                        </Label>
                                        <Input
                                          value={col.label ?? ""}
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            updateColumn(col.id, (column) => ({
                                              ...column,
                                              label: value.trim() ? value.slice(0, 32) : null,
                                            }));
                                          }}
                                          placeholder={meta.label || "No label"}
                                          className="h-8 text-xs"
                                        />
                                        <p className="text-[11px] text-muted-foreground/65">
                                          Leave blank to use the default label.
                                        </p>
                                      </div>

                                      <div className="space-y-1.5">
                                        <Label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                          <Ruler className="size-3" />
                                          Sizing
                                        </Label>
                                        <Select
                                          value={col.sizing ?? "__default"}
                                          onValueChange={(value) => updateColumn(col.id, (column) => ({
                                            ...column,
                                            sizing: value === "__default" ? undefined : value as ColumnSizing,
                                          }))}
                                        >
                                          <SelectTrigger className="h-8 text-xs">
                                            <span className="truncate">
                                              {col.sizing ?? `${meta.sizing} (default)`}
                                            </span>
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__default">{meta.sizing} (default)</SelectItem>
                                            {SIZING_OPTIONS.map((option) => (
                                              <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <p className="text-[11px] text-muted-foreground/65">
                                          `fixed` locks a column, `fit` shrink-wraps it, `fill` takes leftover space.
                                        </p>
                                      </div>

                                      <div className="space-y-1.5">
                                        <Label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                          <Ruler className="size-3" />
                                          Width
                                        </Label>
                                        <Input
                                          type="number"
                                          inputMode="numeric"
                                          min={widthBounds.min}
                                          step={1}
                                          value={col.width ?? ""}
                                          onChange={(e) => {
                                            const nextValue = e.target.value;
                                            updateColumn(col.id, (column) => ({
                                              ...column,
                                              width: nextValue === ""
                                                ? null
                                                : clampColumnWidth(meta, Number(nextValue), column),
                                            }));
                                          }}
                                          placeholder={meta.width != null ? `${meta.width}` : "auto"}
                                          className="h-8 text-xs"
                                        />
                                        <p className="text-[11px] text-muted-foreground/65">
                                          {widthBounds.min != null ? `Min ${widthBounds.min}px` : "No minimum"}
                                          {widthBounds.max != null ? ` · Max ${widthBounds.max}px` : " · No maximum"}
                                        </p>
                                      </div>

                                      <div className="space-y-2 md:col-span-2">
                                        <div className="flex items-center justify-between gap-3">
                                          <Label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                                            <Ruler className="size-3" />
                                            Width range
                                          </Label>
                                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/75">
                                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                              min {col.minWidth != null ? `${col.minWidth}px` : "none"}
                                            </Badge>
                                            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                              max {col.maxWidth != null ? `${col.maxWidth}px` : "none"}
                                            </Badge>
                                          </div>
                                        </div>

                                        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
                                          <Slider
                                            min={sliderRange.min}
                                            max={sliderRange.max}
                                            step={1}
                                            value={[sliderMinValue, sliderMaxValue]}
                                            onValueChange={(value) => {
                                              const nextValues = Array.isArray(value)
                                                ? value
                                                : [value, sliderMaxValue];
                                              const [nextMinRaw, nextMaxRaw] = nextValues;
                                              const nextMin = clampSliderValue(nextMinRaw ?? sliderRange.min, sliderRange.min, sliderRange.max);
                                              const nextMax = clampSliderValue(nextMaxRaw ?? sliderRange.max, nextMin, sliderRange.max);

                                              updateColumn(col.id, (column) => ({
                                                ...column,
                                                minWidth: nextMin,
                                                maxWidth: nextMax,
                                                width: column.width != null
                                                  ? clampColumnWidth(meta, column.width, {
                                                    ...column,
                                                    minWidth: nextMin,
                                                    maxWidth: nextMax,
                                                  })
                                                  : null,
                                              }));
                                            }}
                                          />

                                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                              <Checkbox
                                                checked={col.minWidth == null}
                                                onCheckedChange={(checked) => updateColumn(col.id, (column) => ({
                                                  ...column,
                                                  minWidth: checked ? undefined : sliderMinValue,
                                                  width: checked
                                                    ? column.width
                                                    : clampColumnWidth(meta, column.width, {
                                                      ...column,
                                                      minWidth: sliderMinValue,
                                                    }),
                                                }))}
                                              />
                                              No min
                                            </label>

                                            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                              <Checkbox
                                                checked={col.maxWidth == null}
                                                onCheckedChange={(checked) => updateColumn(col.id, (column) => ({
                                                  ...column,
                                                  maxWidth: checked ? undefined : sliderMaxValue,
                                                  width: checked
                                                    ? column.width
                                                    : clampColumnWidth(meta, column.width, {
                                                      ...column,
                                                      maxWidth: sliderMaxValue,
                                                    }),
                                                }))}
                                              />
                                              No max
                                            </label>
                                          </div>
                                        </div>

                                        <p className="text-[11px] text-muted-foreground/65">
                                          Drag both handles like a price range. Turn a side off if this section shouldn&apos;t override that bound.
                                        </p>
                                      </div>

                                      <div className="space-y-1.5">
                                        <Label className="text-[11px] font-medium text-muted-foreground">
                                          Header placement
                                        </Label>
                                        <div className="flex items-center gap-1">
                                          {ALIGNMENT_OPTIONS.map(({ value, label, Icon }) => {
                                            const active = (col.headerAlign ?? col.align ?? meta.align ?? "left") === value;
                                            return (
                                              <Tooltip key={`header-${value}`}>
                                                <TooltipTrigger render={
                                                  <Button
                                                    type="button"
                                                    variant={active ? "outline" : "ghost"}
                                                    size="icon-xs"
                                                    className={cn(active && "border-border bg-muted")}
                                                    onClick={() => updateColumn(col.id, (column) => ({
                                                      ...column,
                                                      headerAlign: value,
                                                    }))}
                                                  >
                                                    <Icon className="size-3" />
                                                  </Button>
                                                } />
                                                <TooltipContent>{label}</TooltipContent>
                                              </Tooltip>
                                            );
                                          })}
                                          <Tooltip>
                                            <TooltipTrigger render={
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                onClick={() => updateColumn(col.id, (column) => ({
                                                  ...column,
                                                  headerAlign: null,
                                                }))}
                                              >
                                                <RotateCcw className="size-3" />
                                              </Button>
                                            } />
                                            <TooltipContent>Use default header placement</TooltipContent>
                                          </Tooltip>
                                        </div>
                                      </div>

                                      <div className="space-y-1.5">
                                        <Label className="text-[11px] font-medium text-muted-foreground">
                                          Item placement
                                        </Label>
                                        <div className="flex items-center gap-1">
                                          {ALIGNMENT_OPTIONS.map(({ value, label, Icon }) => {
                                            const active = (col.align ?? meta.align ?? "left") === value;
                                            return (
                                              <Tooltip key={`items-${value}`}>
                                                <TooltipTrigger render={
                                                  <Button
                                                    type="button"
                                                    variant={active ? "outline" : "ghost"}
                                                    size="icon-xs"
                                                    className={cn(active && "border-border bg-muted")}
                                                    onClick={() => updateColumn(col.id, (column) => ({
                                                      ...column,
                                                      align: value,
                                                    }))}
                                                  >
                                                    <Icon className="size-3" />
                                                  </Button>
                                                } />
                                                <TooltipContent>{label}</TooltipContent>
                                              </Tooltip>
                                            );
                                          })}
                                          <Tooltip>
                                            <TooltipTrigger render={
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                onClick={() => updateColumn(col.id, (column) => ({
                                                  ...column,
                                                  align: null,
                                                }))}
                                              >
                                                <RotateCcw className="size-3" />
                                              </Button>
                                            } />
                                            <TooltipContent>Use default item placement</TooltipContent>
                                          </Tooltip>
                                        </div>
                                      </div>

                                      <div className="space-y-1.5 md:col-span-2">
                                        <Label className="text-[11px] font-medium text-muted-foreground">
                                          Text truncation
                                        </Label>
                                        <div className="flex items-center gap-2">
                                          <Select
                                            value={truncation}
                                            onValueChange={(value) =>
                                              updateColumn(col.id, (column) => ({
                                                ...column,
                                                truncation: value as ColumnTruncation,
                                              }))}
                                          >
                                            <SelectTrigger className="h-8 w-36 text-xs">
                                              {TRUNCATION_OPTIONS.find((option) => option.value === truncation)?.label ?? truncation}
                                            </SelectTrigger>
                                            <SelectContent>
                                              {TRUNCATION_OPTIONS.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>
                                                  {option.label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            onClick={() => updateColumn(col.id, (column) => ({
                                              ...column,
                                              truncation: null,
                                            }))}
                                          >
                                            <RotateCcw className="size-3" />
                                          </Button>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground/65">
                                          Controls header and item text truncation for this column.
                                        </p>
                                      </div>
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              )}
                            </SortableColumnItem>
                          );
                        })}
                      </Accordion>
                    </SortableContext>
                  </DndContext>
                </TooltipProvider>
              </div>
            </>
          )}

          {/* Badge count */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="show-badge"
              checked={showBadge}
              onCheckedChange={(checked) => setShowBadge(checked === true)}
            />
            <Label htmlFor="show-badge" className="text-xs font-normal">
              Items in this section add to the inbox badge count
            </Label>
          </div>
        </div>

        <Separator />

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {isEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => void handleDelete()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="size-3.5" />
              Delete section
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={isSaving || !name.trim()}
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
