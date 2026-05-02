import { motion } from "motion/react";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  CornerDownRight,
  FileText,
  Hash,
  Mail,
  Sparkles,
  Tag,
  Timer,
} from "lucide-react";

const cardClass =
  "relative w-full max-w-md overflow-hidden rounded-xl border border-border/60 bg-card/60 p-5 shadow-sm backdrop-blur-sm";

export function MemoryVisual() {
  const nodes = [
    { id: "you", label: "You", x: 50, y: 50, primary: true },
    { id: "pi", label: "Pi", x: 22, y: 22 },
    { id: "gmail", label: "Gmail", x: 80, y: 24 },
    { id: "repo", label: "g-spot", x: 18, y: 78 },
    { id: "note", label: "specs.md", x: 82, y: 78 },
  ];
  const edges = [
    ["you", "pi"],
    ["you", "gmail"],
    ["you", "repo"],
    ["you", "note"],
    ["pi", "note"],
  ] as const;

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <div className={cardClass}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Memory graph
        </p>
        <span className="text-[10px] text-muted-foreground/70">12 facts</span>
      </div>
      <div className="relative aspect-[4/3] w-full">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {edges.map(([a, b], i) => {
            const na = byId[a]!;
            const nb = byId[b]!;
            return (
              <motion.line
                key={`${a}-${b}`}
                x1={na.x}
                y1={na.y}
                x2={nb.x}
                y2={nb.y}
                stroke="currentColor"
                strokeWidth={0.4}
                className="text-primary/40"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.2 + i * 0.15 }}
              />
            );
          })}
        </svg>
        {nodes.map((node, i) => (
          <motion.div
            key={node.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 + i * 0.12, type: "spring", stiffness: 300, damping: 20 }}
          >
            <div
              className={
                node.primary
                  ? "flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary"
                  : "flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2 py-1 text-[10px] text-foreground/80"
              }
            >
              <motion.span
                className={
                  node.primary
                    ? "size-1.5 rounded-full bg-primary"
                    : "size-1 rounded-full bg-muted-foreground/60"
                }
                animate={node.primary ? { scale: [1, 1.4, 1], opacity: [1, 0.7, 1] } : undefined}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
              {node.label}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function DiffLine({
  num,
  kind,
  text,
  delay,
  highlighted,
}: {
  num: number;
  kind: "ctx" | "add" | "del";
  text: string;
  delay: number;
  highlighted?: boolean;
}) {
  const tone =
    kind === "add"
      ? "bg-emerald-500/10 text-emerald-300"
      : kind === "del"
        ? "bg-rose-500/10 text-rose-300"
        : "text-muted-foreground";
  const sigil = kind === "add" ? "+" : kind === "del" ? "-" : " ";
  return (
    <motion.div
      className={`flex items-stretch gap-2 ${tone} ${highlighted ? "ring-1 ring-inset ring-primary/40" : ""}`}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
    >
      <span className="w-6 shrink-0 select-none border-r border-border/40 px-1 text-right text-[10px] tabular-nums text-muted-foreground/50">
        {num}
      </span>
      <span className="w-3 shrink-0 select-none text-center opacity-60">
        {sigil}
      </span>
      <span className="min-w-0 truncate pr-2">{text}</span>
    </motion.div>
  );
}

export function ReviewsVisual() {
  return (
    <div className={cardClass}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FileText className="size-3" />
        <span className="font-mono">apps/web/src/inbox-list.tsx</span>
      </div>

      <div className="overflow-hidden rounded-md border border-border/50 bg-background/40 font-mono text-[11px] leading-[1.55]">
        <div className="border-b border-border/40 bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground/70">
          @@ -42,6 +42,7 @@ function InboxList()
        </div>
        <div className="py-1">
          <DiffLine num={42} kind="ctx" text="export function InboxList() {" delay={0.05} />
          <DiffLine num={43} kind="ctx" text="  const items = useInbox();" delay={0.12} />
          <DiffLine num={44} kind="del" text="  return items.map((row) => <Row …/>);" delay={0.2} />
          <DiffLine
            num={44}
            kind="add"
            text='  return <Virtuoso data={items} itemContent={…} />;'
            delay={0.32}
            highlighted
          />
          <DiffLine num={45} kind="ctx" text="}" delay={0.4} />
        </div>

        <motion.div
          className="border-t border-border/40 bg-card/60 p-2"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ delay: 0.65, duration: 0.35 }}
        >
          <div className="rounded-md border border-border/60 bg-card">
            <div className="flex items-center justify-between border-b border-border/40 px-2.5 py-1.5 text-[10px]">
              <div className="flex items-center gap-1.5">
                <div className="size-4 rounded-full bg-gradient-to-br from-primary/70 to-fuchsia-500/70" />
                <span className="font-medium text-foreground">you</span>
                <span className="text-muted-foreground/70">commented</span>
              </div>
              <span className="text-muted-foreground/60">pending</span>
            </div>
            <div className="px-2.5 py-1.5 text-[11px] leading-snug">
              Set <code className="rounded bg-muted/50 px-1">overscan</code> so
              we don't flicker on fast scroll.
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        className="mt-3 flex items-center justify-end gap-2"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 }}
      >
        <motion.div
          className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-[10px] text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.05 }}
        >
          <CheckCircle2 className="size-3 text-emerald-500" />
          Approve
        </motion.div>
        <motion.div
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.15, type: "spring", stiffness: 360, damping: 22 }}
        >
          <span className="flex size-3.5 items-center justify-center rounded bg-white/20 text-[9px] font-semibold">
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.3 }}
            >
              3
            </motion.span>
          </span>
          Finish review
          <ChevronDown className="size-3 opacity-80" />
        </motion.div>
      </motion.div>
    </div>
  );
}

