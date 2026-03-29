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

import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import {
  githubPrFields,
  gmailFields,
} from "@g-spot/api/schemas/section-filters";
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
  source: "github_pr" | "gmail";
  index: number;
  onChange: (updated: FilterCondition) => void;
  onRemove: () => void;
  dynamicOptions?: Array<{ value: string; label: string }>;
  isLoadingOptions?: boolean;
};

export function FilterConditionRow({
  condition,
  source,
  index,
  onChange,
  onRemove,
  dynamicOptions,
  isLoadingOptions,
}: FilterConditionRowProps) {
  const fields = source === "github_pr" ? githubPrFields : gmailFields;
  const fieldConfig = getFieldConfig(source, condition.field);
  const availableOperators = fieldConfig?.operators
    ? ALL_OPERATORS.filter((op) =>
        (fieldConfig.operators as readonly string[]).includes(op.value),
      )
    : ALL_OPERATORS;

  return (
    <div className="group/row relative">
      {/* AND/OR logic pill — shown between rows */}
      {index > 0 && (
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-border/40" />
          <button
            type="button"
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest transition-all",
              "border border-border/60 text-muted-foreground",
              "hover:border-foreground/30 hover:text-foreground",
            )}
            onClick={() =>
              onChange({
                ...condition,
                logic: condition.logic === "or" ? "and" : "or",
              })
            }
          >
            {condition.logic === "or" ? "or" : "and"}
          </button>
          <div className="h-px flex-1 bg-border/40" />
        </div>
      )}

      {/* Condition controls — single tight row */}
      <div className="flex items-center gap-1.5">
        {/* Field */}
        <Select
          value={condition.field}
          onValueChange={(field) =>
            field && onChange({ ...condition, field, value: "" })
          }
        >
          <SelectTrigger className="h-7 w-auto min-w-[100px] shrink-0 gap-1 border-none bg-muted/50 px-2 text-xs shadow-none hover:bg-muted">
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
          <SelectTrigger className="h-7 w-auto min-w-[60px] shrink-0 gap-1 border-none bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-muted/50 hover:text-foreground">
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
            fieldConfig={fieldConfig}
            fetchedOptions={dynamicOptions}
            isLoadingOptions={isLoadingOptions}
            placeholder={fieldConfig?.placeholder ?? fieldConfig?.label ?? "Value"}
          />
        </div>

        {/* Remove — visible on hover */}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground/0 transition-colors group-hover/row:text-muted-foreground group-hover/row:hover:text-foreground"
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
