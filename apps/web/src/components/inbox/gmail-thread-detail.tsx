import { useRef, useEffect, useCallback, useState } from "react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { Button } from "@g-spot/ui/components/button";
import { Separator } from "@g-spot/ui/components/separator";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import type { OAuthConnection } from "@stackframe/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
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
import {
  archiveGmailThread,
  trashGmailThread,
  modifyGmailThreadLabels,
} from "@/lib/gmail/api";
import { useComposeState } from "@/hooks/use-compose-state";
import { ComposeInline } from "./compose-inline";
import type { GmailThread } from "@/lib/gmail/types";
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

function getSenderAvatarUrl(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const personalDomains = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com",
    "outlook.com", "live.com", "aol.com", "icloud.com",
    "protonmail.com", "proton.me",
  ]);
  if (personalDomains.has(domain)) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function MessageBody({ html, text }: { html: string | null; text: string | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!html || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: hsl(var(--foreground, 0 0% 3.9%));
            overflow-wrap: break-word;
            word-break: break-word;
          }
          img { max-width: 100%; height: auto; }
          a { color: hsl(var(--primary, 221.2 83.2% 53.3%)); }
          blockquote {
            margin: 8px 0;
            padding-left: 12px;
            border-left: 3px solid hsl(var(--border, 214.3 31.8% 91.4%));
            color: hsl(var(--muted-foreground, 215.4 16.3% 46.9%));
          }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `);
    doc.close();

    // Auto-resize iframe to content height
    const resize = () => {
      if (iframeRef.current && doc.body) {
        iframeRef.current.style.height = `${doc.body.scrollHeight}px`;
      }
    };
    resize();
    // Re-check after images load
    const observer = new MutationObserver(resize);
    observer.observe(doc.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [html]);

  if (html) {
    return (
      <iframe
        ref={iframeRef}
        title="Email content"
        className="w-full border-0"
        sandbox="allow-same-origin"
        style={{ minHeight: 100 }}
      />
    );
  }

  if (text) {
    return (
      <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">
        {text}
      </pre>
    );
  }

  return (
    <p className="text-sm text-muted-foreground italic">No content available</p>
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
};

export function GmailThreadDetail({
  thread,
  detail,
  isLoading,
  googleAccount,
  onClose,
}: GmailThreadDetailProps) {
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    if (!googleAccount) throw new Error("No Google account connected");
    const result = await googleAccount.getAccessToken();
    if (result.status === "error") throw new Error("Failed to get access token");
    return result.data.accessToken;
  }, [googleAccount]);

  const handleArchive = useCallback(async () => {
    setActionLoading("archive");
    try {
      const token = await getAccessToken();
      await archiveGmailThread(token, thread.threadId);
      await queryClient.invalidateQueries({ queryKey: ["gmail"] });
      onClose();
    } catch {
      // TODO: toast
    } finally {
      setActionLoading(null);
    }
  }, [getAccessToken, thread.threadId, queryClient, onClose]);

  const handleTrash = useCallback(async () => {
    setActionLoading("trash");
    try {
      const token = await getAccessToken();
      await trashGmailThread(token, thread.threadId);
      await queryClient.invalidateQueries({ queryKey: ["gmail"] });
      onClose();
    } catch {
      // TODO: toast
    } finally {
      setActionLoading(null);
    }
  }, [getAccessToken, thread.threadId, queryClient, onClose]);

  const handleMarkUnread = useCallback(async () => {
    setActionLoading("unread");
    try {
      const token = await getAccessToken();
      await modifyGmailThreadLabels(token, thread.threadId, ["UNREAD"]);
      await queryClient.invalidateQueries({ queryKey: ["gmail"] });
      onClose();
    } catch {
      // TODO: toast
    } finally {
      setActionLoading(null);
    }
  }, [getAccessToken, thread.threadId, queryClient, onClose]);

  const compose = useComposeState(googleAccount);

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
                  disabled={actionLoading !== null}
                  onClick={handleArchive}
                >
                  {actionLoading === "archive" ? (
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
                  disabled={actionLoading !== null}
                  onClick={handleTrash}
                >
                  {actionLoading === "trash" ? (
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
                  disabled={actionLoading !== null}
                  onClick={handleMarkUnread}
                >
                  {actionLoading === "unread" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Mail className="size-4" />
                  )}
                </Button>
              } />
              <TooltipContent>Mark as unread</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => compose.openCompose("reply", detail)}
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
                  onClick={() => compose.openCompose("reply-all", detail)}
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
                  onClick={() => compose.openCompose("forward", detail)}
                >
                  <Forward className="size-4" />
                </Button>
              } />
              <TooltipContent>Forward</TooltipContent>
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
        {messages.map((msg, idx) => (
          <div key={msg.id}>
            {idx > 0 && <Separator />}
            <div className="px-6 py-4">
              <div className="flex items-start gap-3">
                <Avatar size="default">
                  <AvatarImage
                    src={getSenderAvatarUrl(msg.from.email) ?? undefined}
                    alt={msg.from.name}
                  />
                  <AvatarFallback>
                    {msg.from.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {msg.from.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatFullDate(msg.date)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    To: {msg.to}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <MessageBody html={msg.bodyHtml} text={msg.bodyText} />
              </div>
            </div>
          </div>
        ))}

        {/* Inline compose for reply/reply-all/forward */}
        <ComposeInline compose={compose} />
      </div>
    </div>
  );
}
