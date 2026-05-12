import { Textarea } from "@g-spot/ui/components/textarea";
import { cn } from "@g-spot/ui/lib/utils";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
} from "react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  branch: string | null | undefined;
  disabled?: boolean;
};

const MIN_ROWS = 3;
const MAX_ROWS = 8;
const LINE_HEIGHT_PX = 18;

export function CommitBox({
  value,
  onChange,
  onSubmit,
  branch,
  disabled,
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollH = el.scrollHeight;
    const min = MIN_ROWS * LINE_HEIGHT_PX + 16;
    const max = MAX_ROWS * LINE_HEIGHT_PX + 16;
    el.style.height = `${Math.max(min, Math.min(max, scrollH))}px`;
  }, [value]);

  const firstLine = value.split("\n")[0] ?? "";
  const overSubject = firstLine.length > 50;
  const overHard = firstLine.length > 72;

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className="relative min-w-0 overflow-hidden">
      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        disabled={disabled}
        placeholder={
          branch
            ? `Message (⌘+Enter to commit on '${branch}')`
            : "Message (⌘+Enter to commit)"
        }
        className={cn(
          "resize-none rounded-md font-mono text-xs leading-[18px]",
          overHard && "border-destructive/50",
          !overHard && overSubject && "border-yellow-500/50",
        )}
      />
      {/* 50/72 ruler — absolute thin lines via ch units */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-2 left-3"
        style={{ width: "72ch" }}
      >
        <div
          className={cn(
            "absolute inset-y-0 w-px",
            overSubject ? "bg-yellow-500/40" : "bg-border/40",
          )}
          style={{ left: "50ch" }}
        />
        <div
          className={cn(
            "absolute inset-y-0 w-px",
            overHard ? "bg-destructive/60" : "bg-border/40",
          )}
          style={{ left: "72ch" }}
        />
      </div>
    </div>
  );
}
