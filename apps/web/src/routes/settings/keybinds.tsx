import { useMemo, useRef } from "react";

import {
  detectPlatform,
  formatForDisplay,
  useHotkeyRecorder,
  type Hotkey,
  type ReactHotkeyRecorder,
} from "@tanstack/react-hotkeys";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";
import { Kbd, KbdGroup } from "@g-spot/ui/components/kbd";
import { Switch } from "@g-spot/ui/components/switch";
import { cn } from "@g-spot/ui/lib/utils";

import {
  KEYBIND_BY_ID,
  KEYBIND_GROUPS,
  useKeybindActions,
  useResolvedKeybinds,
  type KeybindId,
  type ResolvedKeybind,
} from "@/lib/keybinds";

export const Route = createFileRoute("/settings/keybinds")({
  component: KeybindsPage,
});

function KeybindsPage() {
  const resolved = useResolvedKeybinds();
  const { resetAll } = useKeybindActions();
  const platform = useMemo(() => detectPlatform(), []);

  const hasCustomizations = resolved.some(
    (r) => r.isCustomHotkey || !r.enabled,
  );

  const byGroup = useMemo(() => {
    const map = new Map<string, ResolvedKeybind[]>();
    for (const r of resolved) {
      const list = map.get(r.def.group) ?? [];
      list.push(r);
      map.set(r.def.group, list);
    }
    return map;
  }, [resolved]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-2xl space-y-8 px-4 py-12">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-semibold text-lg tracking-tight">
              Keyboard shortcuts
            </h1>
            <p className="mt-1 text-muted-foreground text-[13px] leading-relaxed">
              Customize app shortcuts. Click a shortcut to record a new combo,
              press Escape to cancel, or Backspace to restore the default.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 text-muted-foreground hover:text-foreground"
            disabled={!hasCustomizations}
            onClick={resetAll}
          >
            <RotateCcw className="size-3.5" />
            Reset all
          </Button>
        </header>

        {KEYBIND_GROUPS.map((group) => {
          const rows = byGroup.get(group.id);
          if (!rows?.length) return null;
          return (
            <section key={group.id} className="space-y-1">
              <div className="mb-2">
                <h2 className="font-medium text-sm">{group.label}</h2>
                <p className="text-muted-foreground text-xs">
                  {group.description}
                </p>
              </div>
              <div className="divide-y divide-border rounded-lg border">
                {rows.map((row) => (
                  <KeybindRow
                    key={row.def.id}
                    row={row}
                    platform={platform}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function KeybindRow({
  row,
  platform,
}: {
  row: ResolvedKeybind;
  platform: "mac" | "windows" | "linux";
}) {
  const id = row.def.id as KeybindId;
  const { setHotkey, setEnabled, reset } = useKeybindActions();

  const recorderRef = useRef<ReactHotkeyRecorder | null>(null);
  const recorder = useHotkeyRecorder({
    onRecord: (hotkey) => {
      setHotkey(id, hotkey);
      recorderRef.current?.stopRecording();
    },
    onClear: () => {
      reset(id);
      recorderRef.current?.stopRecording();
    },
  });
  recorderRef.current = recorder;

  const conflictNames = row.conflictsWith.map(
    (cid) => KEYBIND_BY_ID[cid].name,
  );
  const canReset = row.isCustomHotkey || !row.enabled;

  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm",
              !row.enabled && "text-muted-foreground line-through",
            )}
          >
            {row.def.name}
          </span>
          {conflictNames.length > 0 && row.enabled ? (
            <span
              className="inline-flex items-center gap-1 text-amber-500 text-xs"
              title={`Also bound to: ${conflictNames.join(", ")}`}
            >
              <AlertTriangle className="size-3" />
              Conflict
            </span>
          ) : null}
        </div>
        {row.def.description ? (
          <p className="truncate text-muted-foreground text-xs">
            {row.def.description}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() =>
            recorder.isRecording
              ? recorder.cancelRecording()
              : recorder.startRecording()
          }
          className={cn(
            "min-w-[7rem] rounded-md border px-2 py-1 text-right transition-colors",
            recorder.isRecording
              ? "border-primary bg-primary/10"
              : "border-transparent hover:border-border hover:bg-muted/50",
          )}
          aria-label={`Edit shortcut for ${row.def.name}`}
        >
          {recorder.isRecording ? (
            <span className="text-muted-foreground text-xs">
              {recorder.recordedHotkey
                ? formatForDisplay(recorder.recordedHotkey, { platform })
                : "Press keys…"}
            </span>
          ) : (
            <ComboKbd hotkey={row.hotkey} platform={platform} />
          )}
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          disabled={!canReset}
          onClick={() => reset(id)}
          aria-label={`Reset ${row.def.name} to default`}
        >
          <RotateCcw className="size-3.5" />
        </Button>

        <Switch
          checked={row.enabled}
          onCheckedChange={(checked) => setEnabled(id, checked)}
          aria-label={`Enable ${row.def.name}`}
        />
      </div>
    </div>
  );
}

/** Renders a hotkey as separate Kbd chips per token. */
function ComboKbd({
  hotkey,
  platform,
}: {
  hotkey: Hotkey;
  platform: "mac" | "windows" | "linux";
}) {
  const tokens = formatForDisplay(hotkey, { platform })
    .split(/[\s+]+/)
    .filter(Boolean);
  return (
    <KbdGroup className="justify-end">
      {tokens.map((token, i) => (
        <Kbd key={`${token}-${i}`}>{token}</Kbd>
      ))}
    </KbdGroup>
  );
}
