import { useState, useMemo } from "react";

import { Button } from "@g-spot/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@g-spot/ui/components/select";
import { ChevronDown, Check, Search, Loader2 } from "lucide-react";
import { cn } from "@g-spot/ui/lib/utils";

import type { FieldConfig } from "@/lib/filter-fields";

type FilterValueInputProps = {
  value: string;
  onChange: (value: string) => void;
  fieldConfig: FieldConfig | undefined;
  fetchedOptions?: Array<{ value: string; label: string }>;
  isLoadingOptions?: boolean;
  placeholder?: string;
};

export function FilterValueInput({
  value,
  onChange,
  fieldConfig,
  fetchedOptions,
  isLoadingOptions,
  placeholder = "Value",
}: FilterValueInputProps) {
  if (!fieldConfig) {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
      />
    );
  }

  if (fieldConfig.valueType === "date") {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fieldConfig.placeholder ?? placeholder}
        className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
      />
    );
  }

  if (fieldConfig.valueType === "text") {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fieldConfig.placeholder ?? placeholder}
        className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
      />
    );
  }

  if (fieldConfig.valueType === "boolean") {
    return (
      <Select value={value || "true"} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (fieldConfig.valueType === "select" && fieldConfig.options) {
    return (
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {fieldConfig.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <SearchableDropdown
      value={value}
      onChange={onChange}
      options={fetchedOptions ?? fieldConfig.options ?? []}
      isLoading={isLoadingOptions}
      placeholder={placeholder}
    />
  );
}

function SearchableDropdown({
  value,
  onChange,
  options,
  isLoading,
  placeholder,
  onSearchChange,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  isLoading?: boolean;
  placeholder: string;
  onSearchChange?: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lower) ||
        opt.value.toLowerCase().includes(lower),
    );
  }, [options, search]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full justify-between gap-1 px-2.5 font-normal text-xs"
          />
        }
      >
        <span
          className={cn(
            "min-w-0 truncate",
            !value && "text-muted-foreground",
          )}
        >
          {value ? selectedLabel : placeholder}
        </span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--anchor-width)] min-w-[220px] max-h-[var(--available-height,320px)] flex flex-col overflow-hidden p-0"
        align="start"
      >
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-2 shrink-0">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              onSearchChange?.(e.target.value);
            }}
            placeholder="Search or type custom…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          {isLoading && (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-1">
          {!isLoading && filtered.length === 0 && !search && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              No options available
            </div>
          )}

          {filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                value === opt.value && "bg-accent/50",
              )}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                setSearch("");
              }}
            >
              <Check
                className={cn(
                  "size-3 shrink-0",
                  value === opt.value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="min-w-0 truncate">{opt.label}</span>
            </button>
          ))}

          {search && !filtered.some((o) => o.value === search) && (
            <>
              {filtered.length > 0 && (
                <div className="mx-1 my-1 border-t border-border" />
              )}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => {
                  onChange(search);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <span className="size-3 shrink-0" />
                Use &ldquo;{search}&rdquo;
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
