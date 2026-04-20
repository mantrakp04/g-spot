import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";

type Shortcut = {
  keys: string[];
  label: string;
  soon?: boolean;
};

const SHORTCUTS: Shortcut[] = [
  { keys: ["j"], label: "Next file" },
  { keys: ["k"], label: "Previous file" },
  { keys: ["["], label: "Previous PR in stack" },
  { keys: ["]"], label: "Next PR in stack" },
  { keys: ["c"], label: "Add comment", soon: true },
  { keys: ["v"], label: "Toggle viewed on focused file", soon: true },
  { keys: ["s"], label: "Toggle split / unified diff" },
  { keys: ["e"], label: "Expand / collapse all files", soon: true },
  { keys: ["/"], label: "Focus file search", soon: true },
  { keys: ["?"], label: "Show this help" },
  { keys: ["⌘", "↵"], label: "Submit review", soon: true },
];

export function KeyboardOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Quick navigation for reviewing pull requests and issues.
          </DialogDescription>
        </DialogHeader>
        <ul className="mt-1 space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li
              key={s.keys.join("+") + s.label}
              className="flex items-center justify-between gap-3 text-[12px]"
            >
              <div className="flex items-center gap-1.5 text-foreground">
                {s.label}
                {s.soon ? (
                  <span className="rounded-sm border border-border/50 bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
                    soon
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
