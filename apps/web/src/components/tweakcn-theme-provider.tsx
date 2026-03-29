
import * as React from "react"
import type { Theme } from "@/lib/tweakcn"

type ThemeMode = "light" | "dark" | "system"

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  resolvedTheme: "light" | "dark"
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined)

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: ThemeMode
  storageKey?: string
  attribute?: string
  enableSystem?: boolean
}

// ── Inline-style theme application ──────────────────────────────────
// Inline styles on <html> have specificity 1-0-0-0 and always beat
// @theme inline, :root rules, and anything Vite HMR re-injects.

const THEME_STORAGE_KEY = "theme-config"
const APPLIED_PROPS_KEY = "tweakcn-applied-props"

function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as Theme
  } catch {
    return null
  }
}

function clearInlineVars() {
  const root = document.documentElement
  try {
    const stored = sessionStorage.getItem(APPLIED_PROPS_KEY)
    if (stored) {
      for (const prop of JSON.parse(stored) as string[]) {
        root.style.removeProperty(prop)
      }
    }
  } catch { /* noop */ }
  sessionStorage.removeItem(APPLIED_PROPS_KEY)
}

function applyInlineVars(theme: Theme) {
  clearInlineVars()
  const root = document.documentElement
  const isDark = root.classList.contains("dark")
  const props: string[] = []

  const set = (k: string, v: string) => {
    root.style.setProperty(k, v)
    props.push(k)
  }

  // Shared vars (fonts, radius, spacing — mode-independent)
  if (theme.cssVars.theme) {
    for (const [k, v] of Object.entries(theme.cssVars.theme)) {
      set(`--${k}`, v)
    }
  }

  // Mode-specific vars (colors etc.)
  const modeVars = isDark ? theme.cssVars.dark : theme.cssVars.light
  for (const [k, v] of Object.entries(modeVars)) {
    set(`--${k}`, v)
  }

  // Derived radius tokens (Tailwind @theme inline bakes these at build time)
  const radius = modeVars.radius || theme.cssVars.theme?.radius
  if (radius) {
    set("--radius-sm", `calc(${radius} - 4px)`)
    set("--radius-md", `calc(${radius} - 2px)`)
    set("--radius-lg", radius)
    set("--radius-xl", `calc(${radius} + 4px)`)
    set("--radius-2xl", `calc(${radius} + 8px)`)
    set("--radius-3xl", `calc(${radius} + 12px)`)
    set("--radius-4xl", `calc(${radius} + 16px)`)
  }

  // Derived tracking tokens
  const tn = modeVars["tracking-normal"] || theme.cssVars.theme?.["tracking-normal"]
  if (tn) {
    set("--tracking-tighter", `calc(${tn} - 0.05em)`)
    set("--tracking-tight", `calc(${tn} - 0.025em)`)
    set("--tracking-normal", tn)
    set("--tracking-wide", `calc(${tn} + 0.025em)`)
    set("--tracking-wider", `calc(${tn} + 0.05em)`)
    set("--tracking-widest", `calc(${tn} + 0.1em)`)
  }

  sessionStorage.setItem(APPLIED_PROPS_KEY, JSON.stringify(props))
}

// ── FOUC-prevention inline script ───────────────────────────────────

