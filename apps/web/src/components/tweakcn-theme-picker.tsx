
import * as React from "react"
import { useTheme } from "@/components/tweakcn-theme-provider"
import {
  Check,
  Import,
  Laptop,
  Loader2,
  Moon,
  Palette,
  Search,
  Shuffle,
  Sun,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@g-spot/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu"
import { Input } from "@g-spot/ui/components/input"
import { ScrollArea } from "@g-spot/ui/components/scroll-area"
import { cn } from "@g-spot/ui/lib/utils"
import { useTweakCNThemes } from "@/components/tweakcn-theme-provider"
import {
  fetchTheme,
  fetchThemes,
  normalizeThemeUrl,
  type Theme,
} from "@/lib/tweakcn"

interface SavedThemeEntry {
  url: string
  theme: Theme
}

interface ThemePickerProps {
  themes?: Theme[]
  className?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  sideOffset?: number
  compact?: boolean
}

const SAVED_THEMES_KEY = "tweakcn-saved-themes"

function getSavedThemes(): SavedThemeEntry[] {
  if (typeof window === "undefined") return []
  try {
    const saved = localStorage.getItem(SAVED_THEMES_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

function saveSavedThemes(themes: SavedThemeEntry[]) {
  if (typeof window === "undefined") return
  localStorage.setItem(SAVED_THEMES_KEY, JSON.stringify(themes))
}

function formatThemeName(name: string): string {
  return name
    .replace(/-/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase())
}

function ThemeColorDots({ theme }: { theme: Theme }) {
  const colors = [
    theme.cssVars.light.primary || "oklch(0.5 0.2 250)",
    theme.cssVars.light.secondary || "oklch(0.9 0.02 250)",
    theme.cssVars.light.accent || "oklch(0.95 0.02 250)",
    theme.cssVars.light.muted || "oklch(0.95 0.01 250)",
  ].map((value, index) => ({
    key: `color-${index}`,
    value,
  }));

  return (
    <div className="flex items-center gap-0.5">
      {colors.map((color) => (
        <div
          key={color.key}
          className="h-3 w-3 rounded-full border border-border/50"
          style={{ background: color.value }}
        />
      ))}
    </div>
  )
}

export function ThemePicker({
  themes: additionalThemes = [],
  className,
  side,
  align = "end",
  sideOffset,
  compact = false,
}: ThemePickerProps) {
  const { currentTheme, setTheme: setTweakCNTheme } = useTweakCNThemes()
  const { theme: themeMode, setTheme: setThemeMode } = useTheme()
  const [isOpen, setIsOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [showImport, setShowImport] = React.useState(false)
  const [importUrl, setImportUrl] = React.useState("")
  const [isImporting, setIsImporting] = React.useState(false)
  const [importError, setImportError] = React.useState<string | null>(null)
  const [savedThemes, setSavedThemes] = React.useState<SavedThemeEntry[]>([])
  const [fetchedThemes, setFetchedThemes] = React.useState<Theme[]>([])
  const [isLoadingThemes, setIsLoadingThemes] = React.useState(true)

  React.useEffect(() => {
    setMounted(true)
    setSavedThemes(getSavedThemes())

    // Fetch themes internally
    fetchThemes()
      .then(setFetchedThemes)
      .catch((error) => {
        console.error("Failed to load themes:", error)
        setFetchedThemes([])
      })
      .finally(() => {
        setIsLoadingThemes(false)
      })
  }, [])

  // Combine fetched themes with additional themes provided by user
  const themes = React.useMemo(() => {
    const allThemes = [...fetchedThemes, ...additionalThemes]
    // Remove duplicates based on theme name
    const uniqueThemes = allThemes.reduce((acc, theme) => {
      if (!acc.find(t => t.name === theme.name)) {
        acc.push(theme)
      }
      return acc
    }, [] as Theme[])
    return uniqueThemes
  }, [fetchedThemes, additionalThemes])

  const handleThemeSelect = (theme: Theme) => {
    setTweakCNTheme(theme)
  }

  const handleRandomTheme = () => {
    const allThemes = [...themes, ...savedThemes.map(s => s.theme)]
    if (allThemes.length === 0) return
    const randomIndex = Math.floor(Math.random() * allThemes.length)
    setTweakCNTheme(allThemes[randomIndex])
  }

  const handleClearTheme = () => {
    setTweakCNTheme(null)
  }

  const handleImportTheme = async () => {
    if (!importUrl.trim()) return

    setIsImporting(true)
    setImportError(null)

    try {
      const url = new URL(importUrl.trim())
      if (!url.hostname.includes("tweakcn.com")) {
        throw new Error("Only tweakcn.com URLs are supported")
      }

      const themeUrl = normalizeThemeUrl(importUrl.trim())

      if (savedThemes.some(s => normalizeThemeUrl(s.url) === themeUrl)) {
        throw new Error("Theme already imported")
      }

      const theme = await fetchTheme(themeUrl)
      const newEntry: SavedThemeEntry = { url: themeUrl, theme }
      const updated = [...savedThemes, newEntry]
      setSavedThemes(updated)
      saveSavedThemes(updated)
      setImportUrl("")
      setShowImport(false)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import theme")
    } finally {
      setIsImporting(false)
    }
  }

  const handleDeleteSavedTheme = (url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = savedThemes.filter(s => s.url !== url)
    setSavedThemes(updated)
    saveSavedThemes(updated)
  }

  const filteredThemes = themes.filter((theme) =>
    theme.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredSavedThemes = savedThemes.filter((entry) =>
    entry.theme.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalThemes = filteredThemes.length + filteredSavedThemes.length
  const normalizedThemeMode =
    themeMode === "light" || themeMode === "dark" || themeMode === "system"
      ? themeMode
      : "system"

  const nextThemeMode =
    normalizedThemeMode === "system"
      ? "light"
      : normalizedThemeMode === "light"
        ? "dark"
        : "system"

  const themeModeLabel =
    normalizedThemeMode === "system"
      ? "System"
      : normalizedThemeMode === "light"
        ? "Light"
        : "Dark"

  if (!mounted || isLoadingThemes) {
    return (
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "sm"}
        className={cn(compact ? "text-muted-foreground" : "gap-2", className)}
        disabled
        aria-label={compact ? "Theme" : undefined}
      >
        <Palette className="h-4 w-4" />
        {!compact && "Loading..."}
      </Button>
    )
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant={compact ? "ghost" : "outline"}
            size={compact ? "icon-sm" : "sm"}
            className={cn(compact ? "text-muted-foreground hover:text-foreground" : "gap-2", className)}
            aria-label={compact ? (currentTheme ? formatThemeName(currentTheme.name) : "Theme") : undefined}
            title={compact ? (currentTheme ? formatThemeName(currentTheme.name) : "Theme") : undefined}
          />
        }
      >
        <Palette className="h-4 w-4 shrink-0" />
        {!compact && (
          <span className="truncate">{currentTheme ? formatThemeName(currentTheme.name) : "Choose TweakCN Theme"}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} sideOffset={sideOffset} className="w-[280px] p-0">
        {/* Search Input */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search themes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-sm"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>

        {/* Header with count and random button */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm text-muted-foreground">
            {totalThemes} themes
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setThemeMode(nextThemeMode)
              }}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title={`Theme: ${themeModeLabel} (click to switch)`}
              aria-label={`Theme: ${themeModeLabel}. Click to switch.`}
              type="button"
            >
              {normalizedThemeMode === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : normalizedThemeMode === "light" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Laptop className="h-4 w-4" />
              )}
            </button>
            {currentTheme && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleClearTheme()
                }}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Clear theme"
                aria-label="Clear current theme"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleRandomTheme()
              }}
              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Random theme"
              aria-label="Randomize theme"
              type="button"
            >
              <Shuffle className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Saved Themes Section */}
        <div className="px-3 py-2 border-b border-border">
          {!showImport ? (
            <div className="flex items-center justify-between">
              {savedThemes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  <a
                    href="https://tweakcn.com/editor/theme"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Import
                  </a>{" "}
                  a theme to find it here.
                </p>
              ) : (
                <p className="text-xs font-medium text-muted-foreground">
                  Saved Themes
                </p>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowImport(true)
                  setImportError(null)
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Import className="h-3 w-3" />
                Import
              </button>
            </div>
          ) : (
            <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  Import Theme URL
                </p>
                <button
                  onClick={() => {
                    setShowImport(false)
                    setImportUrl("")
                    setImportError(null)
                  }}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input
                placeholder="https://tweakcn.com/r/themes/..."
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                className="h-7 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleImportTheme()
                  }
                }}
              />
              {importError && (
                <p className="text-xs text-destructive">{importError}</p>
              )}
              <Button
                size="sm"
                className="w-full h-7 text-xs"
                onClick={handleImportTheme}
                disabled={isImporting || !importUrl.trim()}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Importing...
                  </>
                ) : (
                  "Import Theme"
                )}
              </Button>
            </div>
          )}

          {/* Saved Themes List */}
          {savedThemes.length > 0 && !showImport && (
            <div className="mt-2 space-y-0.5">
              {filteredSavedThemes.map((entry) => {
                const isSelected = currentTheme?.name === entry.theme.name
                return (
                  <button
                    key={entry.url}
                    type="button"
                    onClick={() => handleThemeSelect(entry.theme)}
                    className={cn(
                      "relative flex w-full items-center gap-2 px-1 py-1.5 rounded-sm text-sm group text-left",
                      "hover:bg-secondary/50 transition-colors",
                      isSelected && "bg-accent text-accent-foreground"
                    )}
                  >
                    <ThemeColorDots theme={entry.theme} />
                    <span className="flex-1 truncate text-xs">{formatThemeName(entry.theme.name)}</span>
                    {isSelected ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => handleDeleteSavedTheme(entry.url, e)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            handleDeleteSavedTheme(entry.url, e as unknown as React.MouseEvent)
                          }
                        }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                        title="Remove theme"
                      >
                        <Trash2 className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Built-in Themes Section */}
        <div className="px-2 py-1.5">
          <p className="px-1 mb-1 text-xs font-medium text-muted-foreground">
            Built-in Themes
          </p>
        </div>

        <ScrollArea className="h-[300px]">
          <div className="pb-1">
            {filteredThemes.map((theme) => {
              const isSelected = currentTheme?.name === theme.name
              return (
                <button
                  key={theme.name}
                  type="button"
                  onClick={() => handleThemeSelect(theme)}
                  className={cn(
                    "relative flex w-full items-center gap-2 px-2 py-2 mx-1 rounded-sm text-sm text-left",
                    "hover:bg-secondary/50 transition-colors",
                    isSelected && "bg-accent text-accent-foreground"
                  )}
                >
                  <ThemeColorDots theme={theme} />
                  <span className="flex-1 truncate">{formatThemeName(theme.name)}</span>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0" />
                  )}
                </button>
              )
            })}

            {filteredThemes.length === 0 && filteredSavedThemes.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No themes found
              </div>
            )}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
