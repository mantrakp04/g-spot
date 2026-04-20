import { Button } from "@g-spot/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@g-spot/ui/components/select";
import {
  X,
  Type,
  Calendar,
  ToggleLeft,
  List,
  Search,
} from "lucide-react";
import { cn } from "@g-spot/ui/lib/utils";

import type { FilterCondition } from "@g-spot/types/filters";
import {
  githubPrFields,
  githubIssueFields,
  gmailFields,
} from "@g-spot/types/filters";
import type { FieldValueType } from "@/lib/filter-fields";
import { getFieldConfig } from "@/lib/filter-fields";
import { FilterValueInput } from "./filter-value-input";

const VALUE_TYPE_ICONS: Record<FieldValueType, typeof Type> = {
  text: Type,
  date: Calendar,
  boolean: ToggleLeft,
  select: List,
  combobox: Search,
};

const ALL_OPERATORS = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "between", label: "between" },
] as const;

type FilterConditionRowProps = {
  condition: FilterCondition;
  source: "github_pr" | "github_issue" | "gmail";
  prefix?: "And" | null;
  onPrefixClick?: () => void;
  onChange: (updated: FilterCondition) => void;
  onSearchChange?: (query: string) => void;
  onRemove: () => void;
  dynamicOptions?: Array<{ value: string; label: string }>;
  isLoadingOptions?: boolean;
};

export function FilterConditionRow({
  condition,
  source,
  prefix = null,
  onPrefixClick,
  onChange,
  onSearchChange,
  onRemove,
  dynamicOptions,
  isLoadingOptions,
}: FilterConditionRowProps) {
  const fields =
    source === "github_pr"
      ? githubPrFields
      : source === "github_issue"
        ? githubIssueFields
        : gmailFields;
  const fieldConfig = getFieldConfig(source, condition.field);
  const availableOperators = fieldConfig?.operators
    ? ALL_OPERATORS.filter((op) =>
        (fieldConfig.operators as readonly string[]).includes(op.value),
      )
    : ALL_OPERATORS;

  return (
    <div className="group/row flex items-stretch gap-2">
      {/* Left rail — group-internal connector (And) */}
      <div className="flex w-10 shrink-0 items-center justify-start pt-px">
        {prefix ? (
          <button
            type="button"
            onClick={onPrefixClick}
            disabled={!onPrefixClick}
            className={cn(
              "text-[13px] font-normal text-muted-foreground/70 transition-colors",
              onPrefixClick && "hover:text-foreground",
            )}
            title={onPrefixClick ? "Click to split into a new OR group" : undefined}
          >
            {prefix}
          </button>
        ) : null}
      </div>

      {/* Condition pill — unified filled container */}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-muted/40 pr-1",
          "ring-1 ring-inset ring-border/50 transition-colors",
          "focus-within:ring-border hover:bg-muted/55",
        )}
      >
        {/* Field */}
        <Select
          value={condition.field}
          onValueChange={(field) =>
            field && onChange({ ...condition, field, value: "" })
          }
        >
          <SelectTrigger className="h-9 w-auto shrink-0 gap-1 border-none bg-transparent px-3 text-xs font-medium shadow-none hover:bg-background/50 data-[state=open]:bg-background/60">
            <SelectValue placeholder="Field" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((field) => {
              const fc = getFieldConfig(source, field);
              const Icon = VALUE_TYPE_ICONS[fc?.valueType ?? "text"];
              return (
                <SelectItem key={field} value={field}>
                  <div className="flex items-center gap-2">
                    <Icon className="size-3 shrink-0 text-muted-foreground" />
                    {fc?.label ?? field.replace(/_/g, " ")}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* Operator */}
        <Select
          value={condition.operator}
          onValueChange={(operator) =>
            operator && onChange({ ...condition, operator })
          }
        >
          <SelectTrigger className="h-9 w-auto shrink-0 gap-1 border-none bg-transparent px-1.5 text-xs text-muted-foreground shadow-none hover:bg-background/50 hover:text-foreground data-[state=open]:bg-background/60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableOperators.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Value */}
        <div className="min-w-0 flex-1">
          <FilterValueInput
            value={condition.value}
            onChange={(value) => onChange({ ...condition, value })}
            onSearchChange={onSearchChange}
            fieldConfig={fieldConfig}
            fetchedOptions={dynamicOptions}
            isLoadingOptions={isLoadingOptions}
            placeholder={fieldConfig?.placeholder ?? fieldConfig?.label ?? "Value"}
          />
        </div>

        {/* Remove */}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground/60 opacity-0 transition-all hover:text-foreground group-hover/row:opacity-100 focus-visible:opacity-100"
          onClick={onRemove}
          aria-label="Remove condition"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