const themeScript = (storageKey: string, defaultTheme: string, attribute: string, enableSystem: boolean) => {
  const el = document.documentElement
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"

  let theme: string
  try {
    theme = localStorage.getItem(storageKey) || defaultTheme
  } catch {
    theme = defaultTheme
  }

  const resolved = theme === "system" && enableSystem ? systemTheme : theme

  if (attribute === "class") {
    el.classList.remove("light", "dark")
    el.classList.add(resolved)
  } else {
    el.setAttribute(attribute, resolved)
  }
  el.style.colorScheme = resolved

  // Apply stored TweakCN theme as inline styles
  try {
    const stored = localStorage.getItem("theme-config")
    if (stored) {
      const tc = JSON.parse(stored)
      if (tc?.cssVars) {
        const isDark = resolved === "dark"
        const set = (k: string, v: string) => { el.style.setProperty(k, v) }

        if (tc.cssVars.theme) {
          for (const [k, v] of Object.entries(tc.cssVars.theme) as [string, string][]) {
            set(`--${k}`, v)
          }
        }
        const mv = isDark ? tc.cssVars.dark : tc.cssVars.light
        if (mv) {
          for (const [k, v] of Object.entries(mv) as [string, string][]) {
            set(`--${k}`, v)
          }
        }
        const r = mv?.radius || tc.cssVars.theme?.radius
        if (r) {
          set("--radius-sm", "calc(" + r + " - 4px)")
          set("--radius-md", "calc(" + r + " - 2px)")
          set("--radius-lg", r)
          set("--radius-xl", "calc(" + r + " + 4px)")
          set("--radius-2xl", "calc(" + r + " + 8px)")
          set("--radius-3xl", "calc(" + r + " + 12px)")
          set("--radius-4xl", "calc(" + r + " + 16px)")
        }
        const tn = mv?.["tracking-normal"] || tc.cssVars.theme?.["tracking-normal"]
        if (tn) {
          set("--tracking-tighter", "calc(" + tn + " - 0.05em)")
          set("--tracking-tight", "calc(" + tn + " - 0.025em)")
          set("--tracking-normal", tn)
          set("--tracking-wide", "calc(" + tn + " + 0.025em)")
          set("--tracking-wider", "calc(" + tn + " + 0.05em)")
          set("--tracking-widest", "calc(" + tn + " + 0.1em)")
        }
      }
    }
  } catch {
    // Ignore theme loading errors
  }
}

export function ThemeScript({
  storageKey = "theme",
  defaultTheme = "dark",
  attribute = "class",
  enableSystem = true,
}: Omit<ThemeProviderProps, "children">) {
  const scriptArgs = JSON.stringify([storageKey, defaultTheme, attribute, enableSystem])
  return (
    <script
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `(${themeScript.toString()})(${scriptArgs.slice(1, -1)})`,
      }}
    />
  )
}

// ── ThemeProvider ───────────────────────────────────────────────────

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "theme",
  attribute = "class",
  enableSystem = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<ThemeMode>(defaultTheme)
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">("dark")

  const getSystemTheme = React.useCallback((): "light" | "dark" => {
    if (typeof window === "undefined") return "light"
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }, [])

  const applyTheme = React.useCallback((resolved: "light" | "dark") => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    if (attribute === "class") {
      root.classList.remove("light", "dark")
      root.classList.add(resolved)
    } else {
      root.setAttribute(attribute, resolved)
    }
  }, [attribute])

  React.useEffect(() => {
    const stored = localStorage.getItem(storageKey) as ThemeMode | null
    if (stored && ["light", "dark", "system"].includes(stored)) {
      setThemeState(stored)
    }
  }, [storageKey])

  React.useEffect(() => {
    const resolved = theme === "system" ? getSystemTheme() : theme
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [theme, getSystemTheme, applyTheme])

  React.useEffect(() => {
    if (!enableSystem || theme !== "system") return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      const resolved = getSystemTheme()
      setResolvedTheme(resolved)
      applyTheme(resolved)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme, enableSystem, getSystemTheme, applyTheme])

  const setTheme = React.useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme)
    localStorage.setItem(storageKey, newTheme)
  }, [storageKey])

  const value = React.useMemo(() => ({
    theme,
    setTheme,
    resolvedTheme,
  }), [theme, setTheme, resolvedTheme])

  // Apply TweakCN theme + re-apply on light/dark class changes
  React.useLayoutEffect(() => {
    const storedTheme = getStoredTheme()
    if (storedTheme) {
      applyInlineVars(storedTheme)
    }

    const observer = new MutationObserver(() => {
      const t = getStoredTheme()
      if (t) applyInlineVars(t)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

// ── useTweakCNThemes hook ──────────────────────────────────────────

export function useTweakCNThemes() {
  const [currentTheme, setCurrentTheme] = React.useState<Theme | null>(getStoredTheme)

  const applyTheme = React.useCallback((theme: Theme | null) => {
    if (typeof window === "undefined") return

    if (theme) {
      applyInlineVars(theme)
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
      setCurrentTheme(theme)
    } else {
      clearInlineVars()
      localStorage.removeItem(THEME_STORAGE_KEY)
      setCurrentTheme(null)
    }
  }, [])

  return {
    currentTheme,
    applyTheme,
    setTheme: applyTheme,
  }
}
