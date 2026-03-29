export interface Theme {
  $schema?: string
  name: string
  type: string
  css?: Record<string, Record<string, string>>
  cssVars: {
    theme?: Record<string, string>
    light: Record<string, string>
    dark: Record<string, string>
  }
}

interface CachedTheme {
  theme: Theme
  timestamp: number
}

const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours
const CACHE_PREFIX = "tweakcn-theme:"

function getCacheKey(url: string): string {
  return `${CACHE_PREFIX}${url}`
}

function getCachedTheme(url: string): Theme | null {
  try {
    const cached = localStorage.getItem(getCacheKey(url))
    if (!cached) {
      return null
    }

    const parsed = JSON.parse(cached) as CachedTheme
    const isExpired = Date.now() - parsed.timestamp > CACHE_EXPIRY_MS

    if (isExpired) {
      localStorage.removeItem(getCacheKey(url))
      return null
    }

    return parsed.theme
  } catch (error) {
    console.warn("Failed to get cached theme:", error)
    return null
  }
}

function setCachedTheme(url: string, theme: Theme): void {
  try {
    const cached: CachedTheme = {
      theme,
      timestamp: Date.now(),
    }
    localStorage.setItem(getCacheKey(url), JSON.stringify(cached))
  } catch (error) {
    console.warn("Failed to cache theme:", error)
  }
}

export async function fetchTheme(url: string): Promise<Theme> {
  const cached = getCachedTheme(url)
  if (cached) {
    return cached
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch theme: ${response.statusText}`)
  }

  const theme = await response.json()
  setCachedTheme(url, theme)

  return theme
}

export async function fetchThemes(): Promise<Theme[]> {
  const promises = THEME_URLS.map((url) => fetchTheme(url))
  return Promise.all(promises)
}

export const THEME_URLS = [
  "https://tweakcn.com/r/themes/amber-minimal.json",
  "https://tweakcn.com/r/themes/amethyst-haze.json",
  "https://tweakcn.com/r/themes/bold-tech.json",
  "https://tweakcn.com/r/themes/bubblegum.json",
  "https://tweakcn.com/r/themes/caffeine.json",
  "https://tweakcn.com/r/themes/candyland.json",
  "https://tweakcn.com/r/themes/catppuccin.json",
  "https://tweakcn.com/r/themes/claude.json",
  "https://tweakcn.com/r/themes/claymorphism.json",
  "https://tweakcn.com/r/themes/clean-slate.json",
  "https://tweakcn.com/r/themes/cosmic-night.json",
  "https://tweakcn.com/r/themes/cyberpunk.json",
  "https://tweakcn.com/r/themes/darkmatter.json",
  "https://tweakcn.com/r/themes/doom-64.json",
  "https://tweakcn.com/r/themes/elegant-luxury.json",
  "https://tweakcn.com/r/themes/graphite.json",
  "https://tweakcn.com/r/themes/kodama-grove.json",
  "https://tweakcn.com/r/themes/midnight-bloom.json",
  "https://tweakcn.com/r/themes/mocha-mousse.json",
  "https://tweakcn.com/r/themes/modern-minimal.json",
  "https://tweakcn.com/r/themes/mono.json",
  "https://tweakcn.com/r/themes/nature.json",
  "https://tweakcn.com/r/themes/neo-brutalism.json",
  "https://tweakcn.com/r/themes/northern-lights.json",
  "https://tweakcn.com/r/themes/notebook.json",
  "https://tweakcn.com/r/themes/ocean-breeze.json",
  "https://tweakcn.com/r/themes/pastel-dreams.json",
  "https://tweakcn.com/r/themes/perpetuity.json",
  "https://tweakcn.com/r/themes/quantum-rose.json",
  "https://tweakcn.com/r/themes/retro-arcade.json",
  "https://tweakcn.com/r/themes/sage-garden.json",
  "https://tweakcn.com/r/themes/soft-pop.json",
  "https://tweakcn.com/r/themes/solar-dusk.json",
  "https://tweakcn.com/r/themes/starry-night.json",
  "https://tweakcn.com/r/themes/sunset-horizon.json",
  "https://tweakcn.com/r/themes/supabase.json",
  "https://tweakcn.com/r/themes/t3-chat.json",
  "https://tweakcn.com/r/themes/tangerine.json",
  "https://tweakcn.com/r/themes/twitter.json",
  "https://tweakcn.com/r/themes/vercel.json",
  "https://tweakcn.com/r/themes/vintage-paper.json",
  "https://tweakcn.com/r/themes/violet-bloom.json",
] as const
