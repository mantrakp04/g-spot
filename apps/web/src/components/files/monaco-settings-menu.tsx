import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { useAtom } from "jotai";
import { Minus, Plus, RotateCcw, Settings2 } from "lucide-react";

import {
  DEFAULT_MONACO_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TAB_SIZE_OPTIONS,
  monacoSettingsAtom,
  type RenderWhitespace,
} from "./monaco-settings-store";
import { Button } from "@g-spot/ui/components/button";

const RENDER_WHITESPACE_LABEL: Record<RenderWhitespace, string> = {
  none: "Off",
  selection: "Selection",
  all: "All",
};

export function MonacoSettingsMenu() {
  const [settings, setSettings] = useAtom(monacoSettingsAtom);

  const setFontSize = (next: number) => {
    const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, next));
    setSettings((prev) => ({ ...prev, fontSize: clamped }));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Editor settings"
      >
        <Button variant="ghost" size="icon-sm">
          <Settings2 className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Editor settings</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <div className="flex items-center justify-between px-2 py-1.5 text-xs">
          <span className="text-muted-foreground">Font size</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Decrease font size"
              className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              disabled={settings.fontSize <= FONT_SIZE_MIN}
              onClick={(event) => {
                event.preventDefault();
                setFontSize(settings.fontSize - 1);
              }}
            >
              <Minus className="size-3" />
            </button>
            <span className="w-6 text-center font-mono">{settings.fontSize}</span>
            <button
              type="button"
              aria-label="Increase font size"
              className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              disabled={settings.fontSize >= FONT_SIZE_MAX}
              onClick={(event) => {
                event.preventDefault();
                setFontSize(settings.fontSize + 1);
              }}
            >
              <Plus className="size-3" />
            </button>
          </div>
        </div>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span>Tab size</span>
            <span className="ml-auto font-mono text-muted-foreground">
              {settings.tabSize}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-32">
            <DropdownMenuRadioGroup
              value={String(settings.tabSize)}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, tabSize: Number(value) }))
              }
            >
              {TAB_SIZE_OPTIONS.map((size) => (
                <DropdownMenuRadioItem key={size} value={String(size)}>
                  {size} spaces
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span>Whitespace</span>
            <span className="ml-auto text-muted-foreground">
              {RENDER_WHITESPACE_LABEL[settings.renderWhitespace]}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-36">
            <DropdownMenuRadioGroup
              value={settings.renderWhitespace}
              onValueChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  renderWhitespace: value as RenderWhitespace,
                }))
              }
            >
              {(Object.keys(RENDER_WHITESPACE_LABEL) as RenderWhitespace[]).map(
                (option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {RENDER_WHITESPACE_LABEL[option]}
                  </DropdownMenuRadioItem>
                ),
              )}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={settings.wordWrap === "on"}
          onCheckedChange={(checked) =>
            setSettings((prev) => ({
              ...prev,
              wordWrap: checked ? "on" : "off",
            }))
          }
          onSelect={(event) => event.preventDefault()}
        >
          Word wrap
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={settings.minimap}
          onCheckedChange={(checked) =>
            setSettings((prev) => ({ ...prev, minimap: Boolean(checked) }))
          }
          onSelect={(event) => event.preventDefault()}
        >
          Minimap
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={settings.lineNumbers}
          onCheckedChange={(checked) =>
            setSettings((prev) => ({
              ...prev,
              lineNumbers: Boolean(checked),
            }))
          }
          onSelect={(event) => event.preventDefault()}
        >
          Line numbers
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setSettings(DEFAULT_MONACO_SETTINGS)}>
          <RotateCcw />
          <span>Reset to defaults</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
