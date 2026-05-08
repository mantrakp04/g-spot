import { monaco } from "./monaco-bootstrap";
import { useEffect, useState, useSyncExternalStore } from "react";

const LIGHT_THEME = "g-spot-light";
const DARK_THEME = "g-spot-dark";

/**
 * Read a CSS custom property and return its computed color as `#rrggbb`.
 * Uses a probe element so the browser resolves `oklch(...)`/`color-mix(...)`
 * for us; Monaco only accepts hex in `defineTheme`.
 */
function readCssColorAsHex(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const probe = document.createElement("div");
  probe.style.color = `var(${varName})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const m = rgb.match(/rgba?\(([^)]+)\)/);
  if (!m) return oklchToHex(rgb) ?? normalizeColorWithCanvas(rgb) ?? fallback;
  const parts = m[1].split(",").map((s) => Number.parseFloat(s.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return fallback;
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
}

function normalizeColorWithCanvas(color: string): string | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.fillStyle = color;
  const normalized = context.fillStyle;
  return normalized.startsWith("#") ? normalized : null;
}

function parseOklchComponent(value: string, scale: number): number | null {
  if (value === "none") return 0;
  if (value.endsWith("%")) return Number.parseFloat(value) / 100;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed / scale;
}

function parseHue(value: string): number | null {
  if (value === "none") return 0;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return null;
  if (value.endsWith("rad")) return (parsed * 180) / Math.PI;
  if (value.endsWith("turn")) return parsed * 360;
  return parsed;
}

function linearToSrgb(value: number): number {
  const clamped = Math.min(Math.max(value, 0), 1);
  if (clamped <= 0.0031308) return 12.92 * clamped;
  return 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function oklchToHex(color: string): string | null {
  const match = color.match(/^oklch\(([^)]+)\)$/i);
  if (!match) return null;
  const [rawLightness, rawChroma, rawHue] = match[1]
    .split("/")
    .at(0)!
    .trim()
    .split(/\s+/);
  if (!rawLightness || !rawChroma || !rawHue) return null;

  const lightness = parseOklchComponent(rawLightness, 1);
  const chroma = parseOklchComponent(rawChroma, 1);
  const hue = parseHue(rawHue);
  if (lightness === null || chroma === null || hue === null) return null;

  const hueRadians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(hueRadians);
  const b = chroma * Math.sin(hueRadians);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const red = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  const toHex = (value: number) =>
    Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

type MonacoThemePalette = {
  bg: string;
  fg: string;
  muted: string;
  mutedFg: string;
  accent: string;
  border: string;
  popover: string;
  primary: string;
  secondary: string;
  destructive: string;
};

function readPalette(): MonacoThemePalette {
  const bg = readCssColorAsHex("--background", "#1e1e1e");
  const fg = readCssColorAsHex("--foreground", "#d4d4d4");
  const muted = readCssColorAsHex("--muted", "#2a2a2a");
  const mutedFg = readCssColorAsHex("--muted-foreground", "#9a9a9a");
  const accent = readCssColorAsHex("--accent", "#3a3a3a");
  const border = readCssColorAsHex("--border", "#333333");
  const popover = readCssColorAsHex("--popover", bg);
  const primary = readCssColorAsHex("--primary", fg);
  const secondary = readCssColorAsHex("--secondary", accent);
  const destructive = readCssColorAsHex("--destructive", "#f87171");

  return {
    bg,
    fg,
    muted,
    mutedFg,
    accent,
    border,
    popover,
    primary,
    secondary,
    destructive,
  };
}

function buildColors({
  bg,
  fg,
  muted,
  mutedFg,
  accent,
  border,
  popover,
  primary,
}: MonacoThemePalette): monaco.editor.IColors {
  return {
    "editor.background": bg,
    "editor.foreground": fg,
    "editorLineNumber.foreground": mutedFg,
    "editorLineNumber.activeForeground": fg,
    "editorCursor.foreground": primary,
    "editor.selectionBackground": `${primary}55`,
    "editor.inactiveSelectionBackground": `${accent}55`,
    "editor.lineHighlightBackground": `${muted}80`,
    "editor.lineHighlightBorder": `${muted}00`,
    "editorWhitespace.foreground": mutedFg,
    "editorIndentGuide.background": border,
    "editorIndentGuide.activeBackground": border,
    "editorWidget.background": popover,
    "editorWidget.border": border,
    "editorSuggestWidget.background": popover,
    "editorSuggestWidget.border": border,
    "editorSuggestWidget.foreground": fg,
    "editorSuggestWidget.selectedBackground": accent,
    "scrollbarSlider.background": `${border}aa`,
    "scrollbarSlider.hoverBackground": `${border}cc`,
    "scrollbarSlider.activeBackground": `${border}ff`,
    "editorGutter.background": bg,
  };
}

function withoutHash(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

/**
 * Custom token rules. Intentionally narrow — we only define the `diff.*`
 * tokens we registered ourselves in `monaco-bootstrap.ts`. Every other
 * language token (keyword, type, string, number, comment, ...) inherits
 * from the base `vs` / `vs-dark` theme so syntax highlighting stays rich
 * and distinguishable.
 *
 * Earlier this function tried to drive everything through a handful of
 * design tokens (--primary, --secondary, --muted-foreground). On themes
 * with a grayscale palette that flattened all syntax to one or two colors
 * and made code unreadable.
 */
const DIFF_INSERTED_DARK = "4ade80";
const DIFF_INSERTED_LIGHT = "16a34a";
const DIFF_DELETED_DARK = "f87171";
const DIFF_DELETED_LIGHT = "dc2626";

function buildRules(
  { mutedFg }: MonacoThemePalette,
  resolved: "light" | "dark",
): monaco.editor.ITokenThemeRule[] {
  const inserted = resolved === "dark" ? DIFF_INSERTED_DARK : DIFF_INSERTED_LIGHT;
  const deleted = resolved === "dark" ? DIFF_DELETED_DARK : DIFF_DELETED_LIGHT;
  return [
    { token: "diff.header", foreground: withoutHash(mutedFg), fontStyle: "bold" },
    { token: "diff.meta", foreground: withoutHash(mutedFg) },
    { token: "diff.range", foreground: withoutHash(mutedFg), fontStyle: "bold" },
    { token: "diff.inserted", foreground: inserted },
    { token: "diff.deleted", foreground: deleted },
  ];
}

export function applyMonacoTheme(resolved: "light" | "dark"): string {
  const name = resolved === "dark" ? DARK_THEME : LIGHT_THEME;
  const palette = readPalette();
  monaco.editor.defineTheme(name, {
    base: resolved === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: buildRules(palette, resolved),
    colors: buildColors(palette),
  });
  monaco.editor.setTheme(name);
  return name;
}

function subscribeToThemeVars(onStoreChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};

  let frame: number | null = null;
  const notify = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      onStoreChange();
    });
  };

  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  window.addEventListener("storage", notify);

  return () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("storage", notify);
  };
}

function getThemeVarsSnapshot(): string {
  if (typeof document === "undefined") return "";
  const root = document.documentElement;
  return `${root.className}:${root.getAttribute("style") ?? ""}`;
}

export function useMonacoTheme(resolved: "light" | "dark", active = true): string {
  const themeVarsSnapshot = useSyncExternalStore(
    active ? subscribeToThemeVars : () => () => {},
    active ? getThemeVarsSnapshot : () => "",
    () => "",
  );
  const [themeName, setThemeName] = useState(() =>
    resolved === "dark" ? "vs-dark" : "vs",
  );

  useEffect(() => {
    if (!active) return;
    setThemeName(applyMonacoTheme(resolved));
  }, [active, resolved, themeVarsSnapshot]);

  return themeName;
}
