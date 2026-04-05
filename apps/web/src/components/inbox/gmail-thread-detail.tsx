import { useRef, useEffect, useCallback, useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@g-spot/ui/components/alert-dialog";
import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { Checkbox } from "@g-spot/ui/components/checkbox";
import { Separator } from "@g-spot/ui/components/separator";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import type { OAuthConnection } from "@stackframe/react";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Forward,
  Loader2,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  Trash2,
  X,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { useLinkWarningDismissed } from "@/hooks/use-link-warning";
import {
  useGmailComposeDraft,
  useGmailThreadActions,
  useGmailThreadDrafts,
} from "@/hooks/use-gmail-actions";
import { useDrafts } from "@/contexts/drafts-context";
import { ComposeInline } from "./compose-inline";
import { GmailSenderAvatar } from "./gmail-sender-avatar";
import type {
  ComposeMode,
  GmailThread,
  GmailFullMessage,
} from "@/lib/gmail/types";
import type { GmailThreadDetail as GmailThreadDetailType } from "@/lib/gmail/types";

function formatFullDate(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseRgbColor(value: string): [number, number, number] | null {
  const match = value.match(/\d+(\.\d+)?/g);
  if (!match || match.length < 3) return null;

  return [
    Number(match[0]),
    Number(match[1]),
    Number(match[2]),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );

  return (lighter + 0.05) / (darker + 0.05);
}

function stripHtmlTags(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

function buildQuotedText(msg: GmailFullMessage): string {
  const content = msg.bodyText ?? (msg.bodyHtml ? stripHtmlTags(msg.bodyHtml) : "");
  return content
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function prefixSubject(subject: string, prefix: "Re" | "Fwd"): string {
  const re = new RegExp(`^${prefix}:\\s*`, "i");
  if (re.test(subject)) return subject;
  return `${prefix}: ${subject}`;
}

function filterOutEmail(addresses: string, exclude: string): string {
  return addresses
    .split(",")
    .map((a) => a.trim())
    .filter((a) => {
      const match = a.match(/<(.+?)>/);
      const email = match ? match[1] : a;
      return email.toLowerCase() !== exclude.toLowerCase();
    })
    .join(", ");
}

function MessageBody({ html, text }: { html: string | null; text: string | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const { dismissed, dismiss } = useLinkWarningDismissed();
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;

  useEffect(() => {
    if (!html || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    const root = document.documentElement;
    const rootStyles = getComputedStyle(root);
    const isDark = root.classList.contains("dark");

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="color-scheme" content="${isDark ? "dark" : "light"}">
        <style>
          :root {
            color-scheme: ${isDark ? "dark" : "light"};
          }
          html {
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            background: var(--background);
            overflow-x: hidden;
            overflow-y: hidden;
          }
          body {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            background: var(--background);
            color: var(--foreground);
            overflow-wrap: break-word;
            word-break: break-word;
            overflow-x: hidden;
            overflow-y: hidden;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
          }
          *, *::before, *::after {
            box-sizing: border-box;
          }
          img, video, canvas, svg, table, iframe {
            max-width: 100%;
          }
          img { height: auto; }
          pre {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          table {
            width: auto !important;
            border-collapse: collapse;
          }
          a { color: var(--primary); cursor: pointer; }
          blockquote {
            margin: 8px 0;
            padding-left: 12px;
            border-left: 3px solid var(--border);
            color: var(--muted-foreground);
          }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `);
    doc.close();

    doc.documentElement.className = root.className;

    for (let i = 0; i < rootStyles.length; i += 1) {
      const property = rootStyles.item(i);
      if (!property.startsWith("--")) continue;

      const value = rootStyles.getPropertyValue(property);
      if (value) {
        doc.documentElement.style.setProperty(property, value);
      }
    }

    const themedBackground =
      parseRgbColor(doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? "") ??
      [255, 255, 255];

    const elements = Array.from(doc.body.querySelectorAll<HTMLElement>("*"));
    for (const element of elements) {
      if (element.tagName === "A") continue;

      const computedColor = doc.defaultView?.getComputedStyle(element).color;
      if (!computedColor) continue;

      const parsedColor = parseRgbColor(computedColor);
      if (!parsedColor) continue;

      const hasExplicitColor =
        element.hasAttribute("color") ||
        (element.getAttribute("style")?.toLowerCase().includes("color") ?? false);

      if (!hasExplicitColor) continue;

      if (contrastRatio(parsedColor, themedBackground) < 3) {
        element.style.color = "var(--foreground)";
      }
    }

    // Intercept link clicks — open in new tab with optional warning
    const handleLinkClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      e.preventDefault();
      e.stopPropagation();

      if (dismissedRef.current) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        setPendingUrl(href);
      }
    };
    doc.addEventListener("click", handleLinkClick);

    // Auto-resize iframe to content height
    let frameId: number | null = null;
    const scheduleResize = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        resize();
      });
    };

    const resize = () => {
      if (iframeRef.current && doc.body && doc.documentElement) {
        const nextHeight = Math.max(
          doc.body.scrollHeight,
          doc.documentElement.scrollHeight,
          doc.body.offsetHeight,
          doc.documentElement.offsetHeight,
        );
        iframeRef.current.style.height = `${nextHeight}px`;
      }
    };
    scheduleResize();

    const imageLoadCleanup = Array.from(doc.images).map((image) => {
      image.addEventListener("load", scheduleResize);
      image.addEventListener("error", scheduleResize);
      return () => {
        image.removeEventListener("load", scheduleResize);
        image.removeEventListener("error", scheduleResize);
      };
    });

    // Re-check after DOM changes and host panel resizes.
    const observer = new MutationObserver(scheduleResize);
    observer.observe(doc.body, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(doc.documentElement);
    resizeObserver.observe(doc.body);
    if (iframeRef.current) {
      resizeObserver.observe(iframeRef.current);
    }
    window.addEventListener("resize", scheduleResize);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      for (const cleanup of imageLoadCleanup) {
        cleanup();
      }
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleResize);
      doc.removeEventListener("click", handleLinkClick);
    };
  }, [html]);

  const openPendingUrl = () => {
    if (dontShowAgain) dismiss();
    if (pendingUrl) window.open(pendingUrl, "_blank", "noopener,noreferrer");
    setPendingUrl(null);
    setDontShowAgain(false);
  };

  const cancelPendingUrl = () => {
    setPendingUrl(null);
    setDontShowAgain(false);
  };

  const body = html ? (
    <iframe
      ref={iframeRef}
      title="Email content"
      className="block w-full overflow-hidden border-0 bg-transparent"
      sandbox="allow-same-origin"
      scrolling="no"
      style={{ minHeight: 100 }}
    />
  ) : text ? (
    <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">
      {text}
    </pre>
  ) : (
    <p className="text-sm text-muted-foreground italic">No content available</p>
  );

  return (
    <>
      {body}
      <AlertDialog open={!!pendingUrl} onOpenChange={(open) => { if (!open) cancelPendingUrl(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Opening external link</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to leave and open an external link in a new tab:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-all text-xs font-mono text-foreground">
              {pendingUrl}
            </span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(checked === true)}
            />
            <span className="text-xs text-muted-foreground select-none">
              Don't show this warning again
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPendingUrl}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={openPendingUrl}>
              Open link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function GmailThreadDetailSkeleton() {
  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-3 w-24" />
      </div>
      <Separator className="my-4" />
      <div className="space-y-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

export function GmailThreadDetailEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <MailOpen className="size-10" strokeWidth={1.25} />
      <p className="text-sm">Select an email to read</p>
    </div>
  );
}

type GmailThreadDetailProps = {
  thread: GmailThread;
  detail: GmailThreadDetailType | undefined;
  isLoading: boolean;
  googleAccount: OAuthConnection | null;
  onClose: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
};

export function GmailThreadDetail({
  thread,
  detail,
  isLoading,
  googleAccount,
  onClose,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: GmailThreadDetailProps) {
  const draftsCtx = useDrafts();
  const composeAnchorRef = useRef<HTMLDivElement>(null);
  const autoOpenedDraftIdRef = useRef<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [pendingDraftToOpenId, setPendingDraftToOpenId] = useState<string | null>(null);
  const accountId = googleAccount?.providerAccountId ?? null;

  const {
    isRead,
    isArchiving,
    isTrashing,
    isTogglingRead,
    archive,
    trash,
    toggleRead,
  } = useGmailThreadActions(thread, googleAccount, onClose);

  const { data: threadDrafts = [] } = useGmailThreadDrafts(
    thread,
    detail,
    googleAccount,
  );

  const { data: draftCompose } = useGmailComposeDraft(
    selectedDraftId,
    googleAccount,
  );

  const orderedThreadDrafts = useMemo(() => {
    const order = new Map(
      (detail?.messages ?? []).map((message, index) => [message.id, index]),
    );

    return [...threadDrafts].sort(
      (a, b) =>
        (order.get(a.messageId) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(b.messageId) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [detail?.messages, threadDrafts]);

  const scrollComposerIntoView = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        composeAnchorRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    });
  }, []);

  // Get the inline draft for this thread from the global store
  const inlineDraft = useMemo(
    () => {
      if (!draftsCtx.inlineDraftId) return null;
      const d = draftsCtx.getDraft(draftsCtx.inlineDraftId);
      if (!d) return null;
      // Only show inline if the draft belongs to this thread
      if (d.form.threadId !== thread.threadId) return null;
      return d;
    },
    [draftsCtx, thread.threadId],
  );

  // Reset auto-open tracking when thread changes
  useEffect(() => {
    autoOpenedDraftIdRef.current = null;
    setSelectedDraftId(null);
    setPendingDraftToOpenId(null);
  }, [thread.threadId]);

  // Auto-open latest draft for this thread
  useEffect(() => {
    if (orderedThreadDrafts.length === 0) return;
    if (autoOpenedDraftIdRef.current) return;

    // Don't auto-open if there's already an inline draft for this thread
    if (inlineDraft) return;

    const latestDraftId =
      orderedThreadDrafts[orderedThreadDrafts.length - 1]?.draftId ?? null;
    if (!latestDraftId) return;

    autoOpenedDraftIdRef.current = latestDraftId;
    setSelectedDraftId(latestDraftId);
    setPendingDraftToOpenId(latestDraftId);
  }, [orderedThreadDrafts, inlineDraft]);

  // Open fetched draft in global store
  useEffect(() => {
    if (!draftCompose) return;
    if (pendingDraftToOpenId !== draftCompose.draftId) return;

    // Check if we already have this draft open in the store
    const existing = draftsCtx.drafts.find(
      (d) => d.gmailDraftId === draftCompose.draftId,
    );
    if (existing) {
      draftsCtx.setInlineDraft(existing.id);
      setPendingDraftToOpenId(null);
      scrollComposerIntoView();
      return;
    }

    const id = draftsCtx.openDraftWithForm(
      draftCompose.draftId,
      draftCompose.form,
      draftCompose.quotedContent,
      accountId,
      true, // inline
    );
    setPendingDraftToOpenId(null);
    scrollComposerIntoView();

    // Suppress unused variable warning — id is used by openDraftWithForm to register
    void id;
  }, [
    draftCompose,
    pendingDraftToOpenId,
    draftsCtx,
    accountId,
    scrollComposerIntoView,
  ]);

  const draftsByMessageId = useMemo(
    () =>
      new Map(
        threadDrafts.map((draft) => [draft.messageId, draft]),
      ),
    [threadDrafts],
  );

  const editingDraftMessageId = useMemo(() => {
    if (!inlineDraft?.gmailDraftId) return null;
    return (
      threadDrafts.find((draft) => draft.draftId === inlineDraft.gmailDraftId)?.messageId
      ?? draftCompose?.messageId
      ?? null
    );
  }, [inlineDraft?.gmailDraftId, draftCompose?.messageId, threadDrafts]);

  const openComposeFromToolbar = useCallback(
    (mode: ComposeMode) => {
      setSelectedDraftId(null);
      setPendingDraftToOpenId(null);

      const msg = detail?.messages[detail.messages.length - 1];
      const userEmail = ""; // Will be resolved by the panel's useGoogleProfile
      let form: Record<string, string | null> = {
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        body: "",
        inReplyTo: "",
        references: "",
        threadId: thread.threadId,
      };
      let quotedContent: string | null = null;
      let label = "";

      if (mode === "reply" && msg) {
        form.to = msg.from.email;
        form.subject = prefixSubject(detail?.subject ?? msg.subject, "Re");
        form.inReplyTo = msg.messageId;
        form.references = [msg.references, msg.messageId].filter(Boolean).join(" ");
        quotedContent = buildQuotedText(msg);
        label = `Re: ${detail?.subject ?? msg.subject}`;
      } else if (mode === "reply-all" && msg) {
        form.to = msg.from.email;
        const allCc = [msg.to, msg.cc].filter(Boolean).join(", ");
        form.cc = userEmail ? filterOutEmail(allCc, userEmail) : allCc;
        form.subject = prefixSubject(detail?.subject ?? msg.subject, "Re");
        form.inReplyTo = msg.messageId;
        form.references = [msg.references, msg.messageId].filter(Boolean).join(" ");
        quotedContent = buildQuotedText(msg);
        label = `Re: ${detail?.subject ?? msg.subject}`;
      } else if (mode === "forward" && msg) {
        form.subject = prefixSubject(detail?.subject ?? msg.subject, "Fwd");
        const content = msg.bodyText ?? (msg.bodyHtml ? stripHtmlTags(msg.bodyHtml) : "");
        const header = [
          "---------- Forwarded message ----------",
          `From: ${msg.from.name} <${msg.from.email}>`,
          `Date: ${msg.date}`,
          `Subject: ${msg.subject}`,
          `To: ${msg.to}`,
          msg.cc ? `Cc: ${msg.cc}` : null,
          "",
        ]
          .filter(Boolean)
          .join("\n");
        form.body = `${header}\n${content}`;
        form.threadId = null;
        label = `Fwd: ${detail?.subject ?? msg.subject}`;
      }

      // Close any existing inline draft for this thread first
      if (inlineDraft) {
        draftsCtx.setInlineDraft(null);
      }

      draftsCtx.openDraft({
        mode,
        form: form as Record<string, string> & { threadId: string | null },
        quotedContent,
        label,
        accountId,
        inline: true,
      });

      scrollComposerIntoView();
    },
    [detail, thread.threadId, accountId, draftsCtx, inlineDraft, scrollComposerIntoView],
  );

  if (isLoading) {
    return <GmailThreadDetailSkeleton />;
  }

  const messages = detail?.messages ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Header toolbar */}
      <TooltipProvider>
        <div className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={isArchiving || isTrashing || isTogglingRead}
                  onClick={() => void archive()}
                >
                  {isArchiving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Archive className="size-4" />
                  )}
                </Button>
              } />
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={isArchiving || isTrashing || isTogglingRead}
                  onClick={() => void trash()}
                >
                  {isTrashing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              } />
              <TooltipContent>Move to trash</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={isArchiving || isTrashing || isTogglingRead}
                  onClick={() => void toggleRead()}
                >
                  {isTogglingRead ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isRead ? (
                    <Mail className="size-4" />
                  ) : (
                    <MailOpen className="size-4" />
                  )}
                </Button>
              } />
              <TooltipContent>{isRead ? "Mark as unread" : "Mark as read"}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openComposeFromToolbar("reply")}
                >
                  <Reply className="size-4" />
                </Button>
              } />
              <TooltipContent>Reply</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openComposeFromToolbar("reply-all")}
                >
                  <ReplyAll className="size-4" />
                </Button>
              } />
              <TooltipContent>Reply all</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openComposeFromToolbar("forward")}
                >
                  <Forward className="size-4" />
                </Button>
              } />
              <TooltipContent>Forward</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!hasPrev}
                  onClick={onPrev}
                >
                  <ChevronUp className="size-4" />
                </Button>
              } />
              <TooltipContent>Newer</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!hasNext}
                  onClick={onNext}
                >
                  <ChevronDown className="size-4" />
                </Button>
              } />
              <TooltipContent>Older</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Tooltip>
              <TooltipTrigger render={
                <Button variant="ghost" size="icon-sm" onClick={onClose}>
                  <X className="size-4" />
                </Button>
              } />
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* Subject */}
      <div className="border-b px-6 py-4">
        <h2 className="text-lg font-semibold leading-tight">
          {thread.subject}
        </h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.map((msg, idx) => {
          const draft = draftsByMessageId.get(msg.id);
          const isEditingThisDraft = editingDraftMessageId === msg.id;

          return (
          <div key={msg.id}>
            {idx > 0 && <Separator />}
            <div className="px-6 py-4">
              <div className="flex items-start gap-3">
                <GmailSenderAvatar
                  name={msg.from.name}
                  email={msg.from.email}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <span className="shrink-0 text-sm font-semibold">
                        {msg.from.name}
                      </span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        &lt;{msg.from.email}&gt;
                      </span>
                      {draft && (
                        <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] uppercase">
                          Draft
                        </Badge>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatFullDate(msg.date)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="truncate text-xs text-muted-foreground">
                      To: {msg.to}
                    </p>
                    {draft && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="shrink-0 text-xs"
                        onClick={() => {
                          setSelectedDraftId(draft.draftId);
                          setPendingDraftToOpenId(draft.draftId);
                        }}
                      >
                        {isEditingThisDraft ? "Editing below" : "Edit draft"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              {!isEditingThisDraft && (
                <div className="mt-4">
                  <MessageBody html={msg.bodyHtml} text={msg.bodyText} />
                </div>
              )}
            </div>
          </div>
          );
        })}

        {/* Inline compose for reply/reply-all/forward */}
        <div ref={composeAnchorRef} className="scroll-mt-2">
          {inlineDraft && (
            <ComposeInline
              draft={inlineDraft}
              googleAccount={googleAccount}
            />
          )}
        </div>
      </div>
    </div>
  );
}
