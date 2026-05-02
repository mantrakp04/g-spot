import { ThemePicker } from "@/components/tweakcn-theme-picker";

export function ThemeStep() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Make it yours</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a theme so the rest of g-spot looks like your app. You can change
          it anytime from the sidebar.
        </p>
      </div>
      <div className="rounded-lg border border-border/60 bg-card p-6">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Theme
        </p>
        <ThemePicker />
        <p className="mt-3 text-[12px] text-muted-foreground">
          Browse built-in themes or import any tweakcn.com theme by URL.
        </p>
      </div>
    </div>
  );
}
