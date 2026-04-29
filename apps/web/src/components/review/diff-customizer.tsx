import { atom, useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Cog } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { Switch } from "@g-spot/ui/components/switch";

export type LineDiffType = "word-alt" | "word" | "char" | "none";

export type DiffCustomization = {
  lineDiffType: LineDiffType;
  backgrounds: boolean;
  wrapping: boolean;
  lineNumbers: boolean;
};

const DEFAULTS: DiffCustomization = {
  lineDiffType: "word-alt",
  backgrounds: true,
  wrapping: false,
  lineNumbers: true,
};

const diffCustomizationAtom = atomWithStorage<DiffCustomization>(
  "gspot:review:diff-customization",
  DEFAULTS,
);

// Merges stored values over DEFAULTS so missing fields (from older storage
// shapes) resolve without each consumer re-applying defaults.
const mergedWithDefaultsAtom = atom((get) => ({
  ...DEFAULTS,
  ...get(diffCustomizationAtom),
}));

export function useDiffCustomization(): DiffCustomization {
  return useAtomValue(mergedWithDefaultsAtom);
}

const LINE_DIFF_OPTIONS: Array<{
  value: LineDiffType;
  label: string;
  hint: string;
}> = [
  {
    value: "word-alt",
    label: "Word-Alt",
    hint: "Highlight entire words with enhanced algorithm",
  },
  {
    value: "word",
    label: "Word",
    hint: "Highlight changed words within lines",
  },
  {
    value: "char",
    label: "Character",
    hint: "Highlight individual character changes",
  },
  {
    value: "none",
    label: "None",
    hint: "Show line-level changes only",
  },
];

export function DiffCustomizerMenu() {
  const [settings, setSettings] = useAtom(diffCustomizationAtom);
  const current = { ...DEFAULTS, ...settings };
  const update = (patch: Partial<DiffCustomization>) =>
    setSettings({ ...current, ...patch });

  const row =
    "flex items-center justify-between gap-3 px-2 py-1.5 text-[12px]";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Customize diff"
            title="Customize diff"
          >
            <Cog />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[260px] p-1">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          Line diff
        </div>
        {LINE_DIFF_OPTIONS.map((opt) => {
          const active = current.lineDiffType === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ lineDiffType: opt.value })}
              className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-muted ${
                active ? "bg-muted" : ""
              }`}
            >
              <span
                className={`mt-[3px] inline-flex size-3 items-center justify-center rounded-md border ${
                  active ? "border-primary bg-primary" : "border-border"
                }`}
              />
              <span className="flex-1">
                <span className="block font-medium text-foreground">
                  {opt.label}
                </span>
                <span className="block text-[11px] text-muted-foreground/70">
                  {opt.hint}
                </span>
              </span>
            </button>
          );
        })}

        <DropdownMenuSeparator />

        <div className={row}>
          <span>Backgrounds</span>
          <Switch
            checked={current.backgrounds}
            onCheckedChange={(v) => update({ backgrounds: v })}
          />
        </div>
        <div className={row}>
          <span>Wrapping</span>
          <Switch
            checked={current.wrapping}
            onCheckedChange={(v) => update({ wrapping: v })}
          />
        </div>
        <div className={row}>
          <span>Line numbers</span>
          <Switch
            checked={current.lineNumbers}
            onCheckedChange={(v) => update({ lineNumbers: v })}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