export function WorkflowsVisual() {
  const actions = [
    { id: "label", icon: Tag, label: "Label: Customer", color: "text-blue-400" },
    { id: "draft", icon: Sparkles, label: "Draft reply with Pi", color: "text-fuchsia-400" },
    { id: "snooze", icon: Timer, label: "Snooze 2h", color: "text-amber-400" },
  ];
  return (
    <div className={cardClass}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Workflow
        </p>
        <span className="text-[10px] text-muted-foreground/70">on:new mail</span>
      </div>
      <motion.div
        className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 p-2.5"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-[11px] font-medium">
            sara@acme.com — quick question about pricing
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            Hey! Wondering if your Pro plan covers…
          </p>
        </div>
      </motion.div>
      <div className="my-2 ml-3 flex h-4 w-px bg-border/60" />
      <div className="space-y-1.5">
        {actions.map((action, i) => {
          const Icon = action.icon;
          return (
            <motion.div
              key={action.id}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-card/80 px-2.5 py-1.5"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.2 }}
            >
              <CornerDownRight className="size-3 text-muted-foreground/60" />
              <Icon className={`size-3.5 ${action.color}`} />
              <span className="text-[11px]">{action.label}</span>
              <motion.span
                className="ml-auto text-[10px] text-emerald-500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 + i * 0.2 }}
              >
                ✓
              </motion.span>
            </motion.div>
          );
        })}
      </div>
      <motion.div
        className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
      >
        <Bell className="size-3" />
        Ran in 240ms
      </motion.div>
    </div>
  );
}

export function NotesVisual() {
  return (
    <div className={cardClass}>
      <div className="mb-3 flex items-center gap-2">
        <FileText className="size-3.5 text-muted-foreground" />
        <p className="text-[12px] font-medium">daily/2026-04-28.md</p>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Hash className="size-3" />
          standup
        </span>
      </div>
      <div className="space-y-2 font-mono text-[11px] leading-relaxed">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          ## Today
        </motion.p>
        <motion.p
          className="text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          - Reviewed{" "}
          <motion.span
            className="rounded bg-primary/10 px-1 text-primary"
            initial={{ backgroundColor: "rgba(0,0,0,0)" }}
            animate={{ backgroundColor: "rgba(99,102,241,0.15)" }}
            transition={{ delay: 0.55 }}
          >
            [[PR-482]]
          </motion.span>{" "}
          with Pi
        </motion.p>
        <motion.p
          className="text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          - Drafted reply to{" "}
          <span className="rounded bg-primary/10 px-1 text-primary">
            [[sara@acme]]
          </span>
        </motion.p>
      </div>
      <motion.div
        className="mt-4 rounded-md border border-border/50 bg-background/40 p-2.5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.85 }}
      >
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Backlinks
        </p>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px]">
            <FileText className="size-3 text-muted-foreground/70" />
            <span className="text-muted-foreground">weekly/w17.md</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <FileText className="size-3 text-muted-foreground/70" />
            <span className="text-muted-foreground">projects/inbox.md</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
